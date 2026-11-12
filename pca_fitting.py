"""Signed PCA features supply hypotheses, never absolute diffraction patterns.

Individual lobes and score-weighted partial reconstructions propose geometry.
Original-window checks preserve distinct retained orientations and never use
PCA score sign or magnitude as an eligibility gate.
"""
import itertools
from contextlib import nullcontext
import numpy as np
import analysis_core as core
from shared_spectra import check_cancel, number, spectrum_image
from nmf_fitting import detect_peaks, search_candidates, compact, screen_reasons, matching_width, DEFAULT_PEAK_FRACTION
from nmf_phase_maps import match_local, LOCAL_ROTATION_DEG, LOCAL_SCALE_FRACTION
from component_execution import ComponentPool, search_task, selected_workers


def validate_options(result, options):
    if result['plan'].get('method', 'pca') != 'pca':
        raise ValueError('Signed feature fitting requires PCA.')
    selected_workers(options, result['plan'].get('workers', 1))
    return number(options, 'peak_fraction', DEFAULT_PEAK_FRACTION, .01, 1)


def lobe_spectrum(result, component, side):
    validate_options(result, {})
    if type(component) is not int or not 0 <= component < len(result['components']):
        raise ValueError('Choose a retained PCA component.')
    if side not in ('positive', 'negative'):
        raise ValueError('Choose positive or negative PCA features.')
    loading = result['components'][component] / result['area_weights'].ravel()
    return np.maximum(loading if side == 'positive' else -loading, 0)


def fit_lobes(result, templates, options, cancel=None, progress=None, _pool=None):
    fraction = validate_options(result, options)
    ids = feature_components(result, options)
    total = 2 * len(ids)
    records = []
    fits = dict(kind='pca_signed_lobes', version=2, groups=records, total=total,
                workers=selected_workers(options,result['plan'].get('workers',1))[0],
                completed=0, peak_fraction=fraction, candidates_per_phase=5, feature_components=ids,
                tolerance_nm_inv=matching_width(result),
                scoring='Position minus chance allowance minus scale cost; uniform profile weights. Lobe fit is a hypothesis, not original-window support. No weak/missing, brightness or double-diffraction adjustments.',
                grouping='Positive and negative loadings divided by reciprocal-area weights, clipped separately at zero. No offset, mean addition, score-sign gate or combination of opposite lobes.',
                validation='Every retained orientation, including below-screen feature fits, is checked against every original unbroadened window. PCA sign is arbitrary; flipping loading and scores swaps side labels only.')
    result['fits'] = fits
    if progress:progress(0,total,'Fitting individual PCA features')
    def tasks():
        for component in ids:
            for side in ('positive', 'negative'):
                check_cancel(cancel)
                yield dict(component=component, side=side, topn=5,
                           peaks=detect_peaks(lobe_spectrum(result, component, side), result, fraction))
    workers=selected_workers(options,result['plan'].get('workers',1))[1]
    with (nullcontext(_pool) if _pool else ComponentPool(result,templates,workers,cancel)) as pool:
        for task,candidates,_ in pool.map(search_task,tasks()):
            component,side,peaks=task['component'],task['side'],task['peaks']
            records.append(dict(component=component, components=[component], side=side,
                                peak_count=len(peaks), candidates=[dict(compact(m), predicted_nodes=m['predicted_nodes']) for m in candidates]))
            fits['completed'] = len(records)
            if progress: progress(len(records), total, f'Fitted {len(records)}/{total} PCA sides')
    return fits


def lobe_detail(result, component, side, templates, options=None):
    fraction = validate_options(result, result.get('fits') or options or {})
    spectrum = lobe_spectrum(result, component, side)
    peaks = detect_peaks(spectrum, result, fraction)
    candidates = core.retain(search_candidates(result, peaks, templates), topn=5)
    return dict(kind='pca_lobe', component=component, side=side,
                spectrum=spectrum_image(spectrum, result['plan']), peaks=peaks,
                candidates=[dict(compact(m), rejection_reasons=screen_reasons(m),
                                 predicted_nodes=m['predicted_nodes'], matches=m['matches']) for m in candidates],
                phases=list(dict.fromkeys(t['phase'] for t in templates)),
                peak_fraction=fraction, g_max=result['plan']['g_max'],tolerance_nm_inv=matching_width(result))


