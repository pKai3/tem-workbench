"""Bounded, phase-neutral brightness consistency for diffraction and FFT.

A descriptive model of recorded image signal, not structure factors, phase
fractions or a dynamical simulation. Geometry supplies all assignments first.
"""
import math
import numpy as np
from scipy.optimize import least_squares

VERSION = 'soft-brightness-v3'
DEFAULT_WEIGHT = .10
LOG_SCATTER = math.log(2.)  # Broad within-phase variation, even for a perfect group.


def validate_weight(value):
    value = float(value)
    if not np.isfinite(value) or not 0 <= value <= .5:
        raise ValueError('Brightness grouping strength must be between 0 and 0.5.')
    return value


def reliable_intensity(peak):
    value = peak.get('integrated_intensity')
    if not peak.get('intensity_reliable') or value is None or not np.isfinite(value) or value <= 0:
        return None
    used = [r for r in peak.get('spot_measurements', []) if r.get('reliable')]
    if any('at_image_maximum' in r.get('flags', []) for r in used):
        return None
    return float(value)


def phases_at(model, node):
    if 'phases' in node:
        return sorted(set(node['phases']))
    if model.get('related_pattern'):
        return sorted({'BCC' if owner['component'] == 0 else 'OMEGA' for owner in node['components']})
    return [model['phase']]


def inspect(model, peaks):
    """Compare one brightness level with levels implied by supported phases.

    Shared predictions add phase levels and own ONE measurement. Omega variants
    share one phase level. Both explanations fit the same radial log-intensity
    trend; a penalized robust improvement earns only a bounded positive bonus.
    """
    report = dict(version=VERSION, status='insufficient_intensity', factor=0., groups=[],
                  reliable_profile_ids=[], shared_profile_ids=[], log_scatter_floor=LOG_SCATTER)
    model['brightness_grouping'] = report
    usable = {p['profile_id']: (p, reliable_intensity(p)) for p in peaks}
    usable = {key: value for key, value in usable.items() if value[1] is not None}
    report['available_profiles'] = len(usable)
    rows, seen = [], set()
    for match in model['matches']:
        pid = match['profile_id']
        if pid not in usable or pid in seen:
            continue
        seen.add(pid)
        peak, intensity = usable[pid]
        phases = phases_at(model, model['predicted_nodes'][match['node_index']])
        rows.append((pid, peak, intensity, phases, float(np.clip(match.get('quality', 1.), 0., 1.))))
    report['reliable_profile_ids'] = sorted(r[0] for r in rows)
    report['shared_profile_ids'] = sorted(r[0] for r in rows if len(r[3]) > 1)
    phases = sorted({phase for row in rows for phase in row[3]})
    if len(phases) < 2:
        report['status'] = 'single_phase' if rows else 'insufficient_intensity'
        return model
    if len(rows) < 6:
        return model
    membership = np.array([[phase in row[3] for phase in phases] for row in rows], dtype=float)
    # Each distinct membership used to establish a contrast needs at least two
    # independent directions. An isolated bright outlier cannot supply a group.
    supported = []
    for pattern in np.unique(membership, axis=0):
        indices = np.flatnonzero(np.all(membership == pattern, axis=1))
        angles = [math.atan2(rows[i][1]['qy'], rows[i][1]['qx']) for i in indices]
        spread = max((abs(math.sin(a-b)) for a in angles for b in angles), default=0.)
        if len(indices) >= 2 and spread > .25:
            supported.append(pattern)
    if len(supported) < len(phases) or np.linalg.matrix_rank(supported) < len(phases):
        report['status'] = 'insufficient_group_support'
        return model
    intensities = np.array([r[2] for r in rows])
    reference = float(np.median(intensities))
    # Bound leverage of extreme values; raw/exported measurements stay unchanged.
    y = np.log(intensities/reference)
    clipped = np.clip(y, -math.log(32.), math.log(32.))
    radii = np.array([math.hypot(r[1]['qx'], r[1]['qy']) for r in rows])
    radial = np.log(np.maximum(radii, 1e-12))
    radial -= np.median(radial)
    radial /= max(float(np.ptp(radial)), 1.)
    agreement = np.array([row[4] for row in rows])
    def residual(parameters, matrix):
        expected = np.log(matrix @ np.exp(parameters[:-1])) + parameters[-1]*radial
        return np.sqrt(agreement)*(clipped-expected)/LOG_SCATTER
    def fit(matrix):
        n = matrix.shape[1]
        return least_squares(residual, np.r_[np.full(n, -math.log(n)), 0.],
            args=(matrix,), bounds=(np.r_[np.full(n, -12.), -6.], np.r_[np.full(n, 12.), 6.]),
            loss='soft_l1', max_nfev=80)
    baseline = fit(np.ones((len(rows), 1)))
    grouped = fit(membership)
    if not baseline.success or not grouped.success:
        report['status'] = 'fit_unavailable'
        return model
    complexity = .5*(len(phases)-1)*math.log(len(rows))
    gain = max(0., float(baseline.cost-grouped.cost-complexity))
    support_fraction = float(agreement.sum())/max(len(usable), 1)
    factor = support_fraction*(-math.expm1(-2*gain/len(rows)))
    report.update(status='supported' if gain > 0 else 'no_grouping_gain', factor=float(factor),
        baseline_loss=float(baseline.cost), grouped_loss=float(grouped.cost),
        complexity_cost=float(complexity), penalized_gain=gain, supported_fraction=support_fraction,
        radial_slope=float(grouped.x[-1]), baseline_radial_slope=float(baseline.x[-1]),
        clipped_profile_count=int(np.count_nonzero(y != clipped)), reference_intensity=reference)
    for phase, level in zip(phases, np.exp(grouped.x[:-1])):
        report['groups'].append(dict(phase=phase, relative_level=float(level),
            profile_ids=sorted(r[0] for r in rows if phase in r[3]),
            exclusive_profile_ids=sorted(r[0] for r in rows if r[3] == [phase])))
    return model


def apply(model, weight):
    weight = validate_weight(weight)
    previous = model.get('brightness_bonus', 0.)
    bonus = weight*model.get('brightness_grouping', {}).get('factor', 0.)
    model.update(brightness_grouping_weight=weight, brightness_bonus=float(bonus),
                 score=float(model['score']-previous+bonus))
    # Intensity can rerank passing geometry, not rescue a rejected fit.
    model['valid'] = bool(model['position_valid'] and model['score']-bonus-model.get('double_diffraction_bonus', 0.) > .20)
    return model
