"""Scientific sanity checks for the exploratory spatial-ordering metric."""
import unittest

import numpy as np

from tem_workbench.aztec.processing import spatial_structure


class SpatialStructureTests(unittest.TestCase):
    def test_paired_shuffle_and_spatial_order(self):
        rng = np.random.default_rng(19)
        denominator = rng.uniform(30, 100, 240)
        numerator = denominator * np.r_[np.full(120, .1), np.full(120, .3)]
        coherent = spatial_structure(numerator, denominator, sigma=3)
        order = rng.permutation(240)
        scattered = spatial_structure(numerator[order], denominator[order], sigma=3)
        self.assertGreater(coherent['structure_ratio'], 3)
        self.assertLess(scattered['structure_ratio'], 1.6)
        # Common brightness variation cannot create ratio structure.
        constant_ratio = spatial_structure(denominator*.2, denominator, sigma=3)
        self.assertFalse(constant_ratio['available'])

    def test_units_and_insufficient_information(self):
        rng = np.random.default_rng(10)
        numerator = rng.poisson(20, 187)
        original = spatial_structure(numerator, sigma=2)
        scaled = spatial_structure(numerator*100, sigma=2)
        self.assertAlmostEqual(original['structure_ratio'], scaled['structure_ratio'])
        self.assertFalse(spatial_structure(numerator, sigma=0)['available'])
        self.assertFalse(spatial_structure(numerator, sigma=40)['available'])
        self.assertFalse(spatial_structure(numerator, np.zeros(187), sigma=2)['available'])

    def test_map_order_pairing_and_anisotropic_variation(self):
        from scipy.ndimage import gaussian_filter
        rng = np.random.default_rng(4)
        den = rng.uniform(20, 50, (48, 64))
        a = den*np.where(np.indices(den.shape)[1] < 32, .1, .3)
        check = spatial_structure(a, den, sigma=(1, 2))
        ratio = gaussian_filter(a, (1, 2))/gaussian_filter(den, (1, 2))
        interior = ratio[3:-3, 6:-6]
        self.assertAlmostEqual(check['observed_cv'], interior.std()/interior.mean())
        self.assertGreater(check['structure_ratio'], 3)
        self.assertTrue(check['above_shuffled_95'])
        self.assertFalse(spatial_structure(den*.2, den, sigma=2)['available'])
        order = rng.permutation(a.size)
        scattered = spatial_structure(a.ravel()[order].reshape(a.shape),
                                      den.ravel()[order].reshape(a.shape), sigma=(1, 2))
        self.assertLess(scattered['structure_ratio'], 1.6)

    def test_map_sweep_uses_common_interior(self):
        from tem_workbench.aztec.map_statistics import map_structure
        from tem_workbench.aztec.processing import signal_view
        rng = np.random.default_rng(7)
        den = rng.uniform(10, 20, (40, 40))
        a = den*np.linspace(.1, .3, 40)
        result = map_structure({'V': a}, denominator=den, denominator_label='Ti', sigma=1)
        self.assertEqual(len(result['factors']), 10)
        for factor, value in zip(result['factors'], result['tiles'][0]['spread']):
            interior = signal_view(a, den, sigma=factor)['values'][6:-6, 6:-6]
            p10, p90 = np.percentile(interior, [10, 90])
            self.assertAlmostEqual(value, p90/p10)
        unavailable = map_structure({'V': a}, sigma=0)
        self.assertEqual(unavailable['tiles'][0]['spread'], [None]*10)


if __name__ == '__main__':
    unittest.main()
