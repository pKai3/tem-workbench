"""Original-window overlap maps retain sampling provenance and local support."""
import copy
import json
import unittest
from unittest.mock import patch
import numpy as np
from tem_workbench.components import component_maps
from tem_workbench.components import shared_spectra as spectra
from tem_workbench.components import pca_fitting
from test_shared_spectra import INFO, SETTINGS, OPTIONS
from test_pca_combinations import split_pattern


class ComponentMapTests(unittest.TestCase):
    def fixture(self, method='pca'):
        roi=dict(x=0,y=0,w=128,h=128)
        samples=[dict(roi=roi.copy(),pass_id=k) for k in (0,0,0,1)]
        models=[dict(id=0,phase='BCC'),dict(id=1,phase='BCC'),dict(id=2,phase='HCP')]
        candidates=[dict(model=0,phase='BCC',valid=True,score=.9),dict(model=1,phase='BCC',valid=True,score=.7),dict(model=2,phase='HCP',valid=False,score=.8)]
        return dict(plan=dict(method=method,image_shape=[128,128],pixel_nm=[.04,.04],window_pixels=[128,128],window_nm=[5.12,5.12],spacing_nm=[2.56,2.56],count=4,samples=samples,grid=dict(window_nm=5.12,spacing_nm=2.56,passes=2,sample_edges=True)),
                    phase_support=dict(models=models,phases=['BCC','HCP'],windows=[dict(index=i,candidates=copy.deepcopy(candidates) if i<3 else []) for i in range(4)]))

    def test_equal_pass_weight_and_phase_deduplication(self):
        for method in ('pca','nmf'):
            result=self.fixture(method);before=copy.deepcopy(result)
            a=component_maps.aggregate(result,dict(models=[0,1,2]))
            for c in a['cells']+a['hex']['cells']:
                self.assertAlmostEqual(c['phases']['BCC']['support'],.5)
                self.assertAlmostEqual(c['phases']['BCC']['passing_strength'],.45)
                self.assertEqual(c['phases']['HCP']['support'],0)
                self.assertEqual(c['phases']['HCP']['passing_strength'],0)
                self.assertEqual(c['passes'],2)
            self.assertEqual(result,before)
            json.dumps(a,allow_nan=False)

    def test_selected_pool_hypothesis_colours_and_empty_pool(self):
        result=self.fixture()
        a=component_maps.aggregate(result,dict(models=[1],colour_by='hypothesis'))
        self.assertEqual(a['keys'],['1'])
        self.assertAlmostEqual(a['cells'][0]['phases']['1']['passing_strength'],.35)
        empty=component_maps.aggregate(result,dict(models=[]))
        self.assertTrue(empty['cells']);self.assertEqual(empty['keys'],[])
        self.assertTrue(all(not c['phases'] for c in empty['cells']))
        for options in (dict(models=[99]),dict(models=[True]),dict(models='all'),dict(colour_by='invented')):
            with self.assertRaises(ValueError):component_maps.aggregate(result,options)

    def test_larger_pool_cannot_reduce_best_passing_strength(self):
        result=self.fixture()
        # A rejected alternative must not compete with passing BCC, even when
        # its numerical score is higher. Another BCC proposal fills previously
        # absent windows with poor rejected scores, lowering the old rank mean.
        windows=result['phase_support']['windows']
        windows[0]['candidates']=[dict(model=0,phase='BCC',valid=True,score=.6)]
        for win in windows[1:]:
            win['candidates']=[dict(model=1,phase='BCC',valid=False,score=-.3),
                               dict(model=2,phase='HCP',valid=False,score=.8)]
        previous=None
        for ids in ([0],[0,1],[0,1,2]):
            a=component_maps.aggregate(result,dict(models=ids))
            cells=a['hex']['cells']
            for i,c in enumerate(cells):
                self.assertEqual(c['winner'],'BCC')
                score=c['phases'][c['winner']]['passing_strength']
                if previous is not None:self.assertGreaterEqual(score,previous[i])
            previous=[c['phases'][c['winner']]['passing_strength'] for c in cells]

    def test_live_unchecked_windows_do_not_count_as_failed(self):
        result=self.fixture();result['phase_support']['windows']=result['phase_support']['windows'][:2]
        a=component_maps.aggregate(result,{})
        self.assertEqual(a['checked'],2);self.assertEqual(a['total'],4)
        self.assertEqual(a['cells'][0]['phases']['BCC']['support'],1)
        self.assertEqual(a['cells'][0]['passes'],1)
        self.assertIn(a['cells'][0]['region_id'],('0','1'))
        result['phase_support']['windows']=[]
        self.assertEqual(component_maps.aggregate(result,{})['cells'],[])

    def test_unsampled_footprints_and_legacy_rectangular_plan(self):
        result=self.fixture();p=result['plan'];p.pop('samples');p.pop('grid');p.update(xs=[0,64],ys=[0,64],image_shape=[256,256])
        result['phase_support']['windows']=result['phase_support']['windows'][:1]
        a=component_maps.aggregate(result,{})
        self.assertTrue(a['cells']);self.assertLess(a['coverage_percent'],30)
        self.assertTrue(all(c['region_id']=='0' for c in a['cells']))
        self.assertEqual(a['footprints'],[dict(x=0,y=0,w=128,h=128)])

    def test_sampling_passes_hex_and_all_rim_edges(self):
        info={**INFO,'width':256,'height':256}
        for layout in ('square','hex'):
            for passes in (1,3,9):
                plan=spectra.plan(info,SETTINGS,{**OPTIONS,'layout':layout,'passes':passes,'sample_edges':True})
                self.assertEqual(plan['grid']['passes'],passes)
                for k in range(passes):
                    rois=[s['roi'] for s in plan['samples'] if s['pass_id']==k]
                    coverage=np.zeros((256,256),bool)
                    for r in rois:coverage[r['y']:r['y']+r['h'],r['x']:r['x']+r['w']]=True
                    self.assertTrue(coverage.all(),(layout,passes,k))
                    self.assertEqual(len(rois),len({(r['x'],r['y']) for r in rois}))
                self.assertEqual(plan['count'],len(plan['samples']))
                self.assertEqual(np.prod(plan['map_shape']),plan['count'])
        with self.assertRaises(ValueError):spectra.plan(INFO,SETTINGS,{**OPTIONS,'layout':'hex','passes':9,'spacing_nm':.5})

    def test_irregular_samples_match_original_crops_and_export_summary(self):
        y,x=np.indices((256,256));image=(np.cos(x*.7)+(x>128)*np.sin(y*.9)).astype(np.float32)
        result=spectra.compute(image,{**INFO,'width':256,'height':256},SETTINGS,{**OPTIONS,'layout':'hex','sample_edges':True,'components':2})
        for i,s in enumerate(result['plan']['samples']):
            r=s['roi'];self.assertEqual(result['positions'][i].tolist(),[r[k] for k in ('x','y','w','h')])
        i=len(result['positions'])-1;x,y,w,h=result['positions'][i]
        expected=spectra.local_spectrum(image[y:y+h,x:x+w],result['plan'],SETTINGS,result['radii'],result['angles'])
        np.testing.assert_allclose(result['raw_spectra'][i],expected.ravel())
        summary=spectra.summary(result);json.dumps(summary,allow_nan=False)
        self.assertEqual(np.asarray(summary['components'][0]['scores']).size,len(result['positions']))

    def test_checked_pcs_limit_both_feature_sides_and_combinations(self):
        result,templates=split_pattern();before=result['components'].copy()
        fits=pca_fitting.fit_features(result,templates,dict(feature_components=[1],combination_components=[1],combination_mode='together'))
        self.assertEqual(fits['feature_components'],[1]);self.assertEqual(fits['total'],2)
        self.assertEqual([g['components'] for g in fits['groups']],[[1],[1]])
        np.testing.assert_array_equal(result['components'],before)
        with self.assertRaises(ValueError):pca_fitting.fit_features(result,templates,dict(feature_components=[]))
        with self.assertRaises(ValueError):pca_fitting.fit_features(result,templates,dict(feature_components=[1],combination_components=[0,1]))
        with patch.object(component_maps,'aggregate',return_value={'cells':[]}) as aggregate:
            controller=spectra.SharedSpectra();controller.job=dict(id='a',state='complete',started=0);controller.result=result
            self.assertIs(controller.stability_map('a',{}),controller.stability_map('a',{}));self.assertEqual(aggregate.call_count,1)
            result['phase_support']={'generation':'new','windows':[{}]}
            controller.stability_map('a',{});self.assertEqual(aggregate.call_count,2)

if __name__=='__main__':unittest.main()
