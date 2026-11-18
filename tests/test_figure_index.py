"""Persistent figure metadata preprocessing across folder scans."""
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from tem_workbench.figures.index import FigureMetadataIndex


class FigureMetadataIndexTests(unittest.TestCase):
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
            Image.new('RGB', (80, 60), '#333333').save(second)
            reopened.start(source)
            reopened.thread.join(timeout=15)
            self.assertEqual(reopened.status(source)['reused'], 1)
            self.assertEqual(len(reopened.status(source)['records']), 2)


if __name__ == '__main__':
    unittest.main()
