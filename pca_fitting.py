"""Signed PCA features supply hypotheses, never absolute diffraction patterns.

Each lobe is indexed separately. Original-window checks preserve every retained
orientation and never use PCA score sign or magnitude as an eligibility gate.
"""
import numpy as np
import analysis_core as core
from shared_spectra import check_cancel, number, spectrum_image
from nmf_fitting import detect_peaks, search_candidates, compact, screen_reasons
from nmf_phase_maps import match_local, LOCAL_ROTATION_DEG, LOCAL_SCALE_FRACTION


def validate_options(result, options):
    if result['plan'].get('method', 'pca') != 'pca':
        raise ValueError('Signed feature fitting requires PCA.')
    return number(options, 'peak_fraction', .2, .01, 1)


def lobe_spectrum(result, component, side):
    validate_options(result, {})
    if type(component) is not int or not 0 <= component < len(result['components']):
        raise ValueError('Choose a retained PCA component.')
    if side not in ('positive', 'negative'):
        raise ValueError('Choose positive or negative PCA features.')
    loading = result['components'][component] / result['area_weights'].ravel()
    return np.maximum(loading if side == 'positive' else -loading, 0)


def fit_lobes(result, templates, options, cancel=None, progress=None):
    fraction = validate_options(result, options)
    total = 2 * len(result['components'])
    records = []
    fits = dict(kind='pca_signed_lobes', version=1, groups=records, total=total,
                completed=0, peak_fraction=fraction, candidates_per_phase=5,
                tolerance_nm_inv=max(.1, 1/min(result['plan']['window_nm'])),
                scoring='Position minus chance allowance minus scale cost; uniform profile weights. Lobe fit is a hypothesis, not original-window support. No weak/missing, brightness or double-diffraction adjustments.',
                grouping='Positive and negative loadings divided by reciprocal-area weights, clipped separately at zero. No offset, mean addition, score-sign gate or combination of opposite lobes.',
                validation='Every retained orientation, including below-screen feature fits, is checked against every original unbroadened window. PCA sign is arbitrary; flipping loading and scores swaps side labels only.')
    result['fits'] = fits
    for component in range(len(result['components'])):
        for side in ('positive', 'negative'):
            check_cancel(cancel)
            done = len(records)
            peaks = detect_peaks(lobe_spectrum(result, component, side), result, fraction)
            candidates = core.retain(search_candidates(result, peaks, templates, cancel,
                (lambda n, count: progress(done, total, f'PC {component+1} {side} · template {n}/{count}')) if progress else None), topn=5)
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
                peak_fraction=fraction, g_max=result['plan']['g_max'])


def _local(result, peaks, model):
    width = max(.1, 1/min(result['plan']['window_nm']))
    if model['phase'] == 'OMEGA':
        width *= result['settings'].get('omega_falloff_multiplier', 1.)
    return match_local(peaks, model, width, result['settings'])


def _candidate(result, wi, model, local):
    score = float(result['scores'][wi, model['component']])
    base = dict(model=model['id'], phase=model['phase'], component=model['component'],
                side=model['side'], component_score=score,
                score_sign='positive' if score > 0 else 'negative' if score < 0 else 'zero')
    if local is None:
        return dict(base, score=0., valid=False, coverage=0., predicted_coverage=0.,
                    predicted_count=len(model['predicted_nodes']), profiles=[], rms_nm_inv=0.,
                    rotation_deg=model['rotation_deg'], rotation_adjustment_deg=0., local_scale=1.)
    return dict(base, **{key:local[key] for key in ('score', 'position_score', 'valid',
                'predicted_coverage', 'predicted_count', 'chance_allowance', 'rms_nm_inv',
                'rotation_adjustment_deg', 'local_scale', 'local_scale_penalty', 'profiles')},
                coverage=local['match']['coverage'],
                rotation_deg=model['rotation_deg']+local['rotation_adjustment_deg'])


