import copy
import json
import threading
import unittest
from concurrent.futures import Future
from unittest.mock import patch
import overlap_maps as maps
from server import Workbench
from engine import Engine

INFO=dict(width=256,height=256,pixel_x_nm=.03,pixel_y_nm=.03,image_kind='real_space')

def region(i, pass_id, passing=True, bcc=False):
    return dict(id=str(i),pass_id=pass_id,roi=dict(x=0,y=0,w=128,h=128),
                classification=dict(label='coexisting_candidates' if bcc else 'hcp_compatible'),
                models=[dict(phase='HCP',valid=passing,score=.6 if passing else -.2),
                        dict(phase='BCC',valid=bcc,score=.3 if bcc else -.1)])

def job(regions,passes=1):
    return dict(source=INFO,settings=dict(enabled_phases=['HCP','BCC']),grid=dict(passes=passes),regions=regions)

class OverlapTests(unittest.TestCase):
    def test_sampling_is_deterministic_full_windows_and_staggered(self):
        options=dict(window_nm=2,spacing_nm=1,layout='hex',passes=3)
        samples,config=maps.sampling(INFO,options)
        self.assertEqual((samples,config),maps.sampling(INFO,options))
        self.assertEqual({s['pass_id'] for s in samples},{0,1,2})
        for k in range(3):
            rois=[s['roi'] for s in samples if s['pass_id']==k]
            self.assertEqual(len(rois),len({(r['x'],r['y']) for r in rois}))
            self.assertTrue(all(min(r['x'],r['y'])>=0 and r['x']+r['w']<=256 and r['y']+r['h']<=256 for r in rois))
        rows={s['roi']['y'] for s in samples if s['pass_id']==0}
        starts=[min(s['roi']['x'] for s in samples if s['pass_id']==0 and s['roi']['y']==y) for y in sorted(rows)]
        self.assertNotEqual(starts[0],starts[1])

    def test_nine_pass_lattice_offsets(self):
        samples, options = maps.sampling(INFO, dict(window_nm=2, spacing_nm=1, passes=9))
        self.assertEqual(set(map(tuple, options['offsets_basis'])), {(u/3,v/3) for u in range(3) for v in range(3)})
        self.assertEqual({s['pass_id'] for s in samples}, set(range(9)))
        # Seven remains readable for older saved requests, but new UI offers nine.
        self.assertEqual(maps.sampling(INFO, dict(window_nm=2, spacing_nm=1, passes=7))[1]['passes'], 7)

    def test_invalid_and_excessive_sampling(self):
        for o in [dict(window_nm=float('nan')),dict(spacing_nm=0),dict(passes=True),dict(passes=2),dict(window_nm=20),dict(window_nm=.1),dict(window_nm=2,spacing_nm=3),dict(spacing_nm=.03,passes=7)]:
            with self.subTest(o=o),self.assertRaises(ValueError):maps.sampling(INFO,o)

    def test_equal_pass_weighting_and_missing_not_excluded(self):
        # Four successful copies in one pass must not outweigh one failed other pass.
        regions=[region(i,0) for i in range(4)]+[region(4,1,False)]
        a=maps.aggregate(job(regions,2),8)
        self.assertEqual(a['coverage_percent'],25)
        self.assertTrue(all(c['phases']['HCP']['support']==.5 for c in a['cells']))
        self.assertTrue(all(c['phases']['HCP']['spread']==1 for c in a['cells']))
        self.assertTrue(all(c['phases']['HCP']['rank']==.2 for c in a['cells']))
        regions[-1]['models']=[]
        a=maps.aggregate(job(regions,2),8)
        self.assertEqual(a['phases']['HCP']['mean_support'],.5)
        self.assertEqual(a['phases']['HCP']['mean_fit_presence'],.5)
        self.assertTrue(all(c['phases']['HCP']['rank']==.6 for c in a['cells']))

    def test_weaker_phase_kept_without_winner_normalization(self):
        a=maps.aggregate(job([region(0,0,bcc=True)]),8)
        self.assertEqual(a['phases']['HCP']['mean_support'],1)
        self.assertEqual(a['phases']['BCC']['mean_support'],1)
        self.assertTrue(all(c['separate_support']==1 for c in a['cells']))
        json.dumps(a,allow_nan=False)
        empty=maps.aggregate(job([]),8)
        self.assertEqual(empty['coverage_percent'],0)
        self.assertEqual(empty['cells'],[])
        json.dumps(empty,allow_nan=False)

    def test_coordinator_keeps_passes_and_compact_full_exports(self):
        app=Workbench.__new__(Workbench);app.engine=Engine({});app.jobs={};app.grid_thread=None;app.closing=False
        app.job_lock=threading.RLock();app.lock=threading.RLock()
        class Pool:
            def __init__(self,*a):pass
            def submit(self,roi):
                f=Future();f.set_result(dict(roi=roi,classification=dict(label='insufficient'),periodicity={},models=[],elapsed_ms=0));return f
            def close(self):pass
        with patch('server.RegionPool',Pool):
            id=app.grid(dict(info=INFO),dict(enabled_phases=['HCP','BCC']),2,True,1,workers=1,
                        overlap=dict(window_nm=4,spacing_nm=2,passes=3))['id']
            app.grid_thread.join(10)
        full=app.status(id,full=True);compact=app.status(id)
        self.assertEqual(full['state'],'complete');self.assertFalse(full['grid']['adaptive'])
        self.assertEqual(full['processed'],full['grid']['sample_count'])
        self.assertEqual({r['pass_id'] for r in compact['regions']},{0,1,2})
        self.assertEqual(compact['aggregation'],full['aggregation'])
        self.assertTrue(all(r['leaf'] for r in full['regions']))
        json.dumps(full,allow_nan=False)

    def test_real_workers_rescore_and_export(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from test_parallel_execution import image
        item=image();item['info'].update(id='test',name='Synthetic_overlap')
        app=Workbench.__new__(Workbench);app.engine=Engine({});app.jobs={};app.grid_thread=None;app.closing=False
        app.job_lock=threading.RLock();app.lock=threading.RLock()
        settings=dict(scale_mode='auto_hcp_ratio',enabled_phases=['HCP','BCC'])
        with TemporaryDirectory() as directory:
            app.config={'output_root':directory}
            id=app.grid(item,settings,2,False,1,workers=2,
                        overlap=dict(window_nm=4,spacing_nm=2,passes=3))['id']
            app.grid_thread.join(30)
            self.assertFalse(app.grid_thread.is_alive())
            self.assertEqual(app.jobs[id]['state'],'complete',app.jobs[id].get('error'))
            self.assertTrue(app.status(id)['can_rescore'])
            before=[(r['roi'],r['pass_id']) for r in app.jobs[id]['regions']]
            app.rescore(id,.2,.2,.1)
            self.assertEqual(before,[(r['roi'],r['pass_id']) for r in app.jobs[id]['regions']])
            self.assertEqual(app.jobs[id]['aggregation'],maps.aggregate(app.jobs[id]))
            exported=Path(app.save({'job_id':id})['path'])
            self.assertIn('_overlap_map_',exported.name)
            data=json.loads(exported.read_text())
            self.assertEqual(data['grid']['passes'],3)
            self.assertEqual(data['aggregation'],app.jobs[id]['aggregation'])
            self.assertTrue(all('models' in r and 'pass_id' in r for r in data['regions']))
        app.close()
