"""Exploratory indexing of exhaustive NMF subsets, separate from grid evidence.

Factor amplitudes are arbitrary. Detect relative maxima after radial baseline
removal; do not reuse native FFT photometry thresholds or weak/missing costs.
"""
import numpy as np
from scipy import ndimage
import analysis_core as core
import scale_fitting
from shared_spectra import check_cancel, number, spectrum_image, RADIAL_BINS, ANGULAR_BINS

DEFAULT_PEAK_FRACTION = .35


def matching_width(result):
    """Use the same taper-response width as ordinary FFT crystal fitting."""
    p=result['plan'];s=result['settings']
    return max(.1,core.fft_window_width(p['window_nm'],p['window_pixels'],
                                       s.get('fft_window','hann'),s.get('fft_tukey_alpha',.5)))


def validate_options(result, options):
    if result['plan'].get('method') != 'nmf':
        raise ValueError('Crystal fitting requires nonnegative NMF components; rerun using NMF.')
    return number(options,'peak_fraction',DEFAULT_PEAK_FRACTION,.01,1)


def group_spectrum(result, ids):
    """Use actual reconstruction contributions, invariant to W/H rescaling.

    Co-occurrence means each factor exceeds 20% of its own maximum at a window.
    If none coexist, report that fact and use global mean contributions only as
    an exploratory mathematical combination, not an observed single pattern.
    """
    scores=result['scores'][:,ids]
    maximum=scores.max(axis=0)
    active=(scores >= .2*maximum)&(maximum>1e-20)
    common=active.all(axis=1)
    coefficients=scores[common].mean(axis=0) if common.any() else scores.mean(axis=0)
    spectrum=coefficients@result['components'][ids]/result['area_weights'].ravel()
    support=np.min(scores/np.maximum(maximum,1e-20),axis=1)
    indices=np.flatnonzero(common)
    strongest=indices[np.argsort(-support[indices])[:3]].tolist()
    return spectrum, coefficients, int(common.sum()), strongest


def detect_peaks(spectrum, result, fraction):
    p=result['plan'];a=result['angles'];r=result['radii']
    values=np.asarray(spectrum).reshape(RADIAL_BINS,ANGULAR_BINS)
    signal=np.maximum(values-np.median(values,axis=1,keepdims=True),0)
    high=float(signal.max())
    if high<=1e-20:return []
    maxima=ndimage.maximum_filter(signal,size=(3,3),mode=('nearest','wrap'))
    rr,aa=np.where((signal>=maxima)&(signal>=fraction*high))
    order=np.argsort(-signal[rr,aa],kind='stable')
    separation=max(float(result['settings'].get('fft_minimum_separation',.5)),1e-6)
    peaks=[]
    for idx in order:
        i,j=int(rr[idx]),int(aa[idx]);q=np.array([r[i]*np.cos(a[j]),r[i]*np.sin(a[j])])
        if any(min(np.linalg.norm(q-np.array([v['qx'],v['qy']])),np.linalg.norm(q+np.array([v['qx'],v['qy']])))<separation for v in peaks):continue
        peaks.append(dict(profile_id=len(peaks),qx=float(q[0]),qy=float(q[1]),weight=1.,relative_strength=float(signal[i,j]/high)))
        if len(peaks)>=int(result['settings'].get('fft_max_peaks',70)):break
    return peaks


def compact(model):
    keys=('phase','template_id','zone_3index','rotation_deg','score','valid','coverage',
          'matched_profile_count','predicted_visible_band_node_count','rms_nm_inv',
          'fitted_a_nm','fitted_b_nm','fitted_c_nm','scale_penalty','position_score','scale_mode',
          'scale_a','scale_b','scale_c','shared_scale','scale_note','axis_observable',
          'overall_prediction_scale','ca_ratio_multiplier','overall_scale_penalty','ca_ratio_penalty',
          'position_matching','fitting_band_nm_inv')
    out={k:model[k] for k in keys if k in model}
    if 'fitted_a_nm' not in out and model.get('nominal_a_nm'):
        for axis in 'abc':
            value=model.get('nominal_'+axis+'_nm')
            if value is not None:out['fitted_'+axis+'_nm']=float(value)/model.get('shared_scale',1.)
        out['scale_note']='Fixed common scale; unseen dimensions are assumed, not measured.'
    return out


def search_candidates(result, peaks, templates, cancel=None, progress=None):
    """Shared search for exhaustive summaries and on-demand inspection."""
    p=result['plan'];s=result['settings']
    tolerance=matching_width(result)
    candidates=[]
    for ti,template in enumerate(templates):
        check_cancel(cancel)
        if progress:progress(ti+1,len(templates))
        args=dict(bcc_a=s.get('bcc_a',.330),fcc_a=s.get('fcc_a',.417),g_min=p['g_min'],g_max=p['g_max'],omega_falloff_multiplier=s.get('omega_falloff_multiplier',1.))
        if s.get('scale_mode','fixed')=='fixed':
            found=core.search(peaks,[template],s.get('scale',1.),tolerance,**args)
        else:
            found=scale_fitting.search(peaks,[template],tolerance,s['scale_mode'],scale_penalty_strength=s.get('scale_penalty_strength',.1),ca_penalty_strength=s.get('ca_penalty_strength',.1),**args)
        candidates.extend(found)
    return candidates


