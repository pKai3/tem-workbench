"""Research stopping-rule diagnostics preserve updates and retain minority evidence."""
import unittest
import numpy as np
from tem_workbench.components import shared_spectra as spectra
from tools.nmf_stopping_rule_comparison import advance_rules, trace_decomposition, phase_evidence, compare_phase_evidence, factor_change


class StoppingRuleTests(unittest.TestCase):
    def test_checkpoints_match_production_and_continue_past_early_stop(self):
        x = np.random.default_rng(34).random((30, 80), dtype=np.float32)
        diagnostic, states = trace_decomposition(x, 1, maximum=300)
        production = spectra.decompose_nmf(x, 1)
        self.assertEqual(diagnostic['stops']['current'], production['iterations'])
        self.assertLess(production['iterations'], 300)
        self.assertEqual(diagnostic['trace'][-1]['iteration'], 300)
        np.testing.assert_array_equal(states[production['iterations']]['components'], production['components'])
        self.assertLessEqual(states[300]['relative_reconstruction_error'], production['relative_reconstruction_error']+1e-7)

    def test_patience_resets_on_increase_or_large_gain_and_respects_minimum(self):
        rules = dict(test=dict(metric='gain', tolerance=.01, patience=3))
        streaks = {};stops = {}
        for step, gain in [(30, .001), (40, .001), (50, .001), (60, -.001), (70, .001), (80, .001), (90, .02), (100, .001), (110, .001)]:
            advance_rules(dict(iteration=step, gain=gain), streaks, stops, rules)
            self.assertNotIn('test', stops)
        advance_rules(dict(iteration=120, gain=.001), streaks, stops, rules)
        self.assertEqual(stops['test'], 120)

    def test_phase_evidence_catches_minority_loss_without_winner_change(self):
        candidate = lambda model, phase: dict(model=model, phase=phase, valid=True)
        maps = dict(windows=[dict(candidates=[candidate(0, 'HCP'), candidate(1, 'BCC')]), dict(candidates=[candidate(0, 'HCP')])])
        before = phase_evidence(maps, [0, 1]);after = phase_evidence(maps, [0])
        changes = compare_phase_evidence(before, after, 2)
        self.assertEqual(changes['BCC'], dict(before=1, after=0, gained=0, lost=1))
        self.assertEqual(changes['HCP']['lost'], 0)

    def test_factor_matching_handles_permutation(self):
        before = dict(components=np.eye(3), scores=np.arange(12).reshape(4, 3).astype(float))
        after = dict(components=before['components'][[2, 0, 1]], scores=before['scores'][:, [2, 0, 1]])
        change = factor_change(before, after)
        self.assertEqual(change['min_spectral_cosine'], 1)
        self.assertEqual(change['relative_activity_change'], 0)


if __name__ == '__main__':unittest.main()
