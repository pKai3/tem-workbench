"""Persistent figure metadata preprocessing across folder scans."""
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from PIL import Image

from tem_workbench.figures import creator
from tem_workbench.figures.index import FigureMetadataIndex


class FigureMetadataIndexTests(unittest.TestCase):
    def test_project_preprocessing_excludes_output_images(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / 'output'; output.mkdir()
            Image.new('RGB', (80, 60), '#888888').save(root / 'source.png')
            Image.new('RGB', (80, 60), '#777777').save(output / 'export.png')
            index = FigureMetadataIndex(output / 'index.json')
            index.start(root, outputs=[output])
            index.thread.join(timeout=15)
            self.assertEqual(index.status(root)['state'], 'complete')
            self.assertEqual(index.status(root)['total'], 1)
            self.assertEqual(set(index.status(root)['records']), {str((root / 'source.png').resolve())})

    def test_selected_worker_count_processes_images_concurrently(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for number in range(4):
                Image.new('RGB', (80, 60), '#777777').save(root / f'{number}.png')
            index = FigureMetadataIndex(root / 'index.json')
            original = creator.inspect_image
            lock = threading.Lock()
            active = maximum = 0

            def inspect(path):
                nonlocal active, maximum
                with lock:
                    active += 1
                    maximum = max(maximum, active)
                try:
                    time.sleep(.04)
                    return original(path)
                finally:
                    with lock:
                        active -= 1

            with patch('tem_workbench.figures.creator.inspect_image', side_effect=inspect):
                index.start(root, workers=3)
                index.thread.join(timeout=15)
            self.assertEqual(index.status(root)['state'], 'complete')
            self.assertEqual(index.status(root)['workers'], 3)
            self.assertGreaterEqual(maximum, 2)

    def test_preprocess_persists_reuses_and_refreshes_changed_images(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'images'
            nested = source / 'sample'
            nested.mkdir(parents=True)
            first = source / 'A_8k_5kV.png'
            second = nested / 'B_15k_15kV.png'
            Image.new('RGB', (80, 60), '#777777').save(first)
            Image.new('RGB', (80, 60), '#999999').save(second)
            index_path = root / 'output' / 'image-metadata-index.json'
            index = FigureMetadataIndex(index_path)
            index.start(source)
            index.thread.join(timeout=15)
            first_run = index.status(source)
            self.assertEqual((first_run['state'], first_run['done'], first_run['reused']), ('complete', 2, 0))
            self.assertEqual(first_run['records'][str(first.resolve())]['metadata'], {})
            self.assertEqual(first_run['records'][str(second.resolve())]['metadata'], {})
            self.assertTrue(index_path.is_file())

            reopened = FigureMetadataIndex(index_path)
            reopened.start(source)
            reopened.thread.join(timeout=15)
            self.assertEqual(reopened.status(source)['reused'], 2)
            reopened.start(source, force=True)
            reopened.thread.join(timeout=15)
            self.assertEqual(reopened.status(source)['reused'], 0)
            reopened.records[str(first.resolve())]['inspection_version'] = creator.INSPECTION_VERSION - 1
            reopened.start(source)
            reopened.thread.join(timeout=15)
            self.assertEqual(reopened.status(source)['reused'], 1)
            self.assertEqual(reopened.records[str(first.resolve())]['inspection_version'], creator.INSPECTION_VERSION)
            Image.new('RGB', (80, 60), '#333333').save(second)
            reopened.start(source)
            reopened.thread.join(timeout=15)
            self.assertEqual(reopened.status(source)['reused'], 1)
            self.assertEqual(len(reopened.status(source)['records']), 2)


if __name__ == '__main__':
    unittest.main()
