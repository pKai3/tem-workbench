"""Read-only crop-size diagnostic using the production engine, with all auto trials.

Run with --export a saved region/grid JSON and --output a NEW directory.
Expected phase/zone are evaluation criteria only; they never enter the matcher.
The default experiment compares manual, geometry-auto and rank-auto; optional
smoothing checks are fixed settings, not a new automatic optimization mode.
"""
from pathlib import Path
import argparse
import copy
import csv
import gzip
import hashlib
import html
import json
import multiprocessing as mp
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import Engine
import analysis_core as core
import numpy as np

MODES=('manual','geometry','rank')

def sampling_plan(info, sizes=(4,6,8,12,20), smoothing=False, sigma=.65):
    w,h=info['width'],info['height']; sx=info['pixel_x_nm']; sy=info['pixel_y_nm']
    if w!=h or abs(sx/sy-1)>1e-4:raise ValueError('This diagnostic currently requires a square, isotropically calibrated real-space image.')
    jobs=[];seen=set()
    def add(n,cx,cy,name,nominal,variant='baseline',sig=sigma):
        x=int(round(cx-n/2));y=int(round(cy-n/2))
        if n<32 or x<0 or y<0 or x+n>w or y+n>h:return
        key=(x,y,n,variant)
        if key in seen:return
        seen.add(key);jobs.append(dict(id=name,roi=dict(x=x,y=y,w=n,h=n),size_nm=n*sx,nominal_nm=nominal,variant=variant,sigma_bins=sig,centre=f'{cx/w:.2f},{cy/h:.2f}'))
    for size in sizes:
        for iy,fy in enumerate((.25,.5,.75)):
            for ix,fx in enumerate((.25,.5,.75)):
                add(round(size/sx),fx*w,fy*h,f'n{size:g}_r{iy}c{ix}',size)
    add(round(30/sx),w/2,h/2,'n30_centre',30)
    add(w,w/2,h/2,'full',w*sx)
    if smoothing:
        for job in list(jobs):
            if job['centre']!='0.50,0.50' or (job['nominal_nm'] not in (4,8,20) and job['id']!='full'):continue
            # 0.065 nm^-1 = baseline sigma .65 at a 10 nm crop; all current sizes stay within 0..3 bins.
            for label,sig in [('off',0.),('low',.35),('high',1.3),('physical',.065*job['size_nm'])]:
                if not 0<=sig<=3:continue
                add(job['roi']['w'],w/2,h/2,job['id']+'_'+label,job['nominal_nm'],label,sig)
    return jobs

class RecordingEngine(Engine):
    def _fit_spectrum(self,s,*args):
        models,candidates=super()._fit_spectrum(s,*args)
        self.fit_trials.append(dict(strength=s['minimum_peak_enrichment'],peaks=copy.deepcopy(s['peaks']),models=copy.deepcopy(models),candidates=copy.deepcopy(candidates)))
        return models,candidates

def init_worker(config,array_path,info,limits,settings,output,expected):
    global ENGINE,ITEM,SETTINGS,OUT,EXPECTED
    core.FFT_WORKERS=1
    ENGINE=RecordingEngine(config);ITEM=dict(array=np.load(array_path,mmap_mode='r'),info=info,limits=limits)
    SETTINGS=settings;OUT=Path(output);EXPECTED=expected

def dump(path,data):
    with gzip.open(path,'wt',encoding='utf8') as f:json.dump(data,f,allow_nan=False)

def expected_match(m,expected):
    if m['phase']!=expected['phase']:return False
    if expected.get('zone') is not None and m['zone_3index']!=expected['zone']:return False
    if expected.get('mirror') is not None and m['mirror']!=expected['mirror']:return False
    if expected.get('rotation') is not None:
        delta=abs((m['rotation_deg']-expected['rotation']+90)%180-90)
        if delta>expected.get('rotation_tolerance',5):return False
    return True

def reasons(m):
    if not m:return 'No candidate retained/explored'
    reasons=[]
    if m['matched_profile_count']<4:reasons.append('fewer than 4 profiles')
    if m['nonparallel_spread_sine']<=.5:reasons.append('limited directions')
    if m['coverage']<=.3:reasons.append('coverage <=30%')
    if m['position_score']<=.2:reasons.append('position <=0.20')
    if m['score']<=.2:reasons.append('rank <=0.20')
    return '; '.join(reasons) or 'Pass'

