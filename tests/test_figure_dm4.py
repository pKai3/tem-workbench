"""Native DM4 pixels and metadata remain independent of browser previews."""
import base64
from io import BytesIO
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import numpy as np
from PIL import Image

from tem_workbench.figures import creator
from tem_workbench.figures.index import FigureMetadataIndex


class NativeDM4Tests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.path = self.root / 'native.dm4'
        self.path.write_bytes(b'native-source')
        self.tags = {'Calibrations Dimension 1 Units': 'nm', 'Calibrations Dimension 1 Scale': .125,
                     'Calibrations Dimension 2 Units': 'nm', 'Calibrations Dimension 2 Scale': .125,
                     'Microscope Info Indicated Magnification': 700000,
                     'Microscope Info Voltage': 200000,
                     'Microscope Info Probe Current (nA)': 0,
                     'DataBar Acquisition Date': '10/27/2026', 'DataBar Acquisition Time': '1:51:06 PM'}
        self.pixels = np.random.default_rng(41).normal(1000, 80, (1024, 1536)).astype(np.float32)
        self.handle = MagicMock()
        self.handle.__enter__.return_value = self.handle
        self.handle.numObjects = 2
        self.handle.xSize, self.handle.ySize, self.handle.dataShape = [128, 1536], [128, 1024], [2, 2]
        self.handle.getMetadata.return_value = self.tags
        self.handle.getDataset.side_effect = lambda index: {'data': self.pixels.copy()}
        self.module = SimpleNamespace(fileDM=MagicMock(return_value=self.handle))
        self.reader = lambda: self.module
        self.options = {'dm_reader': self.reader}

    def inspect(self):
        return creator.inspect_image(self.path, **self.options)

    def test_inspection_uses_native_tags_without_pixels_ocr_or_sidecars(self):
        self.path.with_suffix('.txt').write_text('$$SM_PROBE_NO 15\n$CM_DATE 1999/01/01')
        with patch.object(creator, '_footer_ocr', side_effect=AssertionError('No DM4 OCR')):
            slot = self.inspect()
        self.handle.getDataset.assert_not_called()
        self.assertEqual((slot['width'], slot['height'], slot['content_height']), (1536, 1024, 1024))
        self.assertEqual((slot['scale_mode'], slot['pixel_size_nm']), ('metadata', .125))
        self.assertEqual(slot['metadata']['magnification']['value'], 700000)
        self.assertEqual(slot['metadata']['voltage_kv']['value'], 200)
        self.assertEqual(slot['metadata']['acquisition_date']['value'], '2026-10-27')
        self.assertNotIn('probe', slot['metadata'])
        self.assertIsNone(slot['metadata_sidecar'])
        self.assertFalse(slot['footer_detected'])

    def test_export_and_adjustments_use_original_resolution_not_preview(self):
        Image.new('RGB', (90, 60), 'red').save(self.path.with_suffix('.png'))
        slot = {**self.inspect(), 'label_visible': False}
        recipe = dict(slots=[slot], columns=1, aspect='auto', image_padding=0, scale_bar_overlay=False)
        initial = creator.render(recipe, **self.options)
        with Image.open(BytesIO(initial)) as image:
            self.assertEqual(image.size, (1536, 1024))
            expected = creator.dm4_source.image(self.path, self.reader).convert('RGB')
            np.testing.assert_array_equal(np.asarray(image), np.asarray(expected))
        self.path.with_suffix('.png').unlink()
        self.path.with_suffix('.txt').write_text('unrelated metadata')
        self.assertEqual(creator.render(recipe, **self.options), initial)
        for field, value in (('brightness', 1.5), ('contrast', 1.5), ('sharpness', 2)):
            altered = {**recipe, 'slots': [{**slot, field: value}]}
            self.assertNotEqual(creator.render(altered, **self.options), initial, field)
        result = creator.export(recipe, [], self.root / 'output', **self.options)
        self.assertEqual(Path(result['png']).read_bytes(), initial)
        saved = json.loads(Path(result['recipe']).read_text())['recipe']['slots'][0]
        self.assertEqual(saved['path'], str(self.path.resolve()))
        self.assertEqual(saved['sha256'], creator._digest(self.path))
        estimate = creator.estimate_png_size(recipe, **self.options)
        self.assertEqual(estimate['estimated_size_bytes'], len(initial))
        with patch.object(creator, 'MAX_EXACT_ESTIMATE_PIXELS', 1):
            self.assertFalse(creator.estimate_png_size(recipe, **self.options)['exact'])
        self.assertEqual(self.path.read_bytes(), b'native-source')
        self.path.write_bytes(b'changed-source')
        with self.assertRaisesRegex(ValueError, 'changed since this panel was saved'):
            creator.render(recipe, **self.options)

    def test_tone_matching_original_view_and_zoom_keep_native_pipeline(self):
        slot = {**self.inspect(), 'label_visible': False}
        second = self.root / 'second.dm4'; second.write_bytes(b'second')
        other = {**creator.inspect_image(second, **self.options), 'label_visible': False}
        original = self.pixels.copy()
        self.module.fileDM.side_effect = lambda path, **kw: self.choose_pixels(path, original)
        recipe = dict(slots=[slot, other], columns=2, aspect=1, image_padding=0, scale_bar_overlay=False)
        baseline = creator.render(recipe, preview=True, **self.options)
        matched = creator.render({**recipe, 'match_tone': True}, preview=True, **self.options)
        self.assertNotEqual(baseline, matched)
        self.assertTrue(creator.preview(recipe, **self.options).startswith('data:image/png'))
        self.assertTrue(creator.panel_preview(slot, recipe={**recipe, 'match_tone': True}, **self.options).startswith('data:image/png'))
        image = Image.open(BytesIO(base64.b64decode(creator.original_preview(self.path, **self.options).split(',')[1])))
        self.assertEqual(image.size, (1536, 1024))
        with patch.object(creator, '_nice_bar', wraps=creator._nice_bar) as bar:
            creator._panel(slot, 420, 1, strict=True, **self.options)
            scale = bar.call_args.args[0]
            creator._panel({**slot, 'zoom': 2}, 420, 1, strict=True, **self.options)
            self.assertAlmostEqual(bar.call_args.args[0], scale / 2)

    def choose_pixels(self, path, original):
        self.pixels = original if Path(path).name == 'native.dm4' else np.maximum(original - 1000, 0)**2
        return self.handle

    def test_uncalibrated_and_unsupported_native_inputs(self):
        for units, scales in [(('1/nm', '1/nm'), (1, 1)), (('nm', 'nm'), (.1, .2)), (('nm', 'nm'), (float('nan'), 1))]:
            for dimension in (1, 2):
                self.tags[f'Calibrations Dimension {dimension} Units'] = units[dimension - 1]
                self.tags[f'Calibrations Dimension {dimension} Scale'] = scales[dimension - 1]
            self.assertIsNone(self.inspect()['pixel_size_nm'])
            self.assertEqual(self.inspect()['scale_mode'], 'keep')
        self.handle.dataShape = [2, 3]
        with self.assertRaisesRegex(ValueError, 'stacks'):
            self.inspect()
        self.handle.dataShape = [2, 2]
        self.pixels[0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, 'finite'):
            creator.original_preview(self.path, **self.options)

    def test_preprocessing_tracks_dm4_changes_and_ignores_preview_and_txt(self):
        index = FigureMetadataIndex(self.root / 'index.json', self.reader)
        def run():
            index.start(self.root); index.thread.join(timeout=10)
            result = index.status(self.root)
            self.assertEqual((result['state'], result['total'], result['failed']), ('complete', 1, 0))
            return result
        self.assertEqual(run()['reused'], 0)
        Image.new('RGB', (80, 60), 'red').save(self.path.with_suffix('.PNG'))
        self.path.with_suffix('.txt').write_text('not needed')
        self.assertEqual(run()['reused'], 1)
        self.path.write_bytes(b'changed-native-source')
        self.assertEqual(run()['reused'], 0)
        self.assertEqual(index.records[str(self.path.resolve())]['pixel_size_nm'], .125)


if __name__ == '__main__':
    unittest.main()
