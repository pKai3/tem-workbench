"""The acquisition map reads metadata only, preserving raw stage coordinates."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from acquisition_map import MetadataIndex, describe, stage_position, reference_crop, acquisition_batches
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
        self.assertEqual(row['image_kind'], 'diffraction')

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

class AcquisitionBatches(unittest.TestCase):
    @staticmethod
    def row(n, alpha=0., beta=0., folder='ST', date='2026-10-01', width=100):
        name=f'1MX_OneView_ST_{n}'
        return dict(id=f'{folder}/{date}/{name}', name=name, folder=folder, date=date,
                    stage_position=dict(x=1., y=2., alpha=alpha, beta=beta),
                    field_nm=[width, width] if width else None)

    def test_consecutive_equal_tilts_and_widest_reference(self):
        rows=[self.row(3),self.row(1),self.row(2,width=500)]
        groups=acquisition_batches(rows)
        self.assertEqual(len(groups),1)
        self.assertEqual(groups[0]['members'],[rows[1]['id'],rows[2]['id'],rows[0]['id']])
        self.assertEqual(groups[0]['reference_id'],rows[2]['id'])
        self.assertTrue(all(r['acquisition_batch']==groups[0]['id'] for r in rows))

    def test_changes_gaps_missing_tilts_and_return_to_old_tilt_do_not_bridge(self):
        rows=[self.row(1), self.row(2), self.row(3,alpha=1), self.row(4),
              self.row(6), self.row(7,beta=None), self.row(8,beta=None),
              self.row(9), self.row(10,beta=.000001)]
        self.assertEqual([len(g['members']) for g in acquisition_batches(rows)],[2,1,1,1,1,1,1,1])

    def test_folder_date_duplicates_and_unnumbered_are_separate(self):
        a=self.row(1);duplicate=dict(a,id=a['id']+'copy')
        rows=[a,duplicate,self.row(2),self.row(3,folder='STA'),self.row(4,date='other'),
              dict(self.row(5),name='overview'),dict(self.row(6),name='no number')]
        self.assertEqual(len(acquisition_batches(rows)),len(rows))

    def pair(self, n, **kwargs):
        result = []
        for detector in ('ADF', 'Hitachi'):
            row = self.row(n, **kwargs)
            row.update(id=row['id'].replace('OneView', detector),
                       name=row['name'].replace('OneView', detector), time='1:02:53 PM')
            result.append(row)
        return result

    def test_detector_pair_preserves_sequence_and_each_calibration(self):
        pair = self.pair(118, alpha=-10.8)
        pair[1]['field_nm'] = [200, 300]  # Pairing does not choose or overwrite calibration.
        rows = [self.row(117, alpha=-10.8), *pair, *self.pair(119, alpha=-10.8)]
        groups = acquisition_batches(list(reversed(rows)))
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]['members']), 5)
        self.assertEqual((groups[0]['first'], groups[0]['last']), (117, 119))
        self.assertEqual(pair[0]['field_nm'], [100, 100])
        self.assertEqual(pair[1]['field_nm'], [200, 300])
        self.assertEqual(groups[0]['reference_id'], pair[1]['id'])

    def test_conflicting_detector_pairs_do_not_bridge(self):
        for key, value in [('x', 3), ('alpha', 1), ('beta', None), ('time', '1:03:00 PM')]:
            with self.subTest(key=key):
                pair = self.pair(2)
                target = pair[1] if key == 'time' else pair[1]['stage_position']
                target[key] = value
                groups = acquisition_batches([self.row(1), *pair, self.row(3)])
                self.assertEqual([len(g['members']) for g in groups], [1, 1, 1, 1])

    def test_diffraction_sequence_is_retained_without_becoming_reference(self):
        rows=[self.row(1), self.row(2,width=None), self.row(3,width=500)]
        group=acquisition_batches(rows)[0]
        self.assertEqual(len(group['members']),3)
        self.assertEqual(group['reference_id'],rows[2]['id'])

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
