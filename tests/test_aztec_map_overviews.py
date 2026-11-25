"""Native overview identity, independent registration and scientific isolation."""
import base64
from contextlib import closing
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
import uuid
from zipfile import ZipFile

import numpy as np
from PIL import Image

from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.export import DataArchive
from tem_workbench.aztec.native import NativeProjectReader
from tem_workbench.aztec.views import acquisition_views
from tests.test_aztec_kam import fixture


class MapOverviewTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        self.path=Path(tmp.name)/'Project.oipx';self.ids,*_=fixture(self.path)
        ident=str(uuid.uuid4());self.first='/ElectronImages/'+self.ids['ElectronImages'];self.second='/ElectronImages/'+ident
        with closing(sqlite3.connect(self.path)) as con,con:
            data=con.execute('SELECT ObjectBlob FROM ElectronImages').fetchone()[0]
            data=data.replace(uuid.UUID(self.ids['ElectronImages']).bytes_le,uuid.UUID(ident).bytes_le).replace(b'Image 1',b'Image 2')
            data=data.replace(struct.pack('<III3d',2,4,2,.125,.25,.25),struct.pack('<III3d',2,4,2,.125,.125,.25))
            con.execute('INSERT INTO ElectronImages VALUES(?,?,?,?)',(ident,'Image 2','200.0',data))
            parent=con.execute('SELECT Id FROM DataNodes WHERE AssociatedId=?',(self.ids['Analyses'],)).fetchone()[0]
            con.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)',(str(uuid.uuid4()),parent,ident,1,1))
        np.arange(10,0,-1,dtype='<u2').tofile(self.path.parent/'data'/f'{ident}.dat')
        self.acquisition=self.ids['MapAcquires']
        self.options=dict(channel_table='KamMapImages',acquisitions=[self.acquisition],comparison=True,
                          signals=['KAM'],map_distributions=True)

    def view(self,paths=None):
        options=dict(self.options)
        if paths is not None:options['overview_images']={self.acquisition:paths}
        return acquisition_views(NativeProjectReader(self.path),options)

    def test_explicit_order_and_each_images_own_registration(self):
        default=self.view();chosen=self.view([self.second,self.first]);row=chosen['rows'][0]
        self.assertEqual([item['path'] for item in row['overviews']],[self.second,self.first])
        self.assertEqual(row['overviews'][0]['crop_points'],[[1,0],[5,2]])
        self.assertEqual(row['overviews'][1]['crop_points'],[[0,0],[4,2]])
        self.assertEqual(row['electron'],row['overviews'][0]['image'])
        self.assertNotEqual(row['electron'],default['rows'][0]['electron'])
        pixels=np.asarray(Image.open(BytesIO(base64.b64decode(row['electron'].split(',')[1]))))
        self.assertEqual(list(pixels.shape[:2]),row['overviews'][0]['source_shape'])
        self.assertTrue(row['overviews'][0]['full_resolution'])
        self.assertEqual(pixels[:,-1,3].tolist(),[255,255],
                         'Keep source pixels intact; the registered field is clipped at display/export time')
        self.assertEqual(chosen['distributions'],default['distributions'])
        self.assertEqual(row['tiles'],default['rows'][0]['tiles'])
        self.assertEqual(row['kam'],default['rows'][0]['kam'])

    def test_none_and_unavailable_saved_source_never_substitute_first_image(self):
        row=self.view([])['rows'][0];self.assertEqual(row['overviews'],[]);self.assertNotIn('electron',row)
        row=self.view(['/ElectronImages/not-at-this-site'])['rows'][0]
        self.assertIn('error',row['overviews'][0]);self.assertNotIn('electron',row)
        self.assertEqual(row['valid_pixels'],6)

    def test_export_retains_selected_sources_and_geometry_without_embedded_pngs(self):
        options={**self.options,'overview_images':{self.acquisition:[self.second,self.first]}}
        archive=DataArchive(self.path,options)
        result=acquisition_views(NativeProjectReader(self.path),options,export_arrays=archive)
        with ZipFile(BytesIO(base64.b64decode(archive.finish(result)['data']))) as zipped:
            text=zipped.read('manifest.json').decode();manifest=json.loads(text)
            self.assertNotIn('data:image',text)
            images=manifest['acquisitions'][0]['overviews']
            self.assertEqual([item['path'] for item in images],[self.second,self.first])
            self.assertEqual(images[0]['crop_points'],[[1,0],[5,2]])

    def test_thumbnail_uses_the_explicit_site_image(self):
        browser=AztecBrowser()
        first=browser.comparison_thumbnail(self.path,self.acquisition,'map',self.first)
        second=browser.comparison_thumbnail(self.path,self.acquisition,'map',self.second)
        self.assertNotEqual(first['image'],second['image'])
        self.assertTrue(first['full_resolution'])
        pixels=Image.open(BytesIO(base64.b64decode(first['image'].split(',')[1])))
        self.assertEqual(list(pixels.size),first['source_shape'][::-1])

    def test_overview_keeps_all_pixels_above_the_normal_preview_limit(self):
        from tem_workbench.aztec.map_overviews import attach
        reader=NativeProjectReader(self.path);reader.inspect()
        original=reader.preview
        values=np.tile(np.arange(1600,dtype=float),(1300,1))
        reader.preview=lambda path: {'array':values} if path==self.first else original(path)
        record=next(r for r in reader._records.values() if r['table']=='KamMapImages')
        row={'acquisition':self.acquisition}
        attach(reader,row,record,(2,4),{'overview_images':{self.acquisition:[self.first]}})
        image=np.asarray(Image.open(BytesIO(base64.b64decode(row['overviews'][0]['image'].split(',')[1]))))
        self.assertEqual(image.shape,(1300,1600,4))
        low,high=np.percentile(values,[1,99])
        expected=np.uint8(np.clip((values-low)/(high-low),0,1)*255)
        np.testing.assert_array_equal(image[...,0],expected)


if __name__=='__main__':unittest.main()
