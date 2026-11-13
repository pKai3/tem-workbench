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


if __name__ == '__main__':
    unittest.main()
