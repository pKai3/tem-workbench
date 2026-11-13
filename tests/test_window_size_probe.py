import copy
import threading
import unittest
from concurrent.futures import CancelledError
from tem_workbench.mapping.window_size_probe import WindowSizeProbe, plan, summarize

INFO = dict(width=1024,height=1024,pixel_x_nm=.02,pixel_y_nm=.02,image_kind='real_space')
SETTINGS = dict(fft_smoothing_sigma=.65,g_max=10,fft_auto_strength=False,fft_auto_objective='rank')

def fit(phase='HCP', zone=None, rotation=0):
    return dict(phase=phase,zone=zone or [1,0,0],mirror=False,rotation=rotation,rank=.6,rms=.04)

def rows():
    data,_,_=plan(INFO,SETTINGS,2)
    for row in data:
        row['samples']=[dict(models=[fit('BCC' if i==3 else 'HCP')],dual=False) for i in range(5)]
    return data

class SizeProbeTests(unittest.TestCase):
    def test_plan_paired_centres_and_physical_smoothing(self):
        data,q,anchor=plan(INFO,SETTINGS,2)
        self.assertEqual(len(data),4)
        self.assertEqual(anchor,2)
        for row in data:
            self.assertAlmostEqual(row['sigma_bins']/row['width_nm'],q)
            for roi,(fx,fy) in zip(row['rois'],((.25,.25),(.75,.25),(.5,.5),(.25,.75),(.75,.75))):
                self.assertLessEqual(abs(roi['x']+roi['w']/2-fx*1024),.5)
                self.assertLessEqual(abs(roi['y']+roi['h']/2-fy*1024),.5)
        self.assertEqual(SETTINGS['fft_smoothing_sigma'],.65)

    def test_fixed_bins_choice(self):
        data,_,_=plan(INFO,SETTINGS,2,'bins')
        self.assertEqual({r['sigma_bins'] for r in data},{.65})
        self.assertGreater(len({r['sigma_bins']/r['width_nm'] for r in data}),1)
        with self.assertRaises(ValueError):plan(INFO,SETTINGS,2,'invalid')

    def test_skips_unsupported_sizes_without_clamping(self):
        data,_,_=plan(INFO,{**SETTINGS,'fft_smoothing_sigma':3},2)
        self.assertIsNotNone(data[-1]['skip'])
        with self.assertRaises(ValueError):plan({**INFO,'width':128,'height':128},SETTINGS,2)
        with self.assertRaises(ValueError):plan({**INFO,'pixel_y_nm':.03},SETTINGS,2)
        with self.assertRaises(ValueError):plan({**INFO,'image_kind':'diffraction'},SETTINGS,2)

    def test_stable_range_allows_spatially_different_phases(self):
        data=rows();r=summarize(data)
        self.assertEqual((r['small'],r['large']),(0,3))
        self.assertEqual(data[0]['stable_sites'],5)

    def test_second_geometry_favours_small_not_lost_evidence(self):
        data=rows()
        for row in data[2:]:
            for sample in row['samples']:sample['dual']=True
        r=summarize(data)
        self.assertEqual((r['small'],r['large']),(0,1))
        self.assertEqual(data[1]['resolved_sites'],5)
        # Merely deleting all passing fits at smaller sizes is not resolution.
        for row in data[:2]:
            for sample in row['samples']:sample['models']=[]
        r=summarize(data)
        self.assertEqual((r['small'],r['large']),(2,3))
        self.assertIn('persists',r['message'])

    def test_no_stable_fit_no_recommendation(self):
        data=rows()
        for i,row in enumerate(data):
            for s in row['samples']:s['models'][0]['rotation']=i*12
        self.assertIsNone(summarize(data)['small'])
        for row in data:
            for s in row['samples']:s['models']=[]
        self.assertIsNone(summarize(data)['small'])

    def test_dual_resolution_may_change_leader_but_not_invent_fit(self):
        data=rows()
        for row in data[1:]:
            for sample in row['samples']:
                sample['models']=[fit('FCC')]+sample['models'];sample['dual']=True
        r=summarize(data)
        self.assertEqual((r['small'],r['large']),(0,0))

    def test_runs_selected_mode_without_images_and_cancels(self):
        for mode in ('manual','geometry','rank'):
            calls=[]
            class FakeEngine:
                def analyze(self,item,roi,settings,**kwargs):
                    calls.append((copy.deepcopy(settings),kwargs))
                    return dict(models=[dict(phase='HCP',valid=True,zone_3index=[1,0,0],mirror=False,rotation_deg=0,score=.6,rms_nm_inv=.04)],periodicity={},classification=dict(label='hcp_compatible'),spectrum=dict(peaks=[1,2,3,4]))
            settings={**SETTINGS,'fft_auto_strength':mode!='manual','fft_auto_objective':'geometry' if mode=='geometry' else 'rank'}
            probe=WindowSizeProbe();job=probe.start(FakeEngine(),{'info':INFO},settings,2,'source')
            probe.thread.join(3);status=probe.status(job['id'])
            self.assertEqual(status['state'],'complete');self.assertEqual(status['completed'],20)
            for s,k in calls:
                self.assertEqual(s['fft_auto_strength'],settings['fft_auto_strength'])
                self.assertEqual(s['fft_auto_objective'],settings['fft_auto_objective']);self.assertFalse(k['images'])
            self.assertEqual(settings['fft_smoothing_sigma'],.65)
        entered=threading.Event()
        class WaitingEngine:
            def analyze(self,*args,**kwargs):
                entered.set();kwargs['cancel_event'].wait(3);raise CancelledError()
        probe=WindowSizeProbe();job=probe.start(WaitingEngine(),{'info':INFO},SETTINGS,2,'source')
        self.assertTrue(entered.wait(1))
        with self.assertRaises(ValueError):probe.start(WaitingEngine(),{'info':INFO},SETTINGS,2,'source')
        probe.cancel.set();probe.thread.join(2)
        self.assertEqual(probe.status(job['id'])['state'],'cancelled')
        self.assertIsNone(probe.status(job['id'])['recommendation'])

if __name__=='__main__':unittest.main()
