"""Component proposals must be judged by the ordinary native FFT pipeline."""
import itertools
import threading
import unittest
from concurrent.futures import CancelledError
import numpy as np

import analysis_core as core
import component_validation as native
from component_execution import ComponentPool
from engine import Engine
import nmf_phase_maps
import pca_fitting
import shared_spectra
import scale_fitting


def fixture():
    engine=Engine({})
    settings=dict(enabled_phases=['BCC'],scale_mode='fixed',g_min=2.5,g_max=10.,
                  fft_smoothing_sigma=.65,fft_threshold_floor=1.8,
                  fft_minimum_enrichment=2.4,threshold=.35,fft_max_peaks=20,
                  peak_evidence_weight=.3,missing_peak_weight=.25,
                  brightness_grouping_weight=.3,double_diffraction_weight=.4)
    info=dict(image_kind='real_space',pixel_x_nm=.025,pixel_y_nm=.025,width=256,height=256)
    roi=dict(x=0,y=0,w=256,h=256)
    _,settings=engine.validate(dict(info=info,array=np.zeros((256,256))),roi,settings)
    template=next(t for t in engine.templates_for(settings) if t['phase']=='BCC' and t['zone_3index']==[1,-3,-1])
    q=core.rotation(template['q'],.47)
    q=q[(np.linalg.norm(q,axis=1)>2.5)&(np.linalg.norm(q,axis=1)<9.7)]
    y,x=np.indices((256,256))*.025
    image=sum((2+i/3)*np.cos(2*np.pi*(point[0]*x+point[1]*y)) for i,point in enumerate(q))
    image+=np.random.default_rng(0).normal(0,.4,image.shape)
    info=dict(image_kind='real_space',pixel_x_nm=.025,pixel_y_nm=.025,width=256,height=256)
    roi=dict(x=0,y=0,w=256,h=256)
    result=dict(source=info,_source_image=image,method_version=shared_spectra.VERSION,
                settings=settings,scores=np.zeros((4,1)),raw_spectra=np.zeros((4,1)),radii=np.array([3.]),angles=np.array([0.]),
                plan=dict(method='pca',samples=[dict(roi=roi) for _ in range(4)],count=4,
                          window_pixels=[256,256],window_nm=[6.4,6.4],pixel_nm=[.025,.025],image_shape=[256,256],g_min=2.5,g_max=10.))
    return engine,dict(array=image,info=info,limits=[-20,20]),roi,result


class NativeComponentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine,cls.item,cls.roi,cls.result=fixture()

    def seed(self,settings=None):
        settings=settings or self.result['settings']
        ordinary=self.engine.analyze(self.item,self.roi,settings,images=False)
        self.assertTrue(ordinary['models'])
        fit=max(ordinary['models'],key=lambda m:(m['valid'],m['score']))
        return ordinary,dict(fit,id=0,components=[0],component=0,side='positive')

    def test_native_detector_and_full_rank_agree_in_all_scale_modes(self):
        for mode in ('fixed','auto_uniform','auto_hcp_ratio'):
            with self.subTest(mode=mode):
                settings={**self.result['settings'],'scale_mode':mode}
                ordinary,seed=self.seed(settings)
                result={**self.result,'settings':settings}
                analysis=native.analyze(result,[seed],0)
                self.assertEqual(analysis['spectrum']['peaks'],ordinary['spectrum']['peaks'])
                fit=analysis['candidates'][0]
                self.assertEqual(fit['matched_profile_count'],seed['matched_profile_count'])
                self.assertEqual(fit['valid'],seed['valid'])
                for key in ('score','position_score','coverage','scale_penalty','weak_peak_bonus','missing_peak_penalty','brightness_bonus','double_diffraction_bonus'):
                    self.assertAlmostEqual(fit.get(key,0),seed.get(key,0),places=7,msg=key)
                self.assertGreater(fit['matched_profile_count'],3)

    def test_auto_strength_uses_ordinary_search_to_choose_the_peak_set(self):
        for objective in ('rank','geometry'):
            settings={**self.result['settings'],'fft_auto_strength':True,'fft_auto_objective':objective}
            ordinary,seed=self.seed(settings)
            seeded=native.analyze({**self.result,'settings':settings},[seed],0)
            self.assertEqual(seeded['spectrum']['peaks'],ordinary['spectrum']['peaks'])
            self.assertEqual(seeded['spectrum']['auto_peak_strength'],ordinary['spectrum']['auto_peak_strength'])

    def test_displaced_profile_counts_beyond_one_width(self):
        template=next(t for t in self.engine.templates_for(self.result['settings']) if t['phase']=='BCC' and t['zone_3index']==[1,-3,-1])
        q=core.rotation(template['q'],.47)
        q=q[(np.linalg.norm(q,axis=1)>2.5)&(np.linalg.norm(q,axis=1)<9.7)]
        q[0]+=[.32,0]
        y,x=np.indices((256,256))*.025
        image=sum((2+i/3)*np.cos(2*np.pi*(p[0]*x+p[1]*y)) for i,p in enumerate(q))
        item={**self.item,'array':image}
        ordinary=self.engine.analyze(item,self.roi,self.result['settings'],images=False)
        seed=dict(ordinary['models'][0],id=0,components=[0])
        width=core.peak_width(ordinary['spectrum'])
        self.assertTrue(any(width<m['residual_nm_inv']<4*width for m in seed['matches']))
        result={**self.result,'_source_image':image}
        checked=native.window(result,[seed],0)['candidates'][0]
        self.assertEqual(len(checked['profiles']),6)
        self.assertTrue(checked['valid'])
        self.assertAlmostEqual(checked['missing_peak_penalty'],seed['missing_peak_penalty'])

    def test_hcp_seed_refines_ca_with_ordinary_metric_rules(self):
        settings={**self.result['settings'],'enabled_phases':['HCP'],'scale_mode':'auto_hcp_ratio'}
        template=next(t for t in self.engine.templates_for(settings) if t['phase']=='HCP' and t['zone_3index']==[1,-1,-2])
        q=core.rotation(scale_fitting.prediction_points(template,.96,1.035),.47)
        q=q[(np.linalg.norm(q,axis=1)>2.5)&(np.linalg.norm(q,axis=1)<10)]
        peaks=[dict(profile_id=i,qx=x,qy=y,weight=4.) for i,(x,y) in enumerate(q)]
        args=dict(scale_penalty_strength=0,ca_penalty_strength=0,g_min=2.5)
        ordinary=scale_fitting.search(peaks,[template],.1,'auto_hcp_ratio',**args)[0]
        seed=dict(ordinary,id=0,scale_c=1.)
        checked=scale_fitting.search(peaks,[template],.1,'auto_hcp_ratio',hypotheses=[seed],**args)[0]
        self.assertAlmostEqual(checked['scale_c'],1.035,places=5)
        self.assertAlmostEqual(checked['score'],ordinary['score'],places=7)
        self.assertEqual(checked['source_hypothesis'],0)

    def test_pca_nmf_native_checks_ignore_feature_cutoff_and_factor_activity(self):
        _,seed=self.seed()
        context=dict(models=[seed],fraction=.99,eligibility=np.zeros((1,4),dtype=bool))
        a=pca_fitting.window_task(self.result,[],context,0,None)
        b=nmf_phase_maps.window_task(self.result,[],{**context,'fraction':.01},0,None)
        self.assertEqual(a['candidates'],b['candidates'])
        self.assertEqual(a['peak_positions'],b['peak_positions'])
        self.assertTrue(a['candidates'][0]['valid'])
        self.assertEqual(a['tested_models'],1)
        self.assertEqual(a['scoring_version'],native.VERSION)
        self.assertEqual(b['pool_comparisons'],a['pool_comparisons'])

    def test_native_worker_serial_parallel_and_cancel(self):
        _,seed=self.seed();context=dict(models=[seed])
        with ComponentPool(self.result,[],1,context=context,mapping=True) as pool:
            serial=[r for _,r,_ in pool.map(pca_fitting.window_task,range(4))]
        with ComponentPool(self.result,[],2,context=context,mapping=True) as pool:
            parallel=[r for _,r,_ in pool.map(pca_fitting.window_task,range(4))]
        self.assertEqual(serial,parallel)
        stop=threading.Event();stop.set()
        with self.assertRaises(CancelledError):native.window(self.result,[seed],0,stop)

    def test_native_missing_pixels_cannot_silently_use_legacy_rules(self):
        result={k:v for k,v in self.result.items() if k!='_source_image'}
        for function in (pca_fitting.window_task,nmf_phase_maps.window_task):
            with self.assertRaisesRegex(ValueError,'Rerun PCA/NMF'):
                function(result,[],dict(models=[],fraction=.35),0,None)

    def test_compact_pool_decisions_match_ordinary_classifier_for_every_subset(self):
        # Unequal weights and shared evidence exercise rules that differed in the old UI.
        peaks=[dict(profile_id=i,qx=float(np.cos(i)),qy=float(np.sin(i)),weight=1.+i) for i in range(10)]
        candidates=[dict(model=i,phase=phase,score=score,valid=True,coverage=coverage,
                        profiles=profiles,predicted_count=count,scale_parameter_count=params)
                    for i,(phase,score,coverage,profiles,count,params) in enumerate([
                      ('BCC',.7,.7,[0,1,2,3],6,1),('HCP',.68,.7,[0,1,2,3],4,0),
                      ('BCC',.65,.8,[4,5,6,7],4,1),('HCP',.3,.2,[0,1,2,3],4,1)])]
        decisions=native.pool_comparisons(candidates,peaks)
        for n in range(1,len(candidates)+1):
            for pool in itertools.combinations(candidates,n):
                row=decisions[str(pool[0]['model'])];ids={c['model'] for c in pool}
                label='multiple' if ids.intersection(row['multiple']) else 'ambiguous' if ids.intersection(row['ambiguous']) else row['label']
                self.assertEqual(label,native.classify(pool,peaks)['label'])


if __name__=='__main__':unittest.main()
