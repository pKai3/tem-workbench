"""Direct-diffraction search and shared FFT/diffraction combination scoring.

The beta→omega relation generates constrained additional candidates. It is not
an analysis mode, a calibration switch, or a separate ranking convention.
"""
import numpy as np
import analysis_core as core
import beta_omega
import peak_evidence
import scale_fitting
import brightness_grouping
import double_diffraction
from itertools import combinations

SCALE_FIELDS = ('scale_mode', 'scale_a', 'scale_b', 'scale_c', 'shared_scale', 'scale_parameter_count',
    'nominal_a_nm', 'nominal_b_nm', 'nominal_c_nm', 'fitted_a_nm', 'fitted_b_nm', 'fitted_c_nm',
    'scale_penalty', 'scale_penalty_strength', 'ca_penalty_strength', 'overall_prediction_scale',
    'ca_ratio_multiplier', 'overall_scale_penalty', 'ca_ratio_penalty', 'scale_at_bound')


def rescore_scale(model, settings):
    relative = model.get('relative_scale_fit')
    if relative:
        temporary = {**model, 'scale_mode': relative['mode']}
        scale_fitting.penalize(temporary, relative['scale_a'], relative.get('scale_c'), 0., settings.get('ca_penalty_strength', .1))
        for key in ('scale_penalty', 'scale_penalty_strength', 'ca_penalty_strength', 'overall_scale_penalty', 'ca_ratio_penalty'):
            if key in temporary:
                model[key] = temporary[key]
    elif settings['scale_mode'] != 'fixed' and model.get('scale_a') is not None:
        c = model.get('scale_c') if model.get('scale_parameter_count') == 2 else None
        scale_fitting.penalize(model, model['scale_a'], c, settings['scale_penalty_strength'], settings.get('ca_penalty_strength', .1))


def evidence(model, peaks, context, settings, dd_components=None):
    nodes = [n for n in model['predicted_nodes'] if 'visible' not in context or context['visible'](np.array([n['q']]))[0]]
    score = core.score_prediction_nodes(peaks, nodes, context.get('position_scale', context['radius']))
    if score is None:
        return None
    model.update(score)
    model.update(position_score=score['score'], position_valid=score['valid'])
    peak_evidence.inspect(model, context)
    peak_evidence.apply(model, settings['peak_evidence_weight'], settings['peak_evidence_half_weight_nm_inv'], peak_evidence.missing_weight(settings))
    brightness_grouping.inspect(model, peaks)
    brightness_grouping.apply(model, settings.get('brightness_grouping_weight', brightness_grouping.DEFAULT_WEIGHT))
    double_diffraction.evaluate(model, peaks, context['radius'], context['g_min'], context['g_max'],
        settings.get('double_diffraction_weight', 0.), components=dd_components,
        owners=[n['dd_components'] for n in nodes] if dd_components is not None else None)
    return model


def calibrated_parent(model, unit):
    """Express the fitted detector geometry in the linked lattice's basis.

    Legacy cubic templates have their own in-plane axes and handedness. Their
    mirror flag is relative to that stored projection, not beta_omega.projection.
    Recover the rotation and handedness from indexed fitted positions together;
    carrying the flag across directly can cancel the inferred scale.
    """
    nodes = model['predicted_nodes']
    hkl = np.array([n['hkl'] for n in nodes])
    q = np.array([n['q'] for n in nodes])/unit
    target = q[:, 0]+1j*q[:, 1]
    options = []
    for mirror in (1, -1):
        source = hkl @ beta_omega.projection(model['zone_3index'], mirror)
        z = source[:, 0]+1j*source[:, 1]
        factor = np.vdot(z, target)/np.vdot(z, z)
        error = float(np.sum(abs(z*factor-target)**2))
        options.append((error, mirror, factor))
    _, mirror, factor = min(options, key=lambda option: option[0])
    return dict(zone=model['zone_3index'], mirror=mirror, factor=factor,
                scale_penalty=model.get('scale_penalty', 0.),
                scale_metadata={k:model[k] for k in SCALE_FIELDS if k in model})