def leader(candidates):return max(candidates,key=lambda m:m['score'],default=None)

def metric(m):
    if m is None:return {}
    return dict(rank=m['score'],valid=m['valid'],phase=m['phase'],zone=str(m['zone_3index']),rotation=m['rotation_deg'],position=m['position_score'],scale_cost=m.get('scale_penalty',0),overall_cost=m.get('overall_scale_penalty',0),ca_cost=m.get('ca_ratio_penalty',0),missing_cost=m.get('missing_peak_penalty',0),weak_bonus=m.get('weak_peak_bonus',0),coverage=m['coverage'],matched=m['matched_profile_count'],predictions=m['predicted_visible_band_node_count'],rms=m['rms_nm_inv'],a=m['fitted_a_nm'],c=m.get('fitted_c_nm') if m.get('c_axis_visible') else None,ca=m['fitted_c_nm']/m['fitted_a_nm'] if m.get('c_axis_visible') else None,reasons=reasons(m))

def run_job(job):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    roi=job['roi'];x,y,w,h=[roi[k] for k in ('x','y','w','h')];crop=ITEM['array'][y:y+h,x:x+w]
    settings={**SETTINGS,'fft_smoothing_sigma':job['sigma_bins']}
    sx=ITEM['info']['pixel_x_nm'];sy=ITEM['info']['pixel_y_nm']
    # Separate reproducible display/pool preparation. Never changes production decisions.
    pool=core.spectrum(crop,sx,sy,profile_fraction=settings['threshold'],minimum_enrichment=0.,window=settings['fft_window'],remove_mean=settings['remove_mean'],g_max=settings['g_max'],g_min=settings['g_min'],smoothing_sigma=settings['fft_smoothing_sigma'],threshold_floor=settings['fft_threshold_floor'],minimum_separation=settings['fft_minimum_separation'],max_peaks=settings['fft_max_peaks'])
    np.savez_compressed(OUT/(job['id']+'_fields.npz'),raw_log_power=pool['log'],processed=pool['detector_signal'],extent=pool['extent'])
    dump(OUT/(job['id']+'_pool.json.gz'),{k:v for k,v in pool.items() if k not in ('log','detector_signal')})
    rows=[]
    for mode in MODES:
        setting={**settings,'fft_auto_strength':mode!='manual','fft_auto_objective':'geometry' if mode=='geometry' else 'rank'}
        ENGINE.fit_trials=[]
        result=ENGINE.analyze(ITEM,roi,setting,images=False,cache_candidates=True)
        candidates=json.loads(__import__('zlib').decompress(result.pop('_fit_cache')))
        target=leader([m for m in candidates if expected_match(m,EXPECTED)])
        best_phase=leader([m for m in candidates if m['phase']==EXPECTED['phase']])
        best=leader(result['models']);auto=result['spectrum'].get('auto_peak_strength',{})
        row=dict(id=job['id'],mode=mode,variant=job['variant'],centre=job['centre'],nominal_nm=job['nominal_nm'],size_nm=job['size_nm'],sigma_bins=job['sigma_bins'],sigma_nm_inv=job['sigma_bins']*result['spectrum']['df'],x=x,y=y,w=w,h=h,df=result['spectrum']['df'],matching_radius=max(.1,core.peak_width(result['spectrum'])),label=result['classification']['label'],profiles=len(result['spectrum']['peaks']),pool_profiles=len(pool['peaks']),strength=result['spectrum']['minimum_peak_enrichment'],trials=auto.get('tested_sets',1),seconds=result['elapsed_ms']/1000,expected_passing=any(m['valid'] and expected_match(m,EXPECTED) for m in candidates),phase_passing=any(m['valid'] and m['phase']==EXPECTED['phase'] for m in candidates))
        for prefix,m in [('expected',target),('phase',best_phase),('winner',best)]:row.update({prefix+'_'+k:v for k,v in metric(m).items()})
        # Stored-pool ablations: rescore already explored candidates; no refit or new detection.
        ablations={}
        for name,kwargs in [('no_overall',dict(scale_penalty_strength=0.)),('no_ratio',dict(ca_penalty_strength=0.)),('no_peak_evidence',dict(peak_evidence_weight=0.)),('no_penalties',dict(scale_penalty_strength=0.,ca_penalty_strength=0.,peak_evidence_weight=0.))]:
            rs={**setting,**kwargs};cached={**result,'_fit_cache':__import__('zlib').compress(json.dumps(candidates).encode())}
            rescored=ENGINE.cached_models(cached,rs)
            ablations[name]=metric(leader([m for m in rescored if expected_match(m,EXPECTED)]))
            row[name+'_expected_passing']=any(m['valid'] and expected_match(m,EXPECTED) for m in rescored)
        traces={'fit_trials':ENGINE.fit_trials,'auto_trials':auto.get('trials',[]),'geometry_trials':[]}
        if mode=='geometry':
            for t in auto.get('trials',[]):
                pp=[p for p in pool['peaks'] if p['log_radial_enrichment']>=t['strength']]
                assert len(pp)==t['profiles']
                geom=core.purity(pp,max(.1,core.peak_width(pool)),g_max=setting['g_max'],g_min=setting['g_min'])
                traces['geometry_trials'].append(dict(**t,peaks=pp,geometry=geom))
        stem=job['id']+'_'+mode
        dump(OUT/(stem+'.json.gz'),dict(result=result,candidates=candidates,expected=EXPECTED,summary=row,ablations=ablations))
        dump(OUT/(stem+'_trials.json.gz'),traces)
        render_case(OUT,crop,ITEM['limits'],pool,job,mode,result,target,row)
        rows.append(row)
    return rows

