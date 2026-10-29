"""Conservative phase decisions when positional fit and model economy disagree.

Allowed HRTEM reflections need not be visible. Missing detected peaks are
reported as unsupported predictions, never treated as systematic absences.
This comparison does not invent an intensity model or a phase probability.
"""
import analysis_core as core

VERSION = 'shared-evidence-v1'


def describe_predictions(models):
    for model in models:
        count = len(model['predicted_nodes'])
        matched = len({m['node_index'] for m in model['matches']})
        model.update({
            'matched_prediction_count': matched,
            'unmatched_prediction_count': count-matched,
            'prediction_match_fraction': matched/count if count else 0.,
        })


def classify(peaks, models, df):
    describe_predictions(models)
    result = core.classify(peaks, models, df)
    result['comparison_version'] = VERSION
    result['score_only_label'] = result['label']
    # Keep separate-pattern evidence and the original near-tied ambiguity rule.
    if result['label'] not in ('hcp_compatible', 'bcc_compatible', 'fcc_compatible'):
        return result
    leading = result['primary_model']
    ids = {m['profile_id'] for m in leading['matches']}
    for other in models:
        if not other['valid'] or other['phase'] == leading['phase']:
            continue
        if {m['profile_id'] for m in other['matches']} != ids:
            continue
        more_parameters = leading.get('scale_parameter_count', 0) > other.get('scale_parameter_count', 0)
        more_unsupported = leading['unmatched_prediction_count'] > other['unmatched_prediction_count']
        if not (more_parameters or more_unsupported):
            continue
        # Do not resolve a tradeoff by assigning an arbitrary missing-spot or
        # extra-parameter penalty. Nor promote the sparser rival automatically.
        result['label'] = 'ambiguous'
        result['ambiguity_reason'] = 'shared_peaks_model_tradeoff'
        result['comparison_model'] = other
        reason = []
        if more_parameters:
            reason.append('more fitted scale parameters')
        if more_unsupported:
            reason.append('more predictions without a detected peak')
        result['flags'].append(
            f"Both accepted candidates match the same {len(ids)} measured profiles. "
            f"{leading['phase']} matches {leading['matched_prediction_count']}/{len(leading['predicted_nodes'])} "
            f"predicted positions; {other['phase']} matches {other['matched_prediction_count']}/{len(other['predicted_nodes'])}. "
            f"The leading scored fit uses {' and '.join(reason)}, so the phase remains ambiguous.")
        result['flags'].append(
            'An unsupported prediction is not proof of an absent reflection: HRTEM contrast transfer can suppress spots. '
            'These counts are a model check, not a phase fraction or an intensity simulation.')
        break
    return result