def search(engine, spectrum, settings, context, relative, anchors=()):
    peaks = spectrum['peaks']; phases = settings['enabled_phases']
    if not peaks or not phases:
        return [], [], None
    unit = float(np.median([np.hypot(p['qx'], p['qy']) for p in peaks]))
    context = core.matching_context(spectrum, context)
    tolerance = context['position_scale']
    free = relative or settings['material'] == 'unknown'
    candidates = []
    if free:
        # Normalize image coordinates, not the reference-cell scale. The same
        # finite scale/ratio search is used for every independent phase; results
        # are restored to image coordinates before the common evidence check.
        normalization = unit/6.
        normalized = [{**p, 'qx': p['qx']/normalization, 'qy': p['qy']/normalization} for p in peaks]
        options = {**settings, 'material': 'unknown', 'g_min': settings['g_min']/normalization,
                   'g_max': settings['g_max']/normalization,
                   'enabled_phases': [p for p in phases if p != 'BCC']}
        mode = settings['scale_mode'] if settings['scale_mode'] != 'fixed' else 'auto_uniform'
        templates = engine.templates_for(options)
        scale_fitting.search(normalized, templates, tolerance/normalization, mode,
            bcc_a=settings['bcc_a'], fcc_a=settings['fcc_a'], g_min=options['g_min'], g_max=options['g_max'],
            scale_penalty_strength=0., ca_penalty_strength=settings['ca_penalty_strength'], candidate_sink=candidates)
        for model in candidates:
            model['relative_scale_fit'] = dict(mode=mode, scale_a=model['scale_a'],
                scale_c=model.get('scale_c') if model.get('scale_parameter_count') == 2 else None)
            for node in model['predicted_nodes']:
                node['q'] = (np.array(node['q'])*normalization).tolist()
            for axis in ('a', 'b', 'c'):
                if model.get('scale_'+axis) is not None:
                    model['scale_'+axis] *= normalization
                if model.get('fitted_'+axis+'_nm') is not None:
                    model['fitted_'+axis+'_nm'] = None if relative else model['fitted_'+axis+'_nm']/normalization
            model['coordinate_units'] = 'relative' if relative else 'nm^-1'
            model['scale_mode'] = 'relative_geometry'
            if relative:
                model['scale_note'] = 'Relative geometry: absolute lattice dimensions are not measured.'
    else:
        _, candidates = engine._fit_spectrum(spectrum, settings, engine.templates_for(settings), True, context)
    candidates = [m for m in candidates if evidence(m, peaks, context, settings) is not None]
    related = None
    if 'BCC' in phases:
        parents = None
        if not free:
            parents = [calibrated_parent(model, unit) for model in candidates if model['phase'] == 'BCC']
        # BCC-alone runs precisely this same parent generation and scoring.
        candidates = [m for m in candidates if m['phase'] != 'BCC']
        related = beta_omega.fit(peaks, tolerance, settings['g_min'], settings['g_max'], context['visible'],
            anchors or None, parents=parents, context=context, settings=settings, candidate_sink=candidates,
            include_omega='OMEGA' in phases)
        for model in candidates:
            if model['phase'] == 'BCC' and model.get('reciprocal_scale'):
                if free:
                    model['relative_scale_fit'] = dict(mode=settings['scale_mode'] if settings['scale_mode']!='fixed' else 'auto_uniform', scale_a=1., scale_c=None)
                    rescore_scale(model, settings)
                model['coordinate_units'] = 'relative' if relative else 'nm^-1'
                if not relative:
                    model['fitted_a_nm'] = 1/model['reciprocal_scale']
                    model['scale_a'] = model['reciprocal_scale']*settings['bcc_a']
        if not related.get('fit', {}).get('related_pattern'):
            related = None
    return core.retain(candidates), candidates, related


