"""Diagnostic sampling and passive tracing must not change analysis results."""
import unittest
import numpy as np
from tools.crop_size_diagnostic import sampling_plan, RecordingEngine, expected_match
from engine import Engine

class CropDiagnosticTests(unittest.TestCase):
    def test_plan_same_centres_no_clipping(self):
        info=dict(width=4096,height=4096,pixel_x_nm=.009806843474507332,pixel_y_nm=.009806843474507332)
        plan=sampling_plan(info)
        self.assertEqual(len(plan),47)
        self.assertEqual(len(sampling_plan(info,smoothing=True)),63)
        for job in plan:
            r=job['roi'];self.assertGreaterEqual(r['x'],0);self.assertGreaterEqual(r['y'],0)
            self.assertLessEqual(r['x']+r['w'],4096);self.assertLessEqual(r['y']+r['h'],4096)
        physical=[j for j in sampling_plan(info,smoothing=True) if j['variant']=='physical']
        for j in physical:self.assertAlmostEqual(j['sigma_bins']/j['size_nm'],.065)
        self.assertEqual(plan[-1]['roi'],dict(x=0,y=0,w=4096,h=4096))

    def test_expected_orientation_is_only_an_evaluator(self):
        model=dict(phase='HCP',zone_3index=[0,1,-1],mirror=1,rotation_deg=179.)
        self.assertTrue(expected_match(model,dict(phase='HCP',zone=[0,1,-1],rotation=1.,rotation_tolerance=5)))
        self.assertFalse(expected_match(model,dict(phase='HCP',zone=[1,0,0])))

    def test_recording_engine_identical_in_all_modes(self):
        n=96;y,x=np.indices((n,n));a=sum(np.cos(2*np.pi*(u*x+v*y)/n) for u,v in [(12,2),(2,14),(14,16),(24,4),(4,28)]).astype('float32')
        item=dict(array=a,info=dict(image_kind='real_space',pixel_x_nm=.03,pixel_y_nm=.03),limits=[-5,5]);roi=dict(x=0,y=0,w=n,h=n)
        for mode in ['manual','geometry','rank']:
            settings=dict(scale_mode='fixed',enabled_phases=['HCP'],fft_auto_strength=mode!='manual',fft_auto_objective='geometry' if mode=='geometry' else 'rank')
            plain=Engine({}).analyze(item,roi,settings,images=False)
            engine=RecordingEngine({});engine.fit_trials=[];recorded=engine.analyze(item,roi,settings,images=False)
            plain.pop('elapsed_ms');recorded.pop('elapsed_ms')
            self.assertEqual(plain,recorded)
            self.assertGreaterEqual(len(engine.fit_trials),1)

if __name__=='__main__':unittest.main()
