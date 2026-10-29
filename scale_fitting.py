"""Bounded local fits of prediction points; measured FFT coordinates are immutable."""
import itertools
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial import cKDTree
import analysis_core as core
from crystal_templates import reciprocal, allowed, NOMINAL_A

BOUNDS = (.85, 1.15)
MODES = ('fixed', 'auto_uniform', 'auto_hcp_ac')
DEFAULT_SCALE_PENALTY = .10


def scale_cost(scale_a, scale_c=None, strength=DEFAULT_SCALE_PENALTY):
    """Exploratory quadratic preference for small reciprocal-scale adjustments.

    A uniform 5% adjustment costs strength; 10% costs four times strength.
    Average independent HCP axes so a uniform change is not charged twice.
    This is a tunable ranking preference, not a calibrated strain prior.
    """
    cost = ((np.asarray(scale_a)-1.)/.05)**2
    if scale_c is not None:
        cost = (cost+((np.asarray(scale_c)-1.)/.05)**2)/2
    return strength*cost


def penalize(result, scale_a, scale_c, strength):
    if result is None:
        return None
    cost = float(scale_cost(scale_a, scale_c, strength))
    result.update(position_score=result.get('position_score', result['score']),
                  position_valid=result.get('position_valid', result['valid']),
                  scale_penalty=cost, scale_penalty_strength=strength)
    result['score'] = result['position_score'] - cost
    result['valid'] = bool(result['position_valid'] and result['score'] > .20)
    return result


def prepare_templates(templates, g_max=10., bcc_a=.330, fcc_a=.417, hcp_a=.295, hcp_c=.468, g_min=3.):
    """Expand allowed reflections for these zones and the complete scale range.

    The zone library stays finite; the reflection-index bound follows the chosen
    reciprocal range and reference dimensions rather than a fixed shell count.
    """
    prepared = []
    for original in templates:
        phase = original['phase']
        projection = original.get('projection')
        if projection is None:
            projection = np.linalg.lstsq(reciprocal(original['hkl'], phase), original['q'], rcond=None)[0]
        if phase == 'HCP':
            # Changing a/c changes the zone's plane in Cartesian reciprocal space.
            # Re-orthonormalize that plane instead of stretching detector x/y axes.
            old_a = original.get('reference_a_nm', .295)
            old_c = original.get('reference_c_nm', .468)
            scaled = projection * np.array([old_a/hcp_a, old_a/hcp_a, old_c/hcp_c])[:, None]
            eig, axes = np.linalg.eigh(scaled.T @ scaled)
            projection = scaled @ ((axes / np.sqrt(eig)) @ axes.T)
        reference = {'BCC': .330/bcc_a, 'FCC': .417/fcc_a}.get(phase, 1.)
        maximum = (g_max+.1)/(BOUNDS[0]*reference)
        a = hcp_a if phase == 'HCP' else NOMINAL_A[phase]
        a_bound = int(np.ceil(a*maximum))
        c_bound = int(np.ceil(hcp_c*maximum)) if phase == 'HCP' else a_bound
        hs = np.array(list(itertools.product(range(-a_bound, a_bound+1),
                                             range(-a_bound, a_bound+1),
                                             range(-c_bound, c_bound+1))))
        hs = hs[allowed(hs, phase) & (hs @ original['zone_3index'] == 0)]
        vectors = reciprocal(hs, phase, a=a, c=hcp_c)
        radii = np.linalg.norm(vectors, axis=1)
        keep = (radii > 0) & (radii >= (g_min-.1)/(BOUNDS[1]*reference)) & (radii <= maximum)
        hs, vectors = hs[keep], vectors[keep]
        q = vectors @ projection
        half = (q[:, 1] > 1e-8) | ((abs(q[:, 1]) < 1e-8) & (q[:, 0] > 0))
        hs, q = hs[half], q[half]
        order = np.argsort(np.linalg.norm(q, axis=1))
        prepared.append({**original, 'hkl': hs[order], 'q': q[order],
                         'g': np.linalg.norm(q[order], axis=1),
                         'reference_a_nm': a, 'reference_c_nm': hcp_c if phase == 'HCP' else None,
                         'projection': projection, 'c_direction': projection[2].copy()})
    return prepared


def metric_transform(template, scale_a, scale_c):
    """Exact in-plane metric induced by scaling basal and c reciprocal vectors.

    For G = q P.T, scaled 3D distances have metric P.T D² P. Its positive
    square root preserves the zone geometry; it is not an arbitrary x/y stretch.
    The remaining in-plane orientation is fitted separately.
    """
    if template['phase'] in ('BCC', 'FCC'):
        return np.eye(2)*scale_a
    v = template['c_direction']
    norm2 = float(v @ v)
    if norm2 < 1e-12:
        return np.eye(2)*scale_a
    parallel = np.sqrt(max(0., scale_a**2 + (scale_c**2-scale_a**2)*norm2))
    return np.eye(2)*scale_a + (parallel-scale_a)*np.outer(v, v)/norm2


