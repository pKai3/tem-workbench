from io import BytesIO
from pathlib import Path
from unittest.mock import patch
import base64
import copy
import json
import tempfile
import unittest

import numpy as np
from PIL import Image

from tem_workbench.figures import creator


class PlaceholderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.path = self.root / 'image.png'
        Image.fromarray(np.tile(np.arange(200, dtype=np.uint8), (160, 1))).save(self.path)
        self.image = dict(path=str(self.path), sha256=creator._digest(self.path),
                          width=200, height=160, content_height=160,
                          scale_mode='metadata', pixel_size_nm=2, label_visible=False)
        self.missing = dict(kind='placeholder', placeholder=dict(title='Not acquired',
                            sample='ST', location='Near', target_magnification_x=8000))

    def test_six_column_grid_retains_missing_positions_and_exports_recipe(self):
        slots = [self.image] * 18
        for index in (11, 16, 17):
            slots[index] = self.missing
        recipe = dict(name='Acquisition grid', columns=6, slots=slots, aspect='auto', image_padding=0)
        result = creator.preview_result(recipe)
        self.assertEqual((result['layout']['columns'], result['layout']['rows']), (6, 3))
        self.assertEqual(result['layout']['panel_height'], 336)
        preview = Image.open(BytesIO(base64.b64decode(result['image'].split(',')[1])))
        for index in range(18):
            x, y = index % 6 * 420, index // 6 * 336
            self.assertEqual(preview.getpixel((x + 210, y + 20)) == (0, 0, 0), index in (11, 16, 17))
        output = creator.export(recipe, [dict(id='sample', path=str(self.root),
                                output=str(self.root / 'project-output'))], self.root / 'fallback')
        self.assertEqual(Path(output['png']).parent, self.root / 'project-output')
        saved = json.loads(Path(output['recipe']).read_text())['recipe']
        self.assertEqual(saved, recipe)
        self.assertEqual(Path(output['png']).read_bytes(), creator.render(saved))

    def test_placeholder_only_export_and_detail_need_no_source_or_calibration(self):
        recipe = dict(columns=1, slots=[self.missing], match_tone=True,
                      metadata_overlay=['magnification', 'voltage_kv'])
        with patch.object(creator, '_open_image', side_effect=AssertionError('No image needed')):
            data = creator.render(recipe)
            estimate = creator.estimate_png_size(recipe)
            self.assertTrue(estimate['exact'])
            self.assertEqual(estimate['estimated_size_bytes'], len(data))
            result = creator.export(recipe, [], self.root / 'fallback')
            self.assertEqual(Path(result['png']).parent, self.root / 'fallback')
            detail = creator.panel_preview(self.missing, recipe=recipe, width=1000)
        panel = Image.open(BytesIO(base64.b64decode(detail.split(',')[1])))
        exported = Image.open(BytesIO(data))
        np.testing.assert_array_equal(np.asarray(exported)[36:-36, 36:-36], np.asarray(panel))
        # Fixed black field, white text, generous margins, and no generated scale bar.
        pixels = np.asarray(panel)
        self.assertTrue(np.array_equal(pixels[:, :, 0], pixels[:, :, 1]))
        self.assertGreater(np.count_nonzero(pixels), 1000)
        self.assertFalse(pixels[-70:].any())
        self.assertFalse(pixels[:, :30].any())
        self.assertFalse(pixels[:, -30:].any())
        with patch.object(creator, 'MAX_EXACT_ESTIMATE_PIXELS', 1):
            estimate = creator.estimate_png_size(recipe)
        self.assertFalse(estimate['exact'])
        self.assertGreater(estimate['estimated_size_bytes'], 0)

    def test_large_layout_preview_estimate_and_export_preserve_all_panels(self):
        slots = [self.image] * 56
        slots[-1] = self.missing
        recipe = dict(columns=7, rows=8, slots=slots, aspect='auto',
                      export_scale_percent=25, image_padding=0)
        preview = creator.preview_result(recipe, width=6000)
        layout = preview['layout']
        self.assertEqual((layout['columns'], layout['rows']), (7, 8))
        self.assertLessEqual(layout['width'] * layout['height'], creator.MAX_PREVIEW_PIXELS)
        data = creator.render(recipe)
        exported = Image.open(BytesIO(data))
        self.assertEqual(exported.size, (1750, 1600))
        self.assertEqual(exported.getpixel((1625, 1420)), (0, 0, 0))
        estimate = creator.estimate_png_size(recipe)
        self.assertTrue(estimate['exact'])
        self.assertEqual(estimate['estimated_size_bytes'], len(data))

    def test_invalid_grid_dimensions_are_rejected_in_preview_and_estimate(self):
        for columns in (0, -1, 1.5, True, 'bad', float('inf')):
            for function in (creator.preview_result, creator.estimate_png_size):
                with self.subTest(columns=columns, function=function.__name__):
                    with self.assertRaisesRegex(ValueError, 'positive whole number'):
                        function(dict(columns=columns, slots=[self.image]))

    def test_placeholders_do_not_affect_real_image_tone_or_gain_overlays(self):
        bright = {**self.image, 'brightness': 1.3}
        recipe = dict(columns=3, slots=[self.image, bright, self.missing], match_tone=True,
                      image_padding=0, sharpness=3, metadata_overlay=['magnification'])
        with_missing = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))))
        recipe['slots'] = [self.image, bright]
        without = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))))
        np.testing.assert_array_equal(with_missing[:, :840], without[:, :840])
        self.missing.update(brightness=2, contrast=3, label='Do not show', pixel_size_nm=10,
                            metadata={'magnification': {'value': 10000}})
        recipe['slots'] = [self.image, bright, self.missing]
        np.testing.assert_array_equal(with_missing, np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True)))))

    def test_empty_unconfirmed_and_changed_real_images_still_block_export(self):
        recipe = dict(columns=2, slots=[self.missing, {}])
        with self.assertRaisesRegex(ValueError, 'slot 2'):
            creator.render(recipe)
        recipe['slots'][1] = {**self.image, 'pixel_size_nm': None}
        with self.assertRaisesRegex(ValueError, 'pixel size'):
            creator.render(recipe)
        recipe['slots'][1] = self.image
        self.path.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'changed'):
            creator.render(recipe)
        with self.assertRaisesRegex(ValueError, 'source image'):
            creator.panel_preview({**self.missing, 'path': str(self.path)})

    def test_invalid_details_rejected_and_long_unicode_text_fits(self):
        for value in (-1, True, '8000', float('nan')):
            missing = copy.deepcopy(self.missing)
            missing['placeholder']['target_magnification_x'] = value
            with self.assertRaisesRegex(ValueError, 'magnification'):
                creator.panel_preview(missing)
        self.missing['placeholder']['title'] = 'α β γ ' * 20
        self.missing['placeholder']['sample'] = 'Specimen ' * 13
        for aspect in (1, 4 / 3, 16 / 9):
            panel = np.asarray(creator._placeholder_panel(self.missing, 800, aspect))
            self.assertFalse(panel[:, :15].any())
            self.assertFalse(panel[:, -15:].any())
        self.missing['placeholder']['title'] += 'x'
        with self.assertRaisesRegex(ValueError, '120 characters'):
            creator.panel_preview(self.missing)


if __name__ == '__main__':
    unittest.main()
