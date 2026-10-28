"""Small synthetic checks; no microscope files or running server required."""
import json
from pathlib import Path
import unittest
import numpy as np
import analysis_core as core
import scale_fitting as fitting


class ScaleFits(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        templates = json.loads((Path(__file__).resolve().parents[1]/'templates.json').read_text())
        for template in templates:
            for key in ('hkl', 'q', 'g'):
                template[key] = np.array(template[key])
        cls.templates = fitting.prepare_templates(templates)

    def template(self, phase, zone):
        return next(t for t in self.templates if t['phase'] == phase and t['zone_3index'] == zone)

    def fit(self, template, scale_a, scale_c, mode):
        q = core.canonical(core.rotation(fitting.prediction_points(template, scale_a, scale_c), .47))
        q = q[(np.linalg.norm(q, axis=1) >= 3) & (np.linalg.norm(q, axis=1) <= 10)]
        peaks = [dict(profile_id=i+1, qx=float(p[0]), qy=float(p[1]), weight=4., log_radial_enrichment=6.)
                 for i, p in enumerate(q)]
        result = fitting.search(peaks, [template], .10, mode, scale_penalty_strength=0)[0]
        self.assertTrue(result['valid'])
        self.assertLess(result['rms_nm_inv'], .001)
        return result

    def test_hcp_distances_and_angles_match_three_dimensional_metric(self):
        for template in self.templates:
            if template['phase'] == 'HCP':
                q = fitting.prediction_points(template, .94, 1.07)
                g = fitting.reciprocal(template['hkl'], 'HCP') * [.94, .94, 1.07]
                np.testing.assert_allclose(q @ q.T, g @ g.T, atol=1e-8)

    def test_uniform_scale_recovery(self):
        for phase, zone in [('BCC', [1, -3, -1]), ('HCP', [1, -1, -2])]:
            with self.subTest(phase=phase):
                result = self.fit(self.template(phase, zone), .973, .973, 'auto_uniform')
                self.assertAlmostEqual(result['scale_a'], .973, places=3)

    def test_independent_hcp_scale_recovery(self):
        result = self.fit(self.template('HCP', [1, -1, -2]), .96, 1.035, 'auto_hcp_ac')
        self.assertAlmostEqual(result['scale_a'], .96, places=3)
        self.assertAlmostEqual(result['scale_c'], 1.035, places=3)

    def test_c_is_unconstrained_along_c_axis(self):
        result = self.fit(self.template('HCP', [0, 0, 1]), 1.027, 1.08, 'auto_hcp_ac')
        self.assertAlmostEqual(result['scale_a'], 1.027, places=3)
        self.assertIsNone(result['scale_c'])
        self.assertIsNone(result['fitted_c_nm'])

    def test_scale_penalty_is_quadratic_and_uniform_hcp_is_not_double_charged(self):
        self.assertAlmostEqual(float(fitting.scale_cost(1.05, strength=.1)), .1)
        self.assertAlmostEqual(float(fitting.scale_cost(.90, strength=.1)), .4)
        self.assertAlmostEqual(float(fitting.scale_cost(.95, .95, .1)), .1)
        self.assertAlmostEqual(float(fitting.scale_cost(.90, 1., .1)), .2)
        self.assertEqual(float(fitting.scale_cost(.85, 1.15, 0)), 0.)

    def test_larger_adjustment_can_lose_between_two_hcp_orientations(self):
        # A slightly better positional fit need not be the better ranked HCP fit.
        small = fitting.penalize(dict(phase='HCP', zone_3index=[1, -1, 0], score=.80, valid=True), 1.01, .99, .1)
        large = fitting.penalize(dict(phase='HCP', zone_3index=[1, -1, -2], score=.85, valid=True), 1.10, .90, .1)
        self.assertGreater(large['position_score'], small['position_score'])
        self.assertGreater(small['score'], large['score'])
        self.assertTrue(small['valid'])
        self.assertTrue(large['valid'])

    def test_penalty_changes_ranking_without_moving_fitted_points(self):
        template = self.template('HCP', [1, -1, -2])
        q = core.canonical(core.rotation(fitting.prediction_points(template, .96, 1.035), .47))
        q = q[(np.linalg.norm(q, axis=1) >= 3) & (np.linalg.norm(q, axis=1) <= 10)]
        peaks = [dict(profile_id=i+1, qx=float(p[0]), qy=float(p[1]), weight=4., log_radial_enrichment=6.) for i, p in enumerate(q)]
        before = fitting.search(peaks, [template], .10, 'auto_hcp_ac', scale_penalty_strength=0)[0]
        after = fitting.search(peaks, [template], .10, 'auto_hcp_ac', scale_penalty_strength=.1)[0]
        np.testing.assert_allclose([n['q'] for n in before['predicted_nodes']],
                                   [n['q'] for n in after['predicted_nodes']], atol=1e-8, rtol=0)
        self.assertEqual([(m['profile_id'], m['hkl']) for m in before['matches']],
                         [(m['profile_id'], m['hkl']) for m in after['matches']])
        self.assertAlmostEqual(after['score'], before['score']-after['scale_penalty'])



if __name__ == '__main__':
    unittest.main()