def feature_components(result, options):
    ids=options.get('feature_components',list(range(len(result['components']))))
    if not isinstance(ids,list) or not ids or any(type(i) is not int or not 0<=i<len(result['components']) for i in ids):
        raise ValueError('Select at least one computed PC for fitting.')
    return sorted(set(ids))


def combination_options(result, options):
    validate_options(result,options)
    feature_components(result,options)
    mode=options.get('combination_mode','none')
    if mode not in ('none','together','all'):
        raise ValueError('Choose individual features, selected PCs together, or all subsets.')
    ids=options.get('combination_components',feature_components(result,options))
    if not isinstance(ids,list) or not ids or any(type(i) is not int or not 0<=i<len(result['components']) for i in ids):
        raise ValueError('Choose retained PCA components for combination fitting.')
    if 'feature_components' in options and not set(ids)<=set(feature_components(result,options)):
        raise ValueError('Combination PCs must be selected for fitting.')
    return mode,sorted(set(ids))


def combination_spectrum(result, ids, index):
    """An actual window's partial PCA reconstruction, without sign/offset tricks."""
    _,ids=combination_options(result,dict(combination_components=ids))
    if type(index) is not int or not 0<=index<len(result['scores']):
        raise ValueError('Choose an original sampled window.')
    coefficients=result['scores'][index,ids]
    reconstruction=result['mean']+coefficients@result['components'][ids]
    spectrum=reconstruction/result['area_weights'].ravel()*max(float(result['normalizations'][index]),1e-20)
    return spectrum,coefficients


def fit_features(result, templates, options, cancel=None, progress=None):
    """Individual lobes plus window-specific, score-weighted combinations.

    Search every requested subset/window. Cache only identical ordered peak
    coordinates (all search weights are one); peak heights do not enter ranking.
    Keep bounded per-subset hypothesis pools rather than duplicating full fits
    for every window. Each representative records the exact proposal window.
    """
    combination_options(result,options)
    workers=selected_workers(options,result['plan'].get('workers',1))[1]
    with ComponentPool(result,templates,workers,cancel) as pool:
        return _fit_features(result,templates,options,cancel,progress,pool)


