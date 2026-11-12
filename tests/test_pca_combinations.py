"""Score-weighted reconstructions propose fits; original windows test them."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from concurrent.futures import CancelledError
from unittest.mock import patch
import numpy as np
import analysis_core as core
import pca_fitting as fitting
import shared_spectra as spectra
from test_pca_fitting import synthetic


def split_pattern():
    r,templates,_=synthetic();t=templates[0]
    q=core.canonical(core.rotation(t['q'],.47))
    q=q[(np.linalg.norm(q,axis=1)>2.6)&(np.linalg.norm(q,axis=1)<9.8)]
    radius,angle=np.meshgrid(r['radii'],r['angles'],indexing='ij')
    a=np.zeros_like(radius);b=a.copy()
    for i,(x,y) in enumerate(q):
        delta=(angle-np.arctan2(y,x)+np.pi/2)%np.pi-np.pi/2
        (a if i%2 else b)[:]+=np.exp(-.5*((radius-np.hypot(x,y))/.06)**2-.5*(delta/.009)**2)
    a=a.ravel();b=b.ravel();w=r['area_weights'].ravel()
    r.update(components=np.array([a*w,b*w]),scores=np.array([[.5,.5],[.5,-.5],[-.5,.5],[-.5,-.5]]),
             mean=(5+(a+b)/2)*w,raw_spectra=np.array([5+a+b,5+a,5+b,5+np.zeros_like(a)]),
             explained_variance_ratio=np.array([.5,.5]))
    return r,templates


OPTIONS=dict(combination_mode='together',combination_components=[0,1])


class PcaCombinationTests(unittest.TestCase):
    def test_reconstruction_uses_signed_scores_mean_area_and_normalization(self):
        r,_=split_pattern();r['normalizations'][:]=[1.,2.,3.,4.]
        for i in range(4):
            spectrum,weights=fitting.combination_spectrum(r,[1,0,1],i)
            np.testing.assert_allclose(spectrum,r['raw_spectra'][i]*r['normalizations'][i],atol=1e-10)
            np.testing.assert_array_equal(weights,r['scores'][i])
        before=copy.deepcopy(r)
        fitting.combination_spectrum(r,[0,1],0)
        np.testing.assert_array_equal(r['components'],before['components'])

    def test_combination_recovers_pattern_split_across_individual_features(self):
        r,t=split_pattern();fits=fitting.fit_features(r,t,OPTIONS)
        self.assertEqual(fits['completed'],fits['total']);self.assertEqual(fits['total'],8)
        self.assertTrue(all(not g['candidates'] for g in fits['groups'][:4]))
        group=fits['groups'][-1];best=group['candidates'][0]
        self.assertTrue(best['valid']);self.assertEqual(best['phase'],'BCC')
        self.assertEqual(group['completed_windows'],4);self.assertEqual(best['window'],0)
        maps=fitting.build(r,t);r['phase_support']=maps
        self.assertTrue(any(c['valid'] for c in maps['windows'][0]['candidates']))
        self.assertFalse(any(c['valid'] for c in maps['windows'][3]['candidates']))
        model=maps['models'][0]
        self.assertEqual(model['sources'][0]['components'],[0,1])
        self.assertEqual(model['sources'][0]['window'],0)
        detail=fitting.combination_detail(r,[0,1],best['window'],t)
        self.assertAlmostEqual(detail['candidates'][0]['score'],best['score'])
        self.assertEqual(detail['coefficients'],[.5,.5])
        window=fitting.window_detail(r,0,model['id'])
        self.assertIsNone(window['component_score'])
        self.assertEqual(window['spectrum'],spectra.spectrum_image(r['raw_spectra'][0],r['plan']))
        with tempfile.TemporaryDirectory() as folder,patch.object(spectra,'export_staging_root',return_value=Path(folder)/'staging'):
            files=spectra.export(r,folder)['files'];meta=json.loads(Path(files[1]).read_text())
            self.assertEqual(meta['fits'],fits);self.assertEqual(meta['phase_support'],maps)
            with np.load(files[0],allow_pickle=False) as saved:
                np.testing.assert_array_equal(saved['scores'],r['scores'])
                self.assertEqual(json.loads(str(saved['metadata']))['fits']['combination_components'],[0,1])

    def test_sign_reversal_preserves_combination_geometry_and_support(self):
        r,t=split_pattern();flipped=copy.deepcopy(r)
        flipped['components'][0]*=-1;flipped['scores'][:,0]*=-1
        outputs=[]
        for result in (r,flipped):
            fitting.fit_features(result,t,OPTIONS);outputs.append(fitting.build(result,t))
        for wi in range(4):
            self.assertEqual([(c['score'],c['valid']) for c in outputs[0]['windows'][wi]['candidates']],
                             [(c['score'],c['valid']) for c in outputs[1]['windows'][wi]['candidates']])

    def test_all_subsets_visit_every_window_without_averaging_scores(self):
        r,t=split_pattern();r['components']=np.vstack([r['components'],np.zeros_like(r['components'][0])])
        r['scores']=np.column_stack([r['scores'],np.zeros(4)])
        fits=fitting.fit_features(r,t,dict(combination_mode='all'))
        groups=[g for g in fits['groups'] if g.get('kind')=='combination']
        self.assertEqual([g['components'] for g in groups],[[0,1],[0,2],[1,2],[0,1,2]])
        self.assertTrue(all(g['completed_windows']==4 for g in groups))
        self.assertEqual((fits['completed'],fits['total']),(22,22))

    def test_exact_peak_configuration_cache_does_not_replace_raw_validation(self):
        r,t=split_pattern();r['scores'][:]=[.5,.5]
        fits=fitting.fit_features(r,t,OPTIONS)
        self.assertEqual(fits['combination_cache_hits'],3)
        self.assertEqual(fits['combination_searches'],1)
        maps=fitting.build(r,t)
        self.assertEqual(maps['windows'][3]['label'],'unresolved')

    def test_validation_cancel_and_export_include_partial_combination_progress(self):
        r,t=split_pattern()
        for options in (dict(combination_mode='bad'),dict(combination_components=[True]),dict(combination_components=[]),dict(combination_components=[2])):
            with self.assertRaises(ValueError):fitting.combination_options(r,options)
        for wi in (True,-1,4):
            with self.assertRaises(ValueError):fitting.combination_spectrum(r,[0,1],wi)
        stop=threading.Event()
        def progress(done,*_):
            if done==5:stop.set()
        with self.assertRaises(CancelledError):fitting.fit_features(r,t,OPTIONS,stop,progress)
        self.assertEqual((r['fits']['completed'],r['fits']['total']),(5,8))
        self.assertEqual(r['fits']['groups'][-1]['completed_windows'],1)
        with tempfile.TemporaryDirectory() as folder,patch.object(spectra,'export_staging_root',return_value=Path(folder)/'staging'):
            files=spectra.export(r,folder)['files']
            self.assertEqual(json.loads(Path(files[1]).read_text())['fits'],r['fits'])
        with self.assertRaises(ValueError):fitting.build(r,t)

    def test_background_pipeline_accepts_combination_options(self):
        r,t=split_pattern();manager=spectra.SharedSpectra();manager.result=r
        manager.job=dict(id='test',state='complete',started=time.monotonic())
        manager.fit('test',t,OPTIONS);manager.thread.join(10)
        self.assertEqual(r['fit_status'],'complete');self.assertEqual(r['fits']['combination_count'],1)
        manager.support('test',t);manager.thread.join(10)
        self.assertEqual(r['phase_support_status'],'complete')


if __name__=='__main__':unittest.main()
