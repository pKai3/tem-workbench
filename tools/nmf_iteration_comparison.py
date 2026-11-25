"""Compare NMF iteration budgets using saved spectra and verified native pixels.

Both runs use the current crystal fitting engine, captured settings, all saved
windows and exhaustive factor subsets. Writes only to the requested output.
Reconstruction/fit improvement is same-image evidence, not external validation.
"""
import argparse
import copy
import gzip
import hashlib
import html
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tem_workbench.app.engine import Engine, png
from tem_workbench.components import shared_spectra as spectra, nmf_fitting, nmf_phase_maps
from tem_workbench.components import component_maps
from tem_workbench.components.hypothesis_selection import automatic_pool
import numpy as np
from PIL import Image, ImageDraw
from io import BytesIO


def winners(maps, ids):
    ids = set(ids)
    return [min((c for c in w['candidates'] if c['valid'] and c['model'] in ids),
                key=lambda c: (-c['score'], c['model']), default=None) for w in maps['windows']]


def window_metrics(values):
    return dict(supported=sum(v is not None for v in values),
                winning_phases={p: sum(v is not None and v['phase'] == p for v in values)
                                for p in sorted({v['phase'] for v in values if v})},
                mean_best_passing_rank=float(np.mean([v['score'] if v else 0. for v in values])))


def compare_windows(before, after):
    if len(before) != len(after):
        raise ValueError('The compared window counts differ.')
    return dict(gained=sum(a is None and b is not None for a, b in zip(before, after)),
                lost=sum(a is not None and b is None for a, b in zip(before, after)),
                changed_winning_phase=sum(a is not None and b is not None and a['phase'] != b['phase'] for a, b in zip(before, after)),
                rank_improved=sum(b is not None and b['score'] > (a['score'] if a else 0.) + 1e-6 for a, b in zip(before, after)),
                rank_worsened=sum(a is not None and a['score'] > (b['score'] if b else 0.) + 1e-6 for a, b in zip(before, after)),
                mean_best_passing_rank_change=float(np.mean([(b['score'] if b else 0.) - (a['score'] if a else 0.) for a, b in zip(before, after)])))


def compare_aggregates(before, after):
    if [(c['x'],c['y']) for c in before['cells']] != [(c['x'],c['y']) for c in after['cells']]:
        raise ValueError('The compared map grids differ.')
    phases = sorted(set(before['keys']) | set(after['keys']))
    result = {}
    for phase in phases:
        result[phase] = {}
        for metric in ('support','passing_strength'):
            changes = [abs(b['phases'].get(phase,{}).get(metric,0.) - a['phases'].get(phase,{}).get(metric,0.))
                       for a,b in zip(before['cells'],after['cells'])]
            result[phase][metric] = dict(mean_absolute_change=float(np.mean(changes)) if changes else 0.,
                                        max_absolute_change=max(changes,default=0.))
    return result


def map_png(image, plan, values, destination, before=None):
    canvas = Image.open(BytesIO(png(image, max_size=600))).convert('RGB')
    draw = ImageDraw.Draw(canvas)
    sx, sy = canvas.width / image.shape[1], canvas.height / image.shape[0]
    for i, sample in enumerate(spectra.window_samples(plan)):
        value = values[i]
        if before is None:
            colour = {'HCP': '#ffad42', 'BCC': '#56c7ff'}.get(value['phase'], '#cb6ce6') if value else '#858585'
        else:
            old = before[i]
            colour = '#3acb7c' if old is None and value is not None else '#ff5252' if old is not None and value is None else '#e766ff' if old and value and old['phase'] != value['phase'] else None
            if colour is None:
                continue
        roi = sample['roi'];x = (roi['x'] + roi['w']/2)*sx;y = (roi['y'] + roi['h']/2)*sy
        draw.ellipse((x-3, y-3, x+3, y+3), fill=colour, outline='#161616')
    canvas.save(destination)


