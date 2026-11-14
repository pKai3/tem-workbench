"""The spectrum guide uses calibrated transitions and fractional raw bins."""
import unittest

import numpy as np

from tem_workbench.aztec.h5oina import AztecReadError
from tem_workbench.aztec.spectral_windows import measured_windows, peak_catalogue, reconstructed_line_profiles


class SpectralWindowTests(unittest.TestCase):
    def test_fractional_window_counts_and_live_time(self):
        energies = np.arange(1.43, 1.55, .01)
        result = measured_windows(energies, np.full(len(energies), 10), 2)
        self.assertEqual([item['label'] for item in result], ['Al Kα1'])
        self.assertAlmostEqual(result[0]['counts'], 85)
        self.assertAlmostEqual(result[0]['cps'], 42.5)

    def test_reference_lines_include_transition_and_overlap(self):
        lines = peak_catalogue(5.1)
        titanium = next(line for line in lines if line['element'] == 'Ti' and line['line'] == 'Kα1')
        vanadium = next(line for line in lines if line['element'] == 'V' and line['line'] == 'Kα1')
        self.assertAlmostEqual(titanium['energy_kev'], 4.5109, places=4)
        self.assertAlmostEqual(vanadium['energy_kev'], 4.9522, places=4)
        self.assertEqual(titanium['transition'], 'L3 → K')
        self.assertGreater(len(lines), 100)

    def test_invalid_counts_are_not_measured(self):
        self.assertEqual(measured_windows([1, 2], [2, -1]), [])

    def test_reconstructed_native_line_groups_raw_positions_and_live_time(self):
        raw = np.zeros((44, 2048), dtype=np.int32)
        raw[:8, 164] = 2
        raw[:8, 165:173] = 1
        raw[:8, 173] = 3
        raw[8:16, 164] = 4
        energy = -.2 + np.arange(2048) * .01
        profiles = reconstructed_line_profiles(raw, np.full(44, .25), energy, 5)
        self.assertEqual(set(profiles), {'Al Kα1', 'Ti Kα1', 'V Kα1', 'Fe Kα1'})
        self.assertAlmostEqual(profiles['Al Kα1'][0],
                               8 * (2 * .3180470 + 8 + 3 * .2147838) / 2)
        self.assertAlmostEqual(profiles['Al Kα1'][1], 8 * 4 * .3180470 / 2)
        with self.assertRaisesRegex(AztecReadError, 'profile grid'):
            reconstructed_line_profiles(raw, np.full(44, .25), energy + .05, 5)


if __name__ == '__main__':
    unittest.main()
