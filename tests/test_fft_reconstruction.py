import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock, RLock
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import numpy as np
from scipy.fft import fft2
from PIL import Image
import analysis_core as core
import fft_reconstruction as reconstruction
import region_masks
from engine import Engine
from server import Workbench


class ReconstructionTests(unittest.TestCase):
    def test_phase_and_selectivity(self):
        y,x=np.indices((96,128));sx,sy=.1,.2
        desired=3*np.cos(2*np.pi*(12*x/128+7*y/96)+.73)
        other=2*np.cos(2*np.pi*(30*x/128-18*y/96)-1.2)
        settings=dict(mode='keep',keep_dc=False,spots=[dict(qx=12/(128*sx),qy=-7/(96*sy),radius=.05,feather=.01)])
        result,mask,error=reconstruction.reconstruct(fft2(desired+other+9),sx,sy,settings)
        np.testing.assert_allclose(result,desired,atol=1e-5)
        self.assertLess(error,1e-5)
        rejected,_,_=reconstruction.reconstruct(fft2(desired+other+9),sx,sy,dict(settings,mode='reject',keep_dc=True))
        np.testing.assert_allclose(rejected,other+9,atol=1e-5)

    def test_full_pass_and_polygon_input(self):
        rng=np.random.default_rng(9);a=rng.normal(size=(73,96)).astype('float32')
        for polygon in (False,True):
            roi=dict(x=0,y=0,w=96,h=73)
            if polygon: roi.update(polygon=[[0,0],[75,0],[96,73],[0,73]],edge_fade_nm=.3)
            info=dict(pixel_x_nm=.1,pixel_y_nm=.2,image_kind='real_space')
            z,coeff=reconstruction.prepare(a,roi,info,dict(fft_window='hann',remove_mean=True))
            expected=core.prepare_fft_input(a,'hann',True,region_masks.mask(roi,.1,.2))
            np.testing.assert_array_equal(z,expected)
            result,_,_=reconstruction.reconstruct(coeff,.1,.2,dict(mode='reject',keep_dc=True,spots=[]))
            np.testing.assert_allclose(result,z,rtol=2e-6,atol=2e-6)
            _,extent=reconstruction.spectrum_view(coeff,.1,.2,2)
            self.assertGreater(extent[1],extent[0]);self.assertGreater(extent[3],extent[2])

    def test_display_pixel_centres_match_reciprocal_coordinates(self):
        for h,w in ((64,96),(65,97)):
            y,x=np.indices((h,w));sx,sy=.1,.2
            coeff=fft2(np.cos(2*np.pi*(9*x/w+5*y/h)))
            display,extent=reconstruction.spectrum_view(coeff,sx,sy,2)
            rows,cols=display.shape
            peaks=np.argwhere(display>display.max()*.99)
            coordinates=[(extent[0]+(col+.5)*(extent[1]-extent[0])/cols,
                          extent[3]-(row+.5)*(extent[3]-extent[2])/rows) for row,col in peaks]
            self.assertEqual(len(coordinates),2)
            self.assertTrue(any(np.allclose(q,[9/(w*sx),-5/(h*sy)]) for q in coordinates))

    def test_nyquist_even_and_odd_dimensions(self):
        rng=np.random.default_rng(11)
        for shape in ((64,96),(65,97)):
            a=rng.normal(size=shape).astype('float32')
            settings=dict(mode='keep',keep_dc=False,spots=[dict(qx=5.,qy=1.17,radius=.61,feather=.22)])
            result,mask,error=reconstruction.reconstruct(fft2(a),.1,.2,settings)
            reflected=mask[np.ix_((-np.arange(shape[0]))%shape[0],(-np.arange(shape[1]))%shape[1])]
            np.testing.assert_array_equal(mask,reflected)
            self.assertLess(error,1e-6)
            self.assertTrue(np.any((mask>0)&(mask<1)))

    def test_dc_and_invalid_masks(self):
        a=np.full((32,32),7,dtype='float32')
        result,_,_=reconstruction.reconstruct(fft2(a),.1,.1,dict(keep_dc=True,spots=[]))
        np.testing.assert_allclose(result,a)
        result,_,_=reconstruction.reconstruct(fft2(a),.1,.1,dict(keep_dc=False,spots=[]))
        self.assertEqual(np.max(abs(result)),0)
        for invalid in (dict(mode='oops'),dict(keep_dc='yes'),dict(spots=[dict(qx=0,qy=0,radius=.1,feather=.2)]),dict(spots=[dict(qx=float('nan'),qy=0,radius=.1,feather=0)])):
            with self.assertRaises(ValueError):reconstruction.validate_masks(invalid)
        with self.assertRaisesRegex(ValueError,'real-space'):
            reconstruction.prepare(a,dict(x=0,y=0,w=32,h=32),dict(image_kind='diffraction'),{})

    def test_server_cache_and_reproducible_exports(self):
        y,x=np.indices((64,96));a=(2+np.cos(2*np.pi*x/12)).astype('float32')
        item=dict(array=a,info=dict(id='test',name='1.2MX_sample',image_kind='real_space',pixel_x_nm=.1,pixel_y_nm=.2,sha256_pixels='testhash'))
        with TemporaryDirectory() as directory:
            app=Workbench.__new__(Workbench);app.lock=RLock();app.ifft_lock=Lock();app.ifft_cache=None
            engine=Engine({});app.engine=SimpleNamespace(load=lambda _:item,validate=engine.validate,output_for=lambda _:Path(directory))
            body=dict(file_id='test',roi=dict(x=0,y=0,w=96,h=64),settings=dict(fft_window='none',remove_mean=False),masks=dict(mode='reject',keep_dc=True,spots=[]))
            with patch('fft_reconstruction.prepare',wraps=reconstruction.prepare) as prepare:
                preview=app.reconstruct_fft(body)
                exported=app.reconstruct_fft(dict(body,export=True))
                self.assertEqual(prepare.call_count,1)
            self.assertEqual(preview['recipe']['roi'],body['roi'])
            self.assertIn('1.2MX_sample',exported['path'])
            with Image.open(exported['path']) as exported_image:
                self.assertEqual(exported_image.size,(96,64))
            recipe=json.loads(Path(exported['paths'][2]).read_text())
            with np.load(exported['paths'][1],allow_pickle=False) as data:
                np.testing.assert_allclose(data['reconstruction'],a,atol=1e-6)
                self.assertEqual(json.loads(str(data['recipe_json'])),recipe)
                self.assertEqual(data['transfer_mask'].shape,a.shape)
            _,coeff=reconstruction.prepare(a,recipe['roi'],recipe['source'],recipe['processing'])
            reconstructed,_,_=reconstruction.reconstruct(coeff,.1,.2,recipe['masks'])
            np.testing.assert_allclose(reconstructed,a,atol=1e-6)

if __name__=='__main__':unittest.main()
