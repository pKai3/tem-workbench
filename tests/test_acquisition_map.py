"""The acquisition map reads metadata only, preserving raw stage coordinates."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from acquisition_map import MetadataIndex, describe, stage_position


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

if __name__ == '__main__': unittest.main()
