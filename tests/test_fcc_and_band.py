"""Analytical FCC reflections and shared adjustable fitting-band checks."""
import itertools
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import analysis_core as core
from crystal_templates import allowed, fcc_templates, reciprocal
import diffraction
from engine import Engine
import folder_paths
import peak_evidence
import phase_comparison
import scale_fitting as fitting
from server import Workbench
from test_diffraction import pattern


class FCCPatterns(unittest.TestCase):
    def test_cubic_selection_rules_and_projection(self):
        indices = np.array([[1,1,1], [2,0,0], [2,2,0], [1,0,0], [1,1,0], [2,1,1]])
        np.testing.assert_array_equal(allowed(indices, 'FCC'), [True,True,True,False,False,False])
        descriptors = fcc_templates()
        self.assertEqual(len(descriptors), 26)
        for t in fitting.prepare_templates(descriptors):
            self.assertTrue(np.all(t['hkl'] @ t['zone_3index'] == 0))
            self.assertTrue(allowed(t['hkl'], 'FCC').all())
            # Projection must preserve the cubic 3-D distances and angles.
            g = t['hkl']/.417
            np.testing.assert_allclose(t['q'] @ t['q'].T, g @ g.T, atol=1e-8)
        np.testing.assert_allclose(np.linalg.norm(reciprocal(indices[:3], 'FCC'), axis=1),
                                   np.sqrt([3,4,8])/.417)

    def test_expansion_covers_high_orders_for_changed_reference_and_range(self):
        descriptor = next(t for t in fcc_templates() if t['zone_3index'] == [0,0,1] and t['mirror']==1)
        t = fitting.prepare_templates([descriptor], g_max=18, fcc_a=.60)[0]
        q = fitting.prediction_points(t, .85, .85, fcc_a=.60)
        visible = (np.linalg.norm(q,axis=1)>=3) & (np.linalg.norm(q,axis=1)<=18)
        def canonical_indices(hkl):
            hkl=tuple(hkl)
            return min(hkl,tuple(-i for i in hkl))
        got={canonical_indices(hkl) for hkl in t['hkl'][visible]}
        expected={canonical_indices((h,k,0)) for h,k in itertools.product(range(-14,15,2),repeat=2)
                  if 3<=np.hypot(h,k)*.85/.60<=18}
        self.assertEqual(got,expected)
        self.assertTrue(any(max(abs(i) for i in hkl)>4 for hkl in got))

    def test_fcc_scale_recovery_and_selection(self):
        engine=Engine({})
        descriptors=fcc_templates()
        for mode in ('auto_uniform','auto_hcp_ac'):
            t=next(t for t in fitting.prepare_templates(descriptors,fcc_a=.45) if t['zone_3index']==[0,1,1] and t['mirror']==1)
            q=core.canonical(core.rotation(fitting.prediction_points(t,.973,.973,fcc_a=.45),.47))
            q=q[(np.linalg.norm(q,axis=1)>=3)&(np.linalg.norm(q,axis=1)<=10)]
            peaks=[dict(profile_id=i+1,qx=float(v[0]),qy=float(v[1]),weight=4.) for i,v in enumerate(q)]
            model=fitting.search(peaks,[t],.1,mode,fcc_a=.45,scale_penalty_strength=0)[0]
            self.assertTrue(model['valid'])
            self.assertLess(model['rms_nm_inv'],1e-4)
            self.assertAlmostEqual(model['scale_a'],.973,places=4)
            self.assertAlmostEqual(model['fitted_a_nm'],.45/.973,places=4)
            self.assertIsNone(model['fitted_c_nm'])
            self.assertEqual(model['scale_parameter_count'],1)
        # A complete FCC [001] square pattern should survive the whole library.
        t=next(t for t in engine.templates if t['phase']=='FCC' and t['zone_3index']==[0,0,1] and t['mirror']==1)
        q=core.canonical(core.rotation(t['q'],.37))
        q=q[(np.linalg.norm(q,axis=1)>=3)&(np.linalg.norm(q,axis=1)<=10)]
        peaks=[dict(profile_id=i+1,qx=float(v[0]),qy=float(v[1]),weight=4.) for i,v in enumerate(q)]
        models=fitting.search(peaks,engine.templates,.1,'auto_hcp_ac',scale_penalty_strength=.10)
        self.assertEqual(models[0]['phase'],'FCC')
        self.assertEqual(phase_comparison.classify(peaks,models,.03)['label'],'fcc_compatible')
        self.assertIn('FCC',Workbench.best_zones({'models':models}))


