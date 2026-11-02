import copy
import csv
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
from engine import Engine
from batch_grids import BatchGrids, summarize, sample_summaries, map_png
import test_parallel_execution as parallel_tests
from test_parallel_execution import image


class StabilityBatch(unittest.TestCase):
    def job(self, size=100, passing=True):
        models=[dict(phase=p, valid=passing, score=.6, zone_3index=[1,0,0]) for p in ['HCP','BCC']]
        return dict(source=dict(id='test',name='test',width=size,height=size,pixel_x_nm=.1,pixel_y_nm=.1),
            state='complete',settings=dict(enabled_phases=['HCP','BCC']),
            grid=dict(mode='overlap',passes=3,sample_count=3,layout='hex',window_nm=5,spacing_nm=2.5),
            regions=[dict(id=str(i),pass_id=i,leaf=True,roi=dict(x=0,y=0,w=size//2,h=size),
                classification=dict(label='ambiguous'),models=copy.deepcopy(models)) for i in range(3)])

    def test_overlap_denominator_keeps_both_phases_and_coverage(self):
        s=summarize(self.job(),'ST')
        self.assertEqual(s['coverage_percent'],50)
        self.assertEqual(s['analyzed_area_nm2'],50)
        self.assertNotIn('classification_image_percent',s)
        for p in ['HCP','BCC']:
            self.assertEqual(s['phase_support'][p]['mean_support_percent'],100)
        self.assertEqual([z['passing_windows'] for z in s['passing_zones']],[3,3])
        # Different field sizes: pool covered physical area, also retain equal-image mean.
        large=summarize(self.job(200,False),'ST')
        pooled=sample_summaries([s,large])[0]
        self.assertEqual(pooled['coverage_percent'],50)
        self.assertEqual(pooled['phase_support']['BCC']['pooled_support_percent'],20)
        self.assertEqual(pooled['phase_support']['BCC']['mean_image_support_percent'],50)

    def test_cancelled_empty_is_unmeasured_not_zero_support(self):
        job=self.job();job.update(state='cancelled',regions=[])
        s=summarize(job,'STA')
        self.assertEqual(s['coverage_percent'],0)
        self.assertIsNone(s['phase_support']['HCP']['mean_support_percent'])
        self.assertIsNone(sample_summaries([s])[0]['phase_support']['HCP']['pooled_support_percent'])
        job['regions']=self.job()['regions'][:1]
        s=summarize(job,'STA')
        self.assertEqual(s['windows'],1);self.assertEqual(s['planned_windows'],3)
        self.assertEqual(s['coverage_percent'],50)

    def test_png_aspect_and_phase_bands(self):
        job=self.job();job['source']['height']=200
        preview=BytesIO();Image.new('L',(100,200),120).save(preview,format='PNG')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'map.png'
            map_png(dict(preview=preview.getvalue()),job,path,dict(hcp_compatible='#ff0000',bcc_compatible='#00ff00'),1)
            with Image.open(path) as result:
                self.assertEqual(result.size,(980,2060))
                colors=result.getcolors(result.width*result.height)
                self.assertIn((255,0,0),[c for _,c in colors])
                self.assertIn((0,255,0),[c for _,c in colors])

    def test_real_two_image_batch_exports_and_live_map(self):
        app=parallel_tests.CoordinatorChecks().app()
        rows=[dict(id=i,name='1MX_OneView_'+i,sample='ST' if i=='a' else 'STA') for i in ['a','bad','b']]
        class LocalEngine(Engine):
            def catalog(self):return rows
            def load(self,key):
                if key=='bad':raise ValueError('broken fixture')
                item=image();item['info'].update(id=key,name='1MX_OneView_'+key)
                stream=BytesIO();Image.new('L',(256,256),120).save(stream,format='PNG');item['preview']=stream.getvalue()
                return item
        with tempfile.TemporaryDirectory() as tmp:
            app.config=dict(output_root=tmp);app.engine=LocalEngine({});app.batch=BatchGrids(app)
            try:
                with patch('batch_grids.Engine',LocalEngine):
                    app.batch.start(dict(file_ids=['a','bad','b'],workers=2,export_png=True,
                        settings=dict(enabled_phases=['HCP','BCC']),
                        overlap=dict(window_nm=4,spacing_nm=2,layout='hex',passes=3)))
                    app.batch.thread.join(60)
                    self.assertFalse(app.batch.running())
                status=app.batch.status()
                self.assertEqual(status['state'],'complete',status)
                self.assertEqual(len(status['images']),2,status['failures'])
                self.assertEqual(len(status['failures']),1,status['failures'])
                self.assertEqual(len(status['samples']),2)
                self.assertEqual(status['live_grid']['grid']['mode'],'overlap')
                self.assertGreater(len(status['live_grid']['aggregation']['cells']),0)
                folder=Path(status['output_directory'])
                self.assertEqual(len(list(folder.glob('*_overlap_map.png'))),2)
                for summary in status['images']:
                    job=json.loads((folder/summary['data_file']).read_text())
                    self.assertEqual(job['grid']['mode'],'overlap')
                    self.assertEqual({r['pass_id'] for r in job['regions']},{0,1,2})
                    self.assertEqual(summary['windows'],summary['planned_windows'])
                    self.assertLessEqual(summary['coverage_percent'],100)
                with (folder/'images.csv').open() as f:
                    rows=list(csv.DictReader(f))
                    self.assertEqual(len(rows),4)
                    self.assertIn('mean_support_percent',rows[0])
                    self.assertNotIn('image_area_percent',rows[0])
                for filename in ['summary.json','samples.csv','zones.csv','sample_zones.csv']:
                    self.assertTrue((folder/filename).is_file())
            finally:
                app.batch.cancel_run()
                if app.batch.thread:app.batch.thread.join(30)
                app.close()

if __name__=='__main__':unittest.main()
