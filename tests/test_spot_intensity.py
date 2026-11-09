import unittest
import numpy as np
import spot_intensity as photometry


class SpotIntensityTests(unittest.TestCase):
    def spot(self, x, y, sigma):
        return dict(x_px=x, y_px=y, width_px=2.355*sigma, q=[x, y])

    def test_integral_tracks_area_and_rejects_background_gradient(self):
        yy, xx = np.indices((180, 220))
        background = 50+.1*xx+.2*yy
        image = background+100*np.exp(-((xx-50)**2+(yy-90)**2)/(2*3**2))+100*np.exp(-((xx-150)**2+(yy-90)**2)/(2*6**2))
        spots = photometry.measure(image, [self.spot(50, 90, 3), self.spot(150, 90, 6)])
        small, large = [s['photometry'] for s in spots]
        self.assertTrue(small['reliable'] and large['reliable'])
        self.assertAlmostEqual(large['integrated_intensity']/small['integrated_intensity'], 4, delta=.08)
        # A 2.5-sigma aperture encloses 1-exp(-2.5^2/2) of a 2D Gaussian.
        expected = 100*2*np.pi*3**2*(1-np.exp(-2.5**2/2))
        self.assertAlmostEqual(small['integrated_intensity']/expected, 1, delta=.02)
        self.assertAlmostEqual(small['background'], background[90, 50], delta=.05)
        scaled = photometry.measure(5*image+70, [self.spot(50, 90, 3), self.spot(150, 90, 6)])
        for old, new in zip(spots, scaled):
            self.assertAlmostEqual(new['photometry']['integrated_intensity']/old['photometry']['integrated_intensity'], 5, places=8)

    def test_pair_mean_and_bounded_weights_preserve_detection_confidence(self):
        spots = [self.spot(30, 30, 3), self.spot(70, 70, 3)]
        for s in spots:
            s['photometry'] = dict(integrated_intensity=100., reliable=True, flags=[])
        self.assertEqual(photometry.profile_measurements(spots)['integrated_intensity'], 100.)
        peaks = [dict(weight=2., integrated_intensity=i, intensity_reliable=True) for i in (100., 400., 10000.)]
        photometry.apply_weights(peaks)
        self.assertLess(peaks[0]['weight'], peaks[1]['weight'])
        self.assertEqual(peaks[-1]['weight'], 6.)
        self.assertTrue(all(p['detection_weight'] == 2. for p in peaks))
        scaled = [dict(weight=2., integrated_intensity=i, intensity_reliable=True) for i in (700., 2800., 70000.)]
        photometry.apply_weights(scaled)
        self.assertEqual([p['weight'] for p in peaks], [p['weight'] for p in scaled])

    def test_overlap_edges_and_missing_background_are_reported(self):
        yy, xx = np.indices((100, 100)); image = 40+200*np.exp(-((xx-40)**2+(yy-50)**2)/(2*6**2))
        spots = photometry.measure(image, [self.spot(40, 50, 6), self.spot(50, 50, 6), self.spot(2, 2, 4)])
        self.assertIn('overlap_partitioned', spots[0]['photometry']['flags'])
        self.assertIn('aperture_clipped', spots[2]['photometry']['flags'])
        self.assertFalse(any(s['photometry']['reliable'] for s in spots))
        missing = photometry.measure(image, [self.spot(50, 50, 4)], np.zeros_like(image, dtype=bool))[0]['photometry']
        self.assertIsNone(missing['integrated_intensity'])
        p=dict(weight=2.1, integrated_intensity=1e8, intensity_reliable=False)
        photometry.apply_weights([p]); self.assertEqual(p['weight'], 2.1)

    def test_constant_background_has_zero_integral(self):
        s = photometry.measure(np.full((100,100),37.), [self.spot(50,50,4)])[0]['photometry']
        self.assertAlmostEqual(s['integrated_intensity'], 0., places=8)

    def test_brightness_ids_number_profiles_without_reordering_fitting_input(self):
        peaks=[dict(profile_id=i+1, qx=i, integrated_intensity=value)
               for i,value in enumerate((40.,200.,40.,None,-3.,float('nan')))]
        identities=[id(p) for p in peaks]
        photometry.number_profiles(peaks)
        self.assertEqual([p['profile_id'] for p in peaks],[2,1,3,5,4,6])
        self.assertEqual([id(p) for p in peaks],identities)
        self.assertEqual([p['qx'] for p in peaks],list(range(6)))
        # Renumber a selected copy, leaving the source pool and earlier trials intact.
        subset=[dict(p) for p in (peaks[0],peaks[2],peaks[4])]
        photometry.number_profiles(subset)
        self.assertEqual([p['profile_id'] for p in subset],[1,2,3])
        self.assertEqual([p['profile_id'] for p in peaks],[2,1,3,5,4,6])


if __name__ == '__main__':
    unittest.main()
