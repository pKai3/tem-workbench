"""Full-cycle GIF export regression checks."""
import base64
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import RLock
from types import SimpleNamespace
import unittest

from PIL import Image
from server import Workbench, SPECTRUM_MAX_FRAMES, SPECTRUM_MAX_PIXELS


class SpectrumExportTests(unittest.TestCase):
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
            app.engine = SimpleNamespace(files={'test': Path('test.dm4')})
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