def prediction_points(template, scale_a, scale_c, bcc_a=.330, hkl=None, fcc_a=.417):
    q = template['q'] if hkl is None else reciprocal(
        hkl, template['phase'], a=template.get('reference_a_nm'),
        c=template.get('reference_c_nm', .468)) @ template['projection']
    reference = {'BCC': .330/bcc_a, 'FCC': .417/fcc_a}.get(template['phase'], 1.)
    return q @ metric_transform(template, scale_a, scale_c)*reference


def _seed_candidates(peaks, template, tol, bcc_a, double, tree, observed, weights, fcc_a, g_max, g_min):
    lengths = np.linalg.norm(observed, axis=1)
    angles = np.arctan2(observed[:, 1], observed[:, 0])
    low, high = BOUNDS
    ratios = np.unique(np.r_[np.linspace(low/high, high/low, 11), 1.]) if double else [1.]
    seeds = []
    for ratio in ratios:
        q = prediction_points(template, 1., ratio, bcc_a, fcc_a=fcc_a)
        g = np.linalg.norm(q, axis=1)
        lower, upper = max(low, low/ratio), min(high, high/ratio)
        if lower > upper+1e-10:
            continue
        pair = np.argwhere((lengths[:16, None] >= g[None, :]*lower-tol) &
                           (lengths[:16, None] <= g[None, :]*upper+tol))
        if not len(pair):
            continue
        oi, pi = pair.T
        scale = np.clip(lengths[oi]/g[pi], lower, upper)
        angle = (angles[oi]-np.arctan2(q[pi, 1], q[pi, 0])) % np.pi
        hypotheses = np.unique(np.round(np.column_stack((angle, scale)), 5), axis=0)
        angle, scale = hypotheses.T
        scale = np.clip(scale, lower, upper)
        c, s = np.cos(angle)[:, None], np.sin(angle)[:, None]
        predicted = np.stack((c*q[None, :, 0]-s*q[None, :, 1],
                              s*q[None, :, 0]+c*q[None, :, 1]), axis=2)*scale[:, None, None]
        distance, nearest = tree.query(predicted.reshape(-1, 2))
        distance = distance.reshape(len(scale), -1)
        nearest = nearest.reshape(distance.shape) % len(observed)
        visible = (g[None, :]*scale[:, None] >= g_min) & (g[None, :]*scale[:, None] <= g_max)
        quality = np.exp(-.5*(distance/(tol/2))**2)
        quality[(distance > tol) | ~visible] = 0
        support = np.zeros((len(scale), len(observed)))
        np.maximum.at(support, (np.repeat(np.arange(len(scale)), len(q)), nearest.ravel()), quality.ravel())
        quick = support @ weights/weights.sum()
        quick[visible.sum(axis=1) < 4] = 0
        for i in np.argsort(quick)[-3:]:
            if quick[i] >= .2:
                seeds.append((float(quick[i]), float(angle[i]), float(scale[i]), float(scale[i]*ratio)))
    selected = []
    for seed in sorted(seeds, reverse=True):
        if any(abs(np.sin(seed[1]-old[1])) < .01 and
               max(abs(seed[2]-old[2]), abs(seed[3]-old[3])) < .008 for old in selected):
            continue
        selected.append(seed)
        if len(selected) == (4 if double else 3):
            break
    return selected


