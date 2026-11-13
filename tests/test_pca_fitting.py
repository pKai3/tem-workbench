"""Signed-feature invariance and original-window checks, with synthetic lattices."""
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
from tem_workbench.analysis import analysis_core as core
from tem_workbench.analysis import scale_fitting
from tem_workbench.components import shared_spectra as spectra
from tem_workbench.components import pca_fitting as fitting
from test_shared_spectra import INFO, SETTINGS, OPTIONS


def synthetic():
    templates = json.loads((Path(__file__).resolve().parents[1]/'tem_workbench/resources/templates.json').read_text())
    for t in templates:
        for key in ('hkl', 'q', 'g'): t[key] = np.array(t[key])
    t = next(t for t in scale_fitting.prepare_templates(templates)
             if t['phase']=='BCC' and t['zone_3index']==[1,-3,-1])
    plan = spectra.plan(INFO, SETTINGS, {**OPTIONS, 'method':'pca'})
    radii, angles, weights = spectra.axes(plan)
    radius, angle = np.meshgrid(radii, angles, indexing='ij')
    def pattern(rotation, scale=1.):
        q = core.canonical(core.rotation(scale_fitting.prediction_points(t,1,1), rotation)*scale)
        q = q[(np.linalg.norm(q,axis=1)>2.6)&(np.linalg.norm(q,axis=1)<9.8)]
        values = np.zeros_like(weights)
        for qx,qy in q:
            delta = (angle-np.arctan2(qy,qx)+np.pi/2)%np.pi-np.pi/2
            values += np.exp(-.5*((radius-np.hypot(qx,qy))/.06)**2-.5*(delta/.009)**2)
        return values.ravel()
    a,b = pattern(.47),pattern(1.14)
    raw = np.array([a,b,(a+b)/2,np.zeros_like(a)], np.float32)+5
    plan.update(count=4,map_shape=[2,2],xs=plan['xs'][:2],ys=plan['ys'][:2])
    result = dict(plan=plan, settings={**SETTINGS, 'scale_mode':'fixed'},
                  components=np.array([(a-b)*weights.ravel()/2]), scores=np.array([[1.],[-1.],[0.],[0.]]),
                  mean=(5+(a+b)/2)*weights.ravel(), raw_spectra=raw,
                  area_weights=weights, radii=radii, angles=angles, source=INFO,
                  normalizations=np.ones(4), positions=np.array([[0,0,128,128]]*4),
                  explained_variance_ratio=np.array([.9]), residual=np.zeros(4), algorithm='synthetic')
    return result, [t], pattern


