"""Figure panels use the printed TIFF bar and preserve source provenance."""
from pathlib import Path
from io import BytesIO
import base64
import json
import tempfile
import unittest
import sys
from unittest.mock import patch
import numpy as np

from PIL import Image, ImageDraw

from tem_workbench.figures import creator


class FiguresTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'Sample 8kx.tif'
        image = Image.new('L', (400, 300), 128)
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 260, 399, 299), fill=1)
        draw.rectangle((210, 266, 249, 273), fill=255)
        image.save(self.path)

    def test_footer_and_bar_come_from_pixels_not_sidecar_width(self):
        self.assertNotEqual(bytes(creator._font(28).getmask('µ')), bytes(creator._font(28).getmask('□')))
        self.path.with_suffix('.txt').write_text('$$SM_MICRON_BAR 85\n$$SM_MICRON_MARKER 500nm\n')
        found = creator.inspect_image(self.path)
        self.assertEqual(found['content_height'], 260)
        self.assertEqual(found['bar_px'], 40)
        self.assertEqual(found['sidecar_bar_px'], 85)
        self.assertIsNone(found['scale_nm'])
        self.assertFalse(found['metadata_sidecar']['checks']['bar_width'])
        found['scale_nm'] = 500
        recipe = dict(name='Example', columns=1, slots=[{**found, 'zoom':1,'center_x':.5,'center_y':.5}])
        self.assertTrue(creator.render(recipe).startswith(b'\x89PNG'))
        with Image.open(BytesIO(creator.render(recipe, preview=True))) as with_bar:
            shown = np.asarray(with_bar).copy()
        recipe['scale_bar_overlay'] = False
        with Image.open(BytesIO(creator.render(recipe, preview=True))) as without_bar:
            hidden = np.asarray(without_bar).copy()
        self.assertGreater(np.count_nonzero(shown != hidden), 100)
        recipe['scale_bar_overlay'] = True
        recipe['slots'][0]['label_colour'] = '#ff0000'
        with Image.open(BytesIO(creator.render(recipe, preview=True))) as preview:
            self.assertEqual(preview.getpixel((27, 27)), (255, 0, 0))
        left = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))).convert('L'))
        recipe['slots'][0]['scale_position'] = 'right'
        right = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))).convert('L'))
        self.assertGreater(np.count_nonzero(right[-70:-20, -145:-25] > 240),
                           np.count_nonzero(left[-70:-20, -145:-25] > 240))
        del recipe['slots'][0]['scale_position']
        recipe['scale_bar_position'] = 'right'
        inherited_right = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))).convert('L'))
        np.testing.assert_array_equal(inherited_right, right)
        for position in ('left', 'right'):
            full_panel = np.asarray(creator._panel({**found, 'scale_position': position},
                                                   1000, 4 / 3, strict=True))
            self.assertEqual(np.count_nonzero(np.all(full_panel[700:705] > 245, axis=2)), 0)
        self.assertTrue(creator.original_preview(self.path).startswith('data:image/png;base64,'))
        panel = creator.panel_preview(recipe['slots'][0])
        with Image.open(BytesIO(base64.b64decode(panel.split(',', 1)[1]))) as image:
            self.assertEqual(image.size, (1000, 750))
        detail = creator.panel_preview(recipe['slots'][0], width=1600)
        with Image.open(BytesIO(base64.b64decode(detail.split(',', 1)[1]))) as image:
            self.assertEqual(image.size, (1600, 1200))
        output = creator.export(recipe, [dict(id='sample',path=str(self.root),output=str(self.root/'project-output'))], self.root/'fallback')
        self.assertEqual(Path(output['png']).parent, (self.root/'project-output').resolve())
        self.assertTrue(Path(output['recipe']).is_file())
        self.assertEqual(output['size_bytes'], Path(output['png']).stat().st_size)

    def test_missing_sidecar_needs_confirmed_scale_and_changed_source_is_rejected(self):
        found = creator.inspect_image(self.path)
        self.assertIsNone(found['scale_nm'])
        recipe = dict(slots=[found], columns=1)
        self.assertTrue(creator.render(recipe, preview=True).startswith(b'\x89PNG'))
        with self.assertRaisesRegex(ValueError, 'Confirm the printed scale'):
            creator.render(recipe)
        recipe['scale_bar_overlay'] = False
        self.assertTrue(creator.render(recipe).startswith(b'\x89PNG'))
        recipe['scale_bar_overlay'] = True
        recipe['slots'][0]['scale_nm'] = 500
        self.assertTrue(creator.render(recipe).startswith(b'\x89PNG'))
        with Image.open(self.path) as image:
            modified = image.copy()
        modified.putpixel((0, 0), 0)
        modified.save(self.path)
        with self.assertRaisesRegex(ValueError, 'changed since this panel was saved'):
            creator.render(recipe, preview=True)

    def test_adjacent_analysis_json_is_linked_by_source_metadata(self):
        companion=self.path.with_suffix('.json')
        companion.write_text(json.dumps({'source':{'id':'image-7','content_sha256':'original-hash'},'grid':{'mode':'overlap'}}))
        found=creator.inspect_image(self.path)
        self.assertEqual(found['analysis']['source_id'],'image-7')
        self.assertEqual(found['analysis']['source_sha256'],'original-hash')
        self.assertEqual(found['analysis']['method'],'overlap')
        recipe=dict(slots=[{**found,'scale_nm':500}],columns=1)
        creator.render(recipe)
        companion.write_text(companion.read_text()+'\n')
        with self.assertRaisesRegex(ValueError, 'linked analysis'):
            creator.render(recipe)

    def test_empty_slot_previews_but_blocks_export(self):
        recipe={'slots':[{'empty':True}],'columns':1}
        self.assertTrue(creator.render(recipe, preview=True).startswith(b'\x89PNG'))
        with self.assertRaisesRegex(ValueError, 'Choose an image for slot 1'):
            creator.render(recipe)

    def test_existing_rendered_image_can_keep_its_original_scale_display(self):
        path=self.root/'saved-analysis.png'
        Image.new('RGB',(200,150),'#808080').save(path)
        slot=creator.inspect_image(path)
        self.assertEqual(slot['scale_mode'],'keep')
        self.assertIsNone(slot['bar_px'])
        self.assertTrue(creator.render({'slots':[slot],'columns':1}).startswith(b'\x89PNG'))

    def test_visual_browser_thumbnail_is_small_original_image(self):
        with Image.open(BytesIO(creator.thumbnail(self.path, size=100))) as preview:
            self.assertEqual(preview.size, (100, 75))
            self.assertLess(preview.convert('L').getpixel((2, 70)), 35)

    def test_footer_preview_shows_only_rows_trimmed_from_the_panel(self):
        with Image.open(BytesIO(creator.footer_preview(self.path, 260))) as preview:
            self.assertEqual(preview.size, (400, 40))
            self.assertEqual(preview.convert('L').getpixel((220, 8)), 255)
        with self.assertRaisesRegex(ValueError, 'No footer rows'):
            creator.footer_preview(self.path, 300)

    def test_footer_text_is_metadata_source_and_txt_only_supplies_probe_current(self):
        text = '$CM_MAG 8000\n$CM_ACCEL_VOLT 5.00\n$$SM_WD 10.25\n$$SM_PROBE_NO 16\n$$SM_PROBE_CURRENT 0.00\n'
        metadata = creator._acquisition_metadata(self.path, text, '',
                                                  'x15,000 15.0kV BED-C SEM WD 9.4mm')
        self.assertEqual(metadata['magnification']['value'], 15000)
        self.assertEqual(metadata['voltage_kv']['value'], 15)
        self.assertEqual(metadata['working_distance']['value'], 9.4)
        self.assertTrue(all(metadata[key]['source'] == 'Footer OCR'
                            for key in ('magnification', 'voltage_kv', 'working_distance')))
        self.assertEqual(metadata['probe']['value'], 16)
        self.assertEqual(metadata['probe']['kind'], 'number')
        self.assertEqual(creator._metadata_lines({'metadata': metadata},
                         ['magnification', 'voltage_kv', 'probe', 'working_distance']),
                         ['15,000×', '15kV', 'P16', 'WD 9.4mm'])
        fallback = creator._acquisition_metadata(self.path, '$$SM_PROBE_CURRENT 0.25 nA', '', '')
        self.assertEqual(fallback['probe']['value'], .25)
        self.assertEqual(fallback['probe']['kind'], 'current')
        self.assertNotIn('probe', creator._acquisition_metadata(self.path, '$$SM_PROBE_CURRENT 0.00', '', ''))
        self.path.with_suffix('.txt').write_text(text)
        self.assertTrue(creator.list_images(self.root)['images'][0]['has_sidecar'])

    def test_filename_is_not_acquisition_metadata_and_date_uses_recorded_sources(self):
        classified = self.root / 'Classified ST-3.0K 5kV 20261118.tif'
        Image.new('RGB', (80, 60), '#777777').save(classified)
        inspected = creator.inspect_image(classified)
        self.assertEqual(inspected['metadata'], {})
        self.assertIsNone(inspected['scale_nm'])
        self.assertEqual(creator._acquisition_metadata(classified,
            '$CM_DATE 18/11/2026\n', '', '')['acquisition_date'],
            {'value': '2026-11-18', 'source': 'TXT $CM_DATE'})
        self.assertEqual(creator._acquisition_metadata(classified,
            '$CM_DATE 18/11/2026\n', '', '21/06/2026'),
            {'acquisition_date': {'value': '2026-06-21', 'source': 'Footer OCR'}})

    def test_working_distance_text_cannot_be_read_as_scale_bar(self):
        with Image.open(self.path) as image, patch.object(creator, '_tesseract_path', return_value='fake'), \
             patch.object(creator, '_ocr_image', return_value='x15,000 15.0kV WD 9.4mm'):
            _, scale, _ = creator._footer_ocr(image, 260, {'x': 210, 'y': 266, 'w': 40, 'h': 8})
        self.assertIsNone(scale)

    def test_sparse_footer_ocr_keeps_the_scale_label_and_other_text(self):
        def sparse(image, *, psm=6, whitelist=None):
            return '1um\nWD 9.4mm\nDetector BSE' if psm == 11 else ''
        with Image.open(self.path) as image, patch.object(creator, '_tesseract_path', return_value='fake'), \
             patch.object(creator, '_ocr_image', side_effect=sparse):
            text, scale, label = creator._footer_ocr(image, 260,
                                                      {'x': 210, 'y': 266, 'w': 40, 'h': 8})
        self.assertIn('Detector BSE', text)
        self.assertEqual((scale, label), (1000, '1um'))

    def test_verified_scale_reading_replaces_bad_footer_ocr_token(self):
        raw = '1pm CMM UQ 21/06/2026\nx15,000 15.0kV WD 9.4mm'
        self.assertEqual(creator._correct_footer_scale(raw, 1000),
                         '1 µm CMM UQ 21/06/2026\nx15,000 15.0kV WD 9.4mm')
        self.assertEqual(creator._correct_footer_scale('a lpm CMM UQ', 1000), '1 µm CMM UQ')

    def test_metadata_overlay_and_tone_matching_are_rendered_in_preview(self):
        first = self.root / 'bright.png'
        second = self.root / 'dim.png'
        gradient = np.tile(np.linspace(0, 1, 120), (90, 1))
        Image.fromarray(np.uint8(155 + gradient * 75)).save(first)
        Image.fromarray(np.uint8(45 + gradient * 45)).save(second)
        a, b = creator.inspect_image(first), creator.inspect_image(second)
        a['metadata'] = {'magnification': {'value': 15000, 'unit': '×', 'source': 'Footer OCR'}}
        recipe = dict(columns=2, slots=[a, b], metadata_overlay=[])
        plain = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))).convert('L'))
        recipe['metadata_overlay'] = ['magnification']
        badged = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))).convert('L'))
        self.assertGreater(np.count_nonzero(plain[25:80, 290:430] != badged[25:80, 290:430]), 100)
        recipe['metadata_overlay'] = []
        recipe['match_tone'] = True
        matched = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))).convert('L'))
        left = matched[60:300, 50:400]
        right = matched[60:300, 485:835]
        self.assertLess(abs(float(np.median(left)) - float(np.median(right))), 8)
        a['brightness'] = 1.3
        adjusted = np.asarray(creator._panel(a, 420, 4 / 3, strict=False).convert('L'))
        default = np.asarray(creator._panel({**a, 'brightness': 1}, 420, 4 / 3, strict=False).convert('L'))
        self.assertGreater(float(adjusted.mean()), float(default.mean()))

    def test_sharpness_override_and_equal_panel_spacing(self):
        path = self.root / 'detail.png'
        pattern = (np.indices((315, 420)).sum(axis=0) % 2 * 255).astype(np.uint8)
        Image.fromarray(pattern).save(path)
        slot = creator.inspect_image(path)
        inherited = np.asarray(creator._panel(slot, 420, 4 / 3, strict=False, figure_sharpness=0))
        overridden = np.asarray(creator._panel({**slot, 'sharpness': 3}, 420, 4 / 3,
                                                strict=False, figure_sharpness=0))
        self.assertGreater(float(overridden.std()), float(inherited.std()))
        recipe = dict(columns=2, slots=[slot, slot], sharpness=1)
        with Image.open(BytesIO(creator.render(recipe, preview=True))) as preview:
            self.assertEqual(preview.size, (2 * 420 + 3 * 15, 315 + 2 * 15))
            self.assertEqual(preview.getpixel((0, 150)), (255, 255, 255))
            self.assertEqual(preview.getpixel((440, 150)), (255, 255, 255))
        recipe['image_padding'] = 50
        with Image.open(BytesIO(creator.render(recipe, preview=True))) as preview:
            self.assertEqual(preview.size, (2 * 420 + 3 * 21, 315 + 2 * 21))
        with Image.open(BytesIO(creator.render(recipe))) as exported:
            self.assertEqual(exported.size, (2 * 1000 + 3 * 50, 750 + 2 * 50))

    def test_full_export_preserves_native_crop_pixels(self):
        path = self.root / 'large.png'
        pixels = np.zeros((1200, 1600, 3), dtype=np.uint8)
        pixels[..., 0] = np.arange(1600, dtype=np.uint16)[None, :] % 256
        pixels[..., 1] = np.arange(1200, dtype=np.uint16)[:, None] % 256
        original = Image.fromarray(pixels, 'RGB')
        original.save(path)
        slot = dict(path=str(path), sha256=creator._digest(path), width=1600, height=1200,
                    content_height=1200, scale_mode='keep')
        panel = creator._panel(slot, 1600, 4 / 3, strict=True)
        np.testing.assert_array_equal(np.asarray(panel), pixels)
        recipe = dict(columns=1, slots=[slot], scale_bar_overlay=False)
        with Image.open(BytesIO(creator.render(recipe, preview=True))) as preview:
            self.assertEqual(preview.size, (420 + 2 * 9, 315 + 2 * 9))
        with Image.open(BytesIO(creator.render(recipe))) as exported:
            self.assertEqual(exported.size, (1600 + 2 * 36, 1200 + 2 * 36))
            self.assertEqual(exported.getpixel((36 + 800, 36 + 600)), original.getpixel((800, 600)))
        recipe['export_scale_percent'] = 50
        with Image.open(BytesIO(creator.render(recipe))) as exported:
            self.assertEqual(exported.size, (800 + 2 * 36, 600 + 2 * 36))
        with Image.open(BytesIO(creator.render(recipe, preview=True))) as preview:
            self.assertEqual(preview.size, (420 + 2 * 19, 315 + 2 * 19))
        for invalid in (24, 101, 'half'):
            recipe['export_scale_percent'] = invalid
            with self.assertRaisesRegex(ValueError, 'Export size'):
                creator.render(recipe)

    def test_transparent_tags_export_to_project_and_reject_duplicates(self):
        sources = [dict(id='sample', path=str(self.root), output=str(self.root / 'project-output'))]
        tags = [dict(label='ST', colour='#0072B2'), dict(label='STA', colour=None)]
        result = creator.export_label_tags(tags, {}, sources, self.root / 'fallback', self.path)
        self.assertEqual(Path(result['folder']).parent, (self.root / 'project-output').resolve())
        self.assertEqual(len(result['files']), 2)
        with Image.open(result['files'][0]) as tag:
            self.assertEqual(tag.mode, 'RGBA')
            self.assertEqual(tag.getpixel((0, 0))[3], 0)
            self.assertEqual(tag.getpixel((tag.width // 2, tag.height - 1))[3], 255)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            creator.export_label_tags([dict(label='ST'), dict(label='st')], {}, sources, self.root)
        with self.assertRaisesRegex(ValueError, 'Each tag'):
            creator.export_label_tags(['ST'], {}, sources, self.root)
        if sys.platform == 'darwin':
            self.assertEqual(creator._font(56, system_ui=True, semibold=True).getname(),
                             ('System Font', 'Semibold'))

    def test_automatic_shape_and_metadata_crop_override(self):
        slot = creator.inspect_image(self.path)
        recipe = dict(slots=[slot], columns=1, aspect='auto', crop_metadata=True)
        self.assertAlmostEqual(creator._figure_aspect(recipe), 400 / 260)
        recipe['crop_metadata'] = False
        self.assertAlmostEqual(creator._figure_aspect(recipe), 400 / 300)
        slot['crop_metadata'] = True
        self.assertAlmostEqual(creator._figure_aspect(recipe), 400 / 260)
        slot['scale_mode'] = 'keep'
        with self.assertRaisesRegex(ValueError, 'outside the cropped field'):
            creator._panel(slot, 400, 4 / 3, strict=True, figure_crop_metadata=False)
        slot['crop_metadata'] = False
        self.assertEqual(creator._panel(slot, 400, 4 / 3, strict=True,
                                        figure_crop_metadata=True).size, (400, 300))

    def test_custom_folder_finds_images_recursively_and_keeps_folder_context(self):
        nested = self.root / 'sample A' / 'site 2'
        nested.mkdir(parents=True)
        duplicate = nested / self.path.name
        Image.new('RGB', (20, 20), 'white').save(duplicate)
        (nested / 'notes.txt').write_text('not an image')
        found = creator.list_images(self.root)
        self.assertEqual([(item['name'], item['folder']) for item in found['images']],
                         [(self.path.name, '.'), (self.path.name, 'sample A/site 2')])
        self.assertEqual(found['images'][1]['relative_path'], 'sample A/site 2/Sample 8kx.tif')

    def test_bright_footer_metadata_does_not_hide_boundary_or_force_uncropped_keep(self):
        image = Image.new('L', (400, 300), 128)
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 260, 399, 299), fill=0)
        draw.rectangle((120, 268, 260, 288), fill=255)
        draw.rectangle((300, 268, 399, 295), fill=255)
        image.save(self.path)
        found = creator.inspect_image(self.path)
        self.assertEqual(found['content_height'], 260)
        self.assertEqual(found['bar_px'], 141)
        found['scale_mode'] = 'keep'
        cropped = creator._panel(found, 400, 4 / 3, strict=False)
        self.assertGreater(cropped.convert('L').getpixel((200, 295)), 100)
        with self.assertRaisesRegex(ValueError, 'outside the cropped field'):
            creator._panel(found, 400, 4 / 3, strict=True)
        self.assertEqual(creator._panel(found, 400, 4 / 3, strict=True,
                                        figure_scale_bar_overlay=False).size, (400, 300))


if __name__ == '__main__':
    unittest.main()
