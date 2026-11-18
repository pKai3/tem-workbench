"""Figure panels use the printed TIFF bar and preserve source provenance."""
from pathlib import Path
from io import BytesIO
import base64
import json
import tempfile
import unittest
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
        self.assertEqual(found['scale_nm'], 500)
        self.assertEqual(found['scale_source'], 'sidecar label; bar width measured from image')
        recipe = dict(name='Example', columns=1, slots=[{**found, 'zoom':1,'center_x':.5,'center_y':.5}])
        self.assertTrue(creator.render(recipe).startswith(b'\x89PNG'))
        recipe['slots'][0]['label_colour'] = '#ff0000'
        with Image.open(BytesIO(creator.render(recipe, preview=True))) as preview:
            self.assertEqual(preview.getpixel((27, 27)), (255, 0, 0))
        left = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))).convert('L'))
        recipe['slots'][0]['scale_position'] = 'right'
        right = np.asarray(Image.open(BytesIO(creator.render(recipe, preview=True))).convert('L'))
        self.assertGreater(np.count_nonzero(right[-70:-20, -145:-25] > 240),
                           np.count_nonzero(left[-70:-20, -145:-25] > 240))
        self.assertTrue(creator.original_preview(self.path).startswith('data:image/png;base64,'))
        panel = creator.panel_preview(recipe['slots'][0])
        with Image.open(BytesIO(base64.b64decode(panel.split(',', 1)[1]))) as image:
            self.assertEqual(image.size, (1000, 750))
        output = creator.export(recipe, [dict(id='sample',path=str(self.root),output=str(self.root/'project-output'))], self.root/'fallback')
        self.assertEqual(Path(output['png']).parent, (self.root/'project-output').resolve())
        self.assertTrue(Path(output['recipe']).is_file())

    def test_missing_sidecar_needs_confirmed_scale_and_changed_source_is_rejected(self):
        found = creator.inspect_image(self.path)
        self.assertIsNone(found['scale_nm'])
        recipe = dict(slots=[found], columns=1)
        self.assertTrue(creator.render(recipe, preview=True).startswith(b'\x89PNG'))
        with self.assertRaisesRegex(ValueError, 'Confirm the printed scale'):
            creator.render(recipe)
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


if __name__ == '__main__':
    unittest.main()
