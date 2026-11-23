"""Overview matching must not change scientific signals, geometry or exports."""
import base64
from io import BytesIO
import unittest

import numpy as np
from PIL import Image

from tem_workbench.aztec.export import DataArchive
from tem_workbench.aztec.views import acquisition_views, match_overview_tones
from tem_workbench.image_tone import tone_quantiles, match_tone
from tests.test_aztec_comparison import Reader


def decode(source):
    return Image.open(BytesIO(base64.b64decode(source.split(',', 1)[1]))).convert('RGBA')


class ToneReader(Reader):
    def __init__(self, line=False):
        super().__init__(); self.line = line
        gradient = np.tile(np.linspace(0, 1, 32), (32, 1))
        self.arrays['electron-a'] = gradient
        self.arrays['electron-b'] = gradient**4
        if line:
            for record in self._records.values():
                record['table'] = 'XrayLinescans'
                self.arrays[record['path']] = np.arange(32, dtype=float) + 1

    def site(self, index):
        site = super().site(index); site['image_path'] = 'electron-' + index
        if self.line:
            for region in site['regions']:
                region.update(kind='line', points=[[0, 16], [31, 16]])
        return site


class OverviewToneTests(unittest.TestCase):
    def test_maps_and_lines_match_overviews_without_changing_data(self):
        for line in (False, True):
            with self.subTest(line=line):
                reader = ToneReader(line); originals = {key: a.copy() for key, a in reader.arrays.items()}
                options = dict(acquisitions=['a', 'b'], comparison=True, signals=['Ti', 'V'],
                               mode='both' if not line else 'signal', smoothing=0, normalisation='none')
                plain_archive = DataArchive('/tmp/source.oipx', options)
                matched_archive = DataArchive('/tmp/source.oipx', options)
                plain = acquisition_views(reader, options, export_arrays=plain_archive)
                matched = acquisition_views(reader, dict(options, match_overview_tone=True), export_arrays=matched_archive)
                ranges = [tone_quantiles(decode(row['electron'])) for row in plain['rows']]
                adjusted = [tone_quantiles(decode(row['electron'])) for row in matched['rows']]
                self.assertGreater(np.linalg.norm(ranges[0] - ranges[1]), 10)
                self.assertLess(np.linalg.norm(adjusted[0] - adjusted[1]), 2)
                for before, after in zip(plain['rows'], matched['rows']):
                    for key in before.keys() - {'electron', 'background'}:
                        self.assertEqual(before[key], after[key], key)
                    if line:
                        self.assertNotEqual(before['background'], after['background'])
                for (before_meta, before), (after_meta, after) in zip(plain_archive.entries, matched_archive.entries):
                    self.assertEqual(before_meta, after_meta)
                    np.testing.assert_array_equal(before, after)
                for key in originals:
                    np.testing.assert_array_equal(originals[key], reader.arrays[key])
                self.assertEqual(acquisition_views(reader, options, export_arrays=DataArchive('/tmp/source.oipx', options)), plain)

    def test_single_overview_and_missing_images_are_unchanged(self):
        rows = acquisition_views(ToneReader(), dict(acquisitions=['a'], comparison=True, smoothing=0))['rows']
        original = rows[0]['electron']; rows.append({'error': 'Missing overview'})
        match_overview_tones(rows)
        self.assertEqual(rows[0]['electron'], original)

    def test_transparent_padding_is_ignored_and_flat_images_stay_flat(self):
        image = Image.new('RGBA', (100, 100), (0, 0, 0, 0))
        image.paste((40, 40, 40, 255), (10, 10, 30, 30))
        np.testing.assert_allclose(tone_quantiles(image), [40, 40])
        adjusted = match_tone(image, (60, 180))
        np.testing.assert_array_equal(np.asarray(image)[..., 3], np.asarray(adjusted)[..., 3])
        self.assertEqual(adjusted.getpixel((20, 20)), (120, 120, 120, 255))
        self.assertIsNone(tone_quantiles(Image.new('RGBA', (4, 4))))

    def test_figures_retains_its_original_pixel_transform(self):
        from tem_workbench.figures.creator import _adjust_tone
        pixels = np.random.default_rng(42).integers(0, 256, (40, 30, 3), dtype=np.uint8)
        image = Image.fromarray(pixels); target = (35., 190.)
        low, high = tone_quantiles(image)
        expected = np.clip((pixels.astype(np.float32) - low) * ((target[1] - target[0]) / (high - low)) + target[0], 0, 255).astype(np.uint8)
        np.testing.assert_array_equal(np.asarray(_adjust_tone(image, {}, target)), expected)
