"""Focused decision checks; independent of microscope data and the server."""
import copy
import unittest
import numpy as np
import analysis_core as core
import phase_comparison as comparison


class SharedEvidence(unittest.TestCase):
    def setUp(self):
        self.peaks = [dict(profile_id=i+1, weight=1., qx=float(5*np.cos(a)), qy=float(5*np.sin(a)))
                      for i, a in enumerate(np.linspace(0, np.pi, 9, endpoint=False))]

    def model(self, phase, ids, nodes, score, parameters):
        return dict(phase=phase, valid=True, score=score, coverage=len(ids)/len(self.peaks),
                    scale_parameter_count=parameters,
                    matches=[dict(profile_id=k, node_index=i) for i, k in enumerate(ids)],
                    predicted_nodes=[dict(q=[i, 0.]) for i in range(nodes)])

    def test_shared_evidence_with_extra_predictions_or_parameters_is_ambiguous(self):
        for nodes, parameters in [(18, 1), (6, 2), (18, 2)]:
            with self.subTest(nodes=nodes, parameters=parameters):
                models = [self.model('HCP', [1, 2, 3, 4, 5], nodes, .84, parameters),
                          self.model('BCC', [1, 2, 3, 4, 5], 6, .63, 1)]
                original = copy.deepcopy(models)
                self.assertEqual(core.classify(self.peaks, models, .1)['label'], 'hcp_compatible')
                result = comparison.classify(self.peaks, models, .1)
                self.assertEqual(result['label'], 'ambiguous')
                self.assertEqual(result['ambiguity_reason'], 'shared_peaks_model_tradeoff')
                self.assertEqual(result['comparison_model']['phase'], 'BCC')
                self.assertEqual(models[0]['unmatched_prediction_count'], nodes-5)
                for before, after in zip(original, models):
                    for key, value in before.items():
                        self.assertEqual(after[key], value)

    def test_separate_unique_evidence_stays_two_candidates(self):
        models = [self.model('HCP', [1, 2, 3, 4, 5], 18, .84, 2),
                  self.model('BCC', [4, 5, 6, 7, 8], 6, .63, 1)]
        result = comparison.classify(self.peaks, models, .1)
        self.assertEqual(result['label'], 'coexisting_candidates')
        self.assertEqual(result['secondary_model']['phase'], 'BCC')

    def test_no_extra_flexibility_or_predictions_preserves_existing_decision(self):
        models = [self.model('BCC', [1, 2, 3, 4, 5], 6, .84, 1),
                  self.model('HCP', [1, 2, 3, 4, 5], 18, .63, 2)]
        self.assertEqual(comparison.classify(self.peaks, models, .1)['label'], 'bcc_compatible')
        self.assertEqual(comparison.classify(self.peaks[:3], [], .1)['label'], 'insufficient')


if __name__ == '__main__':
    unittest.main()
