from io import BytesIO
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from tem_workbench.app.engine import Engine
from tem_workbench.storage import raster_images as raster

class RasterTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.config=dict(data_root=str(self.root),raster_calibrations=str(self.root/'calibrations.json'))
        self.pixels=(np.arange(128*128).reshape(128,128)%4000).astype(np.uint16)
        Image.fromarray(self.pixels).save(self.root/'test.tiff')
        self.engine=Engine(self.config);self.engine.catalog()
    def tearDown(self):self.temp.cleanup()
    def calibration(self,kind='real_space',units='nm',value=2):
        return dict(image_kind=kind,units=units,value=value,points=[[10,20],[110,20]])
    def test_required_calibration_persists_and_analyzes(self):
        with self.assertRaisesRegex(ValueError,'Calibrate'):self.engine.load('test.tiff')
        self.engine.calibrate_raster('test.tiff',self.calibration())
        engine=Engine(self.config);engine.catalog();item=engine.load('test.tiff')
        np.testing.assert_array_equal(item['array'],self.pixels)
        self.assertEqual(item['info']['pixel_x_nm'],.02)
        self.assertEqual(item['info']['manual_calibration']['bar_pixels'],100)
        result=engine.analyze(item,dict(x=0,y=0,w=128,h=128),{},images=False)
        self.assertEqual(result['image_kind'],'real_space')
    def test_reciprocal_units_and_recalibration(self):
        self.engine.calibrate_raster('test.tiff',self.calibration())
        self.engine.load('test.tiff')
        self.engine.calibrate_raster('test.tiff',self.calibration('diffraction','Å^-1',1))
        item=self.engine.load('test.tiff')
        self.assertEqual(item['info']['image_kind'],'diffraction')
        self.assertEqual(item['info']['pixel_x_nm_inv'],.1)
        result=self.engine.analyze(item,dict(x=0,y=0,w=128,h=128),{},images=False)
        self.assertEqual(result['image_kind'],'diffraction')
    def test_invalid_calibration_and_changed_source(self):
        for update in [dict(value=0),dict(value=float('inf')),dict(points=[[1,1],[1,1]]),dict(points=[[-1,0],[10,10]]),dict(units='nm^-1')]:
            with self.subTest(update=update),self.assertRaises(ValueError):self.engine.calibrate_raster('test.tiff',{**self.calibration(),**update})
        self.engine.calibrate_raster('test.tiff',self.calibration())
        Image.fromarray(self.pixels+1).save(self.root/'test.tiff')
        self.assertIsNone(self.engine.raster_info('test.tiff')['calibration'])
    def test_catalog_sidecars_and_rgb(self):
        Image.fromarray(np.zeros((64,64,3),dtype=np.uint8)).save(self.root/'colour.jpg')
        Image.fromarray(np.zeros((64,64),dtype=np.uint8)).save(self.root/'colour.png')
        Image.fromarray(np.zeros((64,64),dtype=np.uint8)).save(self.root/'standalone.png')
        (self.root/'acquisition.dm4').touch()
        Image.fromarray(np.zeros((64,64),dtype=np.uint8)).save(self.root/'acquisition.PNG')
        names={row['id'] for row in self.engine.catalog()}
        self.assertTrue({'test.tiff','colour.jpg','standalone.png','acquisition.dm4'}<=names)
        self.assertNotIn('colour.png',names);self.assertNotIn('acquisition.PNG',names)
        self.assertTrue(self.engine.file_preview('colour.jpg').startswith(b'\x89PNG'))
        self.assertEqual(Image.open(BytesIO(self.engine.raster_preview('test.tiff'))).size,(128,128))
        with self.assertRaises(ValueError):self.engine.raster_source('../elsewhere.png')
    def test_catalog_calibration_status_tracks_source(self):
        def entry():return next(row for row in self.engine.catalog() if row['name']=='test')
        self.assertEqual(entry()['extension'],'.tiff')
        self.assertFalse(entry()['calibrated'])
        self.engine.calibrate_raster('test.tiff',self.calibration())
        self.assertTrue(entry()['calibrated'])
        Image.fromarray(self.pixels+1).save(self.root/'test.tiff')
        self.assertFalse(entry()['calibrated'])

    def test_stack_rejected_and_length_unit_conversion(self):
        Image.fromarray(self.pixels).save(self.root/'stack.tif',save_all=True,append_images=[Image.fromarray(self.pixels)])
        with self.assertRaisesRegex(ValueError,'single-frame'):raster.read(self.root/'stack.tif')
        self.assertEqual(raster.validate(self.pixels,self.calibration(units='µm',value=1))['scale'],10)

if __name__=='__main__':unittest.main()