def _refine(peaks, template, seed, tol, bcc_a, double, strength, fcc_a, g_max, g_min):
    _, angle, sa, sc = seed
    low, high = BOUNDS

    def score(angle, sa, sc):
        return core.score_hypothesis(peaks, template, prediction_points(template, sa, sc, bcc_a, fcc_a=fcc_a), 1., angle, tol, g_max, g_min)

    result = score(angle, sa, sc)
    if not result:
        return None
    for _ in range(3):
        if len(result['matches']) < 3 or result['nonparallel_spread_sine'] < .3:
            break
        matches = result['matches']
        hkl = np.array([m['hkl'] for m in matches])
        observed = np.array([m['observed_q'] for m in matches])
        predicted = np.array([m['predicted_q'] for m in matches])
        observed *= np.where(np.sum(observed*predicted, axis=1) < 0, -1., 1.)[:, None]
        weights = np.sqrt([m['weight']*max(m['quality'], .05) for m in matches])[:, None]

        def residual(params):
            a, s1 = params[:2]
            s2 = params[2] if double else s1
            q = core.rotation(prediction_points(template, s1, s2, bcc_a, hkl, fcc_a=fcc_a), a)
            return ((q-observed)*weights).ravel()

        start = [angle, sa, sc] if double else [angle, sa]
        bounds = ([angle-.06, low, low], [angle+.06, high, high]) if double else ([angle-.06, low], [angle+.06, high])
        fitted = least_squares(residual, np.clip(start, *bounds), bounds=bounds, max_nfev=12,
                               ftol=1e-7, xtol=1e-7, gtol=1e-7)
        aa, ss = fitted.x[:2]
        cc = fitted.x[2] if double else ss
        proposed = score(aa, ss, cc)
        if not proposed or proposed['score'] < result['score']-1e-10:
            break
        improvement = proposed['score']-result['score']
        result, angle, sa, sc = proposed, float(aa), float(ss), float(cc)
        if improvement < 1e-7:
            break
    c_visible = template['phase'] == 'HCP' and float(template['c_direction'] @ template['c_direction']) > 1e-10
    nominal_a = {'BCC': bcc_a, 'FCC': fcc_a, 'HCP': template.get('reference_a_nm', .295)}[template['phase']]
    nominal_c = template.get('reference_c_nm', .468) if template['phase'] == 'HCP' else None
    fitted_a = nominal_a/sa
    fitted_c = nominal_c/sc if template['phase'] == 'HCP' else None
    result.update({'shared_scale': None if double else sa, 'scale_a': sa,
                   'scale_c': sc if template['phase'] == 'HCP' else None,
                   'nominal_a_nm': nominal_a,
                   'nominal_c_nm': nominal_c,
                   'fitted_a_nm': fitted_a, 'fitted_c_nm': fitted_c,
                   'scale_parameter_count': 2 if double else 1,
                   'c_axis_visible': c_visible,
                   'scale_at_bound': any(min(abs(v-low), abs(v-high)) < .001 for v in ([sa, sc] if double else [sa]))})
    # Keep fitted coordinates inspectable and unaltered by the ranking preference.
    # Apply cost to every fitted hypothesis BEFORE deduplication/zone selection.
    return penalize(result, sa, sc if double else None, strength)


def search(peaks, templates, tol, mode, bcc_a=.330, topn=5, scale_penalty_strength=DEFAULT_SCALE_PENALTY, candidate_sink=None, fcc_a=.417, g_max=10., g_min=3.):
    if mode not in ('auto_uniform', 'auto_hcp_ac'):
        raise ValueError('Unknown automatic scale mode.')
    strength = float(scale_penalty_strength)
    if not np.isfinite(strength) or not 0 <= strength <= .5:
        raise ValueError('Scale penalty must be between 0 and 0.5.')
    if len(peaks) < 4:
        return []
    observed = np.array([[p['qx'], p['qy']] for p in peaks])
    weights = np.array([p['weight'] for p in peaks])
    tree = cKDTree(np.r_[observed, -observed])
    candidates = []
    for template in templates:
        double = (mode == 'auto_hcp_ac' and template['phase'] == 'HCP' and
                  float(template['c_direction'] @ template['c_direction']) > 1e-10)
        if len(template['q']) < 4:
            continue
        seeds = _seed_candidates(peaks, template, tol, bcc_a, double, tree, observed, weights, fcc_a, g_max, g_min)
        for seed in seeds:
            result = _refine(peaks, template, seed, tol, bcc_a, double, strength, fcc_a, g_max, g_min)
            if result:
                result['scale_mode'] = mode
                if mode == 'auto_hcp_ac' and template['phase'] == 'HCP' and not double:
                    result.update({'scale_c': None, 'fitted_c_nm': None,
                                   'scale_note': 'This zone does not constrain c; only a is fitted.'})
                candidates.append(result)
    if candidate_sink is not None:
        # Retain every refined hypothesis, before penalty-dependent pruning.
        candidate_sink.extend(candidates)
    return retain(candidates, topn)


def retain(candidates, topn=5):
    retained = []
    for candidate in sorted(candidates, key=lambda m: m['score'], reverse=True):
        ids = {m['profile_id'] for m in candidate['matches']}
        if any(candidate['phase'] == other['phase'] and
               candidate['zone_3index'] == other['zone_3index'] and
               len(ids & {m['profile_id'] for m in other['matches']}) /
               max(len(ids | {m['profile_id'] for m in other['matches']}), 1) > .8 for other in retained):
            continue
        if sum(candidate['phase'] == other['phase'] for other in retained) < topn:
            retained.append(candidate)
    return retained


def rerank(candidates, strength, topn=5):
    """Reweight cached positional fits without changing coordinates or matches."""
    strength = float(strength)
    if not np.isfinite(strength) or not 0 <= strength <= .5:
        raise ValueError('Scale penalty must be between 0 and 0.5.')
    ranked = []
    for original in candidates:
        model = original.copy()
        c = model.get('scale_c') if model.get('scale_parameter_count') == 2 else None
        ranked.append(penalize(model, model['scale_a'], c, strength))
    return retain(ranked, topn)
