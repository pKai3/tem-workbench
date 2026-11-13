"""Native browsing stays separate from decoding, with bounded read-only previews."""
import hashlib
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
import uuid
from unittest.mock import patch

import numpy as np

from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.h5oina import AztecReadError, SourceChangedError
from tem_workbench.aztec.native import NativeProjectReader, blob_payloads
from tests.test_aztec_h5oina import fixture as h5fixture


def blob(payload):
    return b'@\x04Blob\xa3' + struct.pack('<I', len(payload)) + payload


def native_fixture(path):
    ids = {key: str(uuid.uuid4()) for key in ('Project', 'Samples', 'Analyses', 'MapAcquires', 'SmartMaps',
                                            'XrayMapImages', 'ElectronImages', 'XrayLinescans', 'EDXSpectra')}
    with closing(sqlite3.connect(path)) as con, con:
        con.execute('CREATE TABLE DataNodes(Id TEXT PRIMARY KEY, ParentId TEXT, AssociatedId TEXT, AssociatedType INTEGER, ItemOrder INTEGER)')
        nodes = {key: str(uuid.uuid4()) for key in ids}
        for key, ident in ids.items():
            con.execute(f'CREATE TABLE {key}(EntityId TEXT PRIMARY KEY COLLATE NOCASE, Label TEXT, Version TEXT, ObjectBlob BLOB)')
            label = {'Project':'Test project', 'Samples':'Specimen A', 'Analyses':'Site', 'MapAcquires':'Map 1',
                     'SmartMaps':'EDS Data', 'XrayMapImages':'V Kα1', 'ElectronImages':'Image 1',
                     'XrayLinescans':'V Kα1', 'EDXSpectra':'Sum spectrum'}[key]
            payload = b'undecoded'
            if key in ('XrayMapImages', 'ElectronImages'):
                text = label.encode()
                data = b'\x06\0\0\0\0'+bytes([len(text)])+text
                data += struct.pack('<III', 4 if key=='XrayMapImages' else 2, 4, 2) + b'\0'*24 + uuid.UUID(ident).bytes_le
                payload = blob(data)
            if key == 'XrayLinescans':
                text=label.encode()
                payload=blob(struct.pack('<I',1)+uuid.UUID(ident).bytes_le+struct.pack('<I',1)+b'\0'+bytes([len(text)])+text+struct.pack('<I',4)+np.arange(4,dtype='<f4').tobytes())
            con.execute(f'INSERT INTO {key} VALUES(?,?,?,?)',(ident,label,'200.0',payload))
            parent = {'Project':None,'Samples':'Project','Analyses':'Samples','MapAcquires':'Analyses',
                      'SmartMaps':'MapAcquires','XrayMapImages':'SmartMaps','XrayLinescans':'MapAcquires',
                      'ElectronImages':'Analyses','EDXSpectra':'MapAcquires'}[key]
            con.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)',(nodes[key],nodes[parent] if parent else '',ident,1,0))
    (path.parent/'data').mkdir()
    np.arange(8,dtype='<f4').tofile(path.parent/'data'/f"{ids['XrayMapImages']}.dat")
    # Full-resolution image followed by the verified half-resolution level.
    np.arange(10,dtype='<u2').tofile(path.parent/'data'/f"{ids['ElectronImages']}.dat")
    return ids


class AztecBrowserTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name);self.path=self.root/'Project.oipx';self.ids=native_fixture(self.path)
        self.browser=AztecBrowser()

    def test_native_inventory_does_not_decode_payloads(self):
        with patch.object(NativeProjectReader,'record_blob',side_effect=AssertionError('eager payload')):
            result=self.browser.open(self.path)
        c=result['catalogue'];json.dumps(c,allow_nan=False)
        self.assertEqual(c['file_type'],'OIPX')
        site=c['acquisitions'][0];self.assertEqual((site['project'],site['specimen'],site['label']),('Test project','Specimen A','Site'))
        record=next(d for d in c['datasets'] if d['path'].startswith('/XrayMapImages/'))
        self.assertEqual(record['attributes']['Acquisition'],'Map 1')
        self.assertEqual(site['layers'][0]['technique'],'Electron images')
        self.assertEqual(result['folder'],str(self.root.resolve()))

    def test_native_arrays_and_profiles_are_exact_and_read_only(self):
        paths=[self.path,*sorted((self.root/'data').iterdir())]
        before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        reader=NativeProjectReader(self.path);reader.inspect()
        for table,dtype in [('XrayMapImages','<f4'),('ElectronImages','<u2')]:
            preview=reader.preview('/'+table+'/'+self.ids[table])
            np.testing.assert_array_equal(preview['array'],np.arange(8,dtype=dtype).reshape(2,4))
        profile=reader.preview('/XrayLinescans/'+self.ids['XrayLinescans'])
        np.testing.assert_array_equal(profile['y'],np.arange(4,dtype='<f4'))
        self.assertEqual(before,{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
        opened=self.browser.open(self.path)
        for d in opened['catalogue']['datasets']:
            json.dumps(self.browser.preview(opened['id'],d['path']),allow_nan=False)

    def test_unknown_records_stay_visible_without_guessed_values(self):
        opened=self.browser.open(self.path)
        preview=self.browser.preview(opened['id'],'/EDXSpectra/'+self.ids['EDXSpectra'])
        self.assertEqual(preview['kind'],'metadata');self.assertNotIn('y',preview)

    def test_native_point_counts_calibration_and_truncation(self):
        ident=self.ids['EDXSpectra'];label=b'Sum spectrum'
        counts=np.array([0, 3, 70000, 5],dtype='<i4')
        payload=(struct.pack('<I',2)+uuid.UUID(ident).bytes_le+struct.pack('<I',1)+b'\0'
                 +bytes([len(label)])+label+struct.pack('<I',len(counts))+counts.tobytes()
                 +struct.pack('<dd',10.,-200.)+b'\1'*4)
        def store(data):
            with closing(sqlite3.connect(self.path)) as con, con:
                con.execute('UPDATE EDXSpectra SET ObjectBlob=?',(blob(data),))
        store(payload)
        result=NativeProjectReader(self.path).preview('/EDXSpectra/'+ident)
        np.testing.assert_array_equal(result['y'],counts)
        np.testing.assert_allclose(result['x'],[-.2,-.19,-.18,-.17])
        self.assertEqual(result['total_counts'],70008)
        store(payload[:-1])
        with self.assertRaisesRegex(AztecReadError,'truncated'):
            NativeProjectReader(self.path).preview('/EDXSpectra/'+ident)

    def test_changed_project_and_companion_require_reopen(self):
        reader=NativeProjectReader(self.path);reader.inspect()
        target=self.root/'data'/f"{self.ids['XrayMapImages']}.dat"
        target.write_bytes(b'changed')
        with self.assertRaises(SourceChangedError):reader.preview('/XrayMapImages/'+self.ids['XrayMapImages'])
        with closing(sqlite3.connect(self.path)) as con, con:con.execute("UPDATE Project SET Label='Changed'")
        with self.assertRaises(SourceChangedError):reader.inspect()

    def test_unverified_native_storage_is_rejected(self):
        target=self.root/'data'/f"{self.ids['XrayMapImages']}.dat";target.write_bytes(b'wrong')
        reader=NativeProjectReader(self.path);reader.inspect()
        with self.assertRaisesRegex(AztecReadError,'storage differ'):reader.preview('/XrayMapImages/'+self.ids['XrayMapImages'])
        with self.assertRaisesRegex(AztecReadError,'Truncated'):list(blob_payloads(b'@\x04Blob\xa3\xff\xff\xff\x7f'))

    def test_pending_database_changes_are_not_read_as_a_stable_snapshot(self):
        Path(str(self.path)+'-wal').write_bytes(b'pending')
        with self.assertRaisesRegex(SourceChangedError,'pending database changes'):
            NativeProjectReader(self.path).inspect()

    def test_native_browse_and_legacy_status(self):
        (self.root/'Old.oip').write_bytes(b'legacy')
        h5fixture(self.root/'Reference.h5oina')
        listing=self.browser.browse(self.root,self.root)
        native=next(f for f in listing['files'] if f['kind']=='OIPX');self.assertTrue(native['supported'])
        old=next(f for f in listing['files'] if f['kind']=='OIP');self.assertFalse(old['supported'])
        with self.assertRaisesRegex(AztecReadError,'legacy OIP'):self.browser.open(old['path'])
        self.assertEqual(listing['files'][-1]['kind'],'H5OINA')

    def test_h5_reference_preview_preserves_spectral_row_grid(self):
        path=self.root/'Reference.h5oina';h5fixture(path);opened=self.browser.open(path)
        result=self.browser.preview(opened['id'],'/3/EDS/Data/Spectrum',row=2)
        self.assertEqual(result['y'],list(range(16,24)));self.assertEqual(result['rows'],16)
        self.assertEqual(result['x'],list(range(-200,-120,10)))
        with self.assertRaises(AztecReadError):self.browser.preview(opened['id'],'/3/EDS/Data/Spectrum',row=99)
        image=self.browser.preview(opened['id'],'/3/EDS/Data/Window Integral/V Kα1')
        self.assertEqual(image['grid'],(2,2));self.assertTrue(image['image'].startswith('data:image/png;base64,'))

    def test_stale_browser_handles_and_unknown_paths_fail_clearly(self):
        opened=self.browser.open(self.path)
        with self.assertRaises(AztecReadError):self.browser.preview(opened['id'],'/not-a-record')
        for _ in range(4):self.browser.open(self.path)
        with self.assertRaisesRegex(AztecReadError,'Reopen'):self.browser.preview(opened['id'],'/not-a-record')


if __name__=='__main__':unittest.main()
