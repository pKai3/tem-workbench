"""Relative-geometry indexing of a BCC parent and its four ideal omega variants.

OR: {111}beta || (0001)omega, <110>beta || <11-20>omega.
Ideal collapse: a_omega=sqrt(2)*a_beta, c_omega=sqrt(3)*a_beta/2.
See https://doi.org/10.1038/s41598-020-65254-z (Fig. 4).
This is a bounded zone-axis search, not an intensity or phase-fraction model.
The parent is fitted first; variants never acquire independent angles/scales.
"""
from functools import lru_cache
from itertools import combinations_with_replacement, product
import math
import numpy as np
import double_diffraction
import analysis_core as core
import peak_evidence
import brightness_grouping
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree
from crystal_templates import allowed

VERSION = 'related-patterns-common-score-v6'
AXES = ((1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1))
COLORS = ('#63b3ff', '#ff759b', '#67e0a3', '#ffc766', '#c4a0ff')
# Real-space primitive hexagonal cell, rows in units of the cubic parent a.
OMEGA_CELL = np.array([[1., -1., 0.], [0., 1., -1.], [.5, .5, .5]])


def variant_basis(index):
    return np.linalg.inv(OMEGA_CELL * np.array(AXES[index])).T


def projection(zone, mirror=1):
    normal = np.array(zone, dtype=float); normal /= np.linalg.norm(normal)
    x = np.cross(normal, np.eye(3)[np.argmin(abs(normal))]); x /= np.linalg.norm(x)
    return np.column_stack((x, np.cross(normal, x))) * [1, mirror]


def canonical(q, h):
    flip = (q[:, 1] < -1e-8) | ((abs(q[:, 1]) < 1e-8) & (q[:, 0] < 0))
    return q * np.where(flip, -1., 1.)[:, None], h * np.where(flip, -1, 1)[:, None]


@lru_cache(maxsize=256)
def lattice(zone, mirror=1, component=0, limit=8, absent=False):
    """Enumerate the exact zone plane without a three-dimensional cube."""
    basis = np.eye(3) if component == 0 else variant_basis(component-1)
    coefficients = np.rint(6*basis @ np.array(zone)).astype(int)
    solved = int(np.argmax(abs(coefficients)))
    free = [axis for axis in range(3) if axis != solved]
    pairs = np.array(list(product(range(-limit, limit+1), repeat=2)))
    numerator = -(pairs @ coefficients[free])
    keep = (numerator % coefficients[solved] == 0) & (abs(numerator) <= limit*abs(coefficients[solved]))
    h = np.zeros((int(keep.sum()), 3), dtype=int)
    h[:, free] = pairs[keep]
    h[:, solved] = numerator[keep] // coefficients[solved]
    v = h @ basis
    keep = allowed(h, 'BCC' if component == 0 else 'OMEGA')
    if absent:
        keep = ~keep
    keep &= (abs(v @ np.array(zone)) < 1e-8) & (np.linalg.norm(v, axis=1) > 0)
    h, q = h[keep], v[keep] @ projection(zone, mirror)
    half = (q[:, 1] > 1e-8) | ((abs(q[:, 1]) < 1e-8) & (q[:, 0] > 0))
    h, q = h[half], q[half]
    order = np.argsort(np.linalg.norm(q, axis=1), kind='stable')
    return q[order], h[order]


def transform(q, factor):
    z = (q[:, 0] + 1j*q[:, 1]) * factor
    return np.column_stack((z.real, z.imag))


def assign(observed, predicted, weights, tolerance):
    if not len(predicted):
        return [], np.empty(0), np.empty(0, dtype=int)
    direct = np.linalg.norm(observed[:, None]-predicted[None], axis=2)
    opposite = np.linalg.norm(observed[:, None]+predicted[None], axis=2)
    distances = np.minimum(direct, opposite)
    quality = core.positional_quality(distances, tolerance)
    rows, cols = linear_sum_assignment(np.c_[-weights[:, None]*quality, np.zeros((len(observed), len(observed)))])
    pairs = [(int(i), int(j)) for i, j in zip(rows, cols) if j < len(predicted) and quality[i, j] > 0]
    return pairs, np.array([distances[i, j] for i, j in pairs]), np.array([1 if direct[i, j] <= opposite[i, j] else -1 for i, j in pairs])


