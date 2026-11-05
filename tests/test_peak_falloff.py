import copy
import json
import math
import unittest
import zlib
from unittest.mock import patch

import peak_evidence as evidence
from engine import Engine


def model():
    statuses = ['detected', 'weak', 'unsupported', 'unsupported', 'unassessable']
    return dict(phase='HCP', position_score=.8, position_valid=True,
                scale_penalty=.1, scale_mode='fixed',
                predicted_nodes=[{'q': [g, 0]} for g in [3, 5, 4, 8, 12]],
                peak_evidence=dict(nodes=[dict(node_index=i, status=status) for i, status in enumerate(statuses)],
                                   bonus_factor=.08, missing_factor=.5))


class FalloffTests(unittest.TestCase):
    def test_uniform_mode_and_half_weight(self):
        m = model()
        evidence.apply(m, .5)
        self.assertAlmostEqual(m['score'], .8-.1+.04-.25)
        evidence.apply(m, .5, 8)
        self.assertEqual(m['peak_evidence']['nodes'][3]['missing_weight'], .5)
        self.assertAlmostEqual(m['missing_peak_penalty'], .5*(2**(-.25)+.5)/4)
        self.assertEqual(m['weak_peak_bonus'], .04)
        self.assertEqual(m['position_score'], .8)
        self.assertEqual(m['scale_penalty'], .1)

    def test_outer_missing_counts_less_and_unassessable_is_excluded(self):
        m = model()
        evidence.apply(m, .5, 8)
        weights = [n['missing_weight'] for n in m['peak_evidence']['nodes']]
        self.assertGreater(weights[2], weights[3])
        self.assertAlmostEqual(m['peak_evidence']['unweighted_missing_factor'], .5)
        # All assessable predictions missing still receive reduced outer costs.
        for n in m['peak_evidence']['nodes'][:-1]:
            n['status'] = 'unsupported'
        evidence.apply(m, .5, 8)
        self.assertLess(m['missing_peak_penalty'], .5)

    def test_reweighting_is_reversible(self):
        m = model()
        evidence.apply(m, .5, 0)
        uniform = m['score']
        evidence.apply(m, .5, 8)
        self.assertGreater(m['score'], uniform)
        evidence.apply(m, .5, 0)
        self.assertEqual(m['score'], uniform)
        evidence.apply(m, 0, 8)
        self.assertAlmostEqual(m['score'], .7)
        self.assertEqual(m['missing_peak_penalty'], 0)

    def test_no_strong_evidence_created(self):
        m = model(); m['position_valid'] = False
        evidence.apply(m, .5, .1)
        self.assertFalse(m['valid'])
        self.assertAlmostEqual(m['weak_peak_bonus'], .04)

    def test_validation_and_legacy_fit(self):
        for value in [-1, 31, math.nan, math.inf]:
            with self.assertRaises(ValueError):
                evidence.apply(model(), .1, value)
        m = model(); del m['peak_evidence']['nodes']
        evidence.apply(m, .5)
        self.assertEqual(m['missing_peak_penalty'], .25)
        with self.assertRaises(ValueError):
            evidence.apply(m, .5, 8)

    def test_cached_rescore_preserves_observations_and_settings(self):
        engine = Engine.__new__(Engine)
        result = dict(settings=dict(scale_mode='fixed', peak_evidence_weight=.5, g_min=2.5, g_max=10),
                      spectrum={'df': .2, 'peaks': [{'profile_id': 0, 'qx': 3, 'qy': 0}]}, width_nm=5, height_nm=5,
                      _fit_cache=zlib.compress(json.dumps([model()]).encode()))
        original = copy.deepcopy(result)
        with patch('engine.core.retain', side_effect=lambda ms: ms), patch.object(engine, 'classify', return_value={}):
            updated = engine.rescore(result, 0, half_weight_nm_inv=8)
            restored = engine.rescore(updated, 0, half_weight_nm_inv=0)
        self.assertEqual(result, original)
        self.assertEqual(updated['settings']['peak_evidence_half_weight_nm_inv'], 8)
        self.assertEqual(updated['spectrum'], original['spectrum'])
        self.assertGreater(updated['models'][0]['score'], restored['models'][0]['score'])


if __name__ == '__main__':
    unittest.main()
