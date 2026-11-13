"""Synthetic point/line/map exports and distinct acquired/processed EBSD layers."""
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import h5py
import numpy as np

from tem_workbench.aztec import AztecReadError, H5OinaReader, SourceChangedError
from tem_workbench.aztec.__main__ import main


def value(group, name, data, unit=None):
    if isinstance(data, str):
        data = np.asarray([data], dtype=h5py.string_dtype('utf-8'))
    elif np.isscalar(data):
        data = [data]
    ds = group.create_dataset(name, data=data)
    if unit:
        ds.attrs['Unit'] = unit
    return ds


def header(file, path, x, y):
    group = file.require_group(path + '/Header')
    value(group, 'X Cells', x, 'px'); value(group, 'Y Cells', y, 'px')
    value(group, 'X Step', .1, 'um'); value(group, 'Y Step', .1 if y > 1 else 0., 'um')
    value(group, 'Analysis Unique Identifier', 'synthetic-' + path.split('/')[0])
    value(group, 'Analysis Label', 'Spectrum α ' + path.split('/')[0])
    value(group, 'Project Label', 'Synthetic project')
    value(group, 'Specimen Label', 'Synthetic specimen')
    value(group, 'Site Label', 'Synthetic site')
    return group


def fixture(path):
    with h5py.File(path, 'w') as file:
        value(file, 'Format Version', '8.0')
        value(file, 'Manufacturer', 'Oxford Instruments')
        value(file, 'Software Version', '6.3')
        index = value(file, 'Index', [1, 2, 3]); index.attrs['Type'] = 'Single'
        for i, x, y, rows in ((1, 1, 1, 1), (2, 3, 1, 8), (3, 2, 2, 16)):
            group = header(file, f'{i}/EDS', x, y)
            value(group, 'Start Channel', -200., 'eV')
            value(group, 'Channel Width', 10., 'eV')
            value(group, 'Number Channels', 8)
            value(group, 'Binning', 2 if i > 1 else 1)
            data = file.require_group(f'{i}/EDS/Data')
            value(data, 'Spectrum', np.arange(rows * 8, dtype=np.int32).reshape(rows, 8), 'count')
            signal = value(data, 'Window Integral/V Kα1', np.arange(x*y, dtype=np.float32), 'cps')
            signal.attrs.update({'Atomic Number': 23, 'X-ray Line': 'Kα1'})
            value(data, 'X', np.arange(x*y, dtype=np.float32), 'um')
            value(data, 'Y', np.zeros(x*y, dtype=np.float32), 'um')
        # Separate acquisition and cleanup states, even when the folder is called uncleaned.
        group = header(file, '3/EBSD', 2, 2)
        value(group, 'Phases/1/Phase Name', 'Ti-Hex')
        value(group, 'Phases/1/Lattice Dimensions', [[2.954, 2.954, 4.729]], 'angstrom')
        value(group, 'Specimen Orientation Euler', [[0., 0., 0.]], 'rad')
        data = file.require_group('3/EBSD/Data')
        value(data, 'Phase', np.asarray([1, 2, 0, 1], dtype=np.uint8))
        value(data, 'Euler', np.arange(12, dtype=np.float32).reshape(4, 3), 'rad')
        value(data, 'Error', np.asarray([1, 1, 2, 7], dtype=np.uint8)).attrs['Replaced'] = 7
        group = file.require_group('3/Data Processing/Header')
        value(group, 'Phases/1/Phase Name', 'Processed phase definition')
        data = file.require_group('3/Data Processing/Data')
        value(data, 'Phase', np.asarray([1, 1, 1, 2], dtype=np.uint8))
        value(data, 'Euler', np.arange(12, dtype=np.float32).reshape(4, 3) / 10., 'rad')
        header(file, '3/Electron Image', 2, 2)
        value(file.require_group('3/Electron Image/Data'), 'SE/Image',
              np.asarray([-32768, -1, 0, 32767], dtype=np.int16))