def write_report(output, records):
    text = '<!doctype html><meta charset="utf-8"><title>NMF iteration comparison</title><style>body{font:16px system-ui;max-width:1250px;margin:32px auto;padding:0 20px;color:#17202b}table{border-collapse:collapse}td,th{padding:8px 16px;border-bottom:1px solid #ccc;text-align:right}th:first-child,td:first-child{text-align:left}.maps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0}img{width:100%}small{color:#526173}h2{margin-top:48px}@media(max-width:700px){.maps{grid-template-columns:1fr}}</style><h1>NMF: 300 versus 3,000 iterations</h1><p>Matched spectra, native pixels, preprocessing, seed, factor count, all nonempty subsets and current crystal fitting engine. All saved windows, including rim samples, are retained. Auto pools are independently selected by the app’s 99% coverage rule.</p><p>More support or a higher fit rank is not independent evidence of correct phase identification. The 300-iteration maps are rerun with the same current engine as the longer runs.</p>'
    for record in records:
        text += '<h2>' + html.escape(record['name']) + '</h2><table><tr><th>Limit</th><th>Actual steps</th><th>Converged</th><th>Reconstruction error</th><th>Passing groups</th><th>Hypotheses</th><th>Decompose / fit / map, s</th></tr>'
        for run in record['runs']:
            text += f"<tr><td>{run['limit']}</td><td>{run['iterations']}</td><td>{run['converged']}</td><td>{100*run['relative_error']:.4f}%</td><td>{run['passing_groups']}</td><td>{run['hypotheses']}</td><td>{' / '.join(f'{v:.1f}' for v in run['seconds'].values())}</td></tr>"
        text += '</table>'
        for mode, comparison in record['comparisons'].items():
            text += f'<h3>{mode.title()} hypothesis pool</h3><p>'
            a, b = [run['pools'][mode] for run in record['runs']]
            text += f"Supported windows: {a['supported']} → {b['supported']}. Gained {comparison['gained']}; lost {comparison['lost']}; changed winning phase {comparison['changed_winning_phase']}. Mean best passing rank across all windows: {a['mean_best_passing_rank']:.4f} → {b['mean_best_passing_rank']:.4f}.</p>"
            if comparison.get('continuous'):
                changes = '; '.join(f"{html.escape(phase)} {100*metrics['support']['mean_absolute_change']:.3f} percentage points" for phase,metrics in comparison['continuous'].items())
                text += f'<p>Continuous-map support: mean absolute change across the same raster cells, {changes}. These values describe map changes, not phase fractions.</p>'
            text += '<div class="maps">'
            for suffix, caption in [('300','300 iterations'),('3000','Up to 3,000 iterations'),('change','Changes in support / winning phase')]:
                filename = f"{record['stem']}_{mode}_{suffix}.png"
                text += f'<figure><img src="{html.escape(filename, quote=True)}" alt="{html.escape(caption)}"><figcaption>{caption}</figcaption></figure>'
            text += '</div><p><small>Maps: orange HCP, blue BCC, purple other phases, gray unresolved. Changes: green gained, red lost, magenta changed phase. These are window-centre classifications, not exact phase boundaries. Unmarked positions on the change panel retain support/phase; fit rank or orientation may still change.</small></p>'
    text += '<p><a href="comparison.json">Full metrics, settings and provenance</a>. Compressed per-run files retain every crystal fit and original-window candidate.</p>'
    (output/'report.html').write_text(text)
    (output/'comparison.json').write_text(json.dumps(records, indent=2, allow_nan=False)+'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exports', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--config', type=Path, default=ROOT/'.tem-paths.json')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.workers <= 16:
        parser.error('Choose 1–16 workers.')
    output = args.output.resolve();output.mkdir(parents=True, exist_ok=False)
    engine = Engine(json.loads(args.config.read_text()))
    records = []
    for path in args.exports:
        meta = json.loads(path.read_text());source = meta['source'];plan = meta['plan']
        if plan.get('method') != 'nmf' or meta.get('fit_status') != 'complete':
            raise ValueError('Use a completed NMF export.')
        source_path = Path(source['path'])
        engine.files[source['id']] = source_path;engine.file_rows[source['id']] = source
        item = engine.load(source['id'])
        if any(item['info'].get(k) != source.get(k) for k in ('sha256_pixels','pixel_x_nm','pixel_y_nm','width','height')):
            raise ValueError('Source pixels or calibration differ from the export.')
        with np.load(path.with_suffix('.npz'), allow_pickle=False) as saved:
            embedded = json.loads(str(saved['metadata']))
            if embedded['source'] != source or embedded['plan'] != plan or embedded['processing'] != meta['processing']:
                raise ValueError('JSON and NPZ provenance differ.')
            retained = {key:saved[key] for key in ('raw_spectra','normalizations','positions','radii','angles','area_weights')}
        positions = [[s['roi'][key] for key in ('x','y','w','h')] for s in spectra.window_samples(plan)]
        if len(retained['raw_spectra']) != plan['count'] or not np.array_equal(retained['positions'],positions):
            raise ValueError('Saved spectra and window footprints do not agree.')
        matrix = np.empty_like(retained['raw_spectra']);weights = retained['area_weights']
        for i, raw in enumerate(retained['raw_spectra']):
            matrix[i] = spectra.features(raw.reshape(weights.shape),plan,weights)[0].ravel()
        settings = meta['processing'];templates = engine.templates_for(settings)
        record = dict(name=source['name'],stem=path.stem,source=source,source_export=str(path.resolve()),
                      export_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                      npz_sha256=hashlib.sha256(path.with_suffix('.npz').read_bytes()).hexdigest(),
                      engine_sha256=engine.version,settings=settings,plan=plan,
                      decomposition_sha256=hashlib.sha256(Path(spectra.__file__).read_bytes()).hexdigest(),
                      runner_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),runs=[],comparisons={})
        previous = {};aggregates = {}
        for limit in (300, 3000):
            print(f"{source['name']}: {limit} iterations", flush=True)
            started=time.perf_counter();result=spectra.decompose_nmf(matrix,plan['components'],iterations=limit)
            timing=dict(decomposition=time.perf_counter()-started)
            if limit==300 and not np.isclose(result['relative_reconstruction_error'],meta['relative_reconstruction_error'],rtol=1e-7,atol=1e-10):
                raise ValueError('The baseline decomposition does not reproduce the saved error.')
            result.update(retained,plan={**copy.deepcopy(plan),'workers':args.workers,'nmf_max_iterations':limit},
                          source=source,settings=settings,method_version=spectra.VERSION,_source_image=item['array'])
            def progress(done,total,stage):
                if done==total or done%100==0:print(f'  {stage}: {done}/{total}',flush=True)
            started=time.perf_counter()
            fits=nmf_fitting.fit_groups(result,templates,dict(peak_fraction=meta['fits']['peak_fraction'],workers=args.workers),progress=progress)
            result['fit_status']='complete';timing['crystal_fits']=time.perf_counter()-started
            started=time.perf_counter();maps=nmf_phase_maps.build(result,templates,progress=progress)
            result['phase_support']=maps;timing['native_mapping']=time.perf_counter()-started
            run=dict(limit=limit,iterations=result['iterations'],converged=result['converged'],relative_error=result['relative_reconstruction_error'],seconds=timing,
                     passing_groups=sum(any(c['valid'] for c in g['candidates']) for g in fits['groups']),hypotheses=len(maps['models']),pools={})
            for mode, ids in [('all',[m['id'] for m in maps['models']]),('auto',automatic_pool(maps))]:
                values=winners(maps,ids);run['pools'][mode]=dict(models=ids,**window_metrics(values))
                map_png(item['array'],plan,values,output/f"{path.stem}_{mode}_{limit}.png")
                aggregated=component_maps.aggregate(result,dict(models=ids))
                if limit==300:
                    previous[mode]=values;aggregates[mode]=aggregated
                else:
                    record['comparisons'][mode]=compare_windows(previous[mode],values)
                    record['comparisons'][mode]['continuous']=compare_aggregates(aggregates[mode],aggregated)
                    map_png(item['array'],plan,values,output/f"{path.stem}_{mode}_change.png",before=previous[mode])
                with gzip.open(output/f'{path.stem}_{mode}_{limit}_aggregate.json.gz','wt') as handle:
                    json.dump(aggregated,handle,allow_nan=False)
            with gzip.open(output/f'{path.stem}_{limit}.json.gz','wt') as handle:
                json.dump(dict(summary=run,fits=fits,phase_support=maps),handle,allow_nan=False)
            record['runs'].append(run)
            print(json.dumps(run),flush=True)
        records.append(record);write_report(output,records)
        engine.loaded.clear()


if __name__ == '__main__':
    main()