def union_fit(peaks, components, context, settings):
    """Evaluate an ordinary primary+secondary combination on a union of nodes."""
    nodes, keys = [], {}
    ids = [m['phase']+str(sum(c['phase']==m['phase'] for c in components[:i+1])) for i,m in enumerate(components)]
    for component_index, model in enumerate(components):
        for n in model['predicted_nodes']:
            key = tuple(np.round(n['q'], 7))
            if key not in keys:
                keys[key] = len(nodes)
                nodes.append({**n, 'phases': [], 'dd_components': []})
            nodes[keys[key]]['dd_components'].append(dict(component=ids[component_index], hkl=n['hkl']))
            owners = nodes[keys[key]]['phases']
            if model['phase'] not in owners:
                owners.append(model['phase'])
    model = dict(predicted_nodes=nodes, phase='+'.join(m['phase'] for m in components),
        zone_3index=components[0]['zone_3index'], scale_penalty=sum(m.get('scale_penalty', 0.) for m in components),
        additional_pattern_penalty=.025*(len(components)-1), component_count=len(components),
        independent_combination=True, component_zones=[m['zone_3index'] for m in components],
        component_rotations_deg=[m.get('rotation_deg') for m in components],
        coordinate_units=components[0].get('coordinate_units'))
    return evidence(model, peaks, context, settings, [dict(c, id=ids[i]) for i,c in enumerate(components)])


def brightness_combinations(classification, models, spectrum, context, settings):
    """Let supported ordinary phase pairs compete, even against a dense leader.

    The pair needs independent geometry on both sides before brightness is
    considered. Three exclusive profiles and nonparallel support on each side
    retain the ordinary second-pattern safeguards.
    """
    peaks = spectrum.get('peaks', [])
    dd_enabled = bool(settings.get('double_diffraction_weight', 0.))
    brightness_enabled = bool(settings.get('brightness_grouping_weight', brightness_grouping.DEFAULT_WEIGHT)) and sum(brightness_grouping.reliable_intensity(p) is not None for p in peaks) >= 6
    if not dd_enabled and not brightness_enabled:
        return classification
    primary = classification.get('primary_model')
    if primary is None:
        return classification
    total = sum(p['weight'] for p in peaks)
    valid = [m for m in models if m['valid']]
    best = None
    secondary = classification.get('secondary_model')
    existing = union_fit(peaks, (primary, secondary), context, settings) if secondary else None
    threshold = max(primary['score'], existing['score'] if existing and existing['valid'] else -np.inf)
    if (existing and existing['valid'] and (existing['brightness_bonus'] > 0 or existing.get('double_diffraction_bonus', 0.) > 0) and
            existing['score'] > primary['score']):
        best = existing, primary, secondary
    for a, b in combinations(valid, 2):
        if a['phase'] == b['phase'] and not dd_enabled:
            continue
        ids = [{m['profile_id'] for m in c['matches']} for c in (a, b)]
        def independent(owned):
            rows = [p for p in peaks if p['profile_id'] in owned]
            return (len(rows) >= 3 and sum(p['weight'] for p in rows)/total > .15 and
                    beta_omega.spread(np.array([[p['qx'], p['qy']] for p in rows])) > .5)
        if not independent(ids[0]-ids[1]) or not independent(ids[1]-ids[0]):
            continue
        combined = union_fit(peaks, (a, b), context, settings)
        if (combined and combined['valid'] and (combined['brightness_bonus'] > 0 or combined.get('double_diffraction_bonus', 0.) > 0) and
                combined['score'] > threshold and (best is None or combined['score'] > best[0]['score'])):
            best = combined, a, b
    if best is None:
        return classification
    combined, a, b = best
    # Recompute support summaries for the chosen pair, rather than retaining
    # dominance/ambiguity metadata belonging to the previous leader.
    result = core.classify(peaks, [a, b], spectrum['df'])
    result.update(label='multiple_orientations' if a['phase']==b['phase'] else 'coexisting_candidates', primary_model=a, secondary_model=b,
        combined_fit=combined, combined_fit_selected=True, valid_pattern_count=2,
        valid_pattern_phases=[a['phase'], b['phase']], explained_weight_fraction=combined['coverage'])
    result['flags'] = [f for f in result['flags'] if not f.startswith('At ~5nm, Hann broadening')]
    result['flags'].extend(f for f in classification['flags'] if f not in result['flags'] and
                           not f.startswith(('Separate unique', 'The same measured', 'Shared strong',
                                             'Both accepted candidates match', 'The leading fit reaches')))
    result['flags'].append('Separate geometric support and the enabled brightness/DD evidence favour these two candidates together. Additional evidence does not establish phase identity or the scattering mechanism.')
    if primary is not a and primary is not b and combined['score']-primary['score'] <= .08:
        result.update(label='ambiguous', ambiguity_reason='additional_evidence_tradeoff' if dd_enabled else 'brightness_group_tradeoff', comparison_model=primary)
        result['flags'].append(f"The combined rank {combined['score']:.3f} is within 0.08 of the passing {primary['phase']} alternative ({primary['score']:.3f}). The enabled evidence weights do not resolve this model tradeoff.")
    return result


