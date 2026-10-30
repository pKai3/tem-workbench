"""Geometry checks distinguish a second pattern from a repeated primary fit."""
import unittest
import numpy as np
import analysis_core as core


class SecondaryGeometry(unittest.TestCase):
    def setUp(self):
        self.grid = np.array([[4., 0.], [0., 4.], [4., 4.], [-4., 4.], [8., 0.], [0., 8.]])

    def analyze(self, coordinates):
        peaks = [dict(profile_id=i+1, qx=float(q[0]), qy=float(q[1]),
                      weight=1., log_radial_enrichment=4.)
                 for i, q in enumerate(core.canonical(coordinates))]
        return core.purity(peaks, .1)

    def test_single_grid_does_not_report_its_rejected_copy_as_secondary(self):
        result = self.analyze(self.grid)
        self.assertTrue(result['primary_lattice']['valid'])
        self.assertIsNone(result['secondary_lattice'])
        self.assertEqual(result['status'], 'predominantly_one_periodic_pattern')
        self.assertFalse(result['substantial_second_pattern'])
        self.assertEqual(result['secondary_unique_fraction'], 0.)
        self.assertAlmostEqual(result['explained_fraction'], 1.)

    def test_rotated_grid_remains_secondary_even_with_the_same_score(self):
        result = self.analyze(np.r_[self.grid, core.rotation(self.grid, .43)])
        primary, secondary = result['primary_lattice'], result['secondary_lattice']
        self.assertTrue(primary['valid'])
        self.assertTrue(secondary['valid'])
        self.assertAlmostEqual(primary['score'], secondary['score'])
        primary_ids = {m['profile_id'] for m in primary['matches']}
        secondary_ids = {m['profile_id'] for m in secondary['matches']}
        self.assertGreaterEqual(len(secondary_ids-primary_ids), 3)
        self.assertEqual(result['status'], 'multiple_periodic_patterns')
        self.assertTrue(result['substantial_second_pattern'])
        self.assertAlmostEqual(result['explained_fraction'], 1.)

    def test_threshold_objective_rewards_independent_grid_not_duplicate(self):
        coords=np.r_[self.grid,core.rotation(self.grid,.43)]
        peaks=[dict(profile_id=i+1,qx=float(q[0]),qy=float(q[1]),weight=1.,log_radial_enrichment=4.)
               for i,q in enumerate(core.canonical(coords))]
        geometry=core.purity(peaks,.1)
        pair=core.geometry_strength_score(peaks,geometry,12.,.1)
        single=core.geometry_strength_score(peaks,{**geometry,'secondary_lattice':None},12.,.1)
        duplicate=core.geometry_strength_score(peaks,{**geometry,'secondary_lattice':geometry['primary_lattice']},12.,.1)
        self.assertEqual(pair['pattern_count'],2)
        self.assertGreater(pair['score'],single['score'])
        self.assertEqual(duplicate,single)
        # Adding unmatched noise cannot improve the fixed-pool objective.
        noisy=core.geometry_strength_score(peaks+[dict(profile_id=99,weight=1.)],geometry,13.,.1)
        self.assertLess(noisy['score'],pair['score'])

    def test_insufficient_primary_stays_unresolved(self):
        result = self.analyze(self.grid[:3])
        self.assertIsNone(result['primary_lattice'])
        self.assertIsNone(result['secondary_lattice'])
        self.assertEqual(result['status'], 'unresolved_pattern')


if __name__ == '__main__':
    unittest.main()
