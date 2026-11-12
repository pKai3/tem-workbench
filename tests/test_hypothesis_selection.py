"""A small display pool must retain the stated attainable window coverage."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import unittest

from hypothesis_selection import automatic_pool, SORTS


def fixture(count=100):
    maps = dict(models=[dict(id=i) for i in range(4)], windows=[])
    for i in range(count):
        candidates = [dict(model=3, valid=False, score=2.)]
        if i < count - 1:
            candidates += [dict(model=0, valid=True, score=.5), dict(model=1, valid=True, score=.6)]
        else:
            candidates += [dict(model=2, valid=True, score=.4)]
        maps['windows'].append(dict(candidates=candidates))
    return maps


class HypothesisSelectionTests(unittest.TestCase):
    def test_auto_omits_redundant_and_tiny_additions_without_changing_fits(self):
        maps=fixture();before=copy.deepcopy(maps)
        self.assertEqual(automatic_pool(maps),[1])
        self.assertEqual(maps,before)
        self.assertEqual(automatic_pool(fixture(50)),[1,2],
                         'One of 50 windows is more than the permitted 1% loss')

    def test_empty_or_below_screen_maps_select_nothing(self):
        self.assertEqual(automatic_pool({}),[])
        maps=fixture()
        for w in maps['windows']:
            for c in w['candidates']:c['valid']=False
        self.assertEqual(automatic_pool(maps),[])

    def test_default_prioritizes_new_windows_over_improved_existing_fits(self):
        maps=fixture(50)
        for w in maps['windows'][:15]:w['candidates'][1]['score']=.9
        # Model 0 is the first winner on mean support; model 1 improves the
        # remaining supported windows, while model 2 covers a new one.
        self.assertEqual(automatic_pool(maps),[0,2])
        self.assertEqual(automatic_pool(maps,'benefit'),[0,1,2])
        self.assertEqual(automatic_pool(maps,'better'),[0,1,2])
        self.assertEqual(automatic_pool(maps,'passing'),[0,1,2])
        with self.assertRaises(ValueError):automatic_pool(maps,'unknown')

    @unittest.skipUnless(shutil.which('node'), 'Node required for shared UI/backend parity')
    def test_browser_and_batch_auto_choose_identical_pools_for_all_orders(self):
        maps=fixture(50)
        # Persisted tie-break statistics and nonconsecutive IDs are supported.
        maps['model_passing_counts']={str(i):sum(any(c['model']==i and c['valid'] for c in w['candidates']) for w in maps['windows']) for i in range(4)}
        maps['model_mean_support']={'0':.5,'1':.6,'2':.4,'3':0}
        script="""const fs=require('fs'),view=require('./web/shared-spectra.js');
        const maps=JSON.parse(fs.readFileSync(0,'utf8'));
        console.log(JSON.stringify(['coverage','benefit','better','passing'].map(mode=>{
          const order=view.orderedHypotheses(maps,mode);
          return order.slice(0,view.autoHypothesisCount(maps,order)).map(m=>m.id);
        })));"""
        result=subprocess.run(['node','-e',script],input=json.dumps(maps),text=True,capture_output=True,check=True,cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(json.loads(result.stdout),[automatic_pool(maps,mode) for mode in SORTS])


if __name__=='__main__':unittest.main()