def compare(classification, related, spectrum, context, settings, models=()):
    """Compare only actual, inspectable fits with the same score contributions."""
    if context is not None and spectrum.get('peaks'):
        context = core.matching_context(spectrum, context)
        classification = brightness_combinations(classification, models, spectrum, context, settings)
    classification = {**classification, 'flags': list(classification.get('flags', []))}
    primary = classification.get('primary_model')
    secondary = classification.get('secondary_model')
    rival = primary
    if rival and not rival['valid']:
        rival = None
    # Every accepted second pattern competes as the complete scored union,
    # including two orientations of one phase and brightness strength zero.
    # Keep the components explicit even when a related candidate later wins.
    classification['combined_fit_selected'] = False
    if primary and secondary and context is not None:
        combined = union_fit(spectrum['peaks'], [primary, secondary], context, settings)
        classification['combined_fit'] = combined
        classification['combined_fit_components'] = [primary, secondary]
        if combined and combined['valid'] and combined['score'] > primary['score']:
            rival = combined
            classification.update(combined_fit_selected=True, valid_pattern_count=2,
                                  valid_pattern_phases=sorted({primary['phase'],secondary['phase']}),
                                  explained_weight_fraction=combined['coverage'])
    if related is None:
        return classification
    candidate = related['fit']
    wins = candidate['valid'] and (rival is None or candidate['score'] > rival['score'])
    ambiguous = bool(candidate['valid'] and rival and rival['valid'] and abs(candidate['score']-rival['score']) <= .08)
    related['selected'] = bool(wins)
    related['comparison'] = dict(rival=rival, score_difference=candidate['score']-rival['score'] if rival else None,
                                 near_tie_margin=.08, ambiguous=ambiguous, preferred='related' if wins else 'independent')
    result = {**classification, 'flags': list(classification['flags'])}
    if wins:
        result.pop('ambiguity_reason', None)
        result.pop('comparison_model', None)
        result.update(label='coexisting_candidates', primary_model=candidate, secondary_model=None,
                      combined_fit_selected=False,
                      valid_pattern_count=len(candidate['component_ids']), valid_pattern_phases=['BCC', 'OMEGA'],
                      explained_weight_fraction=candidate['coverage'])
        result['flags'].append('Additional peaks support omega variants constrained by the fitted beta parent. Shared positions count once; integrated intensity is weighted identically for all candidates.')
    if ambiguous:
        result.update(label='ambiguous', ambiguity_reason='related_pattern_tradeoff', comparison_model=rival if wins else candidate)
        result['flags'].append(f"Common-score comparison: beta + related omega {candidate['score']:.3f}; {rival['phase']} [{ ' '.join(map(str,rival['zone_3index'])) }] alternative {rival['score']:.3f}. Both pass the common screen and differ by at most 0.08. Inspect the candidate overlays and prediction-evidence costs.")
    return result