def _fit_features(result, templates, options, cancel, progress, executor):
    mode,ids=combination_options(result,options)
    k=len(ids);count=(2**k-k-1 if mode=='all' else int(k>=2)) if mode!='none' else 0
    total=2*len(feature_components(result,options))+count*len(result['scores'])
    metadata=dict(version=3,total=total,combination_mode=mode,combination_components=ids,
                  combination_count=count,combination_windows=len(result['scores']))
    def report(done,ignored,stage):
        if result.get('fits'):result['fits'].update(metadata)
        if progress:progress(done,total,stage)
    fits=fit_lobes(result,templates,options,cancel,report,_pool=executor)
    fits.update(version=3,total=total,combination_mode=mode,combination_components=ids,
                combination_count=count,combination_windows=len(result['scores']),
                combination_reconstruction='(mean + scores[window, selected] @ loadings[selected]) / area_weights * window_normalization; no offset or sign reversal. Negative reconstruction residuals remain in the data; detector uses positive radial-baseline excess.',
                combination_retention='Every requested subset/window searched; up to five distinct hypotheses per phase per subset. Exact repeated ordered peak positions reuse search results. Representative geometry and its source window are retained unchanged.')
    if not count:return fits
    subsets=(itertools.chain.from_iterable(itertools.combinations(ids,size) for size in range(2,k+1)) if mode=='all' else [ids])
    searches=0;hits=0
    for subset in subsets:
        subset=list(subset)
        group=dict(kind='combination',components=subset,component=None,side=None,window=0,
                   completed_windows=0,total_windows=len(result['scores']),peak_count=0,candidates=[])
        fits['groups'].append(group)
        def tasks():
            for wi in range(len(result['scores'])):
                check_cancel(cancel)
                spectrum,coefficients=combination_spectrum(result,subset,wi)
                yield dict(window=wi,coefficients=coefficients,topn=5,
                           peaks=detect_peaks(spectrum,result,fits['peak_fraction']))
        for task,found,hit in executor.map(search_task,tasks(),key=lambda t:tuple((p['qx'],p['qy']) for p in t['peaks'])):
            wi,coefficients,peaks=task['window'],task['coefficients'],task['peaks']
            if wi==0:group['peak_count']=len(peaks)
            stage=f'PC {" + ".join(str(i+1) for i in subset)} · window {wi+1}/{len(result["scores"])}'
            if hit:hits+=1
            else:searches+=1
            proposals=[dict(m,window=wi,coefficients=coefficients.tolist(),peak_count=len(peaks)) for m in found]
            pool=core.retain(group['candidates']+proposals,topn=5)
            group['candidates']=pool
            if pool:
                group.update(window=pool[0]['window'],peak_count=pool[0]['peak_count'])
            group['completed_windows']=wi+1
            fits['completed']+=1
            fits.update(combination_searches=searches,combination_cache_hits=hits)
            report(fits['completed'],total,stage)
        group['candidates']=[dict(compact(m),predicted_nodes=m['predicted_nodes'],window=m['window'],
                                  coefficients=m['coefficients'],peak_count=m['peak_count']) for m in group['candidates']]
    return fits


def combination_detail(result, ids, index, templates, options=None):
    fraction=validate_options(result,result.get('fits') or options or {})
    spectrum,coefficients=combination_spectrum(result,ids,index)
    peaks=detect_peaks(spectrum,result,fraction)
    candidates=core.retain(search_candidates(result,peaks,templates),topn=5)
    return dict(kind='pca_combination',components=sorted(set(ids)),window=index,coefficients=coefficients.tolist(),
                negative_fraction=float(np.mean(spectrum<0)),spectrum=spectrum_image(spectrum,result['plan']),peaks=peaks,
                candidates=[dict(compact(m),rejection_reasons=screen_reasons(m),predicted_nodes=m['predicted_nodes'],matches=m['matches']) for m in candidates],
                phases=list(dict.fromkeys(t['phase'] for t in templates)),peak_fraction=fraction,g_max=result['plan']['g_max'],tolerance_nm_inv=matching_width(result))


def _local(result, peaks, model):
    width = matching_width(result)
    if model['phase'] == 'OMEGA':
        width *= result['settings'].get('omega_falloff_multiplier', 1.)
    return match_local(peaks, model, width, result['settings'])


def _candidate(result, wi, model, local):
    component=model.get('component')
    score = float(result['scores'][wi, component]) if component is not None else None
    base = dict(model=model['id'], phase=model['phase'], component=component,
                side=model.get('side'), component_score=score,
                score_sign=None if score is None else 'positive' if score > 0 else 'negative' if score < 0 else 'zero')
    if local is None:
        return dict(base, score=0., valid=False, coverage=0., predicted_coverage=0.,
                    predicted_count=len(model['predicted_nodes']), profiles=[], rms_nm_inv=0.,
                    rotation_deg=model['rotation_deg'], rotation_adjustment_deg=0., local_scale=1.)
    return dict(base, **{key:local[key] for key in ('score', 'position_score', 'valid',
                'predicted_coverage', 'predicted_count', 'chance_allowance', 'rms_nm_inv',
                'rotation_adjustment_deg', 'local_scale', 'local_scale_penalty', 'profiles')},
                coverage=local['match']['coverage'],
                rotation_deg=model['rotation_deg']+local['rotation_adjustment_deg'])