def render_case(out,crop,limits,pool,job,mode,result,target,row):
    import matplotlib.pyplot as plt
    stem=job['id']+'_'+mode
    fig,axs=plt.subplots(1,3,figsize=(12,4.8))
    axs[0].imshow(crop,cmap='gray',vmin=limits[0],vmax=limits[1]);axs[0].set_axis_off();axs[0].set_title('Real-space crop')
    for ax,field,title in zip(axs[1:],['log','detector_signal'],['Raw log-power FFT','Processed detector signal']):
        ar=pool[field];ax.imshow(ar,extent=pool['extent'],cmap='magma',vmin=np.percentile(ar,50),vmax=np.percentile(ar,99.8),origin='upper')
        for p in result['spectrum']['peaks']:
            ax.scatter([p['qx'],-p['qx']],[p['qy'],-p['qy']],marker='+',s=35,c='white',linewidths=.8)
        if target:
            q=np.array([p['q'] for p in target['predicted_nodes']]);q=np.r_[q,-q]
            ax.scatter(q[:,0],q[:,1],marker='D',s=35,facecolors='none',edgecolors='#56ceff',linewidths=.8)
        for rad in (result['settings']['g_min'],result['settings']['g_max']):ax.add_patch(plt.Circle((0,0),rad,fill=False,color='gray',ls='--',lw=.6))
        ax.set_title(title);ax.set_xlabel('nm⁻¹')
    fig.suptitle(f"{job['size_nm']:.2f} nm · {job['centre']} · {mode} · σ {job['sigma_bins']:.2f} bins\n{result['classification']['label']} · {row['profiles']} profiles · expected: {reasons(target)}",fontsize=10)
    fig.text(.5,.01,'White +: detected profiles and opposites. Blue diamonds: best explored expected-zone fit, whether passing or rejected. Display contrast is illustrative.',ha='center',fontsize=7)
    fig.tight_layout(rect=(0,.10,1,.88));fig.savefig(out/(stem+'.png'),dpi=140);plt.close(fig)


def write_csv(path,rows):
    keys=list(dict.fromkeys(k for r in rows for k in r))
    with path.open('w',newline='') as f:
        wr=csv.DictWriter(f,fieldnames=keys);wr.writeheader();wr.writerows(rows)

