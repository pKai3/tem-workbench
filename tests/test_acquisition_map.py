"""The acquisition map reads metadata only, preserving raw stage coordinates."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from acquisition_map import MetadataIndex, describe, stage_position, reference_crop
from io import BytesIO
import numpy as np
from PIL import Image


def metadata():
    return {'Microscope Info Stage Position Stage X': 0,
            'Microscope Info Stage Position Stage Y': -394.2,
            'Calibrations Dimension 1 Units': 'nm', 'Calibrations Dimension 2 Units': 'nm',
            'Calibrations Dimension 1 Scale': .01, 'Calibrations Dimension 2 Scale': .02}


class AcquisitionMetadata(unittest.TestCase):
    def test_zero_position_and_missing_units_are_preserved(self):
        row = describe(metadata(), 400, 200)
        self.assertEqual(row['field_nm'], [4, 4])
        self.assertEqual(row['stage_position']['x'], 0)
        self.assertIsNone(row['stage_position']['units'])
        self.assertIsNone(stage_position({})['x'])
        json.dumps(row, allow_nan=False)

    def test_invalid_positions_and_reciprocal_calibration(self):
        m = metadata()
        m['Microscope Info Stage Position Stage X'] = float('nan')
        m['Calibrations Dimension 1 Units'] = '1/nm'
        m['Calibrations Dimension 2 Units'] = '1/nm'
        row = describe(m, 4096, 4096)
        self.assertIsNone(row['field_nm'])
        self.assertIsNone(row['stage_position']['x'])
        self.assertEqual(row['image_kind'], 'diffraction_or_uncalibrated')

    def test_metadata_cache_never_reads_pixels_and_invalidates(self):
        calls = []
        class FakeDM:
            numObjects = 2
            xSize = [128, 400]
            ySize = [128, 200]
            def __init__(self, path, on_memory): calls.append(path)
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def getMetadata(self, index): return metadata()
            def getDataset(self, index): raise AssertionError('Pixels must not be read')
        with TemporaryDirectory() as d:
            path = Path(d)/'test.dm4';path.write_bytes(b'a')
            index = MetadataIndex();reader = SimpleNamespace(fileDM=FakeDM)
            self.assertEqual(index.read(path, reader)['field_nm'], [4, 4])
            index.read(path, reader)
            self.assertEqual(len(calls), 1)
            path.write_bytes(b'changed')
            index.read(path, reader)
            self.assertEqual(len(calls), 2)

class ReferenceCrop(unittest.TestCase):
    def setUp(self):
        self.array = np.arange(100, dtype=float).reshape(10, 10)

    def crop(self, **bounds):
        return np.asarray(Image.open(BytesIO(reference_crop(self.array, bounds))))

    def test_original_pixels_and_full_reference_contrast(self):
        lo, hi = np.percentile(self.array, [.3, 99.7])
        expected = np.uint8(np.clip((self.array-lo)/(hi-lo), 0, 1)*255)
        np.testing.assert_array_equal(self.crop(x=.2, y=.3, w=.3, h=.4), expected[3:7, 2:5])

    def test_outside_padding_and_bounded_size(self):
        crop = self.crop(x=-.2, y=0, w=.4, h=.4)
        self.assertEqual(crop.shape, (4, 4))
        self.assertFalse(crop[:, :2].any())
        self.assertTrue(crop[:, 2:].any())
        image = self.crop(x=-1, y=-1, w=1000, h=500)
        self.assertEqual(image.shape, (384, 768))

    def test_invalid_bounds_rejected(self):
        for key, value in [('x', float('nan')), ('w', 0), ('h', -1), ('y', float('inf'))]:
            bounds = dict(x=0, y=0, w=1, h=1); bounds[key] = value
            with self.assertRaises(ValueError): self.crop(**bounds)

if __name__ == '__main__': unittest.main()