class PcaFittingTests(unittest.TestCase):
    def test_repeated_geometry_across_components_keeps_one_check_and_all_sources(self):
        r,t,_ = synthetic()
        fits = fitting.fit_lobes(r,t,{})
        best=copy.deepcopy(fits['groups'][0]['candidates'][0])
        near=copy.deepcopy(best);near['score']-=.05;near['rotation_deg']+=.6
        near['predicted_nodes']=[{**n,'q':core.rotation(np.array([n['q']]),np.radians(.6))[0].tolist()} for n in near['predicted_nodes']]
        r['scores']=np.column_stack([r['scores'],r['scores']])
        r['components']=np.vstack([r['components'],r['components']])
        fits['groups']=[dict(component=0,components=[0],side='negative',candidates=[best]),
                        dict(component=1,components=[1],side='negative',candidates=[near]),
                        dict(component=1,components=[1],side='positive',candidates=[copy.deepcopy(near)])]
        fits['completed']=fits['total']=len(fits['groups'])
        before=copy.deepcopy(fits)
        with patch.object(fitting,'_local',wraps=fitting._local) as local:
            maps=fitting.build(r,t)
        self.assertEqual(len(maps['models']),1)
        self.assertEqual(local.call_count,len(r['raw_spectra']))
        model=maps['models'][0]
        self.assertEqual([(s['component'],s['side']) for s in model['sources']],
                         [(0,'negative'),(1,'negative'),(1,'positive')])
        self.assertEqual(model['predicted_nodes'],best['predicted_nodes'])
        self.assertEqual(model['score'],best['score'])
        self.assertEqual(fits,before)
        self.assertLessEqual(maps['model_passing_counts']['0'],len(r['raw_spectra']))
        r['phase_support']=maps
        self.assertEqual(fitting.window_detail(r,0,0)['sources'],model['sources'])
        json.dumps(maps,allow_nan=False)

    def test_shared_sources_do_not_bridge_distinct_orientations(self):
        r,t,_=synthetic();fitting.fit_lobes(r,t,{})
        before=sum(len(g['candidates']) for g in r['fits']['groups'])
        models=fitting.unique_models(r)
        self.assertEqual(sum(len(m['sources']) for m in models),before)
        self.assertGreaterEqual(len(models),2)
        self.assertGreater(abs(models[0]['rotation_deg']-models[1]['rotation_deg']),25)

    def test_both_sides_and_same_phase_orientations_survive(self):
        r,t,_ = synthetic()
        before = copy.deepcopy(r)
        fits = fitting.fit_lobes(r,t,{})
        self.assertEqual((fits['total'],fits['completed']), (2,2))
        first,second = [g['candidates'][0] for g in fits['groups']]
        self.assertTrue(first['valid'] and second['valid'])
        self.assertEqual(first['phase'], second['phase'])
        self.assertGreater(abs(first['rotation_deg']-second['rotation_deg']), 25)
        maps = fitting.build(r,t)
        self.assertGreaterEqual(len(maps['models']),2)
        self.assertEqual(maps['windows'][3]['label'],'unresolved')
        for wi,side in [(0,'positive'),(1,'negative')]:
            self.assertTrue(any(c['valid'] and c['side']==side for c in maps['windows'][wi]['candidates']))
        # A zero-score mean window can contain both patterns. Never gate by sign.
        both = maps['windows'][2]
        self.assertEqual({c['side'] for c in both['candidates'] if c['valid']}, {'positive','negative'})
        self.assertTrue(all(w['tested_models']==len(maps['models']) for w in maps['windows']))
        for key in ('components','scores','mean','raw_spectra'):
            np.testing.assert_array_equal(r[key], before[key])
        json.dumps(maps,allow_nan=False)

    def test_sign_flip_only_swaps_labels(self):
        r,t,_ = synthetic();flipped = copy.deepcopy(r)
        flipped['components'] *= -1;flipped['scores'] *= -1
        for item in (r,flipped): fitting.fit_lobes(item,t,{})
        a,b = fitting.build(r,t), fitting.build(flipped,t)
        def physical(maps, wi):
            return sorted((c['phase'],round(c['rotation_deg'],5),round(c['score'],6),c['valid']) for c in maps['windows'][wi]['candidates'])
        for wi in range(4): self.assertEqual(physical(a,wi),physical(b,wi))
        np.testing.assert_array_equal(fitting.lobe_spectrum(r,0,'positive'), fitting.lobe_spectrum(flipped,0,'negative'))

    def test_two_orientations_from_one_side_are_not_collapsed(self):
        r,t,pattern = synthetic()
        r['components'][0] = (pattern(.47)+pattern(1.14)-pattern(.1))*r['area_weights'].ravel()
        r['raw_spectra'][0] = 5+pattern(.47)+pattern(1.14)
        fits = fitting.fit_lobes(r,t,{})
        passing = [c for c in fits['groups'][0]['candidates'] if c['valid']]
        self.assertGreaterEqual(len(passing),2)
        self.assertEqual({c['phase'] for c in passing},{'BCC'})
        maps = fitting.build(r,t)
        self.assertGreaterEqual(sum(c['valid'] and c['side']=='positive' for c in maps['windows'][0]['candidates']),2)

    def test_feature_screen_does_not_gate_original_window_support(self):
        r,t,_ = synthetic()
        fits = fitting.fit_lobes(r,t,{})
        fits['groups'][0]['candidates'][0]['valid'] = False
        maps = fitting.build(r,t)
        model = next(m for m in maps['models'] if m['group']==0)
        self.assertFalse(model['valid'])
        self.assertTrue(next(c for c in maps['windows'][0]['candidates'] if c['model']==model['id'])['valid'])

    def test_validation_zero_lobe_and_weak_amplitude(self):
        r,t,_ = synthetic()
        for component,side in [(True,'positive'),(-1,'positive'),(1,'positive'),(0,'both')]:
            with self.assertRaises(ValueError): fitting.lobe_spectrum(r,component,side)
        with self.assertRaises(ValueError): fitting.validate_options({**r,'plan':{'method':'nmf'}},{})
        original = fitting.lobe_detail(r,0,'negative',t)
        r['components'] *= .0001;r['scores'] /= .0001
        weak = fitting.lobe_detail(r,0,'negative',t)
        np.testing.assert_allclose([[p[k] for k in ('qx','qy','relative_strength')] for p in original['peaks']],
                                   [[p[k] for k in ('qx','qy','relative_strength')] for p in weak['peaks']],rtol=1e-5)
        r['components'] = np.maximum(r['components'],0)
        empty = fitting.lobe_detail(r,0,'negative',t)
        self.assertEqual(empty['peaks'],[]);self.assertEqual(empty['candidates'],[])

    def test_window_overlay_is_original_with_bounded_refinement(self):
        r,t,pattern = synthetic();r['settings'].update(scale_mode='auto_uniform',scale_penalty_strength=.1)
        fitting.fit_lobes(r,t,{})
        r['raw_spectra'][0] = 5+pattern(.47+np.radians(2),1.015)
        r['phase_support'] = fitting.build(r,t)
        candidate = next(c for c in r['phase_support']['windows'][0]['candidates'] if c['side']=='positive' and c['valid'])
        detail = fitting.window_detail(r,0,candidate['model'])
        self.assertEqual(detail['spectrum'],spectra.spectrum_image(r['raw_spectra'][0],r['plan']))
        m = detail['candidates'][0]
        self.assertTrue(m['valid']);self.assertGreaterEqual(m['matched_profile_count'],4)
        self.assertLessEqual(abs(m['rotation_adjustment_deg']),3)
        self.assertLessEqual(abs(m['local_scale']-1),.03+1e-8)
        source=r['phase_support']['models'][candidate['model']]
        self.assertAlmostEqual(m['fitted_a_nm'],source['fitted_a_nm']/m['local_scale'])
        self.assertAlmostEqual(m['scale_a'],source['scale_a']*m['local_scale'])
        self.assertAlmostEqual(m['fitted_a_nm']*m['scale_a'],source['fitted_a_nm']*source['scale_a'])
        self.assertAlmostEqual(m['score'],m['position_score']-m['scale_penalty']-m['local_scale_penalty'])
        self.assertTrue(m['matches']);json.dumps(detail,allow_nan=False)
        for wi,mi in [(True,0),(-1,0),(0,True),(0,999)]:
            with self.assertRaises(ValueError):fitting.window_detail(r,wi,mi)

    def test_cancellation_and_export_preserve_signed_provenance(self):
        r,t,_ = synthetic();stop = threading.Event()
        def progress(done,*_):
            if done==1:stop.set()
        with self.assertRaises(CancelledError):fitting.fit_lobes(r,t,{},stop,progress)
        self.assertEqual(r['fits']['completed'],1)
        manager = spectra.SharedSpectra();manager.result=r;manager.job=dict(id='test',state='complete',started=time.monotonic())
        manager.fit('test',t,{});manager.thread.join(10)
        self.assertEqual(r['fit_status'],'complete')
        manager.support('test',t);manager.thread.join(10)
        self.assertEqual(r['phase_support_status'],'complete')
        stop.clear()
        def cancel_window(done,*_):stop.set()
        with self.assertRaises(CancelledError):fitting.build(r,t,stop,cancel_window)
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(spectra,'export_staging_root',return_value=Path(folder)/'staging'):
                files = spectra.export(r,folder)['files']
            meta = json.loads(Path(files[1]).read_text())
            self.assertEqual(meta['fits'],r['fits']);self.assertEqual(meta['phase_support'],r['phase_support'])
            with np.load(files[0],allow_pickle=False) as saved:
                np.testing.assert_array_equal(saved['components'],r['components'])
                self.assertEqual(json.loads(str(saved['metadata'])),meta)


if __name__ == '__main__': unittest.main()