def spread(points):
    if len(points) < 2:
        return 0.
    directions = points / np.linalg.norm(points, axis=1)[:, None]
    return float(np.max(abs(np.linalg.det(np.stack(np.broadcast_arrays(directions[:, None], directions[None]), axis=-2)))))


def predictions(zone, mirror, factor, component, low, high, visible, absent=False):
    # Expand through the whole fitting disk. Truncating a dense candidate's
    # predictions would falsely improve its compactness score.
    limit = max(4, int(np.ceil(high/abs(factor)*(1 if component == 0 else np.sqrt(2)))))
    if limit > 32:
        return np.empty((0, 2)), np.empty((0, 3), dtype=int)
    q, h = lattice(tuple(zone), mirror, component, limit, absent)
    q, h = canonical(transform(q, factor), h)
    radius = np.linalg.norm(q, axis=1)
    keep = (radius >= low) & (radius <= high)
    if visible is not None:
        keep &= visible(q)
    return q[keep], h[keep]


def parent_candidates(observed, weights, tolerance, low, high, visible):
    """Fit parent hypotheses independently of omega; retain alternatives for comparison."""
    tree = cKDTree(np.r_[observed, -observed])
    order = np.argsort(weights)[::-1][:32]
    candidates = []
    for zone in combinations_with_replacement(range(4), 3):
        if math.gcd(*zone) != 1:
            continue
        for mirror in (1, -1):
            raw, _ = lattice(zone, mirror)
            seeds = raw[:16]
            if not len(seeds):
                continue
            factors = ((observed[order, 0]+1j*observed[order, 1])[:, None] /
                       (seeds[:, 0]+1j*seeds[:, 1])[None]).ravel()
            ranked, seen = [], set()
            for factor in factors:
                key = (round(math.log(abs(factor))*100), round((np.angle(factor) % np.pi)*100))
                if key in seen:
                    continue
                seen.add(key)
                q, _ = predictions(zone, mirror, factor, 0, low, high, visible)
                if not 2 <= len(q) <= 240:
                    continue
                d, ids = tree.query(q)
                hit = d < core.matching_radius(tolerance)
                if hit.sum() < 2:
                    continue
                # Unique observed profiles only, including across opposite signs.
                support = np.unique(ids[hit] % len(observed))
                # Rank this parent on its own subset, not the whole beta+omega
                # pattern. Global coverage otherwise discards a sparse parent
                # in favour of a dense lattice absorbing the satellites.
                precision = len(support)/len(q)
                merit = float(np.mean(core.positional_quality(d[hit], tolerance)))*math.sqrt(precision)+.01*min(len(support),6)
                ranked.append((merit, factor))
            # Keep different lattice spacings: a dense sublattice can explain
            # satellites as parent spots and must not erase the coarser parent.
            starts, scale_bins = [], {}
            for merit, factor in sorted(ranked, key=lambda x: x[0], reverse=True):
                bucket = (round(math.log(abs(factor))*8), round((np.angle(factor) % np.pi)*12))
                if scale_bins.get(bucket, 0) >= 2:
                    continue
                starts.append(factor); scale_bins[bucket] = scale_bins.get(bucket, 0)+1
                if len(starts) == 192:
                    break
            for factor in starts:
                for _ in range(3):
                    q, h = predictions(zone, mirror, factor, 0, low, high, visible)
                    pairs, residuals, signs = assign(observed, q, weights, tolerance)
                    if len(pairs) < 2:
                        break
                    oi, pi = np.array(pairs).T
                    target = observed[oi] * signs[:, None]
                    source = (q[pi, 0]+1j*q[pi, 1])/factor
                    influence = weights[oi]*core.positional_quality(residuals, tolerance)
                    fit = np.sum(influence*np.conj(source)*(target[:, 0]+1j*target[:, 1])) / np.sum(influence*abs(source)**2)
                    if abs(fit/factor-1) < 1e-7:
                        break
                    factor = fit
                q, h = predictions(zone, mirror, factor, 0, low, high, visible)
                pairs, residuals, signs = assign(observed, q, weights, tolerance)
                if len(pairs) < 2 or spread(observed[[i for i, _ in pairs]]) < .5:
                    continue
                quality = sum(weights[i]*q for (i, _), q in zip(pairs, core.positional_quality(residuals, tolerance)))/sum(weights[i] for i,_ in pairs)
                merit = quality*math.sqrt(len(pairs)/len(q))+.01*min(len(pairs),6)
                candidates.append(dict(zone=zone, mirror=mirror, factor=factor, merit=merit, parent_count=len(pairs)))
    selected, seen, scale_bins = [], set(), {}
    for candidate in sorted(candidates, key=lambda x: x['merit'], reverse=True):
        q, _ = predictions(candidate['zone'], candidate['mirror'], candidate['factor'], 0, low, high, visible)
        key = tuple(sorted(map(tuple, np.round(q/tolerance/2).astype(int))))
        if key in seen:
            continue
        seen.add(key)
        bucket = round(math.log(abs(candidate['factor']))*8)
        if scale_bins.get(bucket, 0) >= 12:
            continue
        scale_bins[bucket] = scale_bins.get(bucket, 0)+1
        selected.append(candidate)
        if len(selected) == 96:
            break
    return selected


