"""Native browsing stays separate from decoding, with bounded read-only previews."""
import base64
import hashlib
from contextlib import closing
from io import BytesIO
import json
from pathlib import Path
import shutil
import sqlite3
import struct
import tempfile
import unittest
import uuid
from unittest.mock import patch

import h5py
import numpy as np
from PIL import Image

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

    def test_project_file_overviews_use_saved_overview_images(self):
        fallback=self.browser.project_overviews(self.path)['previews']
        self.assertEqual([(p['sample'],p['site'],p['overview']) for p in fallback],
                         [('Specimen A','Site',False)])
        with closing(sqlite3.connect(self.path)) as con, con:
            con.execute("UPDATE Analyses SET Label='Overview'")
        previews=AztecBrowser().project_overviews(self.path)['previews']
        self.assertEqual(len(previews), 1)
        self.assertEqual(previews[0]['sample'], 'Specimen A')
        self.assertTrue(previews[0]['overview'])
        self.assertTrue(previews[0]['image'].startswith('data:image/png;base64,'))

    def test_project_preview_chooses_largest_image_for_sample(self):
        ident=str(uuid.uuid4());label='Larger image'
        payload=b'\x06\0\0\0\0'+bytes([len(label)])+label.encode()+struct.pack('<III',2,8,8)+b'\0'*24+uuid.UUID(ident).bytes_le
        with closing(sqlite3.connect(self.path)) as con, con:
            con.execute('INSERT INTO ElectronImages VALUES(?,?,?,?)',(ident,label,'200.0',blob(payload)))
            parent=con.execute('SELECT Id FROM DataNodes WHERE AssociatedId=?',(self.ids['Analyses'],)).fetchone()[0]
            con.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)',(str(uuid.uuid4()),parent,ident,1,1))
            overview_id,overview_node=str(uuid.uuid4()),str(uuid.uuid4())
            sample_node=con.execute('SELECT Id FROM DataNodes WHERE AssociatedId=?',(self.ids['Samples'],)).fetchone()[0]
            con.execute('INSERT INTO Analyses VALUES(?,?,?,?)',(overview_id,'Overview','200.0',b'overview'))
            con.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)',(overview_node,sample_node,overview_id,1,1))
            con.execute('UPDATE DataNodes SET ParentId=? WHERE AssociatedId=?',(overview_node,self.ids['ElectronImages']))
        np.arange(64,dtype='<u2').tofile(self.root/'data'/f'{ident}.dat')
        browser=AztecBrowser();preview=browser.project_overviews(self.path)['previews'][0]
        self.assertEqual((preview['site'],preview['overview']),('Site',False))
        self.assertEqual(browser.comparison_reader(self.path).electron_image_shape('/ElectronImages/'+ident),(8,8))
        image=Image.open(BytesIO(base64.b64decode(preview['image'].split(',',1)[1])))
        self.assertEqual(image.size,(180,180))

    def test_native_ebsd_fields_and_saved_colours(self):
        map_id,colour_id,contrast_id=(str(uuid.uuid4()) for _ in range(3))
        count=8
        phase=np.array([0,1,1,2,2,1,0,2],dtype='u1')
        euler=np.arange(count*3,dtype='<f4').reshape(count,3)/10
        mad=np.arange(count,dtype='<f4')/2
        contrast=np.arange(count,dtype='u1')+20
        raw=(b'OINA.Ebsd.Data=002'+phase.tobytes()+euler.tobytes()+mad.tobytes()+
             contrast.tobytes()+(contrast+1).tobytes()+(contrast+2).tobytes()+
             (contrast+3).tobytes()+np.zeros(count,dtype='<f4').tobytes()+
             np.arange(count,dtype='<f4').tobytes())
        (self.root/'data'/f'{map_id}.dat').write_bytes(raw)
        with closing(sqlite3.connect(self.path)) as con, con:
            con.execute('CREATE TABLE EbsdMaps(EntityId TEXT PRIMARY KEY, Label TEXT, Version TEXT, ObjectBlob BLOB)')
            con.execute('CREATE TABLE EbsdMapImages(EntityId TEXT PRIMARY KEY, Label TEXT, Version TEXT, ObjectBlob BLOB)')
            parent=con.execute('SELECT Id FROM DataNodes WHERE AssociatedId=?',(self.ids['MapAcquires'],)).fetchone()[0]
            con.execute('INSERT INTO EbsdMaps VALUES(?,?,?,?)',(map_id,'EBSD Data','200.0',b'map'))
            con.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)',(str(uuid.uuid4()),parent,map_id,1,1))
            for ident,label,kind in [(colour_id,'IPF Z Color',5),(contrast_id,'Band Contrast',1)]:
                payload=(b'\x06\0\0\0\0'+bytes([len(label)])+label.encode()+
                         struct.pack('<III',kind,4,2)+b'\0'*24+uuid.UUID(ident).bytes_le)
                con.execute('INSERT INTO EbsdMapImages VALUES(?,?,?,?)',(ident,label,'200.0',blob(payload)))
                con.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)',(str(uuid.uuid4()),parent,ident,1,2))
        (self.root/'data'/f'{colour_id}.dat').write_bytes(bytes([0x11,0x22,0x33,0xff])*count)
        (self.root/'data'/f'{contrast_id}.dat').write_bytes(contrast.tobytes())
        reader=NativeProjectReader(self.path);catalogue=reader.inspect()
        self.assertEqual(sum(d['attributes']['Record type']=='Decoded EBSD field' for d in catalogue['datasets']),10)
        np.testing.assert_array_equal(reader.preview(f'/EbsdMaps/{map_id}/phase')['array'],phase.reshape(2,4))
        np.testing.assert_allclose(reader.preview(f'/EbsdMaps/{map_id}/euler_2')['array'],euler[:,1].reshape(2,4))
        np.testing.assert_array_equal(reader.preview(f'/EbsdMaps/{map_id}/band_contrast')['array'],contrast.reshape(2,4))
        self.assertEqual(reader.preview(f'/EbsdMapImages/{colour_id}')['array'][0,0].tolist(),[0x33,0x22,0x11,0xff])
        browser=AztecBrowser();opened=browser.open(self.path)
        image=browser.preview(opened['id'],f'/EbsdMapImages/{colour_id}')['image']
        pixel=Image.open(BytesIO(base64.b64decode(image.split(',',1)[1]))).getpixel((0,0))
        self.assertEqual(pixel,(0x33,0x22,0x11,0xff))
        contrast_image=browser.preview(opened['id'],f'/EbsdMapImages/{contrast_id}')['image']
        contrast_pixel=Image.open(BytesIO(base64.b64decode(contrast_image.split(',',1)[1]))).getpixel((0,0))
        self.assertEqual(contrast_pixel,20)

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

    def test_native_project_identity_survives_rename_and_folder_move(self):
        sources=[dict(id='source', name='Source', path=str(self.root), output_path=str(self.root/'output'))]
        original=self.browser.files(sources)['files'][0]
        self.assertEqual(original['project_id'],self.ids['Project'])
        self.assertEqual(self.browser.open(self.path)['catalogue']['project_id'],original['project_id'])
        folder=self.root/'Moved';folder.mkdir()
        moved=folder/'Renamed.oipx'
        shutil.move(self.path,moved);shutil.move(self.root/'data',folder/'data')
        discovered=self.browser.files(sources)['files'][0]
        self.assertEqual(discovered['path'],str(moved.resolve()))
        self.assertEqual(discovered['project_id'],original['project_id'])
        opened=self.browser.open(moved)
        self.assertEqual(opened['catalogue']['project_id'],original['project_id'])
        record='/XrayMapImages/'+self.ids['XrayMapImages']
        self.assertTrue(self.browser.preview(opened['id'],record)['image'].startswith('data:image/png;base64,'))

    def test_unreadable_native_file_remains_in_file_list_without_identity(self):
        broken=self.root/'Broken.oipx';broken.write_bytes(b'not a SQLite database')
        sources=[dict(id='source',name='Source',path=str(self.root),output_path=str(self.root/'output'))]
        found={file['name']:file for file in self.browser.files(sources)['files']}
        self.assertIsNone(found['Broken.oipx']['project_id'])
        self.assertEqual(found['Project.oipx']['project_id'],self.ids['Project'])

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

    def test_composition_only_raw_line_catalogues_derived_windows_separately(self):
        smart,group,quant=(str(uuid.uuid4()) for _ in range(3))
        with closing(sqlite3.connect(self.path)) as con, con:
            con.execute('DELETE FROM XrayLinescans')
            parent=con.execute('SELECT Id FROM DataNodes WHERE AssociatedId=?',
                               (self.ids['MapAcquires'],)).fetchone()[0]
            for table,ident,label in [('SmartLines',smart,'EDS Data'),
                                      ('FileGroups',group,'Files'),
                                      ('QuantLinescans',quant,'Al Wt%')]:
                con.execute(f'CREATE TABLE {table}(EntityId TEXT PRIMARY KEY, Label TEXT, ObjectBlob BLOB)')
                con.execute(f'INSERT INTO {table} VALUES(?,?,?)',(ident,label,b'raw'))
                con.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)',
                            (str(uuid.uuid4()),parent,ident,1,0))
        reader=NativeProjectReader(self.path);catalogue=reader.inspect()
        derived=[d for d in catalogue['datasets'] if d['attributes'].get('Record type')=='Reconstructed Kα1 window']
        self.assertEqual([d['attributes']['Label'] for d in derived],['Al Kα1'])
        self.assertEqual(derived[0]['attributes']['Source'],'Native raw line spectra')
        self.assertNotIn('XrayLinescans',catalogue['inventory'])
        self.assertEqual(derived[0]['storage'],'computed from native OIPX spectra')
        with patch.object(reader,'derived_line_profiles',return_value={'Al Kα1':np.array([3.,4.])}):
            preview=reader.preview(derived[0]['path'])
        self.assertEqual(preview['unit'],'cps')
        np.testing.assert_array_equal(preview['y'],[3.,4.])

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

    def test_h5_spectrum_row_does_not_use_aggregate_live_time(self):
        path=self.root/'line.h5oina';h5fixture(path)
        with h5py.File(path,'r+') as file:
            data=file['2/EDS/Data'];del data['Spectrum']
            spectrum=np.zeros((8,2048),dtype=np.int32);spectrum[:,164:174]=10
            data.create_dataset('Spectrum',data=spectrum).attrs['Unit']='count'
            data.create_dataset('Live Time',data=np.ones(3,dtype=np.float32))
            file['2/EDS/Header/Number Channels'][...]=2048
        browser=AztecBrowser();opened=browser.open(path)
        result=browser.preview(opened['id'],'/2/EDS/Data/Spectrum',0)
        self.assertEqual(len(result['spectral_windows']),4)
        self.assertIsNone(result['spectral_windows'][0]['cps'])
        self.assertGreater(result['spectral_windows'][0]['counts'],0)
        with h5py.File(path,'r+') as file:
            data=file['2/EDS/Data'];del data['Live Time']
            data.create_dataset('Live Time',data=np.full(8,2,dtype=np.float32))
        browser=AztecBrowser();opened=browser.open(path)
        result=browser.preview(opened['id'],'/2/EDS/Data/Spectrum',0)
        self.assertAlmostEqual(result['spectral_windows'][0]['cps'],
                               result['spectral_windows'][0]['counts']/2)

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
