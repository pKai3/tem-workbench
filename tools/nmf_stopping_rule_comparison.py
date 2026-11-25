"""Audit NMF stopping rules on unchanged update trajectories and native maps.

Research runner only: never changes the production solver or source exports.
The forced 3,000-step endpoint is a comparison, not scientific ground truth.
"""
import argparse
import copy
import gzip
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.nmf_iteration_comparison import (
    Engine, spectra, nmf_fitting, nmf_phase_maps, component_maps, automatic_pool,
    winners, window_metrics, compare_windows, compare_aggregates, map_png,
)
import numpy as np
from scipy.optimize import linear_sum_assignment


RULES = {
    'current': dict(metric='relative_squared_improvement', tolerance=1e-5, patience=1),
    'initial_1e-4': dict(metric='initial_scaled_improvement', tolerance=1e-4, patience=1),
    'initial_1e-4_p3': dict(metric='initial_scaled_improvement', tolerance=1e-4, patience=3),
    'initial_1e-5_p3': dict(metric='initial_scaled_improvement', tolerance=1e-5, patience=3),
}
MAPPED_RULES = ('current', 'initial_1e-4_p3', 'initial_1e-5_p3')


def advance_rules(row, streaks, stops, rules=RULES):
    for name, rule in rules.items():
        value = row[rule['metric']]
        qualifies = row['iteration'] >= 50 and value is not None and 0 <= value < rule['tolerance']
        streaks[name] = streaks.get(name, 0) + 1 if qualifies else 0
        if name not in stops and streaks[name] >= rule['patience']:
            stops[name] = row['iteration']


def result_at(matrix, w, h, step, energy):
    w = w.copy();h = h.copy()
    norm = np.maximum(h.sum(axis=1), 1e-20);h /= norm[:, None];w *= norm[None, :]
    shares = w.sum(axis=0, dtype=np.float64);shares /= shares.sum()
    order = np.argsort(-shares);h = h[order];w = w[:, order];shares = shares[order]
    residual = np.sqrt(spectra.reconstruction_errors(matrix, w, h))
    return dict(mean=np.zeros(matrix.shape[1], np.float32), components=h, scores=w,
                explained_variance_ratio=np.zeros(len(h)), contribution_share=shares,
                residual=residual, algorithm='euclidean_multiplicative_nmf_seed0',
                total_energy=energy, iterations=step, iteration_limit=step,
                relative_reconstruction_error=float(np.linalg.norm(residual)/np.sqrt(energy)))


def trace_decomposition(matrix, components, maximum=3000):
    """Exact production updates, retaining checkpoints while deliberately continuing."""
    x = np.asarray(matrix, dtype=np.float32)
    k = min(int(components), min(x.shape));rng = np.random.default_rng(0)
    amplitude = np.sqrt(float(x.mean())/k)
    w = (rng.random((len(x), k), dtype=np.float32)+.1)*amplitude
    h = (rng.random((k, x.shape[1]), dtype=np.float32)+.1)*amplitude
    energy = float(spectra.squared_row_norms(x).sum())
    initial = float(np.sqrt(spectra.reconstruction_errors(x, w, h).sum()))
    previous = None;trace = [];streaks = {};stops = {};states = {}
    started = time.perf_counter()
    for step in range(1, maximum+1):
        h *= (w.T@x)/np.maximum((w.T@w)@h, 1e-20)
        w *= (x@h.T)/np.maximum(w@(h@h.T), 1e-20)
        if step % 10 == 0 or step == maximum:
            error = float(spectra.reconstruction_errors(x, w, h).sum())
            row = dict(iteration=step, squared_error=error,
                       relative_error=float(np.sqrt(error/energy)),
                       relative_squared_improvement=None if previous is None else (previous-error)/max(previous, 1e-20),
                       initial_scaled_improvement=None if previous is None else (np.sqrt(previous)-np.sqrt(error))/max(initial, 1e-20),
                       seconds=time.perf_counter()-started)
            advance_rules(row, streaks, stops);trace.append(row);previous = error
            if step in (300, maximum) or step in stops.values():
                states[step] = result_at(x, w, h, step, energy)
    # Detect future drift between this diagnostic loop and the production solver.
    baseline = spectra.decompose_nmf(x, components, iterations=300)
    checkpoint = states[baseline['iterations']]
    for key in ('components', 'scores', 'residual'):
        np.testing.assert_array_equal(checkpoint[key], baseline[key])
    return dict(initial_relative_error=initial/np.sqrt(energy), rules=copy.deepcopy(RULES),
                stops={name: stops.get(name) for name in RULES}, trace=trace), states


def factor_change(before, after):
    a, b = before['components'], after['components']
    similarities = (a/np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-20)) @ (b/np.maximum(np.linalg.norm(b, axis=1, keepdims=True), 1e-20)).T
    rows, cols = linear_sum_assignment(-similarities)
    scores = before['scores'];other = after['scores'][:, cols]
    return dict(min_spectral_cosine=float(similarities[rows, cols].min()),
                median_spectral_cosine=float(np.median(similarities[rows, cols])),
                relative_activity_change=float(np.linalg.norm(other-scores)/max(np.linalg.norm(scores), 1e-20)))