def fit_groups(result, templates, options, cancel=None, progress=None):
    fraction=validate_options(result,options);p=result['plan'];s=result['settings']
    count=len(result['components']);total=(1<<count)-1
    # Native taper response sets tolerance; feature broadening does not enlarge it.
    tolerance=matching_width(result)
    records=[]
    fits=dict(groups=records,total=total,completed=0,peak_fraction=fraction,
              tolerance_nm_inv=tolerance,cooccurrence_fraction=.2,
              scoring='Position minus chance allowance minus scale cost; uniform profile weights. No weak/missing, brightness or double-diffraction scoring. Not comparable to main-analysis rank.',
              grouping='Every nonempty subset. Mean coefficients in co-occurring windows; global mean if none. NMF coefficient scaling is preserved.',
              validation='Best model checked without refitting against up to three unbroadened sampled spectra. Same-image consistency only; correlated windows, not independent validation.')
    result['fits']=fits
    for mask in range(1,total+1):
        check_cancel(cancel)
        ids=[i for i in range(count) if mask & (1<<i)]
        spectrum,coefficients,common,windows=group_spectrum(result,ids)
        peaks=detect_peaks(spectrum,result,fraction)
        candidates=search_candidates(result,peaks,templates,cancel,
            (lambda done,total_templates:progress(mask-1,total,f'Group {mask}/{total} · template {done}/{total_templates}')) if progress else None)
        candidates=core.retain(candidates,topn=1)
        record=dict(components=ids,coefficients=coefficients.tolist(),cooccurring_windows=common,
                    peak_count=len(peaks),candidates=[dict(compact(m),predicted_nodes=m['predicted_nodes']) for m in candidates],support_checks=[])
        if candidates:
            best=candidates[0]
            for index in windows:
                observed=detect_peaks(result['raw_spectra'][index],result,fraction)
                width=tolerance*(s.get('omega_falloff_multiplier',1.) if best['phase']=='OMEGA' else 1.)
                check=core.score_prediction_nodes(observed,best['predicted_nodes'],width)
                record['support_checks'].append(dict(window=index,peak_count=len(observed),
                      matched=check['matched_profile_count'] if check else 0,
                      coverage=check['coverage'] if check else 0.,rms_nm_inv=check['rms_nm_inv'] if check else None))
        records.append(record);fits['completed']=mask
        if progress:progress(mask,total,f'Fitted {mask}/{total} combinations')
    return fits


def screen_reasons(model):
    reasons=[]
    if model['matched_profile_count']<4:reasons.append('Fewer than 4 matched profiles')
    if model['nonparallel_spread_sine']<=.5:reasons.append('Limited independent directions')
    if model['coverage']<=.30:reasons.append('Peak coverage ≤ 30%')
    if model.get('position_score',model['score'])<=.20:reasons.append('Position score ≤ 0.20')
    if model['score']<=.20:reasons.append('Rank ≤ 0.20')
    return reasons


def group_preview(result, ids):
    """Render the same weighted group used for fitting, without running a fit."""
    validate_options(result, {})
    if not isinstance(ids, list) or not ids or any(type(i) is not int or not 0 <= i < len(result['components']) for i in ids):
        raise ValueError('Choose a valid component group.')
    ids = sorted(set(ids))
    spectrum, coefficients, common, _ = group_spectrum(result, ids)
    from shared_spectra import component_image
    return dict(spectrum=component_image(spectrum, result['plan'], False),
                components=ids, coefficients=coefficients.tolist(), cooccurring_windows=common)


def group_detail(result, ids, templates, options=None):
    if not isinstance(ids,list) or not ids or any(type(i) is not int or not 0<=i<len(result['components']) for i in ids):
        raise ValueError('Choose a valid component group.')
    ids=sorted(set(ids))
    # An existing combination table must reproduce its saved detection cutoff.
    fraction=validate_options(result, result.get('fits') or options or {})
    spectrum,coefficients,common,windows=group_spectrum(result,ids)
    peaks=detect_peaks(spectrum,result,fraction)
    candidates=core.retain(search_candidates(result,peaks,templates),topn=5)
    models=[dict(**compact(m),rejection_reasons=screen_reasons(m),
                 predicted_nodes=m['predicted_nodes'],matches=m['matches']) for m in candidates]
    return dict(spectrum=spectrum_image(spectrum,result['plan']),components=ids,
                coefficients=coefficients.tolist(),cooccurring_windows=common,windows=windows,
                peaks=peaks,candidates=models,peak_fraction=fraction,
                phases=list(dict.fromkeys(t['phase'] for t in templates)),
                g_max=result['plan']['g_max'],tolerance_nm_inv=matching_width(result))
