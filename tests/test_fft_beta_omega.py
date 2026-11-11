"""Linked beta/omega must be found from image FFTs, not only detector spots."""
import copy
import itertools
import json
import unittest
from unittest.mock import patch
import numpy as np
import analysis_core as core
import diffraction_fitting
from engine import Engine


def fixture(omega=True):
    engine = Engine({})
    zone = [1, -3, -1]
    template = next(t for t in engine.templates if t['phase']=='BCC' and t['zone_3index']==zone)
    h = np.array(list(itertools.product(range(-6,7), repeat=3)))
    cell = np.array([[1.,-1.,0.], [0.,1.,-1.], [.5,.5,.5]])
    sites = np.array([[0,0,0], [2/3,1/3,.5], [1/3,2/3,.5]])
    rows = []
    for axis in (None, (1,1,1), (-1,1,-1)) if omega else (None,):
        vectors = h if axis is None else h @ np.linalg.inv(cell*np.array(axis)).T
        allowed = h.sum(axis=1)%2==0 if axis is None else abs(np.exp(2j*np.pi*h@sites.T).sum(axis=1))>1e-8
        q = core.rotation(vectors @ template['projection']/ .33, .37)
        g = np.linalg.norm(q, axis=1)
        q = core.canonical(q[allowed & (abs(vectors @ zone)<1e-8) & (g>=2.5) & (g<=10.)])
        rows.append({tuple(np.round(v,8)): v for v in q})
    combined = {key:value for row in rows for key,value in row.items()}
    n=256; pixel=.04; yy,xx=np.indices((n,n))
    image = 100 + sum((3 if key in rows[0] else 2)*np.cos(2*np.pi*pixel*(v[0]*xx+v[1]*yy)) for key,v in combined.items())
    item = dict(array=image,info=dict(image_kind='real_space',pixel_x_nm=pixel,pixel_y_nm=pixel),limits=[60,140])
    settings=dict(enabled_phases=['BCC','OMEGA'],scale_mode='auto_uniform',scale_penalty_strength=.1,
                  fft_minimum_enrichment=1.5,threshold=.15,fft_threshold_floor=.5,
                  peak_evidence_weight=0.,missing_peak_weight=0.,brightness_grouping_weight=0.,double_diffraction_weight=0.)
    return engine,item,dict(x=0,y=0,w=n,h=n),settings