def phase_evidence(maps, ids):
    ids = set(ids)
    phases = sorted({c['phase'] for w in maps['windows'] for c in w['candidates'] if c['model'] in ids})
    return {p: [any(c['valid'] and c['phase'] == p and c['model'] in ids for c in w['candidates'])
                for w in maps['windows']] for p in phases}


def compare_phase_evidence(before, after, count):
    changes = {}
    for phase in sorted(set(before) | set(after)):
        a = before.get(phase, [False]*count);b = after.get(phase, [False]*count)
        changes[phase] = dict(before=sum(a), after=sum(b),
                              gained=sum(not x and y for x, y in zip(a, b)),
                              lost=sum(x and not y for x, y in zip(a, b)))
    return changes


def compare_results(before, after, factor_before, factor_after):
    result = dict(factors=factor_change(factor_before, factor_after), pools={})
    for mode in ('all', 'auto'):
        a, b = before['pools'][mode], after['pools'][mode]
        values = compare_windows(a['winners'], b['winners'])
        values['changed_outcomes'] = values['gained']+values['lost']+values['changed_winning_phase']
        values['continuous'] = compare_aggregates(a['aggregate'], b['aggregate'])
        values['phase_evidence'] = compare_phase_evidence(a['phase_evidence'], b['phase_evidence'], len(a['winners']))
        # Template/mirror changes can flag orientation differences even if phase labels agree.
        values['changed_winning_template_same_phase'] = sum(
            x is not None and y is not None and x['phase'] == y['phase'] and
            (x['template_id'], x['mirror']) != (y['template_id'], y['mirror'])
            for x, y in zip(a['winners'], b['winners']))
        result['pools'][mode] = values
    return result


def code_hashes():
    paths = ['tem_workbench/components/'+name+'.py' for name in (
        'shared_spectra', 'nmf_fitting', 'nmf_phase_maps', 'component_maps',
        'component_validation', 'hypothesis_selection')]
    paths += ['tem_workbench/analysis/analysis_core.py', 'tools/nmf_stopping_rule_comparison.py',
              'tools/nmf_iteration_comparison.py']
    return {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths}


def load_input(engine, path):
    meta = json.loads(path.read_text());source = meta['source'];plan = meta['plan']
    if plan.get('method') != 'nmf' or meta.get('fit_status') != 'complete':
        raise ValueError('Use completed NMF exports.')
    engine.files[source['id']] = Path(source['path']);engine.file_rows[source['id']] = source
    item = engine.load(source['id'])
    if any(item['info'].get(k) != source.get(k) for k in ('sha256_pixels', 'pixel_x_nm', 'pixel_y_nm', 'width', 'height')):
        raise ValueError('Source pixels or calibration differ from the export.')
    with np.load(path.with_suffix('.npz'), allow_pickle=False) as saved:
        embedded = json.loads(str(saved['metadata']))
        if any(embedded[k] != meta[k] for k in ('source', 'plan', 'processing')):
            raise ValueError('JSON and NPZ provenance differ.')
        retained = {key: saved[key] for key in ('raw_spectra', 'normalizations', 'positions', 'radii', 'angles', 'area_weights')}
    positions = [[s['roi'][key] for key in ('x', 'y', 'w', 'h')] for s in spectra.window_samples(plan)]
    if len(retained['raw_spectra']) != plan['count'] or not np.array_equal(retained['positions'], positions):
        raise ValueError('Spectra and window footprints differ.')
    matrix = np.empty_like(retained['raw_spectra']);weights = retained['area_weights']
    for i, raw in enumerate(retained['raw_spectra']):
        matrix[i] = spectra.features(raw.reshape(weights.shape), plan, weights)[0].ravel()
    return meta, retained, matrix, item


