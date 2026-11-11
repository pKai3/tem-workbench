import unittest
import tempfile
from io import BytesIO
import numpy as np
from PIL import Image
import analysis_core as core
import region_masks
from engine import Engine
from workbench_project import Project

class PolygonRegions(unittest.TestCase):
    def setUp(self):
        self.roi=dict(x=0,y=0,w=256,h=192,polygon=[[0,0],[180,0],[220,192],[0,192]],edge_fade_nm=.3)
        self.roi=region_masks.validate(self.roi)
        self.mask=region_masks.mask(self.roi,.025,.025)
    def test_outside_pixels_cannot_affect_spectrum(self):
        y,x=np.indices(self.mask.shape)
        image=10*np.cos(2*np.pi*(30*x/256+15*y/192))
        other=image.copy();other[self.mask==0]=1e6
        a=core.spectrum(image,.025,.025,selection_mask=self.mask)
        b=core.spectrum(other,.025,.025,selection_mask=self.mask)
        np.testing.assert_allclose(a['log'],b['log'])
        self.assertTrue(a['window_fwhm_xy_nm_inv'][0]>0)
        self.assertEqual(a['selection_window'],'polygon_cosine_fade')
    def test_rectangle_coordinates_and_polygon_hann_override(self):
        y,x=np.indices(self.mask.shape);image=100*np.cos(2*np.pi*(30.2*x/256+15.2*y/192))
        a=core.spectrum(image,.025,.025,selection_mask=self.mask,minimum_enrichment=0)
        b=core.spectrum(image,.025,.025,selection_mask=self.mask,window='none',minimum_enrichment=0)
        np.testing.assert_allclose(a['log'],b['log'])
        expected=np.array([-30.2/(256*.025),15.2/(192*.025)])
        self.assertLess(min(np.linalg.norm(expected-[p['qx'],p['qy']]) for p in a['peaks']),.08)
    def test_fade_and_validation(self):
        self.assertTrue(np.any((self.mask>0)&(self.mask<1)))
        hard=region_masks.mask(dict(self.roi,edge_fade_nm=0),.025,.025)
        self.assertEqual(set(np.unique(hard)),{0,1})
        self.assertTrue((self.mask<=hard).all())
        for bad in (dict(self.roi,polygon=[[0,0],[256,192],[0,192],[256,0]]),dict(self.roi,edge_fade_nm=-1),dict(self.roi,polygon=[[0,0],[2,0],[0,2]])):
            with self.assertRaises(ValueError):region_masks.validate(bad)
    def test_saved_region_round_trip_and_preview(self):
        engine=Engine({});item=dict(array=np.ones((192,256)),limits=[0,2],info=dict(image_kind='real_space',pixel_x_nm=.025,pixel_y_nm=.025,sha256_pixels='test'))
        roi,settings=engine.validate(item,self.roi,dict(enabled_phases=[]))
        self.assertEqual(roi,self.roi)
        with tempfile.TemporaryDirectory() as path:
            project=Project(path)
            saved=project.save_region(dict(revision=0,name='Polygon'),item['info'],roi,settings)
            self.assertEqual(project.read()['regions'][0]['roi'],self.roi)
        image=Image.open(BytesIO(engine.region_preview(item,roi)))
        self.assertEqual(image.mode,'RGBA');self.assertEqual(image.getpixel((255,0))[3],0)
        quick=engine.spectrum_preview(item,roi,settings)
        full=engine.analyze(item,roi,settings,images=True)
        self.assertEqual(full['roi'],roi)
        self.assertEqual(full['images']['crop'],quick['images']['crop'])
        self.assertEqual(full['spectrum']['profile_threshold'],quick['spectrum']['profile_threshold'])

if __name__=='__main__':unittest.main()