def union_nodes(parts, selected):
    nodes, keys = [], {}
    for component in selected:
        q, h = parts[component]
        for point, index in zip(q, h):
            key = tuple(np.round(point, 7))
            if key not in keys:
                keys[key] = len(nodes)
                nodes.append(dict(q=point.tolist(), components=[]))
            nodes[keys[key]]['components'].append(dict(component=component, hkl=index.tolist()))
    return nodes


def anchored_parent(anchors, peaks, observed, weights, tolerance):
    """Optional measured beta hkl anchors disambiguate uncalibrated sublattices."""
    if not isinstance(anchors, list) or len(anchors) != 2:
        raise ValueError('Use two beta anchor profiles with their three-index reflections.')
    indices, rows = [], []
    for anchor in anchors:
        h = np.asarray(anchor.get('hkl'), dtype=float)
        if h.shape != (3,) or not np.isfinite(h).all() or np.any(h != np.round(h)) or np.max(abs(h)) > 8 or not h.any() or not allowed([h], 'BCC')[0]:
            raise ValueError('Beta anchors need nonzero integer BCC reflections (h+k+l even), with indices up to 8.')
        row = next((i for i, p in enumerate(peaks) if p['profile_id'] == anchor.get('profile_id')), None)
        if row is None:
            raise ValueError('A beta anchor profile is no longer detected. Clear or update the anchors.')
        indices.append(h); rows.append(row)
    zone = np.cross(*indices).astype(int)
    if rows[0] == rows[1] or not zone.any() or spread(observed[rows]) < .25:
        raise ValueError('Beta anchors must be two different nonparallel reflections.')
    zone //= math.gcd(*zone)
    options = []
    for mirror in (1, -1):
        source = np.array(indices) @ projection(zone, mirror)
        z = source[:, 0]+1j*source[:, 1]
        for sign in (1, -1):
            # Profiles identify +/-q, so either sign of the second is admissible.
            target = observed[rows].copy(); target[1] *= sign
            factor = np.sum(weights[rows]*np.conj(z)*(target[:, 0]+1j*target[:, 1]))/np.sum(weights[rows]*abs(z)**2)
            error = np.max(np.linalg.norm(transform(source, factor)-target, axis=1))
            if error < core.matching_radius(tolerance):
                options.append(dict(zone=tuple(int(v) for v in zone), mirror=mirror, factor=factor, merit=-error, parent_count=2))
    if not options:
        raise ValueError('The beta anchors disagree in angles or spot ratios. Check their indices and the beam centre.')
    return options


