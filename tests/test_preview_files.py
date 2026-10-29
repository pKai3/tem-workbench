"""Preview generation preserves source files and skips existing sidecars."""
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import numpy as np
from PIL import Image
from engine import Engine
from preview_files import PreviewBatch, sidecar_path


class PreviewChecks(unittest.TestCase):
    def test_nested_catalog_generation_and_existing_previews(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            data = root/'data';data.mkdir()
            sample = data/'ST';sample.mkdir()
            output = data/'results';output.mkdir()
            for path in (data/'one.dm4', sample/'two.dm4', output/'ignored.dm4'):
                path.write_bytes(b'original source')
            existing = (sample/'two.PNG');existing.write_bytes(b'existing preview')
            engine = Engine(dict(data_root=str(data), output_root=str(output)))
            rows = engine.catalog()
            self.assertEqual(set(engine.files), {'one.dm4', 'ST/two.dm4'})
            raw = np.arange(64*96, dtype=float).reshape(64, 96)
            with patch.object(engine, 'read_dm4', return_value=(raw, {})) as read:
                batch = PreviewBatch(engine.files, engine.file_preview, data)
                batch.run()
            self.assertEqual(batch.status()['created'], 1)
            self.assertEqual(batch.status()['skipped'], 1)
            self.assertEqual(read.call_count, 1)
            self.assertEqual(existing.read_bytes(), b'existing preview')
            self.assertEqual((data/'one.dm4').read_bytes(), b'original source')
            with Image.open(data/'one.png') as image:
                self.assertEqual(image.size, (96, 64))
            self.assertFalse((output/'ignored.png').exists())
            self.assertTrue(next(r for r in engine.catalog() if r['id']=='one.dm4')['has_preview'])
            self.assertEqual(engine.loaded, {})

    def test_diffraction_preview_does_not_estimate_or_fit_and_limits_size(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();source=root/'diffraction.dm4';source.touch()
            engine=Engine(dict(data_root=str(root)));engine.catalog()
            raw=np.linspace(0, 10000, 1600*800, dtype=np.float32).reshape(1600, 800)
            meta={f'Calibrations Dimension {d} Units':'1/nm' for d in (1,2)}
            with patch.object(engine,'read_dm4',return_value=(raw,meta)), patch('engine.diffraction.estimate_center',side_effect=AssertionError('should not run')):
                preview=engine.file_preview(source.name)
            with Image.open(BytesIO(preview)) as image:
                self.assertEqual(image.size,(700,1400))
                self.assertEqual(image.mode,'L')
            self.assertEqual(engine.loaded,{})

    def test_error_does_not_stop_batch_or_create_preview(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);files={name:root/(name+'.dm4') for name in ('bad','good')}
            def render(name):
                if name=='bad':raise ValueError('unreadable image')
                return b'preview bytes'
            batch=PreviewBatch(files,render,root);batch.run();status=batch.status()
            self.assertEqual((status['state'],status['created'],status['failed'],status['processed']),('complete',1,1,2))
            self.assertEqual((root/'good.png').read_bytes(),b'preview bytes')
            self.assertFalse((root/'bad.png').exists())
            self.assertIn('bad: unreadable image',status['errors'])

    def test_cancel_and_file_created_during_render_are_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'sample.dm4'
            render=Mock(return_value=b'preview')
            batch=PreviewBatch({'one':source},render,root);batch.cancel.set();batch.run()
            self.assertEqual(batch.status()['state'],'cancelled');render.assert_not_called()
            def concurrent_preview(_):
                source.with_suffix('.png').write_bytes(b'another program')
                return b'new bytes'
            batch=PreviewBatch({'one':source},concurrent_preview,root);batch.run()
            self.assertEqual(batch.status()['skipped'],1)
            self.assertEqual(sidecar_path(source).read_bytes(),b'another program')

    def test_existing_sidecar_symlink_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'one.dm4';destination=root/'one.png'
            destination.symlink_to(root/'missing-target')
            render=Mock();batch=PreviewBatch({'one':source},render,root);batch.run()
            render.assert_not_called();self.assertTrue(destination.is_symlink())
            self.assertFalse((root/'missing-target').exists())


if __name__=='__main__':unittest.main()