def unique_models(result, cancel=None):
    """One original-window check per geometry, with all signed sources retained.

    Rank chooses the unchanged representative; sources are provenance, not a
    sum of features, votes or support counts. Compare to that representative,
    not to a chain of neighbours that could connect distinct orientations.
    """
    candidates=[]
    for gi,group in enumerate(result['fits']['groups']):
        for ci,candidate in enumerate(group['candidates']):
            model=dict(candidate,group=gi,candidate=ci,kind=group.get('kind','lobe'),component=group['component'],
                       components=group['components'],side=group['side'])
            # Backward compatibility for fits already held by an older server.
            if 'position_matching' not in model:
                width=matching_width(result)
                if model['phase']=='OMEGA':width*=result['settings'].get('omega_falloff_multiplier',1.)
                model['position_matching']=dict(distance_scale_nm_inv=width)
            model.setdefault('fitting_band_nm_inv',[result['plan']['g_min'],result['plan']['g_max']])
            candidates.append(model)
    models=[]
    for model in sorted(candidates,key=lambda c:-c['score']):
        check_cancel(cancel)
        source={key:model[key] for key in ('group','candidate','kind','component','components','side','score','valid','rotation_deg')}
        if model['kind']=='combination':source.update(window=model['window'],coefficients=model['coefficients'])
        representative=next((m for m in models if core.same_solution(model,m)),None)
        if representative is None:
            models.append(dict(model,id=len(models),sources=[source]))
        else:representative['sources'].append(source)
    return models


def window_task(result, templates, context, wi, cancel):
    models=context['models'];spectrum=result['raw_spectra'][wi]
    check_cancel(cancel)
    peaks = detect_peaks(spectrum, result, context['fraction'])
    candidates = []
    for model in models:
        check_cancel(cancel)
        candidates.append(_candidate(result, wi, model, _local(result, peaks, model)))
    candidates.sort(key=lambda c:(-c['score'], c['model']))
    passing = [c for c in candidates if c['valid']]
    return dict(index=wi, peak_count=len(peaks), tested_models=len(models),
                        peak_positions=[[p['profile_id'],p['qx'],p['qy']] for p in peaks],
                        candidates=candidates, label='supported' if passing else 'unresolved',
                        phases=list(dict.fromkeys(c['phase'] for c in passing)))


def build(result, templates, cancel=None, progress=None, publish=None):
    validate_options(result, {})
    fits = result.get('fits')
    if not fits or fits.get('kind') != 'pca_signed_lobes' or fits['completed'] != fits['total']:
        raise ValueError('Finish fitting both sides of all PCA components first.')
    check_cancel(cancel)
    # Keep below-screen feature fits too: mean-present reflections can supply
    # support in the original windows. A repeated source is not a new geometry.
    models = unique_models(result,cancel)
    windows = []
    support_scores={m['id']:[] for m in models}
    maps=dict(kind='pca_signed_lobes', version=3, models=models, windows=windows,
                phases=list(dict.fromkeys(t['phase'] for t in templates)),
                counts={label:sum(w['label']==label for w in windows) for label in ('supported', 'unresolved')},
                model_passing_counts={str(mid):len(values) for mid,values in support_scores.items()},
                model_mean_support={str(mid):float(np.mean(values)) if values else 0. for mid,values in support_scores.items()},
                parameters=dict(peak_fraction=fits['peak_fraction'], score_gate=False,
                                tolerance_nm_inv=matching_width(result),
                                omega_falloff_multiplier=result['settings'].get('omega_falloff_multiplier',1.),
                                local_rotation_deg=LOCAL_ROTATION_DEG, local_scale_fraction=LOCAL_SCALE_FRACTION,
                                minimum_profiles=4, minimum_prediction_coverage=.3, minimum_support=.2),
                interpretation='Per-geometry support in all original unbroadened sampled windows, regardless of score sign or magnitude. Near duplicates across feature/combination sources keep the highest-ranked unchanged fit and all source links; each geometry is checked once. Global display ranking is passing-window count, then mean passing support. Resolved same-phase orientations remain separate. Counts across hypotheses overlap and must not be summed. Shared predictions alone do not establish coexistence.',
                limitations='Same-image consistency, not independent validation or phase fractions. Lobes are deviations from the mean, not absolute intensity. Mean-present patterns may pass on either score side; drift or noise can also create lobes.')
    if publish:publish(maps)
    workers=selected_workers(result.get('execution',fits),result['plan'].get('workers',1))[1]
    with ComponentPool(result,templates,workers,cancel,dict(models=models,fraction=fits['peak_fraction']),mapping=True) as pool:
        for _,window,_ in pool.map(window_task,range(len(result['raw_spectra']))):
            windows.append(window);wi=window['index']
            passing=[c for c in window['candidates'] if c['valid']]
            for candidate in passing:support_scores[candidate['model']].append(candidate['score'])
            maps['counts'][windows[-1]['label']]+=1
            maps['model_passing_counts']={str(mid):len(values) for mid,values in support_scores.items()}
            maps['model_mean_support']={str(mid):float(np.mean(values)) if values else 0. for mid,values in support_scores.items()}
            if publish:publish(maps)
            if progress: progress(wi+1, len(result['raw_spectra']), f'Checking original windows {wi+1}/{len(result["raw_spectra"])}')
    check_cancel(cancel)
    return maps


