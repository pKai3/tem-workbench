"""Native composition planes stay separate, bounded, registered and exportable."""
import base64
from contextlib import closing
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
import uuid
from zipfile import ZipFile

import numpy as np

from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.h5oina import AztecReadError, SourceChangedError
from tem_workbench.aztec.native import NativeProjectReader
from tests.test_aztec_browser import blob, native_fixture
from tests.test_aztec_geometry import area, core


def add_geometry(path, ids):
    with closing(sqlite3.connect(path)) as con, con:
        con.execute('CREATE TABLE AreaOfInterests(AreaOfInterestId TEXT PRIMARY KEY COLLATE NOCASE, ObjectBlob BLOB)')
        for table in ('ElectronImages', 'SmartMaps'):
            ident = str(uuid.uuid4())
            con.execute('INSERT INTO AreaOfInterests VALUES(?,?)', (ident, area('FullFieldRegion', [.25, .25, .5, .25])))
            data = con.execute(f'SELECT ObjectBlob FROM {table}').fetchone()[0]
            if table == 'ElectronImages':
                data = data.replace(struct.pack('<III', 2, 4, 2) + b'\0' * 24,
                                    struct.pack('<III3d', 2, 4, 2, .125, .25, .25))
            con.execute(f'UPDATE {table} SET ObjectBlob=?', (core(ident) + data,))


def quant_fixture(path, *, fields=(3, 0, 1, 4), width=4, height=2):
    ids = native_fixture(path)
    ident = str(uuid.uuid4()); label = 'SEM Map Quant Results'
    text = label.encode()
    header = (struct.pack('<I', 2) + uuid.UUID(ident).bytes_le + b'\x01\0\0\0\0'
              + bytes([len(text)]) + text + struct.pack('<III', 1, 43, 1) + uuid.uuid4().bytes_le)
    for items in ((13, 22), (1, 1), fields):
        header += struct.pack('<I', len(items)) + struct.pack('<' + 'I' * len(items), *items)
    header += struct.pack('<III', width, height, 1) + uuid.UUID(ident).bytes_le
    payload = b'@\x0cQuantMapData' + blob(header)
    with closing(sqlite3.connect(path)) as con, con:
        con.execute('CREATE TABLE QuantMapData(QuantMapDataId TEXT PRIMARY KEY COLLATE NOCASE, InstanceVersion INTEGER, Label TEXT, ObjectBlob BLOB)')
        con.execute('INSERT INTO QuantMapData VALUES(?,?,?,?)', (ident, 1, label, payload))
        parent = con.execute('SELECT Id FROM DataNodes WHERE AssociatedId=?', (ids['MapAcquires'],)).fetchone()[0]
        con.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)', (str(uuid.uuid4()), parent, ident, 1, 0))
    expected = {}
    for z in (13, 22):
        values = {0: (np.arange(8, dtype='<f4') + 1).reshape(2, 4) * (1 if z == 13 else 2),
                  1: (np.arange(8, dtype='<f4') + .25).reshape(2, 4) * (2 if z == 13 else 3),
                  3: np.full((2, 4), -999, dtype='<f4'), 4: np.full((2, 4), 12345, dtype='<f4')}
        expected[z] = values
        np.stack([values[field] for field in fields]).astype('<f4').tofile(path.parent / 'data' / f'{ident}_{z}.dat')
    return ids, ident, expected


class QuantificationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.path = self.root / 'Project.oipx'
        self.ids, self.ident, self.expected = quant_fixture(self.path)
        self.dataset = '/QuantMapData/' + self.ident

    def test_stored_planes_are_exact_and_source_is_unchanged(self):
        paths = [self.path, *self.root.glob('data/*')]
        hashes = {p: hashlib.sha256(p.read_bytes()).digest() for p in paths}
        reader = NativeProjectReader(self.path)
        for measure, field, unit in [('weight', 0, 'wt%'), ('atomic', 1, 'at%')]:
            result = reader.preview(self.dataset, quant_measure=measure)
            self.assertEqual((result['shape'], result['unit']), ([2, 4], unit))
            self.assertEqual(result['undecoded_fields'], [3, 4])
            for channel in result['channels']:
                np.testing.assert_array_equal(channel['array'], self.expected[channel['atomic_number']][field])
        self.assertEqual(hashes, {p: hashlib.sha256(p.read_bytes()).digest() for p in paths})

    def test_field_order_is_read_from_header(self):
        other = self.root / 'reordered'; other.mkdir()
        _, ident, expected = quant_fixture(other / 'Other.oipx', fields=(1, 4, 0, 3))
        result = NativeProjectReader(other / 'Other.oipx').preview('/QuantMapData/' + ident)
        np.testing.assert_array_equal(result['channels'][0]['array'], expected[13][0])

    def test_atomic_only_record_selects_its_available_unit(self):
        other = self.root / 'atomic'; other.mkdir()
        _, ident, expected = quant_fixture(other / 'Other.oipx', fields=(1, 4))
        result = NativeProjectReader(other / 'Other.oipx').preview('/QuantMapData/' + ident)
        self.assertEqual(result['measure'], 'atomic')
        np.testing.assert_array_equal(result['channels'][0]['array'], expected[13][1])

    def test_browser_keeps_full_resolution_float32_and_units(self):
        browser = AztecBrowser(); opened = browser.open(self.path)
        result = browser.preview(opened['id'], self.dataset, quant_measure='atomic')
        json.dumps(result, allow_nan=False)
        channel = result['channels'][0]
        values = np.frombuffer(base64.b64decode(channel['values_base64']), '<f4').reshape(2, 4)
        np.testing.assert_array_equal(values, self.expected[13][1])
        self.assertEqual(channel['mean'], float(values.mean()))
        self.assertTrue(channel['image'].startswith('data:image/png;base64,'))

    def test_missing_and_truncated_companions_are_visible_per_element(self):
        (self.root / 'data' / f'{self.ident}_13.dat').unlink()
        (self.root / 'data' / f'{self.ident}_22.dat').write_bytes(b'\0' * 12)
        result = NativeProjectReader(self.path).preview(self.dataset)
        self.assertIn('missing', result['channels'][0]['error'])
        self.assertIn('size', result['channels'][1]['error'])

    def test_changed_companion_requires_reopen(self):
        reader = NativeProjectReader(self.path); reader.inspect()
        path = self.root / 'data' / f'{self.ident}_13.dat'
        info = path.stat(); os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000))
        with self.assertRaises(SourceChangedError):
            reader.preview(self.dataset)

    def test_symlink_is_not_followed(self):
        path = self.root / 'data' / f'{self.ident}_13.dat'; target = self.root / 'linked.dat'
        path.rename(target)
        try:
            path.symlink_to(target)
        except OSError:
            self.skipTest('Symlinks unavailable')
        channel = NativeProjectReader(self.path).preview(self.dataset)['channels'][0]
        self.assertIn('Linked', channel['error'])

    def replace_payload(self, payload):
        with closing(sqlite3.connect(self.path)) as con, con:
            con.execute('UPDATE QuantMapData SET ObjectBlob=?', (b'@\x0cQuantMapData' + blob(payload),))

    def payload(self):
        from tem_workbench.aztec.native import blob_payloads
        with closing(sqlite3.connect(self.path)) as con:
            return next(blob_payloads(con.execute('SELECT ObjectBlob FROM QuantMapData').fetchone()[0]))

    def test_future_version_retains_metadata(self):
        payload = self.payload(); self.replace_payload(struct.pack('<I', 999) + payload[4:])
        reader = NativeProjectReader(self.path)
        self.assertEqual(reader.preview(self.dataset)['kind'], 'metadata')
        self.assertFalse(any(d['path'].startswith('/QuantMapImages/') for d in reader.inspect()['datasets']))

    def test_malformed_supported_headers_are_rejected(self):
        payload = self.payload()
        for broken in (payload[:-1], payload[:4] + uuid.uuid4().bytes_le + payload[20:],
                       payload[:-28] + struct.pack('<III', 2**32 - 1, 2, 1) + payload[-16:],
                       payload[:-28] + struct.pack('<III', 0, 2, 1) + payload[-16:]):
            with self.subTest(size=len(broken)):
                self.replace_payload(broken)
                with self.assertRaises(AztecReadError):
                    NativeProjectReader(self.path).preview(self.dataset)

    def test_invalid_measure_is_not_reinterpreted(self):
        with self.assertRaises(AztecReadError):
            NativeProjectReader(self.path).preview(self.dataset, quant_measure='counts')

    def test_comparison_families_use_stored_composition_and_registration(self):
        add_geometry(self.path, self.ids)
        browser = AztecBrowser(); opened = browser.open(self.path)
        for family, field, unit in [('QuantMapImages', 0, 'wt%'), ('AtomicMapImages', 1, 'at%')]:
            reader = browser._readers[opened['id']]
            channels = [r for r in reader._records.values() if r['table'] == family]
            self.assertEqual(len(channels), 2)
            for r in channels:
                np.testing.assert_array_equal(reader.preview(r['path'])['array'], self.expected[r['element']][field])
            options = dict(acquisitions=[self.ids['MapAcquires']], channel_table=family,
                           mode='signal', signals=['Al'], smoothing=0, normalisation='none')
            result = browser.process(opened['id'], options)
            row = result['rows'][0]
            self.assertEqual((row['kind'], row['data_kind']), ('map', 'composition'))
            self.assertEqual(row['tiles'][0]['unit'], unit)
            self.assertIn('width', row)
            exported = browser.process(opened['id'], dict(options, export_data=True))
            with ZipFile(BytesIO(base64.b64decode(exported['data']))) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                original = next(d for d in manifest['datasets'] if d['operation'] == 'original')
                self.assertEqual(original['unit'], unit)
                np.testing.assert_array_equal(np.loadtxt(BytesIO(archive.read(original['file'])), delimiter=','), self.expected[13][field])

    def test_cross_file_composition_ratios_retain_units(self):
        add_geometry(self.path, self.ids)
        other = self.root / 'second'; other.mkdir(); other_path = other / 'Second.oipx'
        ids, _, _ = quant_fixture(other_path); add_geometry(other_path, ids)
        browser = AztecBrowser(); opened = browser.open(self.path)
        for family in ('QuantMapImages', 'AtomicMapImages'):
            result = browser.process(opened['id'], dict(comparison=True,
                        targets=[dict(source=str(self.path), acquisition=self.ids['MapAcquires']),
                                 dict(source=str(other_path), acquisition=ids['MapAcquires'])],
                        channel_table=family, mode='ratio', denominator='Ti', signals=['Al'],
                        smoothing=0, smoothing_unit='px', normalisation='none'))
            self.assertEqual(len(result['rows']), 2)
            for row in result['rows']:
                self.assertEqual(row['data_kind'], 'composition')
                self.assertEqual(row['tiles'][0]['unit'], 'Composition ratio')


if __name__ == '__main__':
    unittest.main()
