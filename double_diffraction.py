"""Observed, allowed two-step vector paths; with optional bounded ranking evidence.

Independent candidates are inspected separately. Only an explicitly joint model
may combine components. Both measured and fitted sums must reach the target;
unassigned/weak peaks never seed paths. Direct-image conjugates are not invented.
This tests in-zone positional compatibility, not thickness/excitation/intensity.
"""
from itertools import combinations_with_replacement, product
import numpy as np
from scipy.spatial import cKDTree
from crystal_templates import allowed, PHASES

VERSION = 'observed-two-step-v1'
MAX_BEAMS = 256
MAX_PATHS = 8
DEFAULT_WEIGHT = 0.
SCORING_VERSION = 'weighted-dd-v1'


def observations(peak):
    q = [peak['qx'], peak['qy']]
    return peak.get('observed_spots', [q, [-v for v in q]])


def fitted_map(component):
    nodes = component.get('predicted_nodes', [])
    if len(nodes) < 2 or any('hkl' not in n or 'q' not in n for n in nodes):
        return None
    h = np.asarray([n['hkl'] for n in nodes], float)
    q = np.asarray([n['q'] for n in nodes], float)
    if h.shape != (len(nodes), 3) or q.shape != (len(nodes), 2) or not np.isfinite(h).all() or not np.isfinite(q).all():
        return None
    if not np.all(h == np.round(h)) or ('zone_3index' in component and np.any(h @ component['zone_3index'] != 0)):
        return None
    transform, _, rank, _ = np.linalg.lstsq(h, q, rcond=None)
    if rank != 2 or np.linalg.matrix_rank(transform) != 2 or not np.allclose(h @ transform, q, atol=1e-7, rtol=1e-7):
        return None
    if not allowed(h, component['phase']).all():
        return None
    return transform


