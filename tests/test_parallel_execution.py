"""Spawn integration and coordinator interruption checks without source DM4 files."""
from concurrent.futures import CancelledError, ThreadPoolExecutor, Future
from pathlib import Path
import threading
import queue
import time
import unittest
from unittest.mock import patch
import numpy as np
from engine import Engine
from parallel_execution import RegionPool, worker_count
from server import Workbench
import diffraction


def image():
    n=256; yy,xx=np.indices((n,n))
    pixels=sum((i+1)*np.cos(2*np.pi*(x*xx+y*yy)/n) for i,(x,y) in enumerate([(25,5),(29,5),(38,21),(42,39),(6,42),(15,60)])).astype(np.float32)
    return dict(array=pixels,info=dict(width=n,height=n,image_kind='real_space',pixel_x_nm=.03,pixel_y_nm=.03),limits=[-40,40])


def comparable(result):
    return {k:v for k,v in result.items() if k!='elapsed_ms'}


class SpawnChecks(unittest.TestCase):
    def test_serial_and_spawn_match_and_reweight(self):
        engine=Engine({}); item=image(); roi=dict(x=0,y=0,w=256,h=256)
        settings=dict(scale_mode='auto_hcp_ratio',fft_auto_strength=True,enabled_phases=['HCP','BCC'])
        expected=engine.analyze(item,roi,settings,images=False,cache_candidates=True)
        pool=RegionPool(item,settings,{},engine.version,2)
        directory=Path(pool.directory.name)
        try:
            jobs=[pool.submit(roi),pool.submit(roi)]
            for future in jobs:
                actual=future.result(timeout=30)
                self.assertEqual(comparable(expected),comparable(actual))
                self.assertEqual(comparable(engine.rescore(expected,.07,.25,.12)),comparable(engine.rescore(actual,.07,.25,.12)))
            self.assertEqual(np.load(directory/'source.npy',mmap_mode='r').flags.writeable,False)
            pool.cancel()
            with self.assertRaises(CancelledError):pool.submit(roi).result(timeout=10)
        finally:pool.close()
        self.assertFalse(directory.exists())

    def test_diagnostics_reports_stages_and_preserves_current_roi(self):
        pool=RegionPool.__new__(RegionPool);pool.events=queue.Queue();pool.states={}
        roi=dict(x=0,y=0,w=128,h=128)
        for stage,detail in [('initializing',None),('ready',{'python':'3.14'}),('analyzing',roi)]:
            pool.events.put((123,stage,detail))
        with self.assertLogs('tem_workbench.grid_diagnostics',level='INFO') as logs:
            state=pool.diagnostics()
        self.assertEqual(state[0]['stage'],'analyzing')
        self.assertEqual(state[0]['detail'],roi)
        self.assertTrue(any('ready' in line for line in logs.output))
        self.assertTrue(any('analyzing' in line for line in logs.output))
        pool.events.put((123,'analysis failed','test traceback'))
        with self.assertLogs('tem_workbench.grid_diagnostics',level='INFO') as logs:
            pool.diagnostics()
        self.assertIn('test traceback',logs.output[0])

    def test_worker_limit_validation(self):
        for value in [-1,17,True,2.5,'2']:
            with self.assertRaises(ValueError):worker_count(value)
        with patch('parallel_execution.os.cpu_count',return_value=2):
            self.assertEqual(worker_count(),1)
            self.assertEqual(worker_count(16),16)

    def test_detector_worker_validation_and_cache(self):
        from test_diffraction import pattern
        array,info,_=pattern()
        for value in [-1,17,True,2.5,'2']:
            with self.assertRaises(ValueError):diffraction.validate(info,{'smoothing_workers':value})
        with patch('diffraction.os.cpu_count',return_value=32):
            for count in (10,12,14,16):
                self.assertEqual(diffraction.smoothing_worker_count(count),count)
        with patch('diffraction.os.cpu_count',return_value=1):
            self.assertEqual(diffraction.smoothing_worker_count(8),1)
        settings=diffraction.validate(info,{'smoothing_workers':1}); cache={}
        with patch.object(diffraction,'_prepare_detector',return_value={'spots':[]}) as prepare:
            a=diffraction._cached_detector(array,settings,cache)
            b=diffraction._cached_detector(array,{**settings,'smoothing_workers':4},cache)
            self.assertIs(a,b);self.assertEqual(prepare.call_count,1)

    def test_detector_threads_are_numerically_identical(self):
        from test_diffraction import pattern
        array,info,_=pattern(); settings=diffraction.defaults(info)
        a=diffraction._prepare_detector(array,{**settings,'smoothing_workers':1})
        b=diffraction._prepare_detector(array,{**settings,'smoothing_workers':2})
        np.testing.assert_array_equal(a.pop('log'),b.pop('log'))
        np.testing.assert_array_equal(a.pop('detector_signal'),b.pop('detector_signal'))
        self.assertEqual(a,b)


