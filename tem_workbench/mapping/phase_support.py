"""Presentation of phase support, retaining joint-fit provenance explicitly."""


def models(region):
    """Independent fits plus supported components of a passing linked union.

    A component inherits a joint rank, NOT an independent passing screen. Keep
    this distinction in exports and hover details. Never add union coverage to
    each phase: component coverage comes from its own assigned observations.
    """
    result = list(region.get('models', []))
    linked = region.get('beta_omega') or {}
    fit = linked.get('fit') or {}
    if not fit.get('valid') or not fit.get('related_pattern'):
        return result
    for component in linked.get('components', []):
        model = component.get('vector_model')
        if not component.get('active') or not model:
            continue
        result.append({**model, 'valid': True, 'score': fit['score'],
                       'coverage': component['coverage'],
                       'support_basis': 'linked_beta_omega_union',
                       'score_basis': 'joint_rank', 'joint_score': fit['score'],
                       'component_id': component['id'],
                       'exclusive_profiles': component['exclusive_profiles'],
                       'shared_profiles': len(component['shared_profile_ids'])})
    return result


def best_zones(region, phases):
    support = models(region)
    result = {}
    for phase in phases:
        options = [m for m in support if m['phase']==phase]
        if not options:
            continue
        best = max(options, key=lambda m:(bool(m['valid']), m['score']))
        row = {key:best[key] for key in ('phase','zone_3index','valid','score','coverage')}
        for key in ('support_basis','score_basis','joint_score','component_id','exclusive_profiles','shared_profiles'):
            if key in best:
                row[key] = best[key]
        related = [m for m in options if m.get('score_basis')=='joint_rank']
        if related:
            row['related_components'] = [{key:m[key] for key in ('component_id','zone_3index','exclusive_profiles','shared_profiles','coverage')} for m in related]
        result[phase] = row
    return result


def linked_summary(region):
    linked = region.get('beta_omega') or {}
    fit = linked.get('fit') or {}
    if not fit.get('valid') or not fit.get('related_pattern'):
        return None
    return dict(score=fit['score'], selected=bool(linked.get('selected')),
                components=[dict(id=c['id'],exclusive_profiles=c['exclusive_profiles'],
                                 shared_profiles=len(c['shared_profile_ids']), coverage=c['coverage'])
                            for c in linked.get('components',[]) if c.get('active')],
                score_basis='joint_rank', interpretation='Components supported by one passing beta + omega fit; not independent phase ranks or phase fractions.')