class FittingBand(unittest.TestCase):
    def test_fft_cutoff_changes_detected_profiles_and_weak_checks(self):
        n=512;pixel=.02;yy,xx=np.indices((n,n));width=n*pixel
        frequencies=[(42,0),(52,60),(118,35)]
        image=sum(np.cos(2*np.pi*(h*xx+k*yy)/n) for h,k in frequencies)
        low=core.spectrum(image,pixel,pixel,g_max=10)
        high=core.spectrum(image,pixel,pixel,g_max=14)
        self.assertEqual(len(low['peaks']),2)
        self.assertEqual(len(high['peaks']),3)
        self.assertTrue(all(3<=p['g_nm_inv']<=10 for p in low['peaks']))
        expected=np.hypot(*frequencies[-1])/width
        self.assertLess(min(abs(p['g_nm_inv']-expected) for p in high['peaks']),.02)
        self.assertGreater(high['extent'][1],low['extent'][1])
        self.assertEqual(peak_evidence.prepare(high,image.shape,pixel,pixel)['g_max'],14)
        # Near-boundary positions remain unchecked, rather than punished as missing.
        model=dict(predicted_nodes=[dict(q=[12,0]),dict(q=[13.95,0])],matches=[])
        peak_evidence.inspect(model,dict(maxima=[],radius=.1,g_max=14,x_limit=15,y_limit=15))
        self.assertEqual([n['status'] for n in model['peak_evidence']['nodes']],['unsupported','unassessable'])

    def test_direct_cutoff_recalculates_cached_detection(self):
        array,info,_=pattern()
        settings=diffraction.validate(info,{'refine_translation':False})
        cache={}
        low,_=diffraction.spectrum(array,settings,cache=cache,g_max=6)
        high,context=diffraction.spectrum(array,settings,cache=cache,g_max=10)
        self.assertEqual(len(low['peaks']),1)
        self.assertEqual(len(high['peaks']),5)
        self.assertEqual(context['g_max'],10)
        self.assertEqual(high['g_max'],10)
        self.assertTrue(all(p['g_nm_inv']<=6 for p in low['peaks']))
        self.assertEqual(settings.get('g_max'),None)

    def test_grid_sampling_uses_selected_limit(self):
        info=dict(id='sampling',image_kind='real_space',width=256,height=256,
                  pixel_x_nm=.06,pixel_y_nm=.06,can_index=False)
        with tempfile.TemporaryDirectory() as directory:
            app=Workbench(folder_paths.DEFAULTS,root=Path(directory))
            with patch('server.threading.Thread'):
                app.grid({'info':info},{'g_max':6.},2,False,5.)
            with self.assertRaisesRegex(ValueError,'sample the full'):
                app.grid({'info':info},{'g_max':10.},2,False,5.)

    def test_reference_and_limit_are_validated_saved_and_restored(self):
        array,info,_=pattern()
        item=dict(array=array,info=info,limits=[99.,351.])
        engine=Engine({})
        roi=dict(x=0,y=0,w=768,h=768)
        for key,value in [('g_max',3),('g_max',31),('fcc_a',float('nan')),('fcc_a',.8)]:
            with self.assertRaises(ValueError):engine.validate(item,roi,{key:value})
        with tempfile.TemporaryDirectory() as directory:
            app=Workbench(folder_paths.DEFAULTS,root=Path(directory))
            app.engine.loaded[info['id']]=item
            settings=dict(scale_mode='auto_hcp_ac',fcc_a=.45,g_max=8)
            saved=app.store_region(dict(file_id=info['id'],source_hash=info['sha256_pixels'],
                                       revision=0,name='FCC and band',tags=[],notes='',roi=roi,settings=settings))
            again=Workbench(folder_paths.DEFAULTS,root=Path(directory))
            again.engine.loaded[info['id']]=item
            stored=again.saved_region(saved['region']['id'])
            self.assertEqual(stored['settings']['fcc_a'],.45)
            self.assertEqual(stored['settings']['g_max'],8.)
            result=engine.analyze(item,roi,settings,images=False,cache_candidates=True)
            reranked=engine.rescore(result,.2,.2)
            self.assertEqual(reranked['settings']['fcc_a'],.45)
            self.assertEqual(reranked['spectrum']['g_max'],8.)
            self.assertTrue(all(np.linalg.norm(n['q'])<=8 for m in reranked['models'] for n in m['predicted_nodes']))
            json.dumps({k:v for k,v in reranked.items() if not k.startswith('_')},allow_nan=False)


if __name__=='__main__':
    unittest.main()
