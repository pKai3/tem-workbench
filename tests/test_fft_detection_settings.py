"""Detector controls change peak selection, never the measured FFT pixels."""
import unittest
import base64
import json
from io import BytesIO
from PIL import Image
import numpy as np
import analysis_core as core
from engine import Engine


class FFTDetectionChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        n = 256; pixel = .03
        yy, xx = np.indices((n, n))
        frequencies = [(25, 5), (29, 5), (38, 21), (42, 39), (6, 42), (15, 60), (47, 30), (57, 19)]
        cls.image = sum(np.cos(2*np.pi*(x*xx+y*yy)/n) for x,y in frequencies).astype(np.float32)
        cls.pixel = pixel

    def test_settings_change_detection_without_changing_fft(self):
        baseline=core.spectrum(self.image,self.pixel,self.pixel)
        self.assertGreater(len(baseline['peaks']),4)
        variants=[dict(smoothing_sigma=0),dict(smoothing_sigma=1.5),dict(threshold_floor=20),
                  dict(minimum_enrichment=20),dict(minimum_separation=3.0),dict(max_peaks=4)]
        for values in variants:
            changed=core.spectrum(self.image,self.pixel,self.pixel,**values)
            np.testing.assert_array_equal(changed['log'],baseline['log'])
            self.assertEqual(changed['extent'],baseline['extent'])
        self.assertEqual(len(core.spectrum(self.image,self.pixel,self.pixel,max_peaks=4)['peaks']),4)
        self.assertEqual(core.spectrum(self.image,self.pixel,self.pixel,threshold_floor=20)['peaks'],[])
        self.assertEqual(core.spectrum(self.image,self.pixel,self.pixel,minimum_enrichment=20)['peaks'],[])
        wider=core.spectrum(self.image,self.pixel,self.pixel,minimum_separation=3.0)
        self.assertLess(len(wider['peaks']),len(baseline['peaks']))
        self.assertEqual(wider['minimum_peak_separation_nm_inv'],3.0)
        resolution=core.spectrum(self.image,self.pixel,self.pixel,minimum_separation=0)
        self.assertEqual(resolution['minimum_peak_separation_nm_inv'],resolution['peak_width_nm_inv'])
        self.assertFalse(np.array_equal(baseline['detector_signal'],core.spectrum(self.image,self.pixel,self.pixel,smoothing_sigma=1.5)['detector_signal']))
        self.assertNotEqual([p['log_radial_enrichment'] for p in baseline['peaks']],
                            [p['log_radial_enrichment'] for p in core.spectrum(self.image,self.pixel,self.pixel,smoothing_sigma=0)['peaks']])

    def test_detector_view_encodes_actual_signed_signal_without_changing_results(self):
        engine=Engine({})
        item=dict(array=self.image,info=dict(image_kind='real_space',pixel_x_nm=self.pixel,pixel_y_nm=self.pixel),limits=[-8,8])
        roi=dict(x=0,y=0,w=256,h=256)
        settings=dict(enabled_phases=[],fft_smoothing_sigma=1.5)
        result=engine.analyze(item,roi,settings,images=True)
        expected=core.spectrum(self.image,self.pixel,self.pixel,smoothing_sigma=1.5)['detector_signal']
        lo,hi=result['images']['detector_signal_limits']
        self.assertLess(lo,0)
        self.assertEqual([lo,hi],[float(expected.min()),float(expected.max())])
        raw=base64.b64decode(result['images']['detector_signal16'].split(',',1)[1])
        rgb=np.asarray(Image.open(BytesIO(raw)),dtype=np.uint16)
        decoded=((rgb[...,0]<<8)|rgb[...,1])/65535*(hi-lo)+lo
        np.testing.assert_allclose(decoded,expected,atol=(hi-lo)/65535+1e-6,rtol=0)
        numerical=engine.analyze(item,roi,settings,images=False)
        self.assertEqual(result['spectrum'],numerical['spectrum'])
        self.assertEqual(result['models'],numerical['models'])
        self.assertNotIn('detector_signal',result['spectrum'])
        json.dumps(result,allow_nan=False)

    def test_old_defaults_unchanged(self):
        # Explicit settings must also reproduce implicit defaults exactly.
        implicit=core.spectrum(self.image,self.pixel,self.pixel)
        explicit=core.spectrum(self.image,self.pixel,self.pixel,smoothing_sigma=.65,
                               threshold_floor=1.8,minimum_enrichment=3.,minimum_separation=.12,max_peaks=70)
        self.assertEqual(implicit['peaks'],explicit['peaks'])
        np.testing.assert_array_equal(implicit['log'],explicit['log'])

    def test_validation_and_analyze_propagate_detector_settings(self):
        engine=Engine({});item=dict(array=self.image,info=dict(image_kind='real_space',pixel_x_nm=self.pixel,pixel_y_nm=self.pixel),limits=[-800,800])
        roi=dict(x=0,y=0,w=256,h=256)
        controls=dict(fft_smoothing_sigma=.3,fft_threshold_floor=2.1,fft_minimum_enrichment=3.2,fft_minimum_separation=.6,fft_max_peaks=4,enabled_phases=[])
        _,values=engine.validate(item,roi,controls)
        for key,value in controls.items():self.assertEqual(values[key],value)
        result=engine.analyze(item,roi,controls,images=False)
        self.assertEqual(result['settings']['fft_smoothing_sigma'],.3)
        self.assertEqual(result['spectrum']['max_peak_profiles'],4)
        self.assertEqual(result['spectrum']['minimum_peak_separation_nm_inv'],.6)
        self.assertLessEqual(len(result['spectrum']['peaks']),4)
        for bad in [dict(fft_smoothing_sigma=-1),dict(fft_threshold_floor=float('nan')),
                    dict(fft_minimum_enrichment=21),dict(fft_minimum_separation=-.1),
                    dict(fft_max_peaks=3),dict(fft_max_peaks=4.5),dict(fft_max_peaks=float('inf'))]:
            with self.assertRaises(ValueError):engine.validate(item,roi,bad)


if __name__=='__main__':unittest.main()
