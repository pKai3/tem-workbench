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
from tem_workbench.components import shared_spectra as pca

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

    def test_window_limit_matches_ordinary_grid_including_passes_and_rim(self):
        from tem_workbench.components import component_grid
        info={**INFO,'width':428,'height':428}
        options=dict(window_nm=1.28,spacing_nm=.16,components=2)
        self.assertEqual(pca.overlap_maps.MAX_WINDOWS,10000)
        for method in ('pca','nmf'):
            # The legacy rectangular viewer and the main/batch grid share the cap.
            legacy=pca.plan(info,SETTINGS,{**options,'method':method})
            self.assertEqual(legacy['count'],10000)
            overlap={**options,'layout':'square','passes':1,'sample_edges':True}
            resolved,_,grid=component_grid.options_for(info,overlap,dict(method=method),1)
            planned=pca.plan(info,SETTINGS,resolved)
            self.assertEqual(planned['count'],10000)
            self.assertEqual(planned['count'],grid['sample_count'])
            self.assertEqual(len(pca.window_samples(planned)),10000)
            with self.assertRaisesRegex(ValueError,r'10,?000'):
                pca.plan({**info,'width':432,'height':432},SETTINGS,{**options,'method':method})
            for extras in (dict(passes=3),dict(sample_edges=True)):
                # 10,000 interior windows, but extra passes or rim exceed the cap.
                with self.assertRaisesRegex(ValueError,r'10,?000'):
                    pca.plan({**info,'width':430,'height':430},SETTINGS,
                             {**options,'method':method,'layout':'square','passes':1,'sample_edges':False,**extras})
            large=pca.plan(INFO,SETTINGS,{**OPTIONS,'method':method,'spacing_nm':.8,
                            'layout':'hex','passes':9,'sample_edges':True})
            self.assertEqual(large['count'],4634)
            self.assertGreater(large['grid']['rim_sample_count'],0)

    def test_large_window_decomposition_keeps_every_row(self):
        rng=np.random.default_rng(45)
        matrix=(rng.random((10000,2),dtype=np.float32)@rng.random((2,96),dtype=np.float32))
        before=matrix.copy()
        p=pca.decompose(matrix,2)
        np.testing.assert_allclose(p['mean']+p['scores']@p['components'],matrix,atol=5e-6)
        n=pca.decompose_nmf(matrix,2,iterations=20)
        self.assertEqual(n['scores'].shape,(10000,2))
        expected=np.linalg.norm(matrix.astype(float)-n['scores']@n['components'],axis=1)
        np.testing.assert_allclose(n['residual'],expected,atol=1e-6)
        np.testing.assert_array_equal(matrix,before)

    def test_residual_blocks_preserve_errors_and_cancellation(self):
        rng=np.random.default_rng(9)
        x=rng.random((37,90),dtype=np.float32)
        scores=rng.random((37,3),dtype=np.float32)
        components=rng.random((3,90),dtype=np.float32)
        expected=np.sum((x-scores@components).astype(float)**2,axis=1)
        with patch.object(pca,'RESIDUAL_BLOCK_BYTES',90*4*5), patch.object(pca,'squared_row_norms',wraps=pca.squared_row_norms) as norms:
            actual=pca.reconstruction_errors(x,scores,components)
            self.assertGreater(norms.call_count,1)
            self.assertTrue(all(len(call.args[0])<=5 for call in norms.call_args_list))
        np.testing.assert_allclose(actual,expected,rtol=1e-7)
        cancel=threading.Event();cancel.set()
        with self.assertRaises(CancelledError):pca.reconstruction_errors(x,scores,components,cancel)

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

    def test_export_stages_locally_and_cleans_success(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);staging=base/'local';output=base/'cloud'
            original=pca.np.savez_compressed
            def save(path, **arrays):
                self.assertTrue(Path(path).is_relative_to(staging))
                self.assertFalse(output.exists())
                return original(path, **arrays)
            with patch.object(pca,'export_staging_root',return_value=staging), patch.object(pca.np,'savez_compressed',side_effect=save):
                response=pca.export(self.result,output)
            self.assertFalse(response['saved_locally'])
            self.assertEqual(list(staging.iterdir()),[])
            self.assertEqual(len(list(output.iterdir())),2)
            self.assertTrue(all(Path(path).is_file() for path in response['files']))

    def test_export_timeout_retains_complete_local_pair(self):
        # Simulate failure during sequential copying and during final publication.
        for failure in ('write','rename','mkdir'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                base=Path(folder);staging=base/'local';output=base/'cloud'
                if failure=='mkdir':output.write_text('not a directory')
                target={'write':'shutil.copyfileobj','rename':'os.replace','mkdir':'copy_export_file'}[failure]
                def fail(*args, **kwargs):
                    if failure=='write':args[1].write(b'partial')
                    raise TimeoutError(60,'Operation timed out')
                # mkdir fails naturally; the patched copy must never be reached.
                with patch.object(pca,'export_staging_root',return_value=staging), patch('tem_workbench.components.shared_spectra.'+target,side_effect=fail), self.assertLogs('tem_workbench',level='WARNING'):
                    response=pca.export(self.result,output)
                self.assertTrue(response['saved_locally'])
                self.assertIn('Complete export saved locally',response['warning'])
                self.assertEqual(response['requested_folder'],str(output))
                with np.load(response['files'][0],allow_pickle=False) as saved:
                    np.testing.assert_array_equal(saved['raw_spectra'],self.result['raw_spectra'])
                    np.testing.assert_array_equal(saved['scores'],self.result['scores'])
                    self.assertEqual(json.loads(str(saved['metadata'])),json.loads(Path(response['files'][1]).read_text()))
                if output.is_dir():self.assertEqual(list(output.iterdir()),[])

    def test_export_json_transfer_failure_retains_nmf_provenance(self):
        r={**self.result,'plan':{**self.result['plan'],'method':'nmf'},
           'contribution_share':np.array([.6,.4]),'iterations':300,'converged':False,
           'relative_reconstruction_error':.12,'fits':{'groups':[{'components':[0,1]}]},'fit_status':'complete'}
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);original=pca.copy_export_file
            def copy(source,destination):
                if source.suffix=='.json':raise TimeoutError(60,'Operation timed out')
                original(source,destination)
            with patch.object(pca,'export_staging_root',return_value=base/'local'), patch.object(pca,'copy_export_file',side_effect=copy), self.assertLogs('tem_workbench',level='WARNING'):
                response=pca.export(r,base/'cloud')
            self.assertTrue(response['saved_locally'])
            meta=json.loads(Path(response['files'][1]).read_text())
            self.assertEqual(meta['fits'],r['fits']);self.assertFalse(meta['converged'])
            self.assertEqual(meta['iterations'],300)
            cloud_npz=next((base/'cloud').glob('*.npz'))
            with np.load(cloud_npz,allow_pickle=False) as saved:
                self.assertEqual(json.loads(str(saved['metadata'])),meta)

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
        from tem_workbench.app.server import Workbench
        from tem_workbench.app.engine import Engine
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