def map_checkpoint(engine, meta, retained, image, result, workers, output, stem, step):
    plan = meta['plan'];settings = meta['processing'];templates = engine.templates_for(settings)
    result.update(retained, plan={**copy.deepcopy(plan), 'workers': workers, 'nmf_max_iterations': step},
                  source=meta['source'], settings=settings, method_version=spectra.VERSION, _source_image=image)
    started = time.perf_counter()
    fits = nmf_fitting.fit_groups(result, templates, dict(peak_fraction=meta['fits']['peak_fraction'], workers=workers))
    fit_seconds = time.perf_counter()-started;result['fit_status'] = 'complete'
    started = time.perf_counter();maps = nmf_phase_maps.build(result, templates);result['phase_support'] = maps
    run = dict(iterations=step, current_rule_converged=result['converged'], relative_error=result['relative_reconstruction_error'],
               seconds=dict(crystal_fits=fit_seconds, native_mapping=time.perf_counter()-started),
               passing_groups=sum(any(c['valid'] for c in g['candidates']) for g in fits['groups']),
               hypotheses=len(maps['models']), pools={})
    payload = dict(summary=run, fits=fits, phase_support=maps, pools={})
    for mode, ids in [('all', [m['id'] for m in maps['models']]), ('auto', automatic_pool(maps))]:
        values = winners(maps, ids);evidence = phase_evidence(maps, ids)
        run['pools'][mode] = dict(models=ids, **window_metrics(values), phase_supported={k: sum(v) for k, v in evidence.items()})
        payload['pools'][mode] = dict(winners=values, phase_evidence=evidence, aggregate=component_maps.aggregate(result, dict(models=ids)))
        map_png(image, plan, values, output/f'{stem}_{mode}_{step}.png')
    with gzip.open(output/f'{stem}_{step}.json.gz', 'wt') as handle:
        json.dump(payload, handle, allow_nan=False)
    np.savez_compressed(output/f'{stem}_{step}_factors.npz', components=result['components'], scores=result['scores'], residual=result['residual'])
    return run, payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection', type=Path, required=True, help='JSON list of export records with path/name fields')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--config', type=Path, default=ROOT/'.tem-paths.json')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.workers <= 16:parser.error('Choose 1–16 workers.')
    output = args.output.resolve();output.mkdir(parents=True, exist_ok=False)
    selection = json.loads(args.selection.read_text());hashes = code_hashes()
    audit = dict(rules=RULES, maximum=3000, minimum=50, interval=10, selection=selection,
                 code_sha256=hashes, records=[], limitations=[
                     'Ten selected acquisitions from one batch; not a random population sample.',
                     'Overlapping windows are correlated; no independent accuracy labels.',
                     'The forced 3000-step endpoint is not ground truth or necessarily converged.',
                     'One initialization, eight factors and captured preprocessing; other configurations untested.',
                     'Both all and independently selected Auto hypothesis pools are compared.'])
    (output/'selection.json').write_text(args.selection.read_text())
    engine = Engine(json.loads(args.config.read_text()))
    for number, selected in enumerate(selection, 1):
        path = Path(selected['path']);print(f"IMAGE {number}/{len(selection)} {selected['name']}", flush=True)
        meta, retained, matrix, item = load_input(engine, path)
        diagnostic, states = trace_decomposition(matrix, meta['plan']['components'])
        if not np.isclose(states[300]['relative_reconstruction_error'], meta['relative_reconstruction_error'], rtol=1e-7, atol=1e-10):
            raise ValueError('The 300-step replay differs from the saved reconstruction error.')
        record = dict(name=meta['source']['name'], stem=path.stem, source_export=str(path.resolve()),
                      export_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                      npz_sha256=hashlib.sha256(path.with_suffix('.npz').read_bytes()).hexdigest(),
                      source=meta['source'], plan=meta['plan'], settings=meta['processing'],
                      diagnostic=diagnostic, runs={}, comparisons={})
        print('STOPS '+json.dumps(diagnostic['stops']), flush=True)
        checkpoints = sorted({300, 3000} | {diagnostic['stops'][name] for name in MAPPED_RULES if diagnostic['stops'][name] is not None})
        payloads = {}
        for step in checkpoints:
            print(f'  Mapping checkpoint {step}', flush=True)
            states[step]['converged'] = diagnostic['stops']['current'] is not None and diagnostic['stops']['current'] <= step
            run, payload = map_checkpoint(engine, meta, retained, item['array'], states[step], args.workers, output, path.stem, step)
            run['seconds']['decomposition'] = next(t['seconds'] for t in diagnostic['trace'] if t['iteration'] == step)
            record['runs'][str(step)] = run;payloads[step] = payload
            print('  RESULT '+json.dumps(run), flush=True)
            # Drop shared arrays from checkpoints to avoid retaining the image via each result.
            for key in (*retained, '_source_image', 'fits', 'phase_support'):
                states[step].pop(key, None)
        for step in checkpoints:
            record['comparisons'][str(step)] = {}
            for reference in (300, 3000):
                record['comparisons'][str(step)][str(reference)] = compare_results(payloads[reference], payloads[step], states[reference], states[step])
            if step != 3000:
                for mode in ('all', 'auto'):
                    map_png(item['array'], meta['plan'], payloads[step]['pools'][mode]['winners'],
                            output/f'{path.stem}_{mode}_{step}_versus_3000.png', before=payloads[3000]['pools'][mode]['winners'])
        if code_hashes() != hashes:raise RuntimeError('Analysis code changed during the study; do not combine these results.')
        audit['records'].append(record)
        (output/'comparison.json').write_text(json.dumps(audit, indent=2, allow_nan=False)+'\n')
        engine.loaded.clear();print(f'COMPLETE {number}/{len(selection)}', flush=True)
    print('STUDY COMPLETE '+str(output), flush=True)


if __name__ == '__main__':
    main()
