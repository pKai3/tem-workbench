"""Small checks for coordinate conversion, masking and direct-mode persistence."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import diffraction
import peak_evidence
from engine import Engine
from server import Workbench
import folder_paths


def pattern():
    shape=(768, 768); centre=np.array([390.3, 372.8]); sx,sy=.03,.032
    yy,xx=np.indices(shape);rng=np.random.default_rng(7)
    array=100+rng.normal(0, .4, shape)
    vectors=np.array([[4., .6], [1., 6.8], [5., 6.2], [8., 1.2], [-4.3, 5.5]])
    observed=[]
    for i,q in enumerate(vectors):
        for sign in (1,-1):
            if i==4 and sign==-1:continue
            x,y=centre+[q[0]*sign/sx, -q[1]*sign/sy]
            array+=250*np.exp(-((xx-x)**2+(yy-y)**2)/(2*2.2**2))
            observed.append(q*sign)
    info=dict(id='synthetic.dm4',name='synthetic',sha256_pixels='synthetic-test',image_kind='diffraction',
              width=shape[1],height=shape[0],pixel_x_nm_inv=sx,pixel_y_nm_inv=sy,
              beam_center=dict(x=centre[0],y=centre[1],pairs=4,method='fixture',residual_px=0.),can_index=True)
    return array.astype(np.float32),info,np.array(observed)


class DiffractionChecks(unittest.TestCase):
    def test_units_and_centre_with_hidden_central_beam(self):
        self.assertEqual(diffraction.reciprocal_factor('1/Å'),10.)
        self.assertEqual(diffraction.reciprocal_factor('nm⁻¹'),1.)
        self.assertIsNone(diffraction.reciprocal_factor('nm'))
        array,info,_=pattern()
        found=diffraction.estimate_center(array)
        self.assertGreaterEqual(found['pairs'],4)
        self.assertLess(np.hypot(found['x']-info['beam_center']['x'],found['y']-info['beam_center']['y']),.5)
        fallback=diffraction.estimate_center(np.zeros((128,160),np.float32))
        self.assertEqual(fallback['method'],'detector_midpoint')
        self.assertEqual(fallback['pairs'],0)

    def test_native_spots_no_fft_no_invented_opposites(self):
        array,info,observed=pattern()
        engine=Engine({})
        item=dict(array=array,info=info,limits=[99.,351.])
        with patch('analysis_core.fft2',side_effect=AssertionError('Direct diffraction must not FFT pixels')):
            result=engine.analyze(item,dict(x=0,y=0,w=768,h=768),dict(scale_mode='auto_hcp_ac'),images=False)
        spectrum=result['spectrum']
        self.assertEqual(len(spectrum['peaks']),5)
        self.assertEqual(spectrum['observed_spot_count'],9)
        measured=np.array([q for p in spectrum['peaks'] for q in p['observed_spots']])
        self.assertLess(np.linalg.norm(observed[:,None]-measured[None],axis=2).min(axis=1).max(),.02)
        self.assertEqual(result['image_kind'],'diffraction')
        self.assertIsNone(result['width_nm'])
        self.assertNotIn('hann_power_fwhm_nm_inv',spectrum)
        json.dumps(result,allow_nan=False)
        with self.assertRaisesRegex(ValueError,'full detector'):
            engine.validate(item,dict(x=0,y=0,w=128,h=128),{})

    def test_opposite_spots_near_horizontal_axis_stay_one_profile(self):
        spots=[{'q':[4.,.01],'local_contrast':10.},
               {'q':[-4.,.01],'local_contrast':9.}]
        profiles=diffraction._profiles(spots,.1)
        self.assertEqual(len(profiles),1)
        self.assertLess(np.linalg.norm(profiles[0]['q']-[4.,0.]),1e-9)
        self.assertEqual(len(profiles[0]['spots']),2)

    def test_masked_pairs_are_not_missing_predictions(self):
        array,info,_=pattern();settings=diffraction.defaults(info)
        q=np.array([4.,.6]);sx,sy=info['pixel_x_nm_inv'],info['pixel_y_nm_inv']
        for sign in (1,-1):
            x=info['beam_center']['x']+sign*q[0]/sx;y=info['beam_center']['y']-sign*q[1]/sy
            settings['masks'].append(dict(x=x-14,y=y-14,w=28,h=28))
        spectrum,context=diffraction.spectrum(array,settings)
        self.assertEqual(len(spectrum['peaks']),4)
        self.assertFalse(context['visible'](np.array([q]))[0])
        model={'predicted_nodes':[{'q':q.tolist()},{'q':[1.,6.8]},{'q':[5.,6.2]},{'q':[8.,1.2]}], 'matches':[]}
        peak_evidence.inspect(model,context)
        self.assertEqual(model['peak_evidence']['nodes'][0]['status'],'unassessable')
        self.assertGreater(model['peak_evidence']['unassessable_count'],0)
        # One visible opposite is still a legitimate place to check for evidence.
        settings['masks'].pop();_,context=diffraction.spectrum(array,settings)
        self.assertTrue(context['visible'](np.array([q]))[0])

    def test_reopen_preserves_detector_settings_and_checks_reciprocal_calibration(self):
        array,info,_=pattern();settings=diffraction.defaults(info)
        settings.update(center_x=391.,pixel_x_nm_inv=.031,masks=[dict(x=30.,y=40.,w=20.,h=50.)])
        with tempfile.TemporaryDirectory() as directory:
            app=Workbench(folder_paths.DEFAULTS,root=Path(directory))
            app.engine.loaded[info['id']]={'array':array,'info':info}
            saved=app.store_region(dict(file_id=info['id'],source_hash=info['sha256_pixels'],revision=0,
                name='Detector setup',tags=[],notes='',roi=dict(x=0,y=0,w=768,h=768),settings=dict(diffraction=settings)))
            restored=app.saved_region(saved['region']['id'])
            self.assertEqual(restored['settings']['diffraction'],settings)
            with self.assertRaisesRegex(ValueError,'not a real-space phase map'):
                app.grid(app.engine.loaded[info['id']],{},5,True,5)
            info['pixel_x_nm_inv']*=1.01
            with self.assertRaisesRegex(ValueError,'calibration differs'):
                app.saved_region(saved['region']['id'])


if __name__=='__main__':unittest.main()
