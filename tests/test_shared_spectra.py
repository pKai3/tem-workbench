"""Numerical controls for exploratory PCA, including smooth lattice drift."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from concurrent.futures import CancelledError
from unittest.mock import patch
import numpy as np
from scipy import linalg
import shared_spectra as pca

INFO=dict(width=512,height=512,pixel_x_nm=.04,pixel_y_nm=.04,image_kind='real_space',name='synthetic',sha256_pixels='test-hash')
SETTINGS=dict(g_min=2.5,g_max=10.,fft_window='tukey',fft_tukey_alpha=.5,remove_mean=True)
OPTIONS=dict(window_nm=5.12,spacing_nm=2.56,components=4)

class SharedSpectraTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        y,x=np.indices((512,512));cls.image=(np.cos(2*np.pi*.04*4*x)+np.cos(2*np.pi*.04*5*y)*(x>256)).astype(np.float32)
        cls.result=pca.compute(cls.image,INFO,SETTINGS,OPTIONS)

    def test_two_patterns_localize_without_labels_and_preserve_input(self):
        before=self.image.copy();r=self.result
        self.assertGreater(r['explained_variance_ratio'][0],.9)
        score=r['scores'][:,0].reshape(r['plan']['map_shape'])
        self.assertLess(score[:,:3].max(),0);self.assertGreater(score[:,4:].min(),0)
        self.assertLess(np.ptp(score[:,:3]),.001)
        self.assertGreater(r['explained_variance_ratio'].sum(),.99)
        np.testing.assert_array_equal(before,self.image)
        self.assertNotIn('classification',r)

    def test_exact_pca_reconstruction_and_total_variance(self):
        rng=np.random.default_rng(4);a=rng.normal(size=(25,3))@rng.normal(size=(3,90))+7
        r=pca.decompose(a.astype(np.float32),3)
        np.testing.assert_allclose(r['mean']+r['scores']@r['components'],a,atol=2e-5)
        self.assertAlmostEqual(sum(r['explained_variance_ratio']),1,places=5)
        self.assertGreater(r['explained_variance_ratio'][0],r['explained_variance_ratio'][1])

    def test_randomized_solver_and_deterministic_subspace(self):
        rng=np.random.default_rng(3);a=(rng.normal(size=(100,5))@rng.normal(size=(5,300))).astype(np.float32)
        r=pca.decompose(a,5);again=pca.decompose(a,5)
        self.assertIn('randomized',r['algorithm'])
        np.testing.assert_allclose(r['scores'],again['scores'],atol=1e-6)
        np.testing.assert_allclose(r['mean']+r['scores']@r['components'],a,atol=3e-5)
        self.assertAlmostEqual(r['explained_variance_ratio'].sum(),1,places=5)

    def test_drift_smoothing_reduces_variation_without_changing_raw_spectra(self):
        plan=pca.plan(INFO,SETTINGS,OPTIONS);r,a,w=pca.axes(plan)
        radius,angle=np.meshgrid(r,a,indexing='ij')
        def spot(deg,scale=1):
            delta=(angle-np.deg2rad(deg)+np.pi/2)%np.pi-np.pi/2
            return np.exp(-.5*((radius-5*scale)/.08)**2-.5*(delta/np.deg2rad(.7))**2).astype(np.float32)
        first,second=spot(.5),spot(3.5,1.02);before=second.copy()
        plain=[pca.features(s,plan,w)[0] for s in [first,second]]
        smooth_plan={**plan,'angular_sigma_deg':3,'spacing_sigma_percent':3}
        smooth=[pca.features(s,smooth_plan,w)[0] for s in [first,second]]
        self.assertLess(np.linalg.norm(smooth[0]-smooth[1]),.65*np.linalg.norm(plain[0]-plain[1]))
        # A genuinely separated orientation must still be distinguishable.
        far=pca.features(spot(40),smooth_plan,w)[0]
        self.assertGreater(np.linalg.norm(far-smooth[0]),1.)
        np.testing.assert_array_equal(second,before)
        # Smoothing across 0/180 has no artificial seam.
        near=pca.features(spot(179.5),smooth_plan,w)[0]
        self.assertLess(np.linalg.norm(near-smooth[0]),np.linalg.norm(smooth[1]-smooth[0]))

    def test_common_grid_calibration_and_antipodal_symmetry(self):
        plan=pca.plan(INFO,SETTINGS,OPTIONS);r,a,_=pca.axes(plan)
        n=128;y,x=np.indices((n,n));crop=np.cos(2*np.pi*.04*(4*x-3*y))
        s=pca.local_spectrum(crop,plan,SETTINGS,r,a)
        peak=np.unravel_index(np.argmax(s),s.shape)
        self.assertAlmostEqual(r[peak[0]],5,delta=.18)
        self.assertAlmostEqual(np.degrees(a[peak[1]]),36.87,delta=1.5)
        np.testing.assert_allclose(s,pca.local_spectrum(-crop,plan,SETTINGS,r,a),atol=1e-5)
        anisotropic={**INFO,'width':1024,'pixel_x_nm':.02}
        ap=pca.plan(anisotropic,SETTINGS,OPTIONS)
        self.assertEqual(ap['window_pixels'],[256,128])
        self.assertEqual(ap['window_nm'],[5.12,5.12])

    def test_validation_and_no_silent_subsampling(self):
        for opts in ({'spacing_nm':.04},{'window_nm':100},{'components':2.5},{'angular_sigma_deg':float('nan')},{'normalization':'fake'}):
            with self.assertRaises(ValueError):pca.plan(INFO,SETTINGS,{**OPTIONS,**opts})
        for settings in ({**SETTINGS,'g_min':0},{**SETTINGS,'g_max':15}):
            with self.assertRaises(ValueError):pca.plan(INFO,settings,OPTIONS)
        with self.assertRaises(ValueError):pca.plan({**INFO,'image_kind':'diffraction'},SETTINGS,OPTIONS)
        with self.assertRaises(ValueError):pca.decompose(np.ones((8,12),np.float32),4)
        cancel=threading.Event();cancel.set()
        with self.assertRaises(CancelledError):pca.compute(self.image,INFO,SETTINGS,OPTIONS,cancel)

    def test_samples_share_scale_and_exports_reconstruct(self):
        r=self.result;s=pca.sample(r,0,[0,1])
        self.assertEqual(s['raw']['limits'],s['processed']['limits'])
        self.assertEqual(s['raw']['limits'],s['reconstruction']['limits'])
        self.assertEqual(s['selected'],[0,1])
        with self.assertRaises(ValueError):pca.sample(r,999,[0])
        with self.assertRaises(ValueError):pca.sample(r,0,[])
        json.dumps(pca.summary(r),allow_nan=False)
        with tempfile.TemporaryDirectory() as folder:
            files=pca.export(r,folder)['files']
            with np.load(files[0],allow_pickle=False) as saved:
                meta=json.loads(str(saved['metadata']))
                self.assertEqual(meta['source']['sha256_pixels'],'test-hash')
                np.testing.assert_array_equal(saved['scores'],r['scores'])
                np.testing.assert_array_equal(saved['raw_spectra'],r['raw_spectra'])
                self.assertEqual(saved['positions'].shape,(r['plan']['count'],4))
                self.assertEqual(meta,json.loads(Path(files[1]).read_text()))

    def test_component_display_raster_preserves_sign_and_exclusions(self):
        import base64
        r=self.result;p=r['plan']
        polar=r['components'][0]/r['area_weights'].ravel()
        values,valid=pca.cartesian(polar,p)
        display=pca.component_image(polar,p,True)
        raster=np.frombuffer(base64.b64decode(display['raster']),np.uint8).reshape(values.shape)
        self.assertTrue(np.all(raster[~valid]==255))
        self.assertTrue(np.all(raster[valid]<255))
        lo,hi=display['limits']
        self.assertEqual(lo,-hi)
        recovered=lo+raster[valid].astype(float)/254*(hi-lo)
        np.testing.assert_allclose(recovered,values[valid],atol=(hi-lo)/508+1e-12)

    def test_server_start_uses_validated_source_snapshot_and_guards_jobs(self):
        from types import SimpleNamespace
        from server import Workbench
        from engine import Engine
        app=Workbench.__new__(Workbench)
        app.lock=threading.RLock();app.job_lock=threading.RLock()
        app.closing=False;app.grid_thread=None
        app.batch=SimpleNamespace(running=lambda:False)
        app.window_probe=SimpleNamespace(running=lambda:False)
        app.pca=pca.SharedSpectra()
        info=dict(INFO);item=dict(array=self.image,info=info)
        with tempfile.TemporaryDirectory() as folder:
            engine=Engine.__new__(Engine)
            engine.load=lambda file_id:item
            engine.output_for=lambda file_id:Path(folder)
            app.engine=engine
            request=dict(file_id='test',roi=dict(x=0,y=0,w=128,h=128),settings=dict(SETTINGS),options=dict(OPTIONS))
            job=app.start_pca(request)
            info['name']='changed after start'
            app.pca.thread.join(10)
            result=app.pca.completed(job['id'])
            self.assertEqual(result['source']['name'],'synthetic')
            self.assertEqual(result['settings']['fft_window'],'tukey')
            self.assertEqual(result['plan']['count'],49)
            self.assertEqual(app.pca.folder,Path(folder))
            app.batch=SimpleNamespace(running=lambda:True)
            with self.assertRaisesRegex(ValueError,'grid, batch or size check'):
                app.start_pca(request)

    def test_background_job_cancellation_and_stale_identity(self):
        manager=pca.SharedSpectra();started=threading.Event();release=threading.Event()
        def slow(*args):
            started.set();release.wait(2);pca.check_cancel(args[4]);return self.result
        with tempfile.TemporaryDirectory() as folder,patch.object(pca,'compute',side_effect=slow):
            j=manager.start(dict(array=self.image,info=INFO),SETTINGS,OPTIONS,folder)
            self.assertTrue(started.wait(1))
            with self.assertRaises(ValueError):manager.start(dict(array=self.image,info=INFO),SETTINGS,OPTIONS,folder)
            with self.assertRaises(ValueError):manager.status('old')
            manager.cancel.set();release.set();manager.thread.join(3)
            self.assertEqual(manager.status(j['id'])['state'],'cancelled')
            with self.assertRaises(ValueError):manager.completed(j['id'])

if __name__=='__main__':unittest.main()
