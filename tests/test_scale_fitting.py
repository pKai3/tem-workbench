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
        result = fitting.search(peaks, [template], .10, mode)[0]
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


if __name__ == '__main__':
    unittest.main()
