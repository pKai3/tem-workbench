"""Independent counts and corruption checks for native spectrum tile groups."""
import struct
import sqlite3
import tempfile
import unittest
import uuid
from contextlib import closing
from pathlib import Path

import lzokay
import numpy as np

from tem_workbench.aztec.h5oina import AztecReadError
from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.native import NativeProjectReader
from tem_workbench.aztec.native_tiles import MAGIC, decode_spectra
from tests.test_aztec_browser import blob, native_fixture


def tile(values):
    samples, channels = values.shape
    records = bytearray()
    for channel in range(channels):
        column = values[:, channel]
        maximum = int(column.max())
        bits = next((size for size in (1, 2, 4, 8) if maximum < 1 << size), 16) if maximum else 0
        words = samples * bits // 32 + 1 if bits else 0
        records.extend(struct.pack('<IIIIIIBI', 1, channel, 1, bits, (1 << bits)-1,
                                   int(column.sum()), 1, words))
        if bits:
            digits = ((column[:, None] >> np.arange(bits)) & 1).astype(np.uint8)
            packed = np.packbits(digits.ravel(), bitorder='little').tobytes()
            records.extend(packed.ljust(words * 4, b'\0'))
    compressed = lzokay.compress(bytes(records))
    return MAGIC + b'\x03LZO' + struct.pack('<II', len(records), len(compressed)) + compressed


class NativeTileTests(unittest.TestCase):
    def test_mixed_channel_widths_and_word_padding(self):
        count = 40
        values = np.stack([np.zeros(count), np.arange(count) % 2, np.arange(count) % 4,
                           np.arange(count) % 16, np.arange(count) % 41], axis=1).astype(np.int32)
        np.testing.assert_array_equal(decode_spectra(tile(values), count), values)

    def test_truncated_or_inconsistent_tiles_are_rejected(self):
        values = np.arange(40, dtype=np.int32).reshape(40, 1)
        encoded = tile(values)
        with self.assertRaisesRegex(AztecReadError, 'truncated'):
            decode_spectra(encoded[:-1], 40)
        with self.assertRaisesRegex(AztecReadError, 'read limit'):
            decode_spectra(encoded, 40, max_bytes=16)
        damaged = bytearray(encoded)
        damaged[21] = 9
        with self.assertRaisesRegex(AztecReadError, 'Unsupported'):
            decode_spectra(bytes(damaged), 40)

    def test_native_reader_uses_only_its_declared_companion_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'Project.oipx'
            ids = native_fixture(path)
            smart, group, tile_id = (str(uuid.uuid4()) for _ in range(3))
            with closing(sqlite3.connect(path)) as connection, connection:
                parent = connection.execute('SELECT Id FROM DataNodes WHERE AssociatedId=?',
                                            (ids['MapAcquires'],)).fetchone()[0]
                for table, ident, payload in (
                    ('SmartLines', smart, b'raw line'),
                    ('FileGroups', group, ('\n'.join([smart+'live.dat', smart+'real.dat',
                                                      tile_id+'.dat'])).encode()),
                ):
                    connection.execute(f'CREATE TABLE {table}(EntityId TEXT PRIMARY KEY, Label TEXT, ObjectBlob BLOB)')
                    connection.execute(f'INSERT INTO {table} VALUES(?,?,?)', (ident, table, payload))
                    connection.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)',
                                       (str(uuid.uuid4()), parent, ident, 1, 0))
            values = np.stack([np.arange(40) % 4, np.arange(40) % 16,
                               np.arange(40) % 8, np.arange(40) % 2], axis=1).astype(np.int32)
            label = b'Line Sum Spectrum'
            sum_payload = (struct.pack('<I', 2) + uuid.UUID(ids['EDXSpectra']).bytes_le
                           + struct.pack('<I', 1) + b'\0' + bytes([len(label)]) + label
                           + struct.pack('<I', values.shape[1])
                           + values.sum(axis=0).astype('<i4').tobytes()
                           + struct.pack('<dd', 10., -200.) + b'\1'*4)
            with closing(sqlite3.connect(path)) as connection, connection:
                connection.execute('UPDATE EDXSpectra SET Label=?, ObjectBlob=? WHERE EntityId=?',
                                   ('Line Sum Spectrum', blob(sum_payload), ids['EDXSpectra']))
            data = path.parent/'data'
            (data/(smart+'live.dat')).write_bytes(np.full(40, .13, dtype='<f4').tobytes())
            (data/(smart+'real.dat')).write_bytes(np.full(40, .14, dtype='<f4').tobytes())
            (data/(tile_id+'.dat')).write_bytes(tile(values))
            reader = NativeProjectReader(path)
            decoded = reader.raw_line_spectra('/SmartLines/'+smart)
            np.testing.assert_array_equal(decoded['spectra'], values)
            np.testing.assert_allclose(decoded['live_time'], .13)
            window = reader.preview('/SmartLines/'+smart, energy_low=-.19, energy_high=-.18)
            np.testing.assert_allclose(window['y'], values[:, 1:3].sum(axis=1) / .13, rtol=1e-5)
            with self.assertRaisesRegex(AztecReadError, 'energy window'):
                reader.preview('/SmartLines/'+smart, energy_low=-.17, energy_high=-.2)
            browser = AztecBrowser()
            opened = browser.open(path)
            shown = browser.preview(opened['id'], '/SmartLines/'+smart)
            self.assertTrue(shown['spectrum_image'].startswith('data:image/png;base64,'))
            self.assertEqual(len(shown['y']), 40)


if __name__ == '__main__':
    unittest.main()