class CoordinatorChecks(unittest.TestCase):
    def app(self):
        app=Workbench.__new__(Workbench)
        app.engine=Engine({});app.jobs={};app.grid_thread=None;app.closing=False
        app.lock=threading.RLock();app.job_lock=threading.RLock()
        return app

    def test_page_reconnect_discovers_job_without_starting_or_cancelling_it(self):
        app=self.app();item=image();item['info'].update(id='source',sha256_pixels='pixels')
        class StalledPool:
            def __init__(self,*args):pass
            def submit(self,roi):return Future()
            def diagnostics(self):return []
            def close(self):pass
        self.assertIsNone(app.grid_summary())
        with patch('server.RegionPool',StalledPool) as pool:
            job_id=app.grid(item,{'enabled_phases':['BCC']},2,False,1,workers=0)['id']
            try:
                summary=app.grid_summary()
                self.assertEqual(summary['id'],job_id)
                self.assertEqual(summary['state'],'running')
                self.assertEqual(summary['execution']['requested_workers'],0)
                self.assertEqual(set(summary),{'id','state','source','settings','grid','execution'})
                summary['settings']['enabled_phases'].append('HCP')
                summary['source']['id']='changed'
                self.assertEqual(app.jobs[job_id]['settings']['enabled_phases'],['BCC'])
                self.assertEqual(app.jobs[job_id]['source']['id'],'source')
                self.assertFalse(app.jobs[job_id]['cancel'])
                self.assertNotIn('_batch',app.status(job_id,full=True))
            finally:
                app.cancel_grid(job_id);app.grid_thread.join(3)
        self.assertEqual(app.grid_summary()['state'],'cancelled')
        for state in ['complete','error']:
            app.jobs[job_id]['state']=state
            self.assertEqual(app.grid_summary()['state'],state)
        # Batch jobs reconnect through their own controls, never the interactive grid.
        app.jobs[job_id]['_batch']=True
        self.assertIsNone(app.grid_summary())
        app.jobs.clear()
        self.assertIsNone(app.grid_summary())
        app.close()

    def test_wait_is_logged_before_any_region_completes(self):
        app=self.app();item=image()
        class StalledPool:
            def __init__(self,*args):pass
            def submit(self,roi):return Future()
            def diagnostics(self):return []
            def close(self):pass
        with patch('server.RegionPool',StalledPool), patch('server.GRID_WAIT_LOG_SECONDS',.01):
            with self.assertLogs('tem_workbench.grid_diagnostics',level='WARNING') as logs:
                job_id=app.grid(item,{},2,False,1,workers=2)['id']
                deadline=time.monotonic()+3
                while not logs.output and time.monotonic()<deadline:time.sleep(.02)
                app.cancel_grid(job_id);app.grid_thread.join(3)
            self.assertTrue(any('no worker initialization received' in line for line in logs.output))
        self.assertEqual(app.jobs[job_id]['processed'],0)
        self.assertEqual(app.jobs[job_id]['state'],'cancelled')
        app.close()

    def test_error_in_child_group_keeps_complete_parent_coverage(self):
        self.check_interruption(error=True)

    def test_cancel_during_child_group_keeps_parent_and_blocks_new_grid(self):
        self.check_interruption(error=False)

    def check_interruption(self,error):
        app=self.app();item=image(); reached=threading.Event(); release=threading.Event()
        class FakePool:
            def __init__(self,*args):self.pool=ThreadPoolExecutor(2)
            def submit(self,roi):return self.pool.submit(self.analyze,roi)
            def analyze(self,roi):
                if roi['w']==64 and roi['x']==64 and roi['y']==0:
                    reached.set();release.wait(5)
                    if error:raise RuntimeError('Worker failed')
                return dict(roi=roi,classification=dict(label='unresolved'),periodicity={},models=[],elapsed_ms=1)
            def close(self):self.pool.shutdown(wait=True,cancel_futures=True)
        with patch('server.RegionPool',FakePool):
            job_id=app.grid(item,{},2,True,1.9,workers=2)['id']
            self.assertTrue(reached.wait(5))
            # Main analysis lock is available while workers are occupied.
            self.assertTrue(app.lock.acquire(timeout=.2));app.lock.release()
            if not error:
                app.cancel_grid(job_id)
                with self.assertRaisesRegex(ValueError,'current grid'):app.grid(item,{},2,False,1,workers=2)
            release.set();app.grid_thread.join(5)
        self.assertFalse(app.grid_thread.is_alive())
        job=app.jobs[job_id];self.assertEqual(job['state'],'error' if error else 'cancelled')
        leaves=[r for r in job['regions'] if r['leaf']]
        self.assertEqual(sum(r['roi']['w']*r['roi']['h'] for r in leaves),256**2)
        self.assertEqual(len(leaves),4)
        self.assertTrue(all(not r['leaf'] for r in job['regions'] if r['trial_only']))
        app.close()


if __name__=='__main__':unittest.main()