def window_detail(result, index, model_id):
    maps = result.get('phase_support')
    if not maps or maps.get('kind') not in ('pca_signed_lobes','nmf_hypotheses'):
        raise ValueError('Build original-window mapping first.')
    if type(index) is not int or not 0 <= index < len(result['raw_spectra']):
        raise ValueError('Choose an original sampled window.')
    if index>=len(maps['windows']):
        raise ValueError('This window has not been checked yet.')
    if type(model_id) is not int or not 0 <= model_id < len(maps['models']):
        raise ValueError('Choose a retained component fit.')
    model = maps['models'][model_id]
    peaks = detect_peaks(result['raw_spectra'][index], result, maps['parameters']['peak_fraction'])
    local = _local(result, peaks, model)
    candidate = _candidate(result, index, model, local)
    match = local['match'] if local else dict(predicted_nodes=model['predicted_nodes'], matches=[])
    # The original-window screen only counts close assignments, unlike lobe search.
    matches = [m for m in match['matches'] if m['profile_id'] in candidate['profiles']]
    width=matching_width(result)*(result['settings'].get('omega_falloff_multiplier',1.) if model['phase']=='OMEGA' else 1.)
    fitted = {**model, **candidate, 'predicted_nodes':match['predicted_nodes'], 'matches':matches,
              'position_matching':dict(distance_scale_nm_inv=width,search_radius_nm_inv=core.matching_radius(width)),
              'matched_profile_count':len(matches), 'coverage':len(matches)/max(len(peaks), 1),
              'rejection_reasons':[] if candidate['valid'] else ['Below original-window support screen']}
    for axis in 'abc':
        key = 'fitted_'+axis+'_nm'
        if fitted.get(key) is not None: fitted[key] /= candidate['local_scale']
    # Report the locally refined cell relative to the same material reference.
    # The c/a ratio is unchanged by the uniform local refinement.
    for key in ('scale_a','scale_b','scale_c','shared_scale','overall_prediction_scale'):
        if fitted.get(key) is not None: fitted[key] *= candidate['local_scale']
    return dict(kind='pca_window' if result['plan']['method']=='pca' else 'nmf_window', component=model.get('component'), components=model['components'],side=model.get('side'), sources=model.get('sources',[]),window=index,
                spectrum=spectrum_image(result['raw_spectra'][index], result['plan']), peaks=peaks,
                candidates=[fitted], phases=[model['phase']], component_score=candidate['component_score'],
                peak_fraction=maps['parameters']['peak_fraction'], g_max=result['plan']['g_max'],tolerance_nm_inv=width)
