"""Reference-cell geometry and user-controlled central exclusions."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

import analysis_core as core
from crystal_templates import reciprocal
import diffraction
from engine import Engine
import folder_paths
from materials import MATERIAL_PRESETS, reference_settings
import peak_evidence
import scale_fitting as fitting
from server import Workbench
from test_diffraction import pattern


def peaks_for(q):
    return [dict(profile_id=i+1, qx=float(x), qy=float(y), weight=4.)
            for i, (x, y) in enumerate(core.canonical(q))]


class MaterialReferences(unittest.TestCase):
    def test_presets_custom_edits_and_validation(self):
        iron = MATERIAL_PRESETS['iron']['references']
        self.assertEqual(reference_settings({'material': 'iron'}),
                         {'material': 'iron', **iron})
        edited = reference_settings({'material': 'iron', 'bcc_a': .287})
        self.assertEqual(edited['material'], 'custom')
        self.assertEqual(edited['hcp_a'], iron['hcp_a'])
        self.assertEqual(edited['bcc_a'], .287)
        # Old saved analyses retain their explicit reference dimensions.
        self.assertEqual(reference_settings({'fcc_a': .45})['fcc_a'], .45)
        self.assertEqual(reference_settings({})['material'], 'titanium')
        for supplied in ({'hcp_a': float('nan')}, {'hcp_c': .1}, {'material': 'unknown'}):
            with self.assertRaises(ValueError):
                reference_settings(supplied)

    def test_hcp_reference_and_fitted_metric_preserve_three_dimensional_geometry(self):
        engine = Engine({})
        for a, c in ((.295, .468), (.24637, .39568), (.32, .53)):
            templates = fitting.prepare_templates(engine.template_library, hcp_a=a, hcp_c=c, g_max=14)
            for t in (t for t in templates if t['phase'] == 'HCP'):
                self.assertTrue(np.all(t['hkl'] @ t['zone_3index'] == 0))
                for sa, sc in ((1., 1.), (.94, 1.07)):
                    q = fitting.prediction_points(t, sa, sc)
                    vectors = reciprocal(t['hkl'], 'HCP', a=a, c=c)*[sa, sa, sc]
                    np.testing.assert_allclose(q @ q.T, vectors @ vectors.T, atol=1e-8)
                    np.testing.assert_allclose(q, fitting.prediction_points(t, sa, sc, hkl=t['hkl']), atol=1e-8)

    def test_iron_patterns_fit_without_consuming_scale_adjustment(self):
        engine = Engine({})
        refs = MATERIAL_PRESETS['iron']['references']
        templates = fitting.prepare_templates(engine.template_library, **refs, g_max=14)
        for phase, zone in (('BCC', [1, -3, -1]), ('FCC', [0, 1, 1]), ('HCP', [1, -1, -2])):
            t = next(t for t in templates if t['phase'] == phase and t['zone_3index'] == zone and t['mirror'] == 1)
            q = fitting.prediction_points(t, 1., 1., bcc_a=refs['bcc_a'], fcc_a=refs['fcc_a'])
            q = core.rotation(q, .47)
            q = q[(np.linalg.norm(q, axis=1) >= 3) & (np.linalg.norm(q, axis=1) <= 14)]
            peaks = peaks_for(q)
            for mode in ('fixed', 'auto_hcp_ac'):
                kwargs = dict(bcc_a=refs['bcc_a'], fcc_a=refs['fcc_a'], g_max=14)
                models = (core.search(peaks, [t], 1., .1, **kwargs) if mode == 'fixed' else
                          fitting.search(peaks, [t], .1, mode, **kwargs))
                self.assertTrue(models[0]['valid'], (phase, mode))
                self.assertLess(models[0]['rms_nm_inv'], .005)
                prefix = 'nominal' if mode == 'fixed' else 'fitted'
                self.assertAlmostEqual(models[0][prefix+'_a_nm'], refs[phase.lower()+'_a'], places=4)
                if phase == 'HCP':
                    self.assertAlmostEqual(models[0][prefix+'_c_nm'], refs['hcp_c'], places=4)


class CentralExclusion(unittest.TestCase):
    def test_fft_inner_peaks_and_weak_search_follow_selected_radius(self):
        n = 512; pixel = .04; yy, xx = np.indices((n, n))
        image = 100 + sum(np.cos(2*np.pi*(h*xx+k*yy)/n) for h, k in ((26, 0), (0, 47), (78, 35)))
        original = image.copy()
        excluded = core.spectrum(image, pixel, pixel)
        included = core.spectrum(image, pixel, pixel, g_min=1.)
        self.assertEqual(len(excluded['peaks']), 1)
        self.assertEqual(len(included['peaks']), 3)
        self.assertEqual(sum(p['g_nm_inv'] < 3 for p in included['peaks']), 2)
        self.assertEqual(included['g_min'], 1.)
        context = peak_evidence.prepare(included, image.shape, pixel, pixel)
        self.assertEqual(context['g_min'], 1.)
        # Features already classed as strong are intentionally omitted from the
        # weak pass. Withhold the inner profiles to exercise that independent pass.
        withheld = {**included, 'peaks': [p for p in included['peaks'] if p['g_nm_inv'] >= 3]}
        weak = peak_evidence.prepare(withheld, image.shape, pixel, pixel)
        self.assertTrue(any(np.linalg.norm(m['q']) < 3 for m in weak['maxima']))
        # Lowering a detection boundary must not alter the transform itself.
        np.testing.assert_array_equal(included['log'], excluded['log'])
        np.testing.assert_array_equal(image, original)
        model = dict(predicted_nodes=[dict(q=[1.01, 0]), dict(q=[2., 0])], matches=[])
        peak_evidence.inspect(model, dict(maxima=[], radius=.1, g_min=1., g_max=10., x_limit=11, y_limit=11))
        self.assertEqual([n['status'] for n in model['peak_evidence']['nodes']], ['unassessable', 'unsupported'])

    def test_matching_counts_predictions_inside_old_three_inverse_nm_limit(self):
        engine = Engine({})
        # A deliberately large custom cell puts genuine allowed reflections below 3.
        templates = fitting.prepare_templates(engine.template_library, hcp_a=.6, hcp_c=.9, g_min=.8)
        t = next(t for t in templates if t['phase'] == 'HCP' and t['zone_3index'] == [1, -1, -2] and t['mirror'] == 1)
        q = core.rotation(t['q'], .47)
        q = q[(np.linalg.norm(q, axis=1) >= .8) & (np.linalg.norm(q, axis=1) <= 10)]
        peaks = peaks_for(q)
        for mode in ('fixed', 'auto_hcp_ac'):
            models = (core.search(peaks, [t], 1., .1, g_min=.8) if mode == 'fixed' else
                      fitting.search(peaks, [t], .1, mode, g_min=.8, scale_penalty_strength=0))
            self.assertTrue(models[0]['valid'])
            self.assertEqual(models[0]['matched_profile_count'], len(peaks))
            self.assertTrue(any(np.linalg.norm(n['q']) < 3 for n in models[0]['predicted_nodes']))

    def test_direct_inner_limit_invalidates_cached_detection(self):
        array, info, _ = pattern(); yy, xx = np.indices(array.shape)
        for sign in (1, -1):
            x = info['beam_center']['x'] + sign*1.5/info['pixel_x_nm_inv']
            y = info['beam_center']['y'] - sign*.3/info['pixel_y_nm_inv']
            array += 250*np.exp(-((xx-x)**2+(yy-y)**2)/(2*2.2**2))
        settings = diffraction.validate(info, {'refine_center': False, 'exclude_radius_nm_inv': 3.})
        cache = {}
        excluded, _ = diffraction.spectrum(array, settings, cache=cache)
        included, context = diffraction.spectrum(array, {**settings, 'exclude_radius_nm_inv': .8}, cache=cache)
        self.assertEqual(len(excluded['peaks']), 5)
        self.assertEqual(len(included['peaks']), 6)
        self.assertEqual(included['g_min'], .8)
        self.assertEqual(context['g_min'], .8)
        self.assertLess(min(abs(p['g_nm_inv']-np.hypot(1.5, .3)) for p in included['peaks']), .02)

    def test_material_and_band_persist_in_saved_analysis_and_reranking(self):
        array, info, _ = pattern(); item = dict(array=array, info=info, limits=[99., 351.])
        engine = Engine({}); roi = dict(x=0, y=0, w=768, h=768)
        settings = dict(material='iron', scale_mode='auto_hcp_ac', g_max=8.,
                        diffraction=dict(exclude_radius_nm_inv=.8, refine_center=False))
        _, validated = engine.validate(item, roi, settings)
        self.assertEqual(validated['g_min'], .8)
        for supplied in ({'diffraction': {'exclude_radius_nm_inv': 8.}, 'g_max': 8.}, {'g_min': -1}):
            with self.assertRaises(ValueError):
                engine.validate(item, roi, supplied)
        with tempfile.TemporaryDirectory() as directory:
            app = Workbench(folder_paths.DEFAULTS, root=Path(directory))
            app.engine.loaded[info['id']] = item
            saved = app.store_region(dict(file_id=info['id'], source_hash=info['sha256_pixels'],
                                         revision=0, name='Iron with inner spots', tags=[], notes='', roi=roi, settings=settings))
            again = Workbench(folder_paths.DEFAULTS, root=Path(directory))
            again.engine.loaded[info['id']] = item
            stored = again.saved_region(saved['region']['id'])
            self.assertEqual(stored['settings']['material'], 'iron')
            self.assertEqual(stored['settings']['g_min'], .8)
            for key, value in MATERIAL_PRESETS['iron']['references'].items():
                self.assertEqual(stored['settings'][key], value)
            result = engine.analyze(item, roi, settings, images=False, cache_candidates=True)
            reranked = engine.rescore(result, .1, .1)
            self.assertEqual(reranked['settings'], {**result['settings'], 'scale_penalty_strength': .1, 'peak_evidence_weight': .1})
            self.assertEqual(reranked['spectrum']['g_min'], .8)
            json.dumps({k: v for k, v in reranked.items() if not k.startswith('_')}, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
