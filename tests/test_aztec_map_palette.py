"""Normalized map palettes change displayed intensity, never the underlying values."""
import base64
from io import BytesIO
import unittest

import numpy as np
from PIL import Image

from tem_workbench.aztec.export import DataArchive
from tem_workbench.aztec.h5oina import AztecReadError
from tem_workbench.aztec.processing import ELEMENT_COLOURS
from tem_workbench.aztec.views import acquisition_views, png
from tests.test_aztec_comparison import Reader


def pixels(source):
    return np.asarray(Image.open(BytesIO(base64.b64decode(source.split(',', 1)[1]))))


class MapPaletteTests(unittest.TestCase):
    def setUp(self):
        self.reader = Reader()
        ramp = np.tile(np.linspace(-1, 1, 32), (32, 1))
        for path, values in self.reader.arrays.items():
            values *= 1 + (.2 if path.endswith('-Ti') else .4) * ramp
        self.options = dict(acquisitions=['a', 'b'], channel_table='XrayMapImages',
                            signals=['Ti', 'V'], mode='both', denominator='Ti',
                            comparison=True, normalisation='median', smoothing=0,
                            scale_scope='all', low=.7, high=1.3)

    def test_black_minimum_full_channel_colour_and_linear_midpoint(self):
        image = pixels(png([[.7, 1., 1.3, np.nan]], low=.7, high=1.3, colour='#db65ed'))
        np.testing.assert_array_equal(image[0, 0], [0, 0, 0, 255])
        np.testing.assert_array_equal(image[0, 2], [219, 101, 237, 255])
        np.testing.assert_allclose(image[0, 1, :3], np.array([219, 101, 237]) / 2, atol=1)
        self.assertEqual(image[0, 3, 3], 0, 'Unavailable ratios remain transparent')

    def test_both_palettes_keep_limits_baselines_and_statistics_for_every_scale_scope(self):
        originals = {path: values.copy() for path, values in self.reader.arrays.items()}
        for scope in ('all', 'element', 'off'):
            with self.subTest(scope=scope):
                options = {**self.options, 'scale_scope': scope}
                diverging = acquisition_views(self.reader, {**options, 'map_palette': 'diverging'})
                black = acquisition_views(self.reader, {**options, 'map_palette': 'black'})
                self.assertEqual(black['map_palette'], 'black')
                self.assertEqual(black['suggested_colour_limits'], diverging['suggested_colour_limits'])
                for a, b in zip(diverging['rows'], black['rows']):
                    self.assertEqual(a['statistics'], b['statistics'])
                    self.assertEqual(a['signal_statistics'], b['signal_statistics'])
                    self.assertEqual(a['electron'], b['electron'])
                    for old, new in zip(a['tiles'], b['tiles']):
                        for field in ('image', 'ratio_image'):
                            if field not in old:
                                continue
                            self.assertEqual(old[field+'_limits'], new[field+'_limits'])
                            self.assertNotEqual(old[field], new[field])
                        self.assertEqual(old['baseline'], new['baseline'])
                        self.assertEqual(old.get('ratio_baseline'), new.get('ratio_baseline'))
                v = pixels(black['rows'][0]['tiles'][1]['image'])
                np.testing.assert_array_equal(v[0, 0, :3], [0, 0, 0])
                colour = ELEMENT_COLOURS['V']
                np.testing.assert_array_equal(v[0, -1, :3], [int(colour[i:i+2], 16) for i in (1, 3, 5)])
        for path, values in originals.items():
            np.testing.assert_array_equal(self.reader.arrays[path], values)

    def test_palette_is_ignored_with_normalization_off_and_default_is_black(self):
        options = {**self.options, 'normalisation': 'none'}
        old = acquisition_views(self.reader, options)
        black = acquisition_views(self.reader, {**options, 'map_palette': 'black'})
        self.assertEqual(old['rows'], black['rows'])
        self.assertEqual(acquisition_views(self.reader, self.options)['map_palette'], 'black')
        with self.assertRaises(AztecReadError):
            acquisition_views(self.reader, {**self.options, 'map_palette': 'invalid'})

    def test_original_and_processed_numerical_exports_are_identical(self):
        archives = []
        for palette in ('diverging', 'black'):
            options = {**self.options, 'map_palette': palette}
            archive = DataArchive('/tmp/source.oipx', options)
            acquisition_views(self.reader, options, export_arrays=archive)
            archives.append(archive)
        self.assertEqual(len(archives[0].entries), len(archives[1].entries))
        for (old, a), (new, b) in zip(archives[0].entries, archives[1].entries):
            self.assertEqual(old, new)
            np.testing.assert_array_equal(a, b)
