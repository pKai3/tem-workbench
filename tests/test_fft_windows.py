"""Taper endpoints, mean subtraction and shared analysis/reconstruction input."""
import unittest
from unittest.mock import patch
import numpy as np
from scipy.fft import fft2
from tem_workbench.analysis import analysis_core as core
from tem_workbench.analysis import fft_reconstruction
from tem_workbench.app.engine import Engine


class FFTWindowTests(unittest.TestCase):
    def setUp(self):
        self.image=np.random.default_rng(3).normal(10,2,(96,128)).astype('float32')
        self.roi=dict(x=0,y=0,w=128,h=96)
        self.info=dict(pixel_x_nm=.02,pixel_y_nm=.03,image_kind='real_space')

    def test_tukey_endpoints_and_plateau(self):
        for mean in (False,True):
            np.testing.assert_allclose(core.prepare_fft_input(self.image,'tukey',mean,tukey_alpha=0),core.prepare_fft_input(self.image,'none',mean),atol=1e-6)
            np.testing.assert_allclose(core.prepare_fft_input(self.image,'tukey',mean,tukey_alpha=1),core.prepare_fft_input(self.image,'hann',mean),atol=1e-6)
        z=core.prepare_fft_input(self.image,'tukey',False,tukey_alpha=.2)
        np.testing.assert_array_equal(z[10:86,13:115],self.image[10:86,13:115])
        self.assertTrue(np.all(z[0]==0) and np.all(z[:,-1]==0))

    def test_mean_removal_changes_dc_only_without_taper(self):
        kept=fft2(core.prepare_fft_input(self.image,'none',False))
        removed=fft2(core.prepare_fft_input(self.image,'none',True))
        self.assertGreater(abs(kept[0,0]),100000)
        self.assertLess(abs(removed[0,0]),.02)
        kept[0,0]=removed[0,0]=0
        np.testing.assert_allclose(kept,removed,atol=.01)
        for window in ('hann','tukey','none'):
            z=core.prepare_fft_input(np.full((96,128),7.),window,True)
            np.testing.assert_array_equal(z,0)

    def test_polygon_replaces_taper(self):
        mask=np.ones(self.image.shape,dtype='float32');mask[:,:20]=0
        np.testing.assert_array_equal(core.prepare_fft_input(self.image,'tukey',True,mask,.7),core.prepare_fft_input(self.image,'hann',True,mask))

    def test_shared_reconstruction_and_spectrum_input(self):
        settings=dict(fft_window='tukey',fft_tukey_alpha=.37,remove_mean=True)
        z,coeff=fft_reconstruction.prepare(self.image,self.roi,self.info,settings)
        expected=core.prepare_fft_input(self.image,'tukey',True,tukey_alpha=.37)
        np.testing.assert_array_equal(z,expected)
        np.testing.assert_allclose(coeff,fft2(expected),atol=1e-5)
        with patch.object(core,'fft2',wraps=fft2) as transform:
            result=core.spectrum(self.image,.02,.03,window='tukey',tukey_alpha=.37)
            np.testing.assert_array_equal(transform.call_args.args[0],expected)
        self.assertEqual(result['fft_tukey_alpha'],.37)
        self.assertNotIn('selection_window',result)

    def test_width_tracks_taper(self):
        widths=[core.tukey_power_width_bins(128,a) for a in (0,.2,.5,1)]
        self.assertEqual(sorted(widths),widths)
        self.assertAlmostEqual(widths[0],.886,delta=.02)
        self.assertAlmostEqual(widths[-1],1.44,delta=.03)

    def test_validation_and_legacy_default(self):
        engine=Engine({'demo_only':True});item=dict(array=self.image,info=self.info)
        _,settings=engine.validate(item,self.roi,{})
        self.assertEqual(settings['fft_window'],'tukey')
        self.assertEqual(settings['fft_tukey_alpha'],.5)
        for alpha in (-.1,1.1,float('nan'),float('inf')):
            with self.assertRaises(ValueError):engine.validate(item,self.roi,dict(fft_window='tukey',fft_tukey_alpha=alpha))
            with self.assertRaises(ValueError):core.prepare_fft_input(self.image,'tukey',tukey_alpha=alpha)
