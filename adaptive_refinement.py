"""Optional child checks after a parent passes; compare fits on the same pixels."""
import math

VERSION = 'passing-children-v1'
MARGIN = .08
PASSING = {'hcp_compatible', 'bcc_compatible'}


def family(model):
    """Ignore zone sign, common factors and template mirror variants."""
    axis = [int(v) for v in model['zone_3index']]
    divisor = math.gcd(*axis) or 1
    axis = [v // divisor for v in axis]
    if next((v for v in axis if v), 1) < 0:
        axis = [-v for v in axis]
    return model['phase'], tuple(axis)


def review(parent, children, engine):
    original = parent['classification']['primary_model']
    parent_family = family(original)
    checks = []
    for child in children:
        classification = child['classification']
        leading = classification.get('primary_model')
        row = {'child_id': child['id'], 'label': classification['label'], 'retain_children': False}
        if classification['label'] in {'coexisting_candidates', 'multiple_orientations'}:
            row.update(retain_children=True, reason='Separate strong profiles support a second pattern.')
        elif classification['label'] in PASSING and leading and leading['valid'] and family(leading) != parent_family:
            # Search the full pool, including candidates pruned from the display.
            # Both scores below come from this child, never from its larger parent.
            candidates = [m for m in engine.cached_models(child, child['settings']) if family(m) == parent_family]
            inherited = max(candidates, key=lambda m: (m['valid'], m['score']), default=None)
            row.update(child_family={'phase': leading['phase'], 'zone_3index': leading['zone_3index']},
                       alternative_score=leading['score'],
                       parent_family_score=inherited['score'] if inherited else None,
                       parent_family_passes=bool(inherited and inherited['valid']))
            if not inherited or not inherited['valid']:
                row.update(retain_children=True, reason='Alternative passes; the parent phase/zone has no passing fit on this child.')
            elif leading['score'] - inherited['score'] >= MARGIN:
                row.update(retain_children=True, reason='Alternative exceeds the parent phase/zone on this child by at least 0.08 score.')
            else:
                row['reason'] = 'Alternative gain on this child is below 0.08.'
        else:
            row['reason'] = 'No resolved alternative phase/zone or separate strong pattern.'
        checks.append(row)
    return {'version': VERSION, 'state': 'complete', 'margin': MARGIN,
            'retain_children': any(c['retain_children'] for c in checks), 'checks': checks}