def inspect_components(components, assignments, peaks, tolerance, g_min, g_max,
                       normalization=None, parent_zone=None, reciprocal_bases=None):
    """Return one hit per observed target position, counted once per profile."""
    report = dict(version=VERSION, status='unavailable', hits=[], profile_ids=[], profile_count=0,
                  total_profiles=len(peaks), remaining_profile_ids=[p['profile_id'] for p in peaks],
                  max_paths_per_spot=MAX_PATHS, interpretation='Candidate two-step paths only; not proof of double diffraction. Optional DD weight adds ranking evidence; never supplies single-scattering acceptance.')
    maps = {c['id']: fitted_map(c) for c in components}
    if not components or any(v is None for v in maps.values()):
        return report
    phases = {c['id']: c['phase'] for c in components}
    predictions = np.array([n['q'] for c in components for n in c['predicted_nodes']])
    norm = float(normalization or np.min(np.linalg.norm(predictions, axis=1)))
    radii = [np.hypot(p['qx'], p['qy']) for p in peaks]
    tol = min(float(tolerance), .04*float(np.median(radii))) if radii else float(tolerance)
    if norm <= 0 or tol <= 0:
        return report
    matched = {a['profile_id']: a for a in assignments if a.get('indices') and a.get('predicted_q') is not None}
    report.update(status='checked', allowed_profile_ids=sorted(matched), allowed_profile_count=len(matched),
                  normalization=norm, normalization_label='parent shortest reciprocal reflection' if normalization else 'shortest fitted prediction in band',
                  search_radius=tol, tolerance_relative=tol/norm, source_beam_count=0, truncated_beams=0)
    beams, targets = [], []
    for peak in peaks:
        pid = peak['profile_id']
        for point in observations(peak):
            point = np.asarray(point, float)
            if point.shape != (2,) or not np.isfinite(point).all() or not g_min <= np.linalg.norm(point) <= g_max:
                continue
            if pid not in matched:
                targets.append((pid, point))
                continue
            assignment = matched[pid]
            predicted = np.asarray(assignment['predicted_q'], float)
            sign = 1 if np.linalg.norm(point-predicted) <= np.linalg.norm(point+predicted) else -1
            predicted = predicted*sign
            error = float(np.linalg.norm(point-predicted))
            if error > tol:
                continue
            indices = []
            for owner in assignment['indices']:
                cid = owner['component']
                h = np.asarray(owner['hkl'], int)*sign
                if cid not in maps or not allowed([h], phases[cid])[0] or not np.allclose(h @ maps[cid], predicted, atol=1e-7, rtol=1e-7):
                    continue
                if reciprocal_bases is not None:
                    parent_vector = h @ reciprocal_bases[cid]
                    if abs(parent_vector @ parent_zone) > 1e-7:
                        continue
                indices.append(dict(component=cid, phase=phases[cid], hkl=h.tolist()))
            if indices:
                beams.append(dict(profile_id=pid, observed_q=point.tolist(), predicted_q=predicted.tolist(), indices=indices, error=error))
    # Bound quadratic work on unusually dense patterns, retaining the best fitted
    # measured beams. An explicit partial status discloses the skipped beams.
    beams.sort(key=lambda b: (b['error'], b['profile_id'], b['observed_q']))
    report['truncated_beams'] = max(0, len(beams)-MAX_BEAMS)
    beams = beams[:MAX_BEAMS]
    report['source_beam_count'] = len(beams)
    if report['truncated_beams']:
        report['status'] = 'partial'
    if targets and beams:
        predicted_tree = cKDTree(np.r_[predictions, -predictions])
        target_points = np.array([q for _, q in targets])
        target_tree = cKDTree(target_points)
        pairs = np.array(list(combinations_with_replacement(range(len(beams)), 2)))
        bq = np.array([b['predicted_q'] for b in beams])
        oq = np.array([b['observed_q'] for b in beams])
        sums = bq[pairs[:, 0]]+bq[pairs[:, 1]]
        measured = oq[pairs[:, 0]]+oq[pairs[:, 1]]
        distances, _ = predicted_tree.query(sums)
        radius = np.linalg.norm(sums, axis=1)
        valid = (radius >= g_min) & (radius <= g_max) & (distances > tol)
        paths_by_target = {}
        for pair, prediction, measured_sum in zip(pairs[valid], sums[valid], measured[valid]):
            left, right = [beams[i] for i in pair]
            for ti in target_tree.query_ball_point(prediction, tol):
                pid, point = targets[ti]
                error = float(np.linalg.norm(point-measured_sum))
                if error > tol:
                    continue
                for first, second in product(left['indices'], right['indices']):
                    same = first['component'] == second['component']
                    h = np.array(first['hkl'])+second['hkl'] if same else None
                    # Centering-allowed vectors are closed under addition. They
                    # cannot generate a same-crystal centering-forbidden spot.
                    if same and (not h.any() or allowed([h], first['phase'])[0]):
                        continue
                    steps = [dict(profile_id=b['profile_id'], observed_q=b['observed_q'], predicted_q=b['predicted_q'], **index)
                             for b, index in [(left, first), (right, second)]]
                    steps.sort(key=lambda s: (s['profile_id'], s['component'], s['hkl']))
                    path = dict(kind='same_crystal' if same else 'cross_component', steps=steps,
                                predicted_q=prediction.tolist(), measured_sum_q=measured_sum.tolist(),
                                residual_relative=float(np.linalg.norm(point-prediction)/norm), measured_residual_relative=error/norm)
                    if same:
                        path['sum_hkl'] = h.tolist()
                    if reciprocal_bases is not None:
                        path['sum_reciprocal_parent'] = (np.array(first['hkl']) @ reciprocal_bases[first['component']]+
                                                         np.array(second['hkl']) @ reciprocal_bases[second['component']]).tolist()
                    key = tuple((s['profile_id'], s['component'], tuple(s['hkl'])) for s in steps)
                    paths_by_target.setdefault(ti, {})[key] = path
        for ti, unique in paths_by_target.items():
            paths = sorted(unique.values(), key=lambda p: (p['measured_residual_relative'], p['residual_relative'],
                           tuple((s['profile_id'], s['component'], s['hkl']) for s in p['steps'])))
            pid, point = targets[ti]
            report['hits'].append(dict(profile_id=pid, observed_q=point.tolist(), paths=paths[:MAX_PATHS], path_count=len(paths),
                                       residual_relative=paths[0]['residual_relative'], measured_residual_relative=paths[0]['measured_residual_relative']))
    report['hits'].sort(key=lambda h: (h['profile_id'], h['observed_q']))
    ids = sorted({h['profile_id'] for h in report['hits']})
    profiles = []
    for pid in ids:
        hits = [h for h in report['hits'] if h['profile_id']==pid]
        profiles.append(dict(profile_id=pid, supported_spot_count=len(hits),
                             residual_relative=float(np.sqrt(np.mean([h['residual_relative']**2 for h in hits]))),
                             measured_residual_relative=float(np.sqrt(np.mean([h['measured_residual_relative']**2 for h in hits])))))
    single_errors = []
    for peak in peaks:
        if peak['profile_id'] in matched:
            q = np.array([peak['qx'], peak['qy']])
            prediction = np.array(matched[peak['profile_id']]['predicted_q'])
            single_errors.append(min(np.linalg.norm(q-prediction), np.linalg.norm(q+prediction))/norm)
    combined_errors = single_errors+[p['residual_relative'] for p in profiles]
    report.update(profile_ids=ids, profile_count=len(ids), profiles=profiles,
                  remaining_profile_ids=[p['profile_id'] for p in peaks if p['profile_id'] not in matched and p['profile_id'] not in ids],
                  coverage_with_candidates=(len(matched)+len(ids))/len(peaks) if peaks else 0.,
                  rms_with_candidates_relative=float(np.sqrt(np.mean(np.square(combined_errors)))) if combined_errors else None,
                  rms_relative=float(np.sqrt(np.mean([p['residual_relative']**2 for p in profiles]))) if profiles else None,
                  measured_rms_relative=float(np.sqrt(np.mean([p['measured_residual_relative']**2 for p in profiles]))) if profiles else None)
    return report