def build(result, templates, cancel=None, progress=None):
    validate_options(result, {})
    fits = result.get('fits')
    if not fits or fits.get('kind') != 'pca_signed_lobes' or fits['completed'] != fits['total']:
        raise ValueError('Finish fitting both sides of all PCA components first.')
    check_cancel(cancel)
    models = []
    for gi, group in enumerate(fits['groups']):
        for candidate in group['candidates']:
            # A deviation can omit mean-present reflections; the original window
            # supplies the support screen, independently of feature-fit acceptance.
            models.append(dict(candidate, id=len(models), group=gi,
                               component=group['component'], components=group['components'], side=group['side']))
    windows = []
    for wi, spectrum in enumerate(result['raw_spectra']):
        check_cancel(cancel)
        peaks = detect_peaks(spectrum, result, fits['peak_fraction'])
        candidates = []
        for model in models:
            check_cancel(cancel)
            candidates.append(_candidate(result, wi, model, _local(result, peaks, model)))
        candidates.sort(key=lambda c:(-c['score'], c['model']))
        passing = [c for c in candidates if c['valid']]
        windows.append(dict(index=wi, peak_count=len(peaks), tested_models=len(models),
                            candidates=candidates, label='supported' if passing else 'unresolved',
                            phases=list(dict.fromkeys(c['phase'] for c in passing))))
        if progress: progress(wi+1, len(result['raw_spectra']), f'Checking original windows {wi+1}/{len(result["raw_spectra"])}')
    check_cancel(cancel)
    return dict(kind='pca_signed_lobes', version=1, models=models, windows=windows,
                phases=list(dict.fromkeys(t['phase'] for t in templates)),
                counts={label:sum(w['label']==label for w in windows) for label in ('supported', 'unresolved')},
                model_passing_counts={str(m['id']):sum(any(c['model']==m['id'] and c['valid'] for c in w['candidates']) for w in windows) for m in models},
                parameters=dict(peak_fraction=fits['peak_fraction'], score_gate=False,
                                local_rotation_deg=LOCAL_ROTATION_DEG, local_scale_fraction=LOCAL_SCALE_FRACTION,
                                minimum_profiles=4, minimum_prediction_coverage=.3, minimum_support=.2),
                interpretation='Per-hypothesis support in all original unbroadened sampled windows, regardless of score sign or magnitude. Separate same-phase orientations retained. Counts across hypotheses overlap and must not be summed. No combined-phase or coexistence classification.',
                limitations='Same-image consistency, not independent validation or phase fractions. Lobes are deviations from the mean, not absolute intensity. Mean-present patterns may pass on either score side; drift or noise can also create lobes.')


def window_detail(result, index, model_id):
    maps = result.get('phase_support')
    if not maps or maps.get('kind') != 'pca_signed_lobes':
        raise ValueError('Build PCA window checks first.')
    if type(index) is not int or not 0 <= index < len(result['raw_spectra']):
        raise ValueError('Choose an original sampled window.')
    if type(model_id) is not int or not 0 <= model_id < len(maps['models']):
        raise ValueError('Choose a retained PCA fit.')
    model = maps['models'][model_id]
    peaks = detect_peaks(result['raw_spectra'][index], result, maps['parameters']['peak_fraction'])
    local = _local(result, peaks, model)
    candidate = _candidate(result, index, model, local)
    match = local['match'] if local else dict(predicted_nodes=model['predicted_nodes'], matches=[])
    # The original-window screen only counts close assignments, unlike lobe search.
    matches = [m for m in match['matches'] if m['profile_id'] in candidate['profiles']]
    fitted = {**model, **candidate, 'predicted_nodes':match['predicted_nodes'], 'matches':matches,
              'matched_profile_count':len(matches), 'coverage':len(matches)/max(len(peaks), 1),
              'rejection_reasons':[] if candidate['valid'] else ['Below original-window support screen']}
    for axis in 'abc':
        key = 'fitted_'+axis+'_nm'
        if fitted.get(key) is not None: fitted[key] /= candidate['local_scale']
    return dict(kind='pca_window', component=model['component'], side=model['side'], window=index,
                spectrum=spectrum_image(result['raw_spectra'][index], result['plan']), peaks=peaks,
                candidates=[fitted], phases=[model['phase']], component_score=candidate['component_score'],
                peak_fraction=maps['parameters']['peak_fraction'], g_max=result['plan']['g_max'])
