"""Full-cycle GIF export regression checks."""
import base64
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import RLock
from types import SimpleNamespace
import unittest

import numpy as np
from tem_workbench.app.engine import Engine
from PIL import Image
from tem_workbench.app.server import Workbench, SPECTRUM_MAX_FRAMES, SPECTRUM_MAX_PIXELS


class SpectrumExportTests(unittest.TestCase):
    def test_native_real_space_crop(self):
        pixels = np.arange(1000 * 1000, dtype=float).reshape(1000, 1000)
        item = {'array': pixels, 'limits': (0, 999999),
                'info': {'name': 'sample 1203', 'image_kind': 'real_space'}}
        with TemporaryDirectory() as directory:
            app = Workbench.__new__(Workbench)
            app.lock = RLock()
            app.config = {'output_root': directory}
            app.engine = SimpleNamespace(output_for=lambda _: Path(directory), load=lambda _: item,
                region_preview=lambda item, roi, max_size: Engine.region_preview(None, item, roi, max_size))
            body = {'file_id': 'sample', 'roi': {'x': 20, 'y': 30, 'w': 900, 'h': 850}}
            saved = app.export_crop(body)
            self.assertIn('real_space_x20_y30_900x850', saved['path'])
            with Image.open(saved['path']) as image:
                self.assertEqual(image.size, (900, 850))
                expected = (pixels[30:880, 20:920] / 999999 * 255).astype(np.uint8)
                np.testing.assert_array_equal(np.array(image), expected)
            with self.assertRaises(ValueError):
                app.export_crop({**body, 'roi': {**body['roi'], 'x': 999}})
            item['info']['image_kind'] = 'diffraction'
            with self.assertRaisesRegex(ValueError, 'real-space'):
                app.export_crop(body)

    def test_full_rotation_cycle(self):
        frames = []
        for index in range(72):
            image = Image.new('RGB', (16, 16), 'black')
            image.putpixel((index % 16, index // 16), (255, 255, 255))
            stream = BytesIO()
            image.save(stream, format='PNG')
            frames.append('data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode())
        durations = [30, 40, 30] * 24
        with TemporaryDirectory() as directory:
            app = Workbench.__new__(Workbench)
            app.lock = RLock()
            app.config = {'output_root': directory}
            app.engine = SimpleNamespace(output_for=lambda _: Path(directory), files={'test': Path('test.dm4')})
            body = dict(file_id='test', format='gif', frames=frames, duration_ms=durations)
            saved = app.export_spectrum(body)
            with Image.open(saved['path']) as gif:
                self.assertEqual(gif.n_frames, 72)
                elapsed = 0
                for index in range(gif.n_frames):
                    gif.seek(index)
                    elapsed += gif.info['duration']
                self.assertEqual(elapsed, 2400)
            with self.assertRaisesRegex(ValueError, 'at most 72 frames'):
                app.export_spectrum({**body, 'frames': frames + [frames[0]]})
        self.assertGreaterEqual(SPECTRUM_MAX_FRAMES, 72)
        self.assertGreaterEqual(SPECTRUM_MAX_PIXELS, 72 * 2800 * round(2800 * 452 / 464))


if __name__ == '__main__':
    unittest.main()