def inspect(model, peaks, tolerance, g_min, g_max):
    if model.get('phase') not in PHASES:
        return inspect_components([], [], peaks, tolerance, g_min, g_max)
    component = dict(model, id=model['phase'])
    assignments = [dict(m, indices=[dict(component=model['phase'], hkl=m['hkl'])]) for m in model.get('matches', []) if 'hkl' in m]
    return inspect_components([component], assignments, peaks, tolerance, g_min, g_max)


def annotate(models, spectrum, tolerance, g_min, g_max, *, reuse_report=False):
    for model in models:
        report = dict(model['double_diffraction']) if reuse_report and 'double_diffraction' in model else inspect(model, spectrum['peaks'], tolerance, g_min, g_max)
        # The display report contains geometry; ranking terms remain on the fit.
        report.pop('scoring_version', None)
        report.pop('scoring_factor', None)
        report['observation_kind'] = 'diffraction' if spectrum.get('kind') == 'diffraction' else 'image_fft'
        model['double_diffraction'] = report


def inspect_joint(model, peaks, tolerance, g_min, g_max, reciprocal_bases):
    components = [dict(c, phase='BCC' if c['id']=='beta' else 'OMEGA') for c in model['components'] if c['active']]
    report = inspect_components(components, model['assignments'], peaks, tolerance, g_min, g_max,
                                model['parent']['fundamental_spacing'], np.array(model['parent']['zone_3index']), reciprocal_bases)
    report['observation_kind'] = 'diffraction'
    return report


def validate_weight(value):
    value = float(value)
    if not np.isfinite(value) or not 0 <= value <= 1:
        raise ValueError('Double-diffraction weight must be between 0 and 1.')
    return value


def scoring_factor(report, peaks):
    """Quality-weighted share of additional profiles, counted once each.

    Both fitted and measured sums must agree. Multiple paths give no extra
    credit, and a partially supported conjugate pair receives partial credit.
    This is adjustable geometric evidence, not a scattering probability.
    """
    tolerance = report.get('tolerance_relative', 0.)
    if tolerance <= 0:
        return 0.
    allowed_ids = set(report.get('allowed_profile_ids', []))
    by_id = {p['profile_id']: p for p in peaks}
    total = sum(p.get('weight', 1.) for p in peaks)
    credit, seen = 0., set()
    for profile in report.get('profiles', []):
        pid = profile['profile_id']
        if pid in seen or pid in allowed_ids or pid not in by_id:
            continue
        seen.add(pid)
        peak = by_id[pid]
        support = min(1., profile['supported_spot_count']/max(len(observations(peak)), 1))
        error = max(profile['residual_relative'], profile['measured_residual_relative'])
        quality = float(np.exp(-.5*(error/tolerance)**2))
        credit += peak.get('weight', 1.)*quality*support
    return float(np.clip(credit/max(total, 1e-12), 0., 1.))


def inspect_union(model, components, owners, peaks, tolerance, g_min, g_max):
    assignments = []
    for match in model.get('matches', []):
        index = match['node_index']
        sign = 1 if np.dot(model['predicted_nodes'][index]['q'], match['predicted_q']) >= 0 else -1
        indices = [dict(component=o['component'], hkl=(np.array(o['hkl'])*sign).tolist()) for o in owners[index]]
        assignments.append(dict(match, indices=indices))
    return inspect_components(components, assignments, peaks, tolerance, g_min, g_max)


def apply(model, weight):
    weight = validate_weight(weight)
    previous = model.get('double_diffraction_bonus', 0.)
    bonus = weight*model.get('double_diffraction_factor', 0.)
    model.update(double_diffraction_weight=weight, double_diffraction_bonus=float(bonus),
                 score=float(model['score']-previous+bonus))
    # Neither DD nor brightness may rescue the single-scattering screen.
    model['valid'] = bool(model['position_valid'] and model['score']-bonus-model.get('brightness_bonus', 0.) > .20)
    return model


def evaluate(model, peaks, tolerance, g_min, g_max, weight=DEFAULT_WEIGHT, *, components=None, owners=None, reuse_report=False, defer_report=False):
    weight = validate_weight(weight)
    if weight:
        if defer_report and components is None and model.get('phase') in ('BCC', 'FCC', 'ORT'):
            # These allowed single-crystal index sets are closed under addition:
            # no two-step sum can reach a nominally forbidden site. The rank
            # contribution is exactly zero. Retained fits still get the complete
            # report in annotate(); cross-component paths must always be tested.
            model['double_diffraction_factor'] = 0.
            return apply(model, weight)
        report = (inspect_union(model, components, owners, peaks, tolerance, g_min, g_max)
                  if components is not None else (model.get('double_diffraction') if reuse_report else None) or inspect(model, peaks, tolerance, g_min, g_max))
        model['double_diffraction'] = report
        model['double_diffraction_factor'] = scoring_factor(report, peaks)
        report.update(scoring_version=SCORING_VERSION, scoring_factor=model['double_diffraction_factor'])
    return apply(model, weight)
