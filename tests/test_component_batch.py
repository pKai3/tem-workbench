"""Batch isolation, real fit/map/export plumbing and failure/cancellation checkpoints."""
import copy
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import numpy as np

from component_batch import ComponentBatch
import shared_spectra
from test_pca_combinations import split_pattern
from test_shared_spectra import INFO, SETTINGS, OPTIONS


class BatchEngine:
    def __init__(self, config):
        self.config=config;self.version='test-engine';self.loaded={}
    def catalog(self):return [dict(id=k,name=k) for k in ('a','bad','b')]
    def load(self,key):
        if key=='bad':raise ValueError('Unavailable source')
        item=dict(info={**INFO,'id':key,'name':key},array=np.zeros((32,32)))
        self.loaded[key]=item;return item
    def validate(self,item,roi,settings):return roi,{**SETTINGS,**settings}
    def templates_for(self,settings):return split_pattern()[1]
    def output_for(self,key):return Path(self.config['output_root'])/key


class ComponentBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.folder=Path(self.temp.name)
        idle=lambda:SimpleNamespace(running=lambda:False)
        self.app=SimpleNamespace(lock=threading.RLock(),job_lock=threading.RLock(),closing=False,
            batch=idle(),pca=idle(),window_probe=idle(),grid_thread=None,config={'output_root':str(self.folder)})
        self.app.engine=BatchEngine(self.app.config)
        self.batch=ComponentBatch(self.app);self.app.component_batch=self.batch
        self.body=dict(file_ids=['a','b'],settings=SETTINGS,options={**OPTIONS,'components':2,'workers':2},fit_options={'combination_mode':'together'})
        self.addCleanup(self.stop)

    def stop(self):
        if self.batch.running():self.batch.cancel_run(self.batch.data['id']);self.batch.thread.join(20)

    def computed(self,array,info,settings,options,*_):
        result,_=split_pattern();result['source']=copy.deepcopy(info)
        result['plan'].update(method=options.get('method','pca'),workers=options['workers'])
        if options.get('method')=='nmf':
            result['scores']=np.abs(result['scores']);result['raw_spectra']=5+result['scores']@result['components']/result['area_weights'].ravel()
            result.update(contribution_share=np.array([.5,.5]),iterations=50,converged=True,relative_reconstruction_error=.01)
        return result

    def patches(self):
        from contextlib import ExitStack
        stack=ExitStack()
        stack.enter_context(patch('component_batch.Engine',BatchEngine))
        stack.enter_context(patch.object(shared_spectra,'compute',side_effect=self.computed))
        stack.enter_context(patch.object(shared_spectra,'export_staging_root',return_value=self.folder/'staging'))
        return stack

    def test_pca_and_nmf_multimage_export_and_independent_results(self):
        original=self.app.pca
        for method in ('pca','nmf'):
            with self.patches():
                body=copy.deepcopy(self.body);body['options']['method']=method
                started=self.batch.start(body);body['options']['workers']=16
                self.batch.thread.join(30)
            self.assertFalse(self.batch.running())
            status=self.batch.status();self.assertEqual(status['state'],'complete')
            self.assertEqual(status['finished'],2);self.assertEqual(status['options']['workers'],2)
            self.assertEqual([r['state'] for r in status['images']],['complete','complete'],status['images'])
            self.assertIs(self.app.pca,original);self.assertIsNone(self.batch.analysis.result)
            for row in status['images']:
                self.assertEqual(row['execution']['workers'],2)
                self.assertEqual(row['checked_windows'],4)
                files=row['export']['files'];self.assertTrue(all(Path(f).is_file() for f in files))
                metadata=json.loads(Path(files[1]).read_text())
                self.assertEqual(metadata['source']['id'],row['file_id'])
                self.assertEqual(metadata['plan']['method'],method)
                self.assertEqual(metadata['phase_support_status'],'complete')
            manifest=json.loads(Path(started['manifest']).read_text())
            self.assertEqual(manifest['images'],status['images']);self.assertEqual(manifest['state'],'complete')

    def test_failure_is_recorded_and_next_image_still_runs(self):
        with self.patches():
            self.batch.start({**self.body,'file_ids':['a','bad','b']});self.batch.thread.join(30)
        status=self.batch.status();self.assertEqual(status['finished'],3)
        self.assertEqual([r['state'] for r in status['images']],['complete','error','complete'])
        self.assertIn('Unavailable',status['images'][1]['error'])
        self.assertEqual(json.loads(Path(status['manifest']).read_text())['finished'],3)

    def test_cancel_during_fit_exports_partial_and_does_not_start_next_image(self):
        import pca_fitting
        entered=threading.Event()
        def blocked(result,templates,options,cancel,progress):
            entered.set();cancel.wait(10);shared_spectra.check_cancel(cancel)
        with self.patches(),patch.object(pca_fitting,'fit_features',side_effect=blocked):
            started=self.batch.start(self.body)
            self.assertTrue(entered.wait(3))
            self.assertEqual(self.batch.status()['current_job']['operation'],'fit')
            with self.assertRaises(ValueError):self.batch.cancel_run('old-id')
            self.batch.cancel_run(started['id']);self.batch.thread.join(10)
        status=self.batch.status();self.assertEqual(status['state'],'cancelled')
        self.assertEqual(status['finished'],1);row=status['images'][0]
        self.assertEqual(row['state'],'cancelled');self.assertEqual(row['fit_status'],'cancelled')
        self.assertTrue(all(Path(f).is_file() for f in row['export']['files']))
        self.assertEqual(json.loads(Path(status['manifest']).read_text())['state'],'cancelled')

    def test_invalid_requests_and_busy_interlock(self):
        with self.patches():
            for files in ([],['a','a'],['missing'],[{}]):
                with self.assertRaises(ValueError):self.batch.start({**self.body,'file_ids':files})
            for worker in (-1,17,True):
                with self.assertRaises(ValueError):self.batch.start({**self.body,'options':{**OPTIONS,'workers':worker}})
            self.app.pca=SimpleNamespace(running=lambda:True)
            with self.assertRaisesRegex(ValueError,'current analysis'):self.batch.start(self.body)
        self.assertFalse(list(self.folder.glob('components_*')))


if __name__=='__main__':unittest.main()