def fit(peaks, tolerance, g_min, g_max, visible=None, anchors=None, *, parents=None,
        context=None, settings=None, candidate_sink=None, include_omega=True, cancel_event=None):
    """Fit in arbitrary common reciprocal units; never infer an absolute cell size."""
    if cancel_event is not None and cancel_event.is_set():
        from concurrent.futures import CancelledError
        raise CancelledError('Grid cancelled')
    empty = dict(version=VERSION, mode='relative_geometry', status='insufficient_parent', components=[],
                 assignments=[dict(profile_id=p['profile_id'], observed_q=[p['qx'],p['qy']], observed_spots=p.get('observed_spots', [[p['qx'],p['qy']]]),
                                   component='unexplained', compatible_components=[], indices=[], residual=None) for p in peaks],
                 unexplained_profile_ids=[p['profile_id'] for p in peaks], alternatives=[],
                 interpretation='A related beta parent needs two nonparallel profiles plus independent omega support. Accepted candidates pass the common four-profile screen; weaker attempts remain inspectable. No phase fraction is inferred.')
    if len(peaks) < 3:
        return empty
    original = np.array([[p['qx'], p['qy']] for p in peaks])
    unit = float(np.median(np.linalg.norm(original, axis=1)))
    if not np.isfinite(unit) or unit <= 0:
        return empty
    observed = original/unit
    weights = np.array([max(float(p.get('weight', 1)), .01) for p in peaks])
    # Use the caller's common scale unchanged. A second cap here would make
    # related variants less tolerant of distortion than independent phases.
    tol = float(tolerance)/unit
    low, high = g_min/unit, g_max/unit
    visibility = (lambda q: visible(q*unit)) if visible is not None else None
    settings = settings or {}
    if anchors:
        parents = anchored_parent(anchors, peaks, observed, weights, tol)
    elif parents is None:
        parents = parent_candidates(observed, weights, tol, low, high, visibility)
    context = context or dict(maxima=[], radius=tol*unit, g_min=g_min, g_max=g_max,
                              x_limit=g_max, y_limit=g_max, **({'visible': visible} if visible else {}))
    evaluated = []
    for parent in parents:
        if cancel_event is not None and cancel_event.is_set():
            from concurrent.futures import CancelledError
            raise CancelledError('Grid cancelled')
        if high/abs(parent['factor'])*np.sqrt(2) > 32:
            continue
        parts = [predictions(parent['zone'], parent['mirror'], parent['factor'], c, low, high, visibility) for c in range(5)]
        for mask in range(16 if include_omega else 1):
            selected = [0]+[c+1 for c in range(4) if mask & (1 << c)]
            nodes = union_nodes(parts, selected)
            points = np.array([n['q'] for n in nodes])
            widths = core.omega_node_scales(nodes, tol, settings.get('omega_falloff_multiplier', 1.))
            pairs, residuals, signs = assign(observed, points, weights, widths)
            unique = {c: [] for c in selected}
            parent_hits = []
            for i, j in pairs:
                owners = [v['component'] for v in nodes[j]['components']]
                if 0 in owners:
                    parent_hits.append(i)
                if len(owners) == 1:
                    unique[owners[0]].append(i)
            if len(parent_hits) < 2 or spread(observed[parent_hits]) < .5:
                continue
            if any(len(unique[c]) < 2 or spread(observed[unique[c]]) < .25 for c in selected[1:]):
                continue
            # Exactly the independent fitter's assignment, chance allowance and
            # prediction-site evidence. A union owns each shared position once.
            model_nodes = [dict(q=(np.array(n['q'])*unit).tolist(), hkl=n['components'][0]['hkl'],
                                components=n['components']) for n in nodes]
            model = core.score_prediction_nodes(peaks, model_nodes, tol*unit, widths*unit)
            if model is None:
                continue
            quality = model['quality_coverage']
            support = len(pairs)/max(len(nodes), 1)
            # All selected omega orientations belong to one added phase family,
            # fixed by this parent. They are not independently rotated/scaled
            # lattices. Variant support gates and missing-site costs still apply.
            additions = int(len(selected)>1)
            complexity = .025*additions
            scale = abs(parent['factor'])*unit
            model.update(phase='BCC', template_id='related_beta_'+str(parent['zone']),
                zone_3index=list(parent['zone']), mirror=parent['mirror'],
                rotation_deg=float(np.degrees(np.angle(parent['factor'])) % 180),
                position_score=model['score'], position_valid=model['valid'],
                scale_penalty=parent.get('scale_penalty', 0.), scale_mode='relative_geometry',
                scale_a=None, scale_c=None, shared_scale=None, fitted_a_nm=None, fitted_c_nm=None,
                nominal_a_nm=settings.get('bcc_a', .330), nominal_c_nm=None,
                scale_parameter_count=1, additional_pattern_penalty=complexity,
                additional_pattern_count=additions, additional_pattern_basis='related_phase_family',
                related_pattern=len(selected)>1, component_ids=['beta']+[f'omega{c}' for c in selected[1:]],
                reciprocal_scale=scale, fit_id=f"beta:{parent['zone']}:{parent['mirror']}:{scale:.9g}:{np.angle(parent['factor']):.9g}:{mask}")
            model.update(parent.get('scale_metadata', {}))
            peak_evidence.inspect(model, context)
            peak_evidence.apply(model, settings.get('peak_evidence_weight', .1), settings.get('peak_evidence_half_weight_nm_inv', 0.), peak_evidence.missing_weight(settings))
            brightness_grouping.inspect(model, peaks)
            brightness_grouping.apply(model, settings.get('brightness_grouping_weight', brightness_grouping.DEFAULT_WEIGHT))
            if settings.get('double_diffraction_weight', 0.):
                ids = {0: 'beta', **{c: f'omega{c}' for c in range(1, 5)}}
                dd_components = [dict(id=ids[c], phase='BCC' if c==0 else 'OMEGA',
                    predicted_nodes=[dict(q=(q*unit).tolist(), hkl=h.tolist()) for q,h in zip(*parts[c])]) for c in selected]
                dd_owners = [[dict(component=ids[o['component']], hkl=o['hkl']) for o in n['components']] for n in nodes]
                double_diffraction.evaluate(model, peaks, context['radius'], g_min, g_max, settings['double_diffraction_weight'],
                                            components=dd_components, owners=dd_owners)
            score = model['score']
            evaluated.append(dict(parent=parent, parts=parts, selected=selected, nodes=nodes, pairs=pairs,
                                  residuals=residuals, signs=signs, widths=widths, quality=quality, prediction_support=support,
                                  complexity=complexity, score=score, model=model))
    if not evaluated:
        return empty
    evaluated.sort(key=lambda x: x['score'], reverse=True)
    if candidate_sink is not None:
        candidate_sink.extend(m['model'] for m in evaluated if len(m['selected']) == 1)
    best = evaluated[0]
    linked = next((m for m in evaluated if len(m['selected']) > 1), None)
    # Retain the best supported related candidate for ordinary comparison and
    # overlays, without replacing a higher-scoring beta-only fit behind the UI.
    if linked is not None:
        best = linked
    competing = False  # The common model comparison reports actual rivals.
    parent = best['parent']
    scale = abs(parent['factor'])*unit
    fundamental = float(np.linalg.norm(lattice(tuple(parent['zone']), parent['mirror'])[0][0]))*scale
    assignments, unexplained = [], []
    assigned = {i: (j, d, sign) for (i, j), d, sign in zip(best['pairs'], best['residuals'], best['signs'])}
    components = []
    for c in range(5):
        q, h = best['parts'][c]
        components.append(dict(id='beta' if c == 0 else f'omega{c}', label='β parent' if c == 0 else 'ω'+str(c).translate(str.maketrans('0123456789','₀₁₂₃₄₅₆₇₈₉')),
                               color=COLORS[c], active=c in best['selected'], c_axis_beta=None if c == 0 else list(AXES[c-1]),
                               predicted_nodes=[dict(q=(p*unit).tolist(), hkl=idx.tolist()) for p, idx in zip(q, h)],
                               assigned_profile_ids=[], shared_profile_ids=[], nominal_absence_profile_ids=[], residuals=[], geometry_residuals=[]))
    for i, peak in enumerate(peaks):
        row = dict(profile_id=peak['profile_id'], observed_q=original[i].tolist(), observed_spots=peak.get('observed_spots', [original[i].tolist()]),
                   component='unexplained', compatible_components=[], indices=[], residual=None)
        if i in assigned:
            j, residual, sign = assigned[i]
            owners = best['nodes'][j]['components']
            ids = [components[v['component']]['id'] for v in owners]
            owner = 'beta' if 'beta' in ids else ids[0] if len(ids) == 1 else 'shared'
            row.update(component=owner, compatible_components=ids, residual=float(residual*unit),
                       quality=float(core.positional_quality(residual, best['widths'][j])),
                       residual_relative=float(residual*unit/fundamental), predicted_q=(np.array(best['nodes'][j]['q'])*unit*sign).tolist(),
                       indices=[dict(component=components[v['component']]['id'], hkl=(np.array(v['hkl'])*sign).tolist()) for v in owners])
            for v in owners:
                component = components[v['component']]
                component['shared_profile_ids' if len(ids) > 1 else 'assigned_profile_ids'].append(peak['profile_id'])
                component['residuals'].append(float(residual*unit))
                component['geometry_residuals'].append(float(residual*unit))
        else:
            unexplained.append(peak['profile_id'])
        assignments.append(row)
    # Explain geometric coincidences at ideal omega basis extinctions without
    # promoting them to allowed reflections or using them to select a variant.
    missing = [i for i in range(len(peaks)) if i not in assigned]
    absent_parts = [predictions(parent['zone'], parent['mirror'], parent['factor'], c, low, high, visibility, absent=True) for c in range(5)]
    absent_nodes = union_nodes(absent_parts, best['selected'][1:])
    absence_ids, absence_residuals = [], []
    if missing and absent_nodes:
        pairs, distances, signs = assign(observed[missing], np.array([n['q'] for n in absent_nodes]), weights[missing], tol)
        for (i,j), distance, sign in zip(pairs, distances, signs):
            row = assignments[missing[i]]; owners = absent_nodes[j]['components']
            row['geometry_diagnostic'] = dict(kind='nominal_omega_absence',
                compatible_components=[components[v['component']]['id'] for v in owners],
                indices=[dict(component=components[v['component']]['id'], hkl=(np.array(v['hkl'])*sign).tolist()) for v in owners],
                predicted_q=(np.array(absent_nodes[j]['q'])*unit*sign).tolist(), residual_relative=float(distance*unit/fundamental))
            absence_ids.append(row['profile_id']);absence_residuals.append(float(distance))
            for v in owners:
                component = components[v['component']]
                component['nominal_absence_profile_ids'].append(row['profile_id'])
                component['geometry_residuals'].append(float(distance*unit))
    for component in components:
        residuals = component.pop('residuals')
        geometry_residuals = component.pop('geometry_residuals')
        component.update(matched_profiles=len(residuals), exclusive_profiles=len(component['assigned_profile_ids']),
                         coverage=len(residuals)/len(peaks), prediction_coverage=len(residuals)/max(len(component['predicted_nodes']), 1),
                         rms_relative=float(np.sqrt(np.mean(np.square(residuals)))/fundamental) if residuals else None,
                         geometry_coverage=len(geometry_residuals)/len(peaks),
                         rms_geometry_relative=float(np.sqrt(np.mean(np.square(geometry_residuals)))/fundamental) if geometry_residuals else None)
    parent_pairs, _, _ = assign(observed, best['parts'][0][0], weights, tol)
    alternatives = []
    for candidate in evaluated:
        if candidate is best:
            continue
        if candidate['parent']['zone'] != parent['zone'] or candidate['selected'] != best['selected']:
            alternatives.append(dict(zone=list(candidate['parent']['zone']), variants=[f'omega{c}' for c in candidate['selected'][1:]], score=candidate['score']))
            if len(alternatives) == 3:
                break
    status = 'beta_omega_candidate' if len(best['selected']) > 1 else 'beta_only'
    if competing:
        status = 'beta_omega_ambiguous'
    if not best['model']['valid']:
        status = 'unresolved'
    result = dict(version=VERSION, mode='relative_geometry', status=status, components=components, assignments=assignments,
                unexplained_profile_ids=unexplained, alternatives=alternatives,
                nominal_absence_profile_ids=absence_ids, unexplained_geometry_profile_ids=[i for i in unexplained if i not in absence_ids],
                parent=dict(zone_3index=list(parent['zone']), mirror=parent['mirror'], rotation_deg=float(np.degrees(np.angle(parent['factor'])) % 180),
                            reciprocal_scale=scale, fundamental_spacing=fundamental, absolute_cell_nm=None, anchors=anchors or [],
                            matched_profiles=len(parent_pairs), requires_variant_support=len(parent_pairs)<3),
                combined=dict(coverage=len(best['pairs'])/len(peaks), weighted_coverage=sum(weights[i] for i, _ in best['pairs'])/weights.sum(),
                              rms_relative=float(np.sqrt(np.mean(best['residuals']**2))*unit/fundamental), matched_profiles=len(best['pairs']),
                              total_profiles=len(peaks), score=best['score'], positional_quality=best['quality'], complexity_cost=best['complexity'],
                              prediction_support=best['prediction_support'],
                              geometry_matched_profiles=len(best['pairs'])+len(absence_ids), geometry_coverage=(len(best['pairs'])+len(absence_ids))/len(peaks),
                              rms_geometry_relative=float(np.sqrt(np.mean(np.r_[best['residuals'], absence_residuals]**2))*unit/fundamental),
                              beta_only_coverage=len(parent_pairs)/len(peaks)),
                tolerance_relative=core.matching_radius(tol)*unit/fundamental, distance_scale_relative=tol*unit/fundamental,
                orientation_relationship='{111}β ∥ (0001)ω; ⟨110⟩β ∥ ⟨11̅20⟩ω',
                ideal_cell_ratios=dict(a_omega_over_a_beta=math.sqrt(2), c_omega_over_a_beta=math.sqrt(3)/2),
                interpretation='Relative spot geometry only; ideal beta→omega relation, four possible variants, finite cubic zones through index 3. Variant numbers are local to this fitted parent, not literature labels. Shared reflections are ambiguous and count once in combined coverage. Nominal omega absences and double-diffraction candidates are excluded from allowed coverage. The separate DD weight optionally adds bounded ranking evidence. Two-step geometry does not establish the scattering mechanism. Scores are heuristic, not phase probabilities; no absolute cell size or phase fraction is inferred.')
    bases = {'beta': np.eye(3), **{f'omega{c}': variant_basis(c-1) for c in range(1, 5)}}
    # Compact presentation aliases; stable orientation IDs and axes remain intact.
    active_variants = [c for c in components if c['active'] and c['id'] != 'beta']
    for number, component in enumerate(active_variants, 1):
        component['display_label'] = 'ω'+str(number).translate(str.maketrans('0123456789','₀₁₂₃₄₅₆₇₈₉'))
    result['double_diffraction'] = double_diffraction.inspect_joint(result, peaks, tol*unit, g_min, g_max, bases)
    result['fit'] = best['model']
    for component in components:
        if not component['active']:
            continue
        # Component views inherit the union's widths, including tight shared spots.
        union_widths = {tuple(np.round(n['q'], 7)): width*unit for n,width in zip(best['nodes'], best['widths'])}
        widths = [union_widths.get(tuple(np.round(np.array(n['q'])/unit, 7)), tol*unit)
                  for n in component['predicted_nodes']]
        vector_model = core.score_prediction_nodes(peaks, component['predicted_nodes'], tol*unit, widths)
        if vector_model is None:
            continue
        hkl = [np.array(n['hkl']) for n in component['predicted_nodes']]
        zone = next((np.cross(a, b) for a in hkl for b in hkl if np.cross(a, b).any()), np.array([0, 0, 1]))
        zone //= math.gcd(*zone)
        ids = set(component['assigned_profile_ids']+component['shared_profile_ids'])
        # These are vector/assignment views of a shared fit, not new candidates.
        component['vector_model'] = dict(phase='BCC' if component['id']=='beta' else 'OMEGA',
            zone_3index=zone.tolist(), rotation_deg=best['model']['rotation_deg'],
            predicted_nodes=component['predicted_nodes'], matches=[m for m in vector_model['matches'] if m['profile_id'] in ids],
            valid=best['model']['valid'], coordinate_units='relative', scale_mode='relative_geometry',
            fitted_a_nm=None, fitted_c_nm=None, shared_scale=None, nominal_a_nm=None, nominal_c_nm=None,
            display_label=component.get('display_label', 'β parent'))
    result['interpretation'] = 'Related omega candidates use the common positional score, weak/missing prediction evidence and bounded integrated-intensity weights, plus the optional soft brightness-grouping bonus. Omega variants share one brightness level; the parent is not required to be brighter. Additional variants must explain independent profiles. Shared positions count once; no phase fractions or dynamical intensities are inferred.'
    return result
