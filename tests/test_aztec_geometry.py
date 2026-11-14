"""Registration controls for cropped images, spatial selection and unknown regions."""
import base64
from contextlib import closing
from io import BytesIO
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
import uuid

import numpy as np
from PIL import Image

from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.geometry import region_geometry
from tem_workbench.aztec.h5oina import AztecReadError
from tem_workbench.aztec.native import NativeProjectReader
from tests.test_aztec_browser import blob, native_fixture


def element(name, contents):
    return b'@'+bytes([len(name)])+name+contents


def region(kind, coords):
    payload = struct.pack('<I4d', 3 if kind == 'LineRegion' else 1, *coords)
    if kind == 'LineRegion':
        payload += struct.pack('<I', 100) + b'\0'*13
    return (element(b'region', b'.\x04type\x98'+bytes([len(kind)+2])+b'a:'+kind.encode()
                    + blob(payload).replace(b'@\x04Blob', b'^\x04Blob'))
            + blob(b'end'))


def area(kind, coords, frame=1):
    return (element(b'absolutePosition', blob(struct.pack('<I', 2)+bytes([frame])*40))
            + region(kind, coords)
            + element(b'ScanCalibration', blob(struct.pack('<I', 1)+b'\0'*16)))


def core(ident):
    return blob(struct.pack('<I', 2)+uuid.UUID(ident).bytes_le+b'\0'*16)


class AztecGeometryTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        self.path=Path(tmp.name)/'Project.oipx';self.ids=native_fixture(self.path)
        self.area_ids={k:str(uuid.uuid4()) for k in ('image','map','point','line')}
        self.line_id=str(uuid.uuid4())
        with closing(sqlite3.connect(self.path)) as c, c:
            c.execute('CREATE TABLE AreaOfInterests(AreaOfInterestId TEXT PRIMARY KEY COLLATE NOCASE, ObjectBlob BLOB)')
            for key,kind,coords in [('image','FullFieldRegion',[.25,.25,.5,.25]),('map','FullFieldRegion',[.25,.25,.5,.25]),
                                   ('point','RectangleRegion',[.5,.375,0,0]),('line','LineRegion',[.3,.3,.7,.45])]:
                c.execute('INSERT INTO AreaOfInterests VALUES(?,?)',(self.area_ids[key],area(kind,coords)))
            for table,key in [('ElectronImages','image'),('SmartMaps','map'),('EDXSpectra','point')]:
                b=c.execute(f'SELECT ObjectBlob FROM {table}').fetchone()[0]
                if key=='image':
                    b=b.replace(struct.pack('<III',2,4,2)+b'\0'*24,struct.pack('<III3d',2,4,2,.125,.25,.25))
                c.execute(f'UPDATE {table} SET ObjectBlob=?',(core(self.area_ids[key])+b,))
            c.execute('CREATE TABLE SmartLines(EntityId TEXT PRIMARY KEY COLLATE NOCASE, Label TEXT, ObjectBlob BLOB)')
            c.execute('INSERT INTO SmartLines VALUES(?,?,?)',(self.line_id,'EDS Data',core(self.area_ids['line'])))
            parent=c.execute('SELECT Id FROM DataNodes WHERE AssociatedId=?',(self.ids['MapAcquires'],)).fetchone()[0]
            c.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)',(str(uuid.uuid4()),parent,self.line_id,1,0))

    def site(self):
        reader=NativeProjectReader(self.path);c=reader.inspect()
        return reader.site(c['acquisitions'][0]['index'])

    def test_image_crop_registration_preserves_native_line_direction_and_points(self):
        site=self.site();self.assertEqual(site['geometry']['origin'],[.25,.25])
        shapes={r['kind']:r for r in site['regions']}
        np.testing.assert_allclose(shapes['line']['points'],[[.4,.4],[3.6,1.6]])
        np.testing.assert_allclose(shapes['rectangle']['points'],[[0,0],[4,2]])
        np.testing.assert_allclose(shapes['point']['points'],[[2,1],[2,1]])
        self.assertIn('/XrayMapImages/'+self.ids['XrayMapImages'],shapes['rectangle']['paths'])
        self.assertEqual(site['unpositioned'],[])

    def test_region_from_another_frame_is_withheld(self):
        with closing(sqlite3.connect(self.path)) as c, c:
            c.execute('UPDATE AreaOfInterests SET ObjectBlob=? WHERE AreaOfInterestId=?',
                      (area('RectangleRegion',[.5,.375,0,0],frame=2),self.area_ids['point']))
        site=self.site();self.assertEqual(len(site['regions']),2)
        self.assertIn('coordinate frame',site['unpositioned'][0]['reason'])

    def test_unknown_masks_and_invalid_geometry_are_not_drawn_as_rectangles(self):
        for kind,coords in [('MaskedRegion',[0,0,1,1]),('RectangleRegion',[0,0,-1,1]),('LineRegion',[0,0,0,0])]:
            with self.subTest(kind=kind),self.assertRaises(AztecReadError):
                region_geometry(region(kind,coords))

    def test_site_preview_uses_same_image_and_rejects_foreign_image(self):
        browser=AztecBrowser();opened=browser.open(self.path);site_id=opened['catalogue']['acquisitions'][0]['index']
        site=browser.site(opened['id'],site_id)
        self.assertEqual(site['preview']['image'],browser.preview(opened['id'],site['image_path'])['image'])
        with self.assertRaises(AztecReadError):browser.site(opened['id'],site_id,'/ElectronImages/unknown')

    def test_comparison_thumbnails_highlight_the_requested_region(self):
        browser=AztecBrowser();images=[]
        for kind in ('map','line'):
            result=browser.comparison_thumbnail(self.path,self.ids['MapAcquires'],kind)
            image=Image.open(BytesIO(base64.b64decode(result['image'].split(',',1)[1])))
            self.assertLessEqual(max(image.size),128)
            pixels=np.asarray(image)
            self.assertTrue(np.any(pixels[...,0]>pixels[...,1]))
            images.append(pixels)
        self.assertFalse(np.array_equal(*images))


if __name__=='__main__':unittest.main()
