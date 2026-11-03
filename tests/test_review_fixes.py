"""Regression checks for the November 2026 external review fixes."""
import copy
import unittest
from unittest.mock import patch
import numpy as np
import analysis_core as core
import peak_evidence as evidence
import scale_fitting as fitting
from engine import Engine


class ReviewFixes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine({})
        cls.template = next(t for t in cls.engine.templates
                            if t['phase'] == 'HCP' and t['zone_3index'] == [0, 1, 0])

    def mixture(self, weight=.6):
        q = fitting.prediction_points(self.template, 1., 1.)
        g = np.linalg.norm(q, axis=1)
        q = q[(g >= 3) & (g <= 10)]
        q = q[np.argsort(np.linalg.norm(q, axis=1))][:6]
        rng = np.random.default_rng(42)
        peaks = []
        for angle, amplitude in ((.31, 4.), (.55, 4.*weight)):
            for p in core.canonical(core.rotation(q, angle))+rng.normal(0, .025, q.shape):
                peaks.append(dict(profile_id=len(peaks)+1, qx=float(p[0]), qy=float(p[1]),
                                  weight=amplitude, log_radial_enrichment=5.))
        return peaks

    def test_weaker_same_phase_orientation_reaches_refinement(self):
        # Old top-three seed truncation only explored profiles 1..6 here.
        # Require exploration, not acceptance: 35% weight may fail the screen.
        for weight in (.6, .35):
            for mode in ('fixed', 'auto_uniform', 'auto_hcp_ac', 'auto_hcp_ratio'):
                with self.subTest(weight=weight, mode=mode):
                    peaks = self.mixture(weight)
                    candidates = []
                    if mode == 'fixed':
                        core.search(peaks, [self.template], 1., .18, candidate_sink=candidates)
                    else:
                        fitting.search(peaks, [self.template], .18, mode, candidate_sink=candidates)
                    for expected in (set(range(1, 7)), set(range(7, 13))):
                        self.assertTrue(any(expected <= {m['profile_id'] for m in c['matches']}
                                            for c in candidates))
                    self.assertLessEqual(len(candidates), 6)

    def test_single_orientation_does_not_become_a_second_pattern(self):
        peaks = self.mixture()[:6]
        for mode in ('fixed', 'auto_uniform', 'auto_hcp_ac', 'auto_hcp_ratio'):
            with self.subTest(mode=mode):
                models = (core.search(peaks, [self.template], 1., .18) if mode == 'fixed'
                          else fitting.search(peaks, [self.template], .18, mode))
                result = core.classify(peaks, models, .18)
                self.assertEqual(result['label'], 'hcp_compatible')
                self.assertFalse(result.get('secondary_model'))

    def test_extra_seeds_preserve_initial_and_skip_symmetry_copies(self):
        angles = np.radians([10, 10.5, 90, 30, 50])
        scores = [.9, .89, .85, .4, .3]
        support = [[1,1,1,0,0,0], [1,1,1,0,0,0], [1,1,1,0,0,0],
                   [0,0,0,1,1,1], [0,0,0,1,1,1]]
        self.assertEqual(core.additional_orientation_seeds(angles, np.array(scores), np.array(support), [0,1]), [3])

    def test_retention_preserves_zone_alternatives_without_duplicate_orientation(self):
        def candidate(zone, ids, score):
            return dict(phase='HCP', zone_3index=zone, score=score,
                        matches=[dict(profile_id=i) for i in ids])
        candidates = [candidate([0,1,0], range(6), .8), candidate([0,1,0], range(6), .79),
                      candidate([1,0,0], range(6), .7), candidate([0,1,0], range(6,12), .4)]
        self.assertEqual(core.retain(candidates), fitting.retain(candidates))
        self.assertEqual(len(core.retain(candidates)), 3)

    def test_strong_exclusion_precedes_weak_deduplication_and_does_not_mutate_cache(self):
        prepared = dict(radius=.2, candidates=[dict(q=[4,1], enrichment=5),
                                               dict(q=[4.15,1], enrichment=4)])
        original = copy.deepcopy(prepared)
        strong = [dict(qx=3.9, qy=1)]
        self.assertEqual(evidence.for_peaks(prepared, strong)['maxima'][0]['q'], [4.15,1])
        self.assertEqual(evidence.for_peaks(prepared, [])['maxima'][0]['q'], [4,1])
        self.assertEqual(prepared, original)

    def image(self):
        yy,xx = np.indices((256,256))
        image = sum((i+1)*np.cos(2*np.pi*(x*xx+y*yy)/256)
                    for i,(x,y) in enumerate([(25,5),(29,5),(38,21),(42,39),(6,42),(15,60),(47,30),(57,19)]))
        return dict(array=image.astype('float32'), info=dict(image_kind='real_space',pixel_x_nm=.03,pixel_y_nm=.03),limits=[-40,40])

    def test_weak_checks_use_the_same_processed_signal_and_settings(self):
        image = self.image()['array']
        for sigma in (0., .65, 1.25):
            s = core.spectrum(image,.03,.03,smoothing_sigma=sigma,threshold_floor=2.4)
            a = evidence.prepare_candidates(s,image.shape,.03,.03)
            # Legacy payloads without the processed field must honour metadata too.
            b = evidence.prepare_candidates({k:v for k,v in s.items() if k!='detector_signal'},image.shape,.03,.03)
            self.assertEqual(a,b)
            self.assertTrue(all(p['enrichment']>=2.4 for p in a['candidates']))
            high = evidence.prepare_candidates({**s,'detection_threshold_floor':20},image.shape,.03,.03)
            self.assertEqual(high['candidates'], [p for p in a['candidates'] if p['enrichment'] >= 20])

    def test_auto_prepares_weak_candidates_once_and_reuses_selected_geometry(self):
        item = self.image();roi=dict(x=0,y=0,w=256,h=256)
        for objective in ('rank','geometry'):
            with patch.object(evidence,'prepare_candidates',wraps=evidence.prepare_candidates) as prep, \
                 patch.object(core,'purity',wraps=core.purity) as geometry:
                result = self.engine.analyze(item,roi,dict(fft_auto_strength=True,fft_auto_objective=objective),images=False)
            report = result['spectrum']['auto_peak_strength']
            self.assertEqual(prep.call_count,1)
            self.assertGreater(report['tested_sets'],1)
            self.assertEqual(geometry.call_count,report['tested_sets'] if objective=='geometry' else 1)
            self.assertEqual(report['pool_profiles'], max(t['profiles'] for t in report['trials']))
            self.assertGreaterEqual(report['pool_profiles'], len(result['spectrum']['peaks']))
            self.assertLessEqual(report['selected_weight_fraction'],1.)
            self.assertEqual(report['scope'],'dominant_pattern' if objective=='rank' else 'geometry_patterns')
            flags = ' '.join(result['classification']['flags'])
            self.assertEqual('Dominant-pattern selection' in flags, objective=='rank')

    def test_prediction_cache_does_not_change_results(self):
        peaks=self.mixture()
        cache={}
        a=fitting.search(peaks,[self.template],.18,'auto_hcp_ratio',prediction_cache=cache)
        with patch.object(fitting,'prediction_points',wraps=fitting.prediction_points) as predictions:
            b=fitting.search(peaks[:8],[self.template],.18,'auto_hcp_ratio',prediction_cache=cache)
            # Cached seed coordinates use sa=1; refinement still computes its own.
            self.assertFalse(any(call.args[1]==1. and len(call.args)<5 for call in predictions.call_args_list))
        self.assertEqual(a,fitting.search(peaks,[self.template],.18,'auto_hcp_ratio'))
        self.assertEqual(b,fitting.search(peaks[:8],[self.template],.18,'auto_hcp_ratio'))

    def test_noise_only_crops_do_not_pass(self):
        item = self.image()
        for seed in range(3):
            item['array'] = np.random.default_rng(seed).normal(size=(256,256)).astype('float32')
            for mode in ('manual', 'geometry', 'rank'):
                with self.subTest(seed=seed, mode=mode):
                    result = self.engine.analyze(item, dict(x=0,y=0,w=256,h=256),
                        dict(enabled_phases=['HCP','BCC'], scale_mode='auto_hcp_ratio',
                             fft_auto_strength=mode!='manual', fft_auto_objective='geometry' if mode=='geometry' else 'rank'), images=False)
                    self.assertFalse(any(m['valid'] for m in result['models']))

    def test_three_profile_explanation_does_not_relax_screen(self):
        peaks=self.mixture()[:3]
        _,settings=self.engine.validate(self.image(),dict(x=0,y=0,w=256,h=256),{})
        result=self.engine.classify(dict(peaks=peaks,df=.1),[],settings,8.,8.)
        self.assertEqual(result['label'],'insufficient')
        self.assertIn('requires four',' '.join(result['flags']))


if __name__=='__main__':unittest.main()
