"""Real spawned workers: identical fits/maps, ordered progress and cleanup."""
import copy
import os
from pathlib import Path
import threading
import time
from types import SimpleNamespace
import unittest
from concurrent.futures import CancelledError
import numpy as np

from component_execution import ComponentPool, selected_workers
import pca_fitting
import nmf_fitting
import nmf_phase_maps
import shared_spectra
from test_pca_combinations import split_pattern, OPTIONS


def probe(result, templates, context, task, cancel):
    time.sleep(.15 if task == 0 else .01)
    return dict(pid=os.getpid(), task=task,
                writable=result['raw_spectra'].flags.writeable,
                value=float(result['raw_spectra'][0,0]))


def failed(result, templates, context, task, cancel):
    raise TimeoutError('worker failure, not a waiting timeout')


class ComponentExecutionTests(unittest.TestCase):
    def test_pca_serial_and_parallel_searches_cache_and_maps_are_identical(self):
        for scale_mode in ('fixed','auto_hcp_ratio'):
            serial,templates=split_pattern();parallel=copy.deepcopy(serial)
            for result in (serial,parallel):result['settings']['scale_mode']=scale_mode
            # Exact repeats must hit the same bounded cache, including pending jobs.
            serial['scores'][1]=serial['scores'][0];parallel['scores'][1]=parallel['scores'][0]
            before=copy.deepcopy(parallel)
            a=pca_fitting.fit_features(serial,templates,{**OPTIONS,'workers':1})
            progress=[]
            b=pca_fitting.fit_features(parallel,templates,{**OPTIONS,'workers':2},progress=lambda n,*_:progress.append(n))
            self.assertEqual({k:v for k,v in a.items() if k!='workers'}, {k:v for k,v in b.items() if k!='workers'})
            self.assertEqual(progress,sorted(progress))
            self.assertEqual(progress[-1],b['total'])
            self.assertEqual(pca_fitting.build(serial,templates),pca_fitting.build(parallel,templates))
            for key in ('raw_spectra','scores','components','mean'):
                np.testing.assert_array_equal(parallel[key],before[key])

    def test_nmf_serial_and_parallel_combinations_and_eligibility_match(self):
        serial,templates=split_pattern();serial['plan']['method']='nmf'
        serial['scores']=np.array([[1.,0.],[0.,1.],[1.,1.],[.5,.8]])
        serial['raw_spectra']=5+serial['scores']@serial['components']/serial['area_weights'].ravel()
        parallel=copy.deepcopy(serial)
        a=nmf_fitting.fit_groups(serial,templates,{'workers':1})
        b=nmf_fitting.fit_groups(parallel,templates,{'workers':2})
        self.assertEqual({k:v for k,v in a.items() if k!='workers'}, {k:v for k,v in b.items() if k!='workers'})
        self.assertEqual(nmf_phase_maps.build(serial,templates),nmf_phase_maps.build(parallel,templates))

    def test_spawn_uses_readonly_shared_input_and_commits_in_order(self):
        result,templates=split_pattern()
        pool=ComponentPool(result,templates,2,mapping=True)
        folder=Path(pool.directory.name)
        try:
            rows=list(pool.map(probe,range(6)))
            processes=list(pool.executor._processes.values())
            self.assertEqual([v['task'] for _,v,_ in rows],list(range(6)))
            self.assertEqual(len({v['pid'] for _,v,_ in rows}),2)
            self.assertTrue(all(not v['writable'] for _,v,_ in rows))
            self.assertTrue(all(v['value']==float(result['raw_spectra'][0,0]) for _,v,_ in rows))
        finally:pool.close()
        self.assertFalse(folder.exists())
        self.assertTrue(all(not process.is_alive() for process in processes))

    def test_cancel_retains_ordered_completed_work_and_cleans_up(self):
        result,templates=split_pattern();stop=threading.Event()
        def cancel_after_one_combination(done,*_):
            if done==5:stop.set()
        with self.assertRaises(CancelledError):
            pca_fitting.fit_features(result,templates,{**OPTIONS,'workers':2},stop,cancel_after_one_combination)
        self.assertEqual(result['fits']['completed'],5)
        self.assertEqual(result['fits']['groups'][-1]['completed_windows'],1)
        stop.clear();pca_fitting.fit_features(result,templates,{**OPTIONS,'workers':2})
        published=[]
        def publish(maps):published.append(copy.deepcopy(maps))
        def cancel_map(done,*_):
            if done==1:stop.set()
        with self.assertRaises(CancelledError):pca_fitting.build(result,templates,stop,cancel_map,publish)
        self.assertEqual([w['index'] for w in published[-1]['windows']],[0])

    def test_task_failure_propagates_and_releases_workers(self):
        result,templates=split_pattern();pool=ComponentPool(result,templates,2)
        folder=Path(pool.directory.name)
        with self.assertRaisesRegex(TimeoutError,'worker failure'):
            with pool:list(pool.map(failed,[0,1]))
        self.assertFalse(folder.exists())

    def test_workbench_shutdown_waits_for_component_workers_and_cleanup(self):
        from server import Workbench
        result,templates=split_pattern();ready=threading.Event();stop=threading.Event();state={}
        def run():
            try:
                with ComponentPool(result,templates,2,stop,mapping=True) as pool:
                    state['folder']=Path(pool.directory.name)
                    for _ in pool.map(probe,range(6)):
                        state['processes']=list(pool.executor._processes.values())
                        ready.set();stop.wait(10)
            except CancelledError:pass
            except BaseException as exc:state['error']=exc;ready.set()
        thread=threading.Thread(target=run);thread.start()
        app=Workbench.__new__(Workbench)
        app.pca=SimpleNamespace(cancel=stop,thread=thread)
        app.job_lock=threading.Lock();app.jobs={};app.grid_thread=None
        try:self.assertTrue(ready.wait(20),'workers did not start')
        finally:app.close()
        self.assertNotIn('error',state)
        self.assertFalse(thread.is_alive())
        self.assertFalse(state['folder'].exists())
        self.assertTrue(all(not process.is_alive() for process in state['processes']))

    def test_worker_validation_and_mapping_only_change(self):
        for value in (-1,17,True,2.5,'2'):
            with self.assertRaises(ValueError):selected_workers({'workers':value})
        result,templates=split_pattern();pca_fitting.fit_features(result,templates,OPTIONS)
        original=copy.deepcopy(result['fits'])
        manager=shared_spectra.SharedSpectra();manager.result=result
        manager.job=dict(id='test',state='complete',started=time.monotonic())
        manager.support('test',templates,workers=2);manager.thread.join(20)
        self.assertFalse(manager.running())
        self.assertEqual(result['phase_support_status'],'complete')
        self.assertEqual(manager.status('test')['execution']['workers'],2)
        self.assertEqual(result['fits'],original,'changing workers does not require refitting')


if __name__=='__main__':unittest.main()