class FFTLinkedTests(unittest.TestCase):
    def test_real_fft_manual_and_rescore(self):
        engine,item,roi,settings=fixture()
        result=engine.analyze(item,roi,settings,images=False,cache_candidates=True)
        self.assertTrue(result['beta_omega']['fit']['valid'])
        self.assertTrue(result['beta_omega']['selected'])
        self.assertEqual(result['beta_omega']['observation_kind'],'image_fft')
        self.assertGreaterEqual(len(result['beta_omega']['fit']['component_ids']),2)
        fresh=engine.analyze(item,roi,{**settings,'scale_penalty_strength':.2},images=False)
        with patch.object(core,'spectrum',side_effect=AssertionError('Rescoring must not repeat FFT')):
            cached=engine.rescore(result,.2)
        self.assertAlmostEqual(cached['beta_omega']['fit']['score'],fresh['beta_omega']['fit']['score'],places=8)
        self.assertEqual(cached['beta_omega']['selected'],fresh['beta_omega']['selected'])
        json.dumps({k:v for k,v in cached.items() if not k.startswith('_')},allow_nan=False)

    def test_disabled_phase_and_beta_only(self):
        engine,item,roi,settings=fixture(False)
        result=engine.analyze(item,roi,settings,images=False)
        self.assertFalse(result.get('beta_omega',{}).get('selected',False))
        with patch.object(diffraction_fitting.beta_omega,'fit',side_effect=AssertionError('Disabled omega must not run')):
            result=engine.analyze(item,roi,{**settings,'enabled_phases':['BCC']},images=False)
        self.assertNotIn('beta_omega',result)

    def test_geometry_auto_runs_linked_once(self):
        engine,item,roi,settings=fixture()
        with patch.object(diffraction_fitting,'fft_related',wraps=diffraction_fitting.fft_related) as linked:
            result=engine.analyze(item,roi,{**settings,'fft_auto_strength':True,'fft_auto_objective':'geometry'},images=False)
        self.assertEqual(linked.call_count,1)
        self.assertGreater(result['spectrum']['auto_peak_strength']['tested_sets'],1)
        self.assertTrue(result['beta_omega']['fit']['valid'])

    def test_rank_auto_and_selected_manual_agree(self):
        engine,item,roi,settings=fixture()
        auto=engine.analyze(item,roi,{**settings,'fft_auto_strength':True,'fft_auto_objective':'rank'},images=False)
        selected=auto['spectrum']['auto_peak_strength']
        manual=engine.analyze(item,roi,{**settings,'fft_minimum_enrichment':selected['selected_strength']},images=False)
        self.assertEqual(auto['classification']['label'],manual['classification']['label'])
        self.assertAlmostEqual(auto['models'][0]['score'],manual['models'][0]['score'],places=8)
        # Rank maximization may prefer a clean beta subset: do not silently change its objective.
        self.assertGreater(selected['tested_sets'],1)

    def test_cancel_linked_search(self):
        import threading
        from concurrent.futures import CancelledError
        import beta_omega
        event=threading.Event();event.set()
        with self.assertRaises(CancelledError):
            beta_omega.fit([dict(qx=3.,qy=0.,weight=1.),dict(qx=0.,qy=4.,weight=1.)],.1,2.5,10,
                           parents=[dict(zone=[0,0,1],mirror=1,factor=1.)],cancel_event=event)

    def test_linked_support_survives_grid_and_batch_summaries(self):
        import phase_support
        import overlap_maps
        import batch_grids
        import batch_stability
        from server import Workbench
        engine,item,roi,settings=fixture()
        result=engine.analyze(item,roi,settings,images=False)
        original=copy.deepcopy(result['models'])
        result.update(id='window',leaf=True,pass_id=0)
        zones=phase_support.best_zones(result,['BCC','OMEGA'])
        self.assertEqual(zones['OMEGA']['score_basis'],'joint_rank')
        self.assertGreaterEqual(len(zones['OMEGA']['related_components']),1)
        self.assertEqual(Workbench.best_zones(result),phase_support.best_zones(result,['HCP','BCC','FCC','ORT','OMEGA']))
        job=dict(source=dict(id='synthetic',name='synthetic',width=256,height=256,pixel_x_nm=.04,pixel_y_nm=.04),
                 state='complete',regions=[result],settings=settings,
                 grid=dict(mode='overlap',passes=1,sample_count=1,layout='hex',window_nm=10.24,spacing_nm=5.))
        aggregate=overlap_maps.aggregate(job)
        self.assertEqual(aggregate['phases']['OMEGA']['mean_support'],1.)
        summary=batch_stability.summarize(job,'test')
        self.assertEqual(summary['linked_beta_omega_windows'],1)
        self.assertEqual(batch_stability.sample_summaries([summary])[0]['linked_beta_omega_windows'],1)
        job['grid']={}
        summary=batch_grids.summarize(job,'test')
        self.assertEqual(summary['linked_beta_omega_regions'],1)
        self.assertIn('OMEGA',[z['phase'] for z in summary['passing_zones']])
        self.assertEqual(batch_grids.sample_summaries([summary])[0]['linked_beta_omega_regions'],1)
        self.assertEqual(result['models'],original)
        result['beta_omega']['fit']['valid']=False
        self.assertEqual(phase_support.models(result),original)

    def test_auto_rank_considers_joint_score(self):
        engine,item,roi,settings=fixture()
        def independent(s,*args):
            models=[dict(phase='BCC',score=.2,valid=True)]
            return models,models
        def linked(s,*args):
            return dict(fit=dict(score=.9 if len(s['peaks'])==10 else .3,valid=True,related_pattern=True))
        with patch.object(engine,'_fit_spectrum',side_effect=independent), \
             patch.object(diffraction_fitting,'fft_related',side_effect=linked), \
             patch.object(engine,'classify',return_value=dict(label='unresolved',flags=[])), \
             patch.object(diffraction_fitting,'compare',side_effect=lambda c,*args:c), \
             patch.object(core,'purity',return_value={}):
            result=engine.analyze(item,roi,{**settings,'fft_auto_strength':True},images=False)
        self.assertEqual(len(result['spectrum']['peaks']),10)
        self.assertEqual(result['beta_omega']['fit']['score'],.9)

    def test_nonzero_evidence_rescore_matches_fresh(self):
        engine,item,roi,settings=fixture()
        settings.update(peak_evidence_weight=.1,missing_peak_weight=.1,brightness_grouping_weight=.1)
        result=engine.analyze(item,roi,settings,images=False,cache_candidates=True)
        fresh=engine.analyze(item,roi,{**settings,'scale_penalty_strength':.2},images=False)
        cached=engine.rescore(result,.2)
        self.assertAlmostEqual(cached['beta_omega']['fit']['score'],fresh['beta_omega']['fit']['score'],places=8)
        self.assertEqual(cached['classification']['label'],fresh['classification']['label'])
