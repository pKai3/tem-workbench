"""Processed diffraction flattens display brightness without changing evidence."""
import base64
from io import BytesIO
import json
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import diffraction
from engine import Engine
from tests.test_diffraction import pattern


class DiffractionDisplayChecks(unittest.TestCase):
    def test_radial_background_flattens_without_shifting_spots(self):
        yy, xx = np.indices((256, 256))
        radius = np.hypot(xx-127.5, yy-127.5)
        background = 3+2*np.exp(-radius**2/(2*65**2))
        spot = np.exp(-((xx-185)**2+(yy-130)**2)/(2*3**2))
        log = background+spot
        original = log.copy()
        valid = (radius > 25) & (xx < 230)
        valid[65:95, 95:125] = False
        processed = diffraction.processed_display(log, valid)
        quiet = valid & (np.hypot(xx-185, yy-130) > 15)
        self.assertLess(np.std(processed[quiet]), .05*np.std(log[quiet]))
        y, x = np.unravel_index(processed.argmax(), processed.shape)
        self.assertLessEqual(np.hypot(x-185, y-130), 1.)
        self.assertTrue(np.isfinite(processed).all())
        self.assertTrue((processed[~valid] == processed.min()).all())
        np.testing.assert_array_equal(log, original)

    def test_masks_and_detector_edges_do_not_create_bright_rims(self):
        log = np.full((80, 100), 5., dtype=np.float32)
        valid = np.ones(log.shape, dtype=bool)
        valid[:, 80:] = False
        valid[20:40, 30:50] = False
        log[~valid] = 1000.
        np.testing.assert_allclose(diffraction.processed_display(log, valid), 0., atol=1e-7)
        np.testing.assert_array_equal(diffraction.processed_display(log, ~np.ones_like(valid)), 0.)

    def test_encoded_view_shares_coordinates_and_leaves_results_unchanged(self):
        array, info, _ = pattern()
        original = array.copy()
        item = dict(array=array, info=info, limits=[99., 351.])
        roi = dict(x=0, y=0, w=768, h=768)
        settings = dict(enabled_phases=[], diffraction={'center_x':402., 'center_y':364.})
        engine = Engine({})
        with patch('analysis_core.fft2', side_effect=AssertionError('No FFT of diffraction pixels')):
            result = engine.analyze(item, roi, settings, images=True)
            numerical = engine.analyze(item, roi, settings, images=False)
        self.assertEqual(result['spectrum'], numerical['spectrum'])
        self.assertEqual(result['models'], numerical['models'])
        self.assertEqual(result['classification'], numerical['classification'])
        self.assertTrue(result['spectrum']['center_refinement']['applied'])
        expected, _ = diffraction.spectrum(array, result['settings']['diffraction'], item['_diffraction_cache'])
        field = expected['detector_signal']
        lo, hi = result['images']['detector_signal_limits']
        raw = base64.b64decode(result['images']['detector_signal16'].split(',', 1)[1])
        rgb = np.asarray(Image.open(BytesIO(raw)), dtype=np.uint16)
        decoded = ((rgb[..., 0] << 8) | rgb[..., 1])/65535*(hi-lo)+lo
        self.assertEqual(decoded.shape, expected['log'].shape)
        np.testing.assert_allclose(decoded, field, atol=(hi-lo)/65535+1e-6, rtol=0)
        self.assertNotIn('detector_signal', result['spectrum'])
        np.testing.assert_array_equal(array, original)
        json.dumps(result, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
