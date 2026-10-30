import copy
from io import BytesIO
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
import diffraction
from batch_grids import eligibility, summarize, sample_summaries, map_png, BatchGrids
from test_diffraction import pattern
import test_parallel_execution as parallel_tests
from test_parallel_execution import image
from engine import Engine

class ManualPeaks(unittest.TestCase):
    def test_add_remove_pair_and_cache(self):
        array,info,_=pattern();d=diffraction.validate(info,{'refine_center':False});cache={}
        baseline,_=diffraction.spectrum(array,d,cache)
        q=baseline['peaks'][0]['observed_spots'][0]
        x=d['center_x']+q[0]/d['pixel_x_nm_inv'];y=d['center_y']-q[1]/d['pixel_y_nm_inv']
        edit=dict(action='remove',x=x,y=y,radius_px=4)
        removed,_=diffraction.spectrum(array,{**d,'peak_edits':[edit]},cache)
        self.assertEqual(removed['observed_spot_count'],baseline['observed_spot_count']-1)
        self.assertEqual(len(removed['peaks']),len(baseline['peaks'])) # Opposite partner remains.
        snap=diffraction.snap_peak(array,{**d,'g_max':10},x+4,y+3,12)
        self.assertLess(np.hypot(snap['x']-x,snap['y']-y),1.5)
        added,_=diffraction.spectrum(array,{**d,'peak_edits':[edit,dict(action='add',**snap,radius_px=4)]},cache)
        self.assertEqual(added['observed_spot_count'],baseline['observed_spot_count'])
        self.assertEqual(sum(len(p['manual_observed_spots']) for p in added['peaks']),1)
        again,_=diffraction.spectrum(array,d,cache)
        self.assertEqual(again['peaks'],baseline['peaks'])
        duplicate,_=diffraction.spectrum(array,{**d,'peak_edits':[dict(action='add',x=x,y=y,radius_px=4)]},cache)
        self.assertEqual(duplicate['observed_spot_count'],baseline['observed_spot_count'])
        refined,_=diffraction.spectrum(array,{**d,'refine_center':True,'peak_edits':[dict(action='add',x=x,y=y,radius_px=4)]},cache)
        self.assertEqual(refined['observed_spot_count'],baseline['observed_spot_count'])
    def test_bounds_masks_persistence(self):
        array,info,_=pattern()
        for edits in [[dict(action='add',x=-1,y=20,radius_px=4)], [dict(action='virtual',x=10,y=10,radius_px=4)], [dict(action='add',x=10,y=10,radius_px=float('nan'))]]:
            with self.assertRaises(ValueError):diffraction.validate(info,{'peak_edits':edits})
        d=diffraction.validate(info,{'refine_center':False,'peak_edits':[dict(action='add',x=390,y=373,radius_px=4)]})
        baseline,_=diffraction.spectrum(array,{**d,'peak_edits':[]})
        excluded,_=diffraction.spectrum(array,d)
        self.assertEqual(baseline['peaks'],excluded['peaks'])
        with self.assertRaises(ValueError):diffraction.snap_peak(array,d,390,373,3)
        self.assertEqual(diffraction.validate(info,d),d)

