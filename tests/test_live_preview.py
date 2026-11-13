"""Fast image previews share final display fields, but do no phase fitting."""
import base64
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

import numpy as np
from PIL import Image
from tem_workbench.app.engine import Engine
from tem_workbench.app.server import Workbench
from tem_workbench.storage import folder_paths


class LivePreviewTests(TestCase):
    def test_preview_matches_completed_images_without_fitting(self):
        engine = Engine({'demo_only': True})
        y, x = np.mgrid[:256, :256]
        pixels = (np.sin(x * .83) + np.cos(y * 1.47) + .2 * np.sin((x+y)*.22)).astype('float32')
        item = dict(array=pixels, limits=(-2.2, 2.2), info=dict(id='synthetic', name='synthetic',
            image_kind='real_space', pixel_x_nm=.02, pixel_y_nm=.02, can_index=False))
        roi = dict(x=64, y=32, w=128, h=128)
        for window in ('hann', 'none', 'tukey'):
            settings = dict(fft_window=window, fft_tukey_alpha=.35, remove_mean=False, fft_smoothing_sigma=.8, g_min=2.5)
            with patch.object(engine, '_fit_spectrum', side_effect=AssertionError('Preview must not fit')), \
                 patch.object(engine, 'templates_for', side_effect=AssertionError('Preview must not build templates')):
                preview = engine.spectrum_preview(item, roi, settings)
            final = engine.analyze(item, roi, settings)
            self.assertEqual(preview['images'], final['images'])
            self.assertEqual(preview['spectrum']['extent'], final['spectrum']['extent'])
            self.assertEqual(preview['spectrum']['peaks'], final['spectrum']['peaks'])
            self.assertTrue(preview['spectrum']['peaks'])
            self.assertNotIn('classification', preview)
            self.assertNotIn('models', preview)
            image = Image.open(BytesIO(base64.b64decode(preview['images']['crop'].split(',')[1])))
            self.assertEqual(image.size, (128, 128))
        with self.assertRaises(ValueError):engine.spectrum_preview(item, {**roi, 'x':250}, {})
        item['info']['image_kind']='diffraction'
        with self.assertRaisesRegex(ValueError, 'real-space'):engine.spectrum_preview(item, roi, {})


class ProjectRenameTests(TestCase):
    def test_label_only_save_preserves_open_pixels_ids_jobs_and_paths(self):
        with TemporaryDirectory() as directory:
            root=Path(directory);images=root/'images';images.mkdir()
            Image.fromarray(np.arange(4096,dtype=np.uint16).reshape(64,64)).save(images/'sample.tif')
            app=Workbench(dict(data_root=str(images),output_root=str(root/'results')),root=root)
            row=next(iter(app.engine.file_rows.values()))
            app.engine.calibrate_raster(row['id'],dict(image_kind='real_space',units='nm',value=1,points=[[0,0],[50,0]]))
            item=app.engine.load(row['id']);engine=app.engine;pixels=item['array'];output=engine.output_for(row['id'])
            app.jobs['running']={'state':'running'}
            with patch.object(app.batch, 'running', return_value=True):
                saved=app.rename_source('primary', 'Renamed project')
            self.assertIs(app.engine,engine)
            self.assertIs(engine.loaded[row['id']],item)
            self.assertIs(item['array'],pixels)
            self.assertEqual(item['info']['source_name'],'Renamed project')
            self.assertEqual(app.jobs,{'running':{'state':'running'}})
            self.assertEqual(engine.output_for(row['id']),output)
            self.assertEqual(next(r for r in saved['files'] if r['id']==row['id'])['source_name'],'Renamed project')
            import json
            reopened=Workbench(json.loads(app.config_path.read_text()),root=root)
            self.assertEqual(reopened.engine.sources[0]['name'],'Renamed project')
            self.assertIn(row['id'],reopened.engine.file_rows)
            before=app.config_path.read_bytes()
            for name in ('', '../other', 'a/b'):
                with self.assertRaises(ValueError):app.rename_source('primary',name)
            with patch('tem_workbench.storage.folder_paths.atomic_json',side_effect=OSError('disk full')):
                with self.assertRaises(OSError):app.rename_source('primary','Not saved')
            self.assertEqual(app.config_path.read_bytes(),before)
            self.assertEqual(engine.sources[0]['name'],'Renamed project')