def build_report(out,rows,manifest):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    colors={'manual':'#777777','geometry':'#238ac0','rank':'#a35cc0'}
    base=[r for r in rows if r['variant']=='baseline'];sizes=sorted({r['nominal_nm'] for r in base})
    summaries=[]
    for mode in MODES:
        for size in sizes:
            rr=[r for r in base if r['mode']==mode and r['nominal_nm']==size]
            summaries.append(dict(mode=mode,size_nm=size,n=len(rr),phase_pass_percent=100*np.mean([r['phase_passing'] for r in rr]),expected_pass_percent=100*np.mean([r['expected_passing'] for r in rr]),median_profiles=float(np.median([r['profiles'] for r in rr])),median_seconds=float(np.median([r['seconds'] for r in rr]))))
    write_csv(out/'summary_by_size.csv',summaries)
    figs=[]
    for name,fields,titles in [('01_detection',['profiles','strength','seconds'],['Detected profiles','Selected minimum strength','Engine seconds']),('02_expected_fit',['expected_rank','expected_position','expected_rms'],['Expected-zone rank','Expected-zone position score','Expected-zone RMS (nm⁻¹)']),('03_lattice',['expected_a','expected_c','expected_ca'],['Expected-zone a (nm)','Expected-zone c (nm)','Expected-zone c/a']),('04_costs',['expected_overall_cost','expected_ca_cost','expected_missing_cost'],['Overall scale cost','c/a cost','Missing-prediction cost'])]:
        fig,axs=plt.subplots(1,3,figsize=(12,4.2))
        for ax,field,title in zip(axs,fields,titles):
            for mode in MODES:
                rr=[r for r in base if r['mode']==mode and r.get(field) is not None]
                ax.scatter([r['size_nm'] for r in rr],[r[field] for r in rr],s=16,alpha=.4,color=colors[mode])
                xs=sorted({r['nominal_nm'] for r in rr});ys=[np.median([r[field] for r in rr if r['nominal_nm']==x]) for x in xs]
                ax.plot(xs,ys,'o-',ms=4,color=colors[mode],label=mode)
            if field=='expected_rank':ax.axhline(.2,ls='--',c='red',lw=.8)
            ax.set(title=title,xlabel='Crop width (nm)');ax.grid(alpha=.2)
        axs[0].legend();fig.suptitle(manifest['source']['name']+' · points: locations; lines: medians',fontsize=12)
        fig.tight_layout();fig.savefig(out/(name+'.png'),dpi=180);fig.savefig(out/(name+'.svg'));plt.close(fig);figs.append(name)
    fig,ax=plt.subplots(figsize=(8,4.2))
    for mode in MODES:
        rr=[r for r in summaries if r['mode']==mode];ax.plot([r['size_nm'] for r in rr],[r['expected_pass_percent'] for r in rr],'o-',label=mode,color=colors[mode])
    ax.set(xlabel='Crop width (nm)',ylabel='Expected-zone fit passes (%)',ylim=(-5,105),title='Expected orientation screen · 9 locations per size; 30/full: centre only');ax.legend();ax.grid(alpha=.2);fig.tight_layout();fig.savefig(out/'05_pass_rate.png',dpi=180);plt.close(fig);figs.append('05_pass_rate')
    # Smoothing sensitivity shows every setting rather than selecting a favourable one.
    sens=[r for r in rows if r['centre']=='0.50,0.50' and (r['nominal_nm'] in (4,8,20) or r['id'].startswith('full'))]
    fig,axs=plt.subplots(1,3,figsize=(12,4))
    for ax,mode in zip(axs,MODES):
        for size in sorted({r['nominal_nm'] for r in sens}):
            rr=sorted([r for r in sens if r['mode']==mode and r['nominal_nm']==size and r.get('expected_rank') is not None],key=lambda r:r['sigma_bins'])
            ax.plot([r['sigma_bins'] for r in rr],[r['expected_rank'] for r in rr],'o-',label=f'{size:.1f} nm')
        ax.axhline(.2,ls='--',c='red',lw=.8);ax.set(title=mode,xlabel='Smoothing σ (bins)',ylabel='Expected-zone rank');ax.grid(alpha=.2)
    axs[0].legend(fontsize=8);fig.tight_layout();fig.savefig(out/'06_smoothing.png',dpi=180);plt.close(fig);figs.append('06_smoothing')
    text='''<!doctype html><meta charset="utf-8"><title>Crop-size diagnostic</title><style>body{font:16px system-ui;background:#fff;color:#203040;max-width:1250px;margin:30px auto;padding:0 20px}img{max-width:100%}td,th{padding:7px;text-align:left;border-bottom:1px solid #ddd}table{border-collapse:collapse;width:100%}a{color:#146eaa}p{line-height:1.5}</style><h1>Crop-size diagnostic</h1>'''
    text+=f"<p>{html.escape(manifest['source']['name'])} · {len(rows)} completed analyses. Same image and references; all three selection modes. Expected phase/zone is an evaluation hypothesis derived from the supplied export, not an independent identification.</p>"
    text+='<p>Expected '+html.escape(str(manifest['expected']))+'. Rejected fits are included in all metric plots. No explored candidate appears as a gap. The 30 nm and full-image sizes have only one centre. Nearby and nested crops are correlated, not independent samples.</p>'
    text+='<p>Baseline smoothing is constant in bins. Sensitivity tests: off (0), low (0.35), high (1.3), and constant reciprocal σ=0.065 nm⁻¹. This does not optimize smoothing. Engine timing excludes diagnostic field reconstruction, rendering and trace serialization.</p>'
    for name in figs:text+=f'<a href="{name}.png"><img src="{name}.png"></a>'
    text+='<h2>Baseline outcome and cached rescoring</h2><table><tr><th>Mode</th><th>Current expected-zone pass</th><th>No overall cost</th><th>No c/a cost</th><th>No peak-evidence adjustment</th><th>No penalties</th></tr>'
    for mode in MODES:
        rr=[r for r in base if r['mode']==mode]
        text+='<tr><td>'+mode+'</td>'+''.join(f'<td>{sum(bool(r.get(k)) for r in rr)}/{len(rr)}</td>' for k in ['expected_passing','no_overall_expected_passing','no_ratio_expected_passing','no_peak_evidence_expected_passing','no_penalties_expected_passing'])+'</tr>'
    text+='</table><p>These rescoring checks reuse the existing candidate pool and selected peaks; they do not refit or reselect thresholds. Removing penalties is diagnostic, not a proposed default. Peak-evidence removal disables both the weak-peak bonus and missing-prediction penalty.</p>'
    text+='<h2>Inspect each crop</h2><p>Each preview shows real space, raw FFT and processed signal. JSON contains the selected result, all explored candidates and rescoring-only ablations. Trials contain every threshold and its supporting peaks; geometry trials do not perform crystal matching.</p><table><tr><th>Crop / centre / smoothing</th>'+''.join(f'<th>{m}</th>' for m in MODES)+'</tr>'
    for job in manifest['jobs']:
        text+='<tr><td>'+html.escape(f"{job['size_nm']:.2f} nm · {job['centre']} · {job['variant']} σ={job['sigma_bins']:.2f}")+'</td>'
        for mode in MODES:
            r=next((r for r in rows if r['id']==job['id'] and r['mode']==mode),None);stem=job['id']+'_'+mode
            if r is None:text+='<td>Not completed</td>';continue
            score=r.get('expected_rank');sc=f'{score:.3f}' if score is not None else 'no candidate'
            text+=f'<td><a href="{stem}.png">{html.escape(r["label"])}<br>Expected rank {sc}; {r["profiles"]} peaks</a><br><a href="{stem}.json.gz">JSON</a> · <a href="{stem}_trials.json.gz">Trials</a></td>'
        text+='</tr>'
    text+='</table><p><a href="metrics.csv">All metrics CSV</a> · <a href="summary_by_size.csv">Size summary CSV</a> · <a href="manifest.json">Source, settings and provenance</a></p>'
    (out/'index.html').write_text(text)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--export',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--data-root',type=Path,default=Path(__file__).resolve().parents[1]/'data');p.add_argument('--workers',type=int,default=4);p.add_argument('--smoothing',action='store_true');p.add_argument('--expected-zone',type=int,nargs=3);p.add_argument('--resume',action='store_true',help='Resume an interrupted run with matching source, settings and job plan');p.add_argument('--smoke',action='store_true',help='Run only the central 4 nm crop in all three modes')
    args=p.parse_args()
    if not 1<=args.workers<=8:p.error('Choose 1–8 workers for this diagnostic.')
    saved=json.loads(args.export.read_text());source=saved['source'];settings=saved.get('settings') or saved['result']['settings']
    primary=saved.get('result',{}).get('classification',{}).get('primary_model')
    if primary and (primary['phase']!='HCP' or args.expected_zone is not None):primary=None
    expected=dict(phase='HCP',zone=args.expected_zone or (primary['zone_3index'] if primary else None),mirror=primary.get('mirror') if primary else None,rotation=primary.get('rotation_deg') if primary else None,rotation_tolerance=5.)
    config=dict(data_root=str(args.data_root.resolve()));engine=Engine(config);engine.files[source['id']]=args.data_root/source['id'];item=engine.load(source['id'])
    if any(source.get(k)!=item['info'].get(k) for k in ('sha256_pixels','pixel_x_nm','pixel_y_nm')):raise ValueError('Source pixels or calibration differ from the supplied export.')
    if item['info']['image_kind']!='real_space':raise ValueError('Choose a real-space image, not diffraction.')
    _,settings=engine.validate(item,dict(x=0,y=0,w=32,h=32),settings)
    jobs=sampling_plan(item['info'],smoothing=args.smoothing,sigma=settings['fft_smoothing_sigma'])
    if args.smoke:jobs=[j for j in jobs if j['id']=='n4_r1c1']
    args.output.mkdir(parents=True,exist_ok=args.resume);out=args.output.resolve()
    manifest=dict(source=item['info'],settings=settings,engine_sha256=engine.version,export_engine_sha256=saved.get('engine_sha256'),runner_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),expected=expected,jobs=jobs,modes=MODES,state='running',workers=args.workers,source_export=str(args.export.resolve()),completed=0)
    rows=[];pending=[]
    if args.resume:
        prior=json.loads((out/'manifest.json').read_text())
        for key in ('source','settings','engine_sha256','expected','jobs','modes'):
            if json.dumps(prior[key],sort_keys=True)!=json.dumps(manifest[key],sort_keys=True):raise ValueError('Resume mismatch: '+key)
    for job in jobs:
        recovered=[]
        if args.resume:
            try:
                with np.load(out/(job['id']+'_fields.npz')) as fields:
                    assert 'processed' in fields and 'raw_log_power' in fields
                for mode in MODES:
                    stem=job['id']+'_'+mode
                    assert (out/(stem+'.png')).stat().st_size>0
                    with gzip.open(out/(stem+'_trials.json.gz'),'rt') as f:json.load(f)
                    with gzip.open(out/(stem+'.json.gz'),'rt') as f:data=json.load(f)
                    row=data['summary']
                    for prefix in ('expected','phase','winner'):
                        # Earlier diagnostic records called the top candidate's valid flag 'passing'.
                        if prefix+'_passing' in row:row[prefix+'_valid']=row.pop(prefix+'_passing')
                    row['expected_passing']=any(m['valid'] and expected_match(m,expected) for m in data['candidates'])
                    row['phase_passing']=any(m['valid'] and m['phase']==expected['phase'] for m in data['candidates'])
                    recovered.append(row)
            except (OSError,ValueError,KeyError,AssertionError,EOFError,__import__('zipfile').BadZipFile):recovered=[]
        if len(recovered)==3:rows.extend(recovered)
        else:pending.append(job)
    manifest['prior_invocations']=prior.get('prior_invocations',[])+[dict(runner_sha256=prior['runner_sha256'],completed=prior['completed'],state=prior['state'])] if args.resume else []
    manifest['completed']=len(rows)
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2));started=time.perf_counter();errors=[]
    import tempfile
    with tempfile.TemporaryDirectory(prefix='tem-crop-diagnostic-') as tmp:
        array_path=Path(tmp)/'pixels.npy';np.save(array_path,item['array'])
        with ProcessPoolExecutor(max_workers=args.workers,mp_context=mp.get_context('spawn'),initializer=init_worker,initargs=(config,str(array_path),item['info'],item['limits'].tolist(),settings,str(out),expected)) as pool:
            futures={pool.submit(run_job,j):j for j in pending}
            for f in as_completed(futures):
                try:rows.extend(f.result())
                except Exception as exc:errors.append(dict(job=futures[f]['id'],error=str(exc)))
                write_csv(out/'metrics.csv',rows);manifest['completed']=len(rows);(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(f"{len(rows)}/{len(jobs)*3} analyses complete · {time.perf_counter()-started:.1f}s",flush=True)
    manifest.update(state='failed' if errors else 'complete',errors=errors,wall_seconds_this_invocation=time.perf_counter()-started);(out/'manifest.json').write_text(json.dumps(manifest,indent=2));write_csv(out/'metrics.csv',rows);build_report(out,rows,manifest)
    print(out/'index.html',flush=True)
    if errors:raise SystemExit(f'{len(errors)} crops failed; use --resume after correcting the error.')

if __name__=='__main__':main()
