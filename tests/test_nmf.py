"""Nonnegative decomposition and exhaustive fitting checks; no microscope data."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from concurrent.futures import CancelledError
from unittest.mock import patch
import numpy as np
import shared_spectra as spectra
import nmf_fitting as fitting
import scale_fitting
import analysis_core as core
from test_shared_spectra import INFO, SETTINGS, OPTIONS


def factor_result(k=2):
    plan=spectra.plan(INFO,SETTINGS,{**OPTIONS,'method':'nmf','components':k})
    radii,angles,weights=spectra.axes(plan)
    h=np.zeros((k,weights.size),np.float32)
    for i in range(k):h[i,(20+i*4)*spectra.ANGULAR_BINS+15+i*20]=1
    w=np.ones((plan['count'],k),np.float32)
    return dict(plan=plan,settings={**SETTINGS,'scale_mode':'fixed'},components=h,scores=w,
                radii=radii,angles=angles,area_weights=weights,raw_spectra=w@h/weights.ravel())


class NmfTests(unittest.TestCase):
    def test_nonnegative_repeatable_reconstruction(self):
        rng=np.random.default_rng(5)
        # Distinct spectral supports and anchor windows make this identifiable.
        h=np.zeros((2,80),np.float32);h[0,:40]=rng.uniform(.3,1,40);h[1,40:]=rng.uniform(.3,1,40)
        w=rng.random((30,2),dtype=np.float32);w[:10,1]=0;w[10:20,0]=0
        x=w@h;before=x.copy();progress=[]
        r=spectra.decompose_nmf(x,2,progress=lambda *args:progress.append(args))
        again=spectra.decompose_nmf(x,2)
        self.assertTrue((r['scores']>=0).all() and (r['components']>=0).all())
        self.assertLess(r['relative_reconstruction_error'],.02)
        np.testing.assert_allclose(r['components'].sum(axis=1),1,atol=1e-6)
        np.testing.assert_array_equal(r['scores'],again['scores'])
        np.testing.assert_array_equal(x,before)
        self.assertAlmostEqual(r['contribution_share'].sum(),1)
        self.assertTrue(progress and progress[-1][0]<=300)
        for bad in (-x,np.zeros_like(x),np.full_like(x,np.nan)):
            with self.assertRaises(ValueError):spectra.decompose_nmf(bad,2)
        stop=threading.Event();stop.set()
        with self.assertRaises(CancelledError):spectra.decompose_nmf(x,2,stop)

    def test_combination_rescaling_and_nonoverlap(self):
        r=factor_result();a=fitting.group_spectrum(r,[0,1])
        changed=copy.deepcopy(r);changed['components'][0]*=7;changed['scores'][:,0]/=7
        b=fitting.group_spectrum(changed,[0,1])
        np.testing.assert_allclose(a[0],b[0],rtol=1e-6)
        self.assertEqual(a[2],b[2])
        r['scores'][:25,1]=0;r['scores'][25:,0]=0
        spectrum,_,common,windows=fitting.group_spectrum(r,[0,1])
        self.assertEqual(common,0);self.assertEqual(windows,[]);self.assertGreater(spectrum.sum(),0)

    def test_exhaustive_above_six_and_partial_cancellation(self):
        r=factor_result(7);progress=[]
        fits=fitting.fit_groups(r,[],{},progress=lambda *v:progress.append(v))
        self.assertEqual(fits['total'],127);self.assertEqual(len(fits['groups']),127)
        self.assertEqual(len({tuple(g['components']) for g in fits['groups']}),127)
        self.assertEqual(fits['groups'][-1]['components'],list(range(7)))
        self.assertEqual(progress[-1][:2],(127,127))
        cancel=threading.Event()
        def stop(done,*_):
            if done==3:cancel.set()
        with self.assertRaises(CancelledError):fitting.fit_groups(r,[],{},cancel,stop)
        self.assertEqual(r['fits']['completed'],3)
        with self.assertRaises(ValueError):fitting.validate_options({**r,'plan':{'method':'pca'}},{})

    def test_calibrated_split_bcc_recovered_and_checked(self):
        templates=json.loads((Path(__file__).resolve().parents[1]/'templates.json').read_text())
        for t in templates:
            for key in ('hkl','q','g'):t[key]=np.array(t[key])
        templates=scale_fitting.prepare_templates(templates)
        t=next(t for t in templates if t['phase']=='BCC' and t['zone_3index']==[1,-3,-1])
        q=core.canonical(core.rotation(scale_fitting.prediction_points(t,1,1),.47))
        q=q[(np.linalg.norm(q,axis=1)>2.6)&(np.linalg.norm(q,axis=1)<9.8)]
        r=factor_result();radius,angle=np.meshgrid(r['radii'],r['angles'],indexing='ij')
        h=np.zeros_like(r['components'])
        for i,(qx,qy) in enumerate(q):
            delta=(angle-np.arctan2(qy,qx)+np.pi/2)%np.pi-np.pi/2
            h[i%2]+=np.exp(-.5*((radius-np.hypot(qx,qy))/.06)**2-.5*(delta/.009)**2).ravel()*r['area_weights'].ravel()
        r['components']=h;r['raw_spectra']=r['scores']@h/r['area_weights'].ravel()
        fits=fitting.fit_groups(r,[t],{})
        group=fits['groups'][-1];best=group['candidates'][0]
        self.assertEqual(best['phase'],'BCC');self.assertTrue(best['valid']);self.assertGreater(best['coverage'],.9)
        self.assertLess(best['rms_nm_inv'],.09)
        self.assertEqual(len(group['support_checks']),3)
        self.assertGreater(group['support_checks'][0]['coverage'],.9)
        self.assertLessEqual(group['peak_count'],len(q))
        json.dumps(fits,allow_nan=False)
        r['settings'].update(scale_mode='auto_uniform',scale_penalty_strength=.1)
        best=fitting.fit_groups(r,[t],{})['groups'][-1]['candidates'][0]
        self.assertIn('scale_penalty',best)
        self.assertAlmostEqual(best['fitted_a_nm'],.33,delta=.01)

    def test_export_and_background_fit_cancel_preserve_factors(self):
        y,x=np.indices((512,512));image=np.cos(2*np.pi*.04*4*x)+np.cos(2*np.pi*.04*5*y)*(x>256)
        r=spectra.compute(image,INFO,SETTINGS,{**OPTIONS,'method':'nmf','components':2})
        self.assertEqual(spectra.summary(r)['decomposition'],'nmf')
        self.assertEqual(spectra.sample(r,0,[0,1])['negative_fraction'],0)
        manager=spectra.SharedSpectra();manager.result=r;manager.job=dict(id='test',state='complete',started=time.monotonic())
        started=threading.Event();release=threading.Event()
        def slow(*args):
            r['fits']={'total':3,'completed':1,'groups':[]};started.set();release.wait(2);spectra.check_cancel(args[3])
        with patch.object(fitting,'fit_groups',side_effect=slow):
            manager.fit('test',[],{});self.assertTrue(started.wait(1))
            self.assertEqual(manager.status('test')['total'],3)
            manager.cancel.set();release.set();manager.thread.join(3)
        self.assertIs(manager.completed('test'),r);self.assertEqual(r['fit_status'],'cancelled')
        with self.assertRaises(ValueError):manager.fit('test',[],{'peak_fraction':0})
        self.assertIs(manager.completed('test'),r)
        manager.fit('test',[],{});manager.thread.join(5)
        self.assertEqual(r['fit_status'],'complete');self.assertEqual(r['fits']['completed'],3)
        with tempfile.TemporaryDirectory() as folder:
            files=spectra.export(r,folder)['files']
            with np.load(files[0],allow_pickle=False) as saved:
                meta=json.loads(str(saved['metadata']))
                self.assertEqual(meta['plan']['method'],'nmf');self.assertEqual(meta['fits']['completed'],3)
                np.testing.assert_allclose(saved['scores']@saved['components'],r['scores']@r['components'])
                self.assertEqual(meta,json.loads(Path(files[1]).read_text()))

if __name__=='__main__':unittest.main()
