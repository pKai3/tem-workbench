"""Component maps use ordinary jobs, batch exports and source isolation."""
import copy
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from server import Workbench
from batch_grids import BatchGrids
import component_grid
import component_maps
import shared_spectra
from test_pca_combinations import split_pattern
from test_shared_spectra import INFO, SETTINGS


class Engine:
    def __init__(self, config):
        self.config=config;self.version='test';self.loaded={};self.sources=[{}]
    def catalog(self):
        return [dict(id=k,name='700kX_OneView_'+k,sample='sample',folder='project/subfolder',source_name='project') for k in ('a','b')]
    def load(self,key):
        preview=BytesIO();Image.new('RGB',(256,256),'#888888').save(preview,format='PNG')
        return dict(info={**INFO,'id':key,'name':'700kX_OneView_'+key,'width':256,'height':256},
                    array=np.zeros((256,256)),preview=preview.getvalue())
    def validate(self,item,roi,settings):return roi,settings
    def templates_for(self,settings):return split_pattern()[1]
    def output_for(self,key):return Path(self.config['output_root'])/key


class ComponentGridTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.folder=Path(self.temp.name)
        app=self.app=Workbench.__new__(Workbench)
        app.lock=threading.RLock();app.job_lock=threading.RLock();app.jobs={};app.grid_thread=None;app.closing=False
        app.config={'output_root':str(self.folder)};app.engine=Engine(app.config)
        app.pca=shared_spectra.SharedSpectra();app.window_probe=type('Idle',(),{'running':lambda _:False})()
        app.component_batch_running=lambda:False;app.batch=BatchGrids(app)
        self.settings={**SETTINGS,'scale_mode':'fixed','enabled_phases':['BCC']}
        self.overlap=dict(window_nm=5.12,spacing_nm=5.12,layout='square',passes=1,sample_edges=True)
        self.component=dict(method='pca',options={'components':2},fit_options={'combination_mode':'together'})
        self.addCleanup(self.stop)

    def stop(self):
        self.app.batch.cancel_run()
        for job in self.app.jobs.values():job['cancel']=True
        if self.app.grid_thread:self.app.grid_thread.join(20)
        if self.app.batch.thread:self.app.batch.thread.join(20)

    def compute(self,array,info,settings,options,*_):
        result,_=split_pattern();result['source']=copy.deepcopy(info);result['settings']=settings
        result['plan']=shared_spectra.plan(info,settings,options)
        result['positions']=np.array([[s['roi'][k] for k in ('x','y','w','h')] for s in result['plan']['samples']])
        if options['method']=='nmf':
            result['scores']=np.abs(result['scores']);result['raw_spectra']=5+result['scores']@result['components']/result['area_weights'].ravel()
            result.update(contribution_share=np.array([.5,.5]),iterations=50,converged=True,relative_reconstruction_error=.01)
        return result

    def test_interactive_job_and_map_use_original_window_support(self):
        with patch.object(shared_spectra,'compute',side_effect=self.compute):
            started=self.app.grid(self.app.engine.load('a'),self.settings,20,False,5,workers=1,overlap=self.overlap,component=self.component)
            self.app.grid_thread.join(20)
        job=self.app.status(started['id'],full=True)
        self.assertEqual(job['state'],'complete',job.get('error'))
        self.assertEqual(job['processed'],4);self.assertEqual(job['pending'],0)
        self.assertFalse(job['can_rescore']);self.assertEqual(self.app.grid_summary()['grid']['component_method'],'pca')
        self.assertEqual(self.app.pca.current()['viewer']['file_id'],'a')
        expected=component_maps.aggregate(self.app.pca.result,{})
        self.assertEqual([c['phases'] for c in job['aggregation']['cells']],[c['phases'] for c in expected['cells']])
        for row,window in zip(job['regions'],self.app.pca.result['phase_support']['windows']):
            self.assertEqual([m['score'] for m in row['models']],[m['score'] for m in window['candidates']])
        with self.assertRaisesRegex(ValueError,'Rerun PCA/NMF'):self.app.rescore(job['id'],.1)
        json.dumps(job,allow_nan=False)

    def test_existing_batch_exports_multiple_map_products_and_numeric_results(self):
        original=self.app.pca
        for method in ('pca','nmf'):
            with patch('batch_grids.Engine',Engine),patch.object(shared_spectra,'compute',side_effect=self.compute),patch.object(shared_spectra,'export_staging_root',return_value=self.folder/'staging'):
                started=self.app.batch.start(dict(file_ids=['a','b'],settings=self.settings,overlap=self.overlap,
                    component={**self.component,'method':method},workers=1,export_png=True,
                    png_views=['strength_all','support_phases','hex','raw'],summary_folders=['project'],flatten_folders=True))
                self.app.batch.thread.join(30)
            status=self.app.batch.status();self.assertEqual(status['state'],'complete');self.assertEqual(status['failures'],[])
            self.assertEqual(status['finished'],2);self.assertIs(self.app.pca,original)
            folder=Path(status['output_directory'])
            for row in status['images']:
                self.assertEqual(set(row['png_files']),{'strength_all','support_bcc','hex','raw'})
                self.assertEqual(row['summary_folder'],'project')
                for name in row['png_files'].values():
                    with Image.open(folder/name) as png:self.assertGreater(png.width,1000);png.verify()
                for name in row['component_export']['files']:self.assertTrue(Path(name).is_file())
                saved=json.loads((folder/row['data_file']).read_text());self.assertEqual(saved['grid']['component_method'],method)
            self.assertTrue((folder/'folders.csv').is_file())
            self.assertNotIn('_component_result',next(iter(self.app.jobs.values())))

    def test_cancel_during_sampling_remains_a_cancelled_grid(self):
        entered=threading.Event()
        def paused(*args):
            cancel=args[-2];entered.set();cancel.wait(10);shared_spectra.check_cancel(cancel)
        with patch.object(shared_spectra,'compute',side_effect=paused):
            job=self.app.grid(self.app.engine.load('a'),self.settings,20,False,5,workers=1,overlap=self.overlap,component=self.component)
            self.assertTrue(entered.wait(3));self.app.cancel_grid(job['id']);self.app.grid_thread.join(10)
        result=self.app.status(job['id']);self.assertEqual(result['state'],'cancelled');self.assertEqual(result['regions'],[])

    def test_image_relative_sampling_resolves_per_source(self):
        overlap=dict(size_mode='image_percent',window_percent=25,spacing_mode='window_percent',spacing_percent=50,layout='hex',passes=3,sample_edges=True)
        first=component_grid.options_for(INFO,overlap,self.component,2)
        second=component_grid.options_for({**INFO,'width':1024,'height':1024},overlap,self.component,2)
        self.assertEqual(second[0]['window_nm'],first[0]['window_nm']*2)
        self.assertEqual(second[0]['spacing_nm'],first[0]['spacing_nm']*2)
        self.assertEqual(first[2]['passes'],3);self.assertTrue(first[2]['sample_edges'])


if __name__=='__main__':unittest.main()
