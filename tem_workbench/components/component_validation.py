"""Adapt component proposals to the ordinary native-FFT analysis engine.

Features discover seeds. Original pixels, detector settings, fit refinement and
all ranking/screening terms belong to Engine.analyze, never to this adapter.
"""
from functools import lru_cache
import numpy as np
from tem_workbench.analysis import phase_comparison

VERSION = 'native-fft-window-v1'


def native_input(result):
    if '_source_image' in result:
        return True
    if result.get('method_version'):
        raise ValueError('Rerun PCA/NMF from the source image to use ordinary FFT validation.')
    # Read-only legacy/synthetic spectra have no native pixels to validate.
    return False


@lru_cache(maxsize=1)
def engine():
    from tem_workbench.app.engine import Engine
    return Engine({})


def analyze(result, models, index, cancel=None):
    image = result.get('_source_image')
    if image is None:
        raise ValueError('Rerun PCA/NMF from the source image to use ordinary FFT validation.')
    from tem_workbench.components.shared_spectra import window_samples, check_cancel
    check_cancel(cancel)
    roi = window_samples(result['plan'])[index]['roi']
    item = dict(array=image, info=result['source'])
    return engine().analyze(item, roi, result['settings'], images=False,
                            cancel_event=cancel, hypotheses=models)


def candidate(fit, source, result, index):
    from tem_workbench.components.nmf_fitting import compact
    component = source.get('component')
    score = float(result['scores'][index, component]) if component is not None else None
    base = dict(model=source['id'], phase=source['phase'], component=component,
                side=source.get('side'), component_score=score,
                score_sign=None if score is None else 'positive' if score > 0 else 'negative' if score < 0 else 'zero',
                score_basis=VERSION)
    if fit is None:
        return dict(base, score=0., valid=False, coverage=0., predicted_coverage=0.,
                    predicted_count=0, profiles=[], rms_nm_inv=0.,
                    rotation_deg=source['rotation_deg'], rotation_adjustment_deg=0., local_scale=1.)
    profiles=sorted(m['profile_id'] for m in fit['matches'])
    count=len(fit['predicted_nodes'])
    return dict(compact(fit), **base, profiles=profiles,
                predicted_count=count, predicted_coverage=len(profiles)/max(count,1),
                rotation_adjustment_deg=float((fit['rotation_deg']-source['rotation_deg']+90)%180-90),
                local_scale=fit.get('scale_a',1.)/(source.get('scale_a') or source.get('shared_scale') or 1.),
                local_scale_penalty=0.)


def classify(candidates, peaks, df=0.):
    """Use the ordinary classifier for compact, selectable hypothesis pools."""
    models=[]
    for c in candidates:
        # The classifier needs only counts and profile identities, not positions.
        models.append(dict(c, predicted_nodes=[None]*c['predicted_count'],
            matches=[dict(profile_id=i,node_index=j) for j,i in enumerate(c['profiles'])]))
    models.sort(key=lambda m:(-m['score'],m['model']))
    classified=phase_comparison.classify(peaks, models, df)
    label=classified['label']
    phases=classified['valid_pattern_phases']
    if label.endswith('_compatible'):
        phases=[classified['primary_model']['phase']];label='single'
    elif label in ('coexisting_candidates','multiple_orientations'):label='multiple'
    elif label=='insufficient':label='unresolved'
    if label=='multiple':phases=list(dict.fromkeys(m['phase'] for m in (classified['primary_model'],classified['secondary_model']) if m))
    return dict(label=label, phases=phases,unique_profiles={})


def pool_comparisons(candidates, peaks):
    """Store ordinary classifier decisions for selectable browser pools.

    Its label depends on the highest-ranked passing member and its pairwise
    rivals. Computing these here avoids a second set of scientific UI rules.
    """
    passing=sorted((c for c in candidates if c['valid']),key=lambda c:(-c['score'],c['model']))
    decisions={}
    for i,primary in enumerate(passing):
        row=dict(label=classify([primary],peaks)['label'],multiple=[],ambiguous=[])
        for other in passing[i+1:]:
            label=classify([primary,other],peaks)['label']
            if label in ('multiple','ambiguous'):row[label].append(other['model'])
        decisions[str(primary['model'])]=row
    return decisions


def window(result, models, index, cancel=None):
    analysis=analyze(result, models, index, cancel)
    best={}
    for fit in analysis['candidates']:
        ident=fit['source_hypothesis']
        if ident not in best or (fit['valid'],fit['score'])>(best[ident]['valid'],best[ident]['score']):best[ident]=fit
    candidates=[candidate(best.get(m['id']),m,result,index) for m in models]
    candidates.sort(key=lambda m:(-m['score'],m['model']))
    spectrum=analysis['spectrum'];peaks=spectrum['peaks']
    return dict(index=index, peak_count=len(peaks), tested_models=len(models), candidates=candidates,
                peak_positions=[[p['profile_id'],p['qx'],p['qy']] for p in peaks],
                peak_weights=[p['weight'] for p in peaks],
                detection_settings={k:spectrum.get(k) for k in ('profile_threshold','minimum_peak_enrichment','minimum_peak_separation_nm_inv','auto_peak_strength')},
                pool_comparisons=pool_comparisons(candidates,peaks),
                scoring_version=VERSION, **classify(candidates,peaks,spectrum['df']))


def spectrum_image(spectrum, outer):
    """Display the native FFT, with the inspector's existing raster contract."""
    import base64
    from scipy.ndimage import map_coordinates
    from tem_workbench.components.shared_spectra import encoded
    size=420
    axis=(np.arange(size)+.5)/size*2*outer-outer
    x,y=np.meshgrid(axis,-axis)
    left,right,bottom,top=spectrum['extent'];log=spectrum['log'];h,w=log.shape
    values=map_coordinates(log,[(top-y)/(top-bottom)*(h-1),(x-left)/(right-left)*(w-1)],order=1,mode='nearest')
    valid=(np.hypot(x,y)>=spectrum['g_min'])&(np.hypot(x,y)<=spectrum['g_max'])
    out=encoded(values,valid);lo,hi=out['limits']
    raster=np.rint(np.clip((values-lo)/max(hi-lo,1e-20),0,1)*254).astype(np.uint8);raster[~valid]=255
    return dict(out,raster=base64.b64encode(raster.tobytes()).decode(),size=size)