class H5OinaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'uncleaned.h5oina'
        fixture(self.path)

    def test_catalogue_is_lazy_and_preserves_units_and_labels(self):
        original = h5py.Dataset.__getitem__
        def metadata_only(dataset, key):
            if '/Data/' in dataset.name:
                raise AssertionError('Catalogue loaded signal data')
            return original(dataset, key)
        with patch.object(h5py.Dataset, '__getitem__', metadata_only):
            catalogue = H5OinaReader(self.path).inspect()
        self.assertEqual(len(catalogue.acquisitions), 3)
        self.assertEqual(catalogue.acquisitions[0].label, 'Spectrum α 1')
        layer = next(v for v in catalogue.acquisitions[1].layers if v.technique == 'EDS')
        self.assertEqual(layer.grid_shape, (1, 3))
        self.assertIn('not automatically rebinned', layer.notes[0])
        signal = next(s for s in layer.signals if s.path.endswith('V Kα1'))
        self.assertEqual(signal.unit, 'cps')
        self.assertEqual(signal.attributes['Atomic Number'], 23)
        self.assertIsNone(signal.value)
        json.dumps(catalogue.to_dict(), allow_nan=False)

    def test_point_and_binned_line_map_keep_separate_sampling(self):
        reader = H5OinaReader(self.path)
        point = reader.read_grid('/1/EDS', 'Spectrum')
        self.assertEqual(point.shape, (1, 1, 8))
        for index in (2, 3):
            with self.assertRaisesRegex(AztecReadError, 'do not match'):
                reader.read_grid(f'/{index}/EDS', 'Spectrum')
        self.assertEqual(reader.read_grid('/3/EDS', 'Window Integral/V Kα1').shape, (2, 2))
        np.testing.assert_array_equal(reader.energy_axis('/1/EDS'), np.arange(8)*10 - 200)

    def test_slice_exact_values_read_limit_and_source_bytes_unchanged(self):
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        reader = H5OinaReader(self.path)
        with self.assertRaisesRegex(AztecReadError, 'read limit'):
            reader.read('/3/EDS/Data/Spectrum', max_bytes=32)
        values = reader.read('/3/EDS/Data/Spectrum', (slice(2, 4), slice(1, 5)), max_bytes=32)
        np.testing.assert_array_equal(values, np.arange(128, dtype=np.int32).reshape(16, 8)[2:4, 1:5])
        self.assertFalse(values.flags.writeable)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)
        for selection in ([1, 2], True, slice(None, None, -1), slice(0., 2), (0, 0, 0), 100):
            with self.assertRaises(AztecReadError):
                reader.read('/3/EDS/Data/Spectrum', selection)

    def test_processed_ebsd_has_distinct_data_phase_definitions_and_geometry_origin(self):
        reader = H5OinaReader(self.path)
        acquired = reader.layer('/3/EBSD'); processed = reader.layer('/3/Data Processing')
        self.assertEqual((acquired.state, processed.state), ('acquired', 'processed'))
        self.assertEqual(processed.geometry_header, '/3/EBSD/Header')
        self.assertEqual(processed.header['Phases/1/Phase Name'].value, ['Processed phase definition'])
        self.assertNotEqual(reader.read_grid('/3/EBSD', 'Phase').tolist(), reader.read_grid('/3/Data Processing', 'Phase').tolist())
        self.assertEqual(reader.read_grid('/3/EBSD', 'Euler').shape, (2, 2, 3))
        self.assertEqual(reader.layer('/3/EBSD').header['Specimen Orientation Euler'].unit, 'rad')

    def test_image_signed_storage_is_preserved(self):
        image = H5OinaReader(self.path).read_grid('/3/Electron Image', 'SE/Image')
        np.testing.assert_array_equal(image, [[-32768, -1], [0, 32767]])
        self.assertEqual(image.dtype, np.dtype('int16'))

    def test_streaming_preserves_every_spectrum_with_bounded_blocks(self):
        reader = H5OinaReader(self.path)
        blocks = list(reader.iter_rows('/3/EDS/Data/Spectrum', rows=1000, max_bytes=96))
        self.assertEqual([start for start, _ in blocks], [0, 3, 6, 9, 12, 15])
        self.assertTrue(all(values.nbytes <= 96 for _, values in blocks))
        np.testing.assert_array_equal(np.concatenate([values for _, values in blocks]),
                                      np.arange(128, dtype=np.int32).reshape(16, 8))
        with self.assertRaises(AztecReadError):
            list(reader.iter_rows('/3/EDS/Data/Spectrum', max_bytes=8))
        stream = reader.iter_rows('/3/EDS/Data/Spectrum', rows=1)
        next(stream)
        stat = self.path.stat()
        os.utime(self.path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
        with self.assertRaises(SourceChangedError): next(stream)

    def test_changed_source_requires_reopen(self):
        reader = H5OinaReader(self.path); reader.inspect()
        stat = self.path.stat()
        os.utime(self.path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
        with self.assertRaises(SourceChangedError): reader.inspect()
        with self.assertRaises(SourceChangedError): reader.read('/1/EDS/Data/Spectrum')

    def test_large_spectrum_not_materialized_and_external_links_not_followed(self):
        with h5py.File(self.path, 'a') as file:
            file['3/EDS/Data'].create_dataset('Large Spectrum', shape=(4_000_000, 2048), dtype='i4', chunks=(128, 2048))
            file['outside'] = h5py.ExternalLink('missing.h5', '/data')
            file['alias'] = h5py.SoftLink('/1/EDS/Data/Spectrum')
        reader = H5OinaReader(self.path)
        self.assertEqual(len(reader.inspect().warnings), 2)
        with self.assertRaisesRegex(AztecReadError, 'read limit'):
            reader.read('/3/EDS/Data/Large Spectrum')
        self.assertEqual(reader.read('/3/EDS/Data/Large Spectrum', (0, slice(0, 2))).tolist(), [0, 0])
        with self.assertRaises(AztecReadError): reader.read('/alias')
        with self.assertRaises(AztecReadError): reader.read('/outside')

    def test_non_h5oina_and_unsupported_versions_are_explicit(self):
        with h5py.File(self.path, 'a') as file:
            del file['Format Version']; value(file, 'Format Version', '99.0')
        with self.assertRaisesRegex(AztecReadError, 'format 8.0'):
            H5OinaReader(self.path).inspect()

    def test_nan_metadata_and_channel_mismatch(self):
        with h5py.File(self.path, 'a') as file:
            value(file['1/EDS/Header'], 'Missing angle', np.nan, 'rad')
            file['1/EDS/Header/Number Channels'][0] = 9
        reader = H5OinaReader(self.path)
        self.assertEqual(reader.layer('/1/EDS').header['Missing angle'].value, ['nan'])
        json.dumps(reader.inspect().to_dict(), allow_nan=False)
        with self.assertRaisesRegex(AztecReadError, 'Channel count'):
            reader.energy_axis('/1/EDS')

    def test_cli_catalogue_and_no_overwrite(self):
        output = Path(self.temp.name) / 'catalogue.json'
        with patch('builtins.print'):
            self.assertEqual(main([str(self.path), '--json', str(output)]), 0)
        self.assertEqual(len(json.loads(output.read_text())['files']), 1)
        before = output.read_bytes()
        with patch('builtins.print'), patch('sys.stderr', new_callable=io.StringIO), self.assertRaises(SystemExit):
            main([str(self.path), '--json', str(output)])
        self.assertEqual(before, output.read_bytes())

    def test_numbered_detectors_and_string_indices(self):
        with h5py.File(self.path, 'a') as file:
            del file['Index']
            file.create_dataset('Index', data=np.asarray(['1', '2', '3'], dtype=h5py.string_dtype()))
            file.move('1/EDS', '1/EDS1')
            file.copy('1/EDS1', '1/EDS2')
        reader = H5OinaReader(self.path)
        layers = reader.inspect().acquisitions[0].layers
        self.assertEqual([v.path for v in layers], ['/1/EDS1', '/1/EDS2'])
        self.assertTrue(all(v.technique == 'EDS' for v in layers))
        np.testing.assert_array_equal(reader.energy_axis('/1/EDS1'), reader.energy_axis('/1/EDS2'))

    def test_external_storage_and_cycles_are_not_read(self):
        with h5py.File(self.path, 'a') as file:
            file['1/EDS/Data'].create_dataset('External', shape=(8,), dtype='i4',
                                            external=[('missing.bin', 0, 32)])
        reader = H5OinaReader(self.path)
        descriptor = next(v for v in reader.inspect().datasets if v.path.endswith('/External'))
        self.assertEqual(descriptor.storage, 'external')
        with self.assertRaisesRegex(AztecReadError, 'local'):
            reader.read(descriptor.path)
        with h5py.File(self.path, 'a') as file:
            file['cycle'] = file['1']
            file['1/back'] = file['1']
        with self.assertRaisesRegex(AztecReadError, 'Cyclic'):
            H5OinaReader(self.path).inspect()