class BatchSummaries(unittest.TestCase):
    def job(self,size=100,state='complete'):
        return dict(source=dict(id='ST/test.dm4',name='test',width=size,height=size,pixel_x_nm=.1,pixel_y_nm=.1),state=state,regions=[
         dict(leaf=False,roi=dict(x=0,y=0,w=size,h=size),classification=dict(label='hcp_compatible'),models=[]),
         dict(leaf=True,roi=dict(x=0,y=0,w=size//2,h=size),classification=dict(label='ambiguous'),models=[dict(phase=p,valid=True,score=.5,zone_3index=[1,0,0]) for p in ['HCP','BCC']]),
         dict(leaf=True,roi=dict(x=size//2,y=0,w=size//2,h=size),classification=dict(label='bcc_compatible'),models=[dict(phase='BCC',valid=False,score=-1,zone_3index=[1,1,0])])])
    def test_denominators_shared_support_and_leaf_only(self):
        a=summarize(self.job(),'ST');self.assertEqual(a['coverage_percent'],100)
        self.assertEqual(a['classification_image_percent']['bcc_compatible'],50)
        self.assertEqual(len(a['passing_zones']),2)
        self.assertEqual(a['passing_zones'][0]['image_area_percent'],50)
        j=self.job(200);j['regions'][1]['classification']['label']='bcc_compatible'
        b=summarize(j,'ST');pooled=sample_summaries([a,b])[0]
        self.assertAlmostEqual(pooled['pooled_image_percent']['bcc_compatible'],90)
        self.assertAlmostEqual(pooled['mean_image_percent']['bcc_compatible'],75)
    def test_eligibility(self):
        row=dict(id='a',sample='ST',name='400kX_OneView_ST_1221')
        self.assertTrue(eligibility(row)['eligible']);self.assertFalse(eligibility(row,inclusive=False)['eligible'])
        for name in ['1MX_OneView_ST_1200_Diffraction','OneView_ST_1200','1MX_Hitachi_ST_12']:
            self.assertFalse(eligibility({**row,'name':name})['eligible'])
        self.assertTrue(eligibility({**row,'name':'1.2MX_OneView_ST_1157'})['eligible'])
    def test_png(self):
        preview=BytesIO();Image.new('L',(100,100),120).save(preview,format='PNG')
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'map.png';map_png(dict(preview=preview.getvalue()),self.job(),target)
            with Image.open(target) as im:self.assertEqual(im.size,(1880,2060))
    def test_cancel_retains_exported_images_and_partial_grid(self):
        from concurrent.futures import ThreadPoolExecutor
        reached=threading.Event();release=threading.Event()
        app=parallel_tests.CoordinatorChecks().app()
        rows=[dict(id=key,name='1MX_OneView_'+key,sample='ST') for key in ['first','second','third']]
        class LocalEngine(Engine):
            def catalog(self):return rows
            def load(self,key):
                item=image();item['info'].update(id=key,name='1MX_OneView_'+key);return item
        class Pool:
            def __init__(self,item,*args):self.id=item['info']['id'];self.pool=ThreadPoolExecutor(1)
            def submit(self,roi):return self.pool.submit(self.analyze,roi)
            def analyze(self,roi):
                if self.id=='second':reached.set();release.wait(10)
                return dict(roi=roi,classification=dict(label='unresolved'),periodicity={},models=[],elapsed_ms=1)
            def close(self):self.pool.shutdown(wait=True,cancel_futures=True)
        with tempfile.TemporaryDirectory() as tmp:
            app.config=dict(output_root=tmp);app.engine=LocalEngine({});app.batch=BatchGrids(app)
            with patch('batch_grids.Engine',LocalEngine),patch('server.RegionPool',Pool):
                app.batch.start(dict(file_ids=['first','second','third'],count=2,minimum_nm=1,adaptive=False,workers=1))
                self.assertTrue(reached.wait(10))
                with self.assertRaisesRegex(ValueError,'batch'):app.grid(image(),{},2,False,1)
                app.batch.cancel_run();release.set();app.batch.thread.join(15)
            status=app.batch.status();self.assertEqual(status['state'],'cancelled')
            self.assertEqual(status['images'][0]['state'],'complete')
            self.assertEqual(len(status['images']),2)
            self.assertNotIn('third',[row['file_id'] for row in status['images']])
            self.assertTrue((Path(status['output_directory'])/'summary.json').is_file())
            app.close()

    def test_real_coordinator_exports_and_failure_retention(self):
        app=parallel_tests.CoordinatorChecks().app()
        rows=[dict(id=i,name='1MX_OneView_'+i,sample='ST' if i=='a' else 'STA') for i in ['a','bad','b']]
        class LocalEngine(Engine):
            def catalog(self):return rows
            def load(self,key):
                if key=='bad':raise ValueError('broken file fixture')
                item=image();item['info'].update(id=key,name='1MX_OneView_'+key)
                stream=BytesIO();Image.new('L',(256,256),120).save(stream,format='PNG');item['preview']=stream.getvalue()
                return item
        with tempfile.TemporaryDirectory() as tmp:
            app.config=dict(output_root=tmp);app.engine=LocalEngine({});app.batch=BatchGrids(app)
            with patch('batch_grids.Engine',LocalEngine):
                app.batch.start(dict(file_ids=['a','bad','b'],count=2,minimum_nm=1,adaptive=False,workers=2,export_png=True,settings={'enabled_phases':['BCC']}))
                app.batch.thread.join(60)
            status=app.batch.status();self.assertEqual(status['state'],'complete',status)
            self.assertEqual(len(status['images']),2);self.assertEqual(len(status['failures']),1)
            folder=Path(status['output_directory']);self.assertEqual(len(list(folder.glob('*_grid.json'))),2)
            self.assertEqual(len(list(folder.glob('*_grid.png'))),2)
            self.assertTrue((folder/'zones.csv').is_file());self.assertEqual(len(status['samples']),2)
            app.close()

if __name__=='__main__':unittest.main()
