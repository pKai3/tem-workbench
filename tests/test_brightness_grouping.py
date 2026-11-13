import copy
import math
import unittest

import numpy as np

from tem_workbench.analysis import analysis_core as core
from tem_workbench.analysis import brightness_grouping as brightness
from tem_workbench.analysis import diffraction_fitting as fitting


def fixture(levels=(800., 100.), names=('BCC', 'OMEGA'), shared=False):
    peaks, nodes = [], []
    for group, level in enumerate(levels):
        for j in range(6):
            angle = .12 + j*.48 + group*.09
            radius = 3. + (j % 3)*1.3 + group*.2
            q = [radius*math.cos(angle), radius*math.sin(angle)]
            pid = len(peaks)+1
            peaks.append(dict(profile_id=pid, qx=q[0], qy=q[1], g_nm_inv=radius,
                              weight=3., intensity_reliable=True,
                              integrated_intensity=level*(1 + .04*(j-2.5))))
            phases = list(names) if shared and group == 0 else [names[group]]
            nodes.append(dict(q=q, hkl=[pid, 0, 0], phases=phases))
    model = core.score_prediction_nodes(peaks, nodes, .05)
    model.update(phase='+'.join(names), position_valid=model['valid'], position_score=model['score'])
    return peaks, model


def inspect(peaks, model):
    brightness.inspect(model, peaks)
    return model['brightness_grouping']


class BrightnessGroupingTests(unittest.TestCase):
    def test_poor_positional_matches_cannot_gain_full_brightness_bonus(self):
        peaks, model = fixture()
        factors = []
        for quality in (1., .5, .05):
            for match in model['matches']:
                match['quality'] = quality
            factors.append(inspect(peaks, model)['factor'])
            self.assertLessEqual(factors[-1],quality)
        self.assertGreater(factors[0],factors[1])
        self.assertGreater(factors[1],factors[2])

    def test_separated_populations_gain_a_bounded_phase_neutral_bonus(self):
        peaks, model = fixture()
        report = inspect(peaks, model)
        self.assertEqual(report['status'], 'supported')
        self.assertGreater(report['factor'], .2)
        self.assertLessEqual(report['factor'], 1.)
        for names in (('FCC', 'HCP'), ('OMEGA', 'BCC')):
            other_peaks, other_model = fixture(names=names)
            self.assertAlmostEqual(inspect(other_peaks, other_model)['factor'], report['factor'], places=6)
        original = model['score']
        brightness.apply(model, .1)
        self.assertAlmostEqual(model['score'], original+.1*report['factor'])
        brightness.apply(model, .3)
        self.assertAlmostEqual(model['score'], original+.3*report['factor'])
        brightness.apply(model, 0.)
        self.assertAlmostEqual(model['score'], original)

    def test_single_phase_and_equal_brightness_do_not_gain(self):
        peaks, model = fixture(levels=(100., 100.))
        self.assertEqual(inspect(peaks, model)['factor'], 0.)
        for node in model['predicted_nodes']:
            node['phases'] = ['BCC']
        for p in peaks[:6]:
            p['integrated_intensity'] *= 8
        self.assertEqual(inspect(peaks, model)['status'], 'single_phase')
        self.assertEqual(model['brightness_grouping']['factor'], 0.)

    def test_gain_is_invariant_to_image_gain_and_coordinate_scale(self):
        peaks, model = fixture()
        before = inspect(peaks, model)['factor']
        for p in peaks:
            p['integrated_intensity'] *= 730.
            p['qx'] *= .013
            p['qy'] *= .013
        self.assertAlmostEqual(inspect(peaks, model)['factor'], before, places=6)

    def test_radial_brightness_trend_is_not_a_second_phase(self):
        peaks, model = fixture()
        for p in peaks:
            p['integrated_intensity'] = 1000*p['g_nm_inv']**-2
        self.assertEqual(inspect(peaks, model)['factor'], 0.)

    def test_shared_measurements_count_once_and_variants_share_one_level(self):
        peaks, model = fixture(shared=True)
        for node in model['predicted_nodes']:
            owners = ([0, 1, 2] if len(node['phases']) > 1 else [1, 2])
            node.pop('phases')
            node['components'] = [dict(component=c, hkl=[1, 0, 0]) for c in owners]
        model['related_pattern'] = True
        report = inspect(peaks, model)
        self.assertEqual(report['status'], 'supported')
        self.assertEqual(len(report['groups']), 2)
        self.assertEqual(len(report['reliable_profile_ids']), 12)
        self.assertEqual(report['shared_profile_ids'], list(range(1, 7)))
        for node in model['predicted_nodes']:
            node['components'] = [dict(component=0), dict(component=1)]
        self.assertEqual(inspect(peaks, model)['status'], 'insufficient_group_support')

    def test_one_bright_outlier_or_parallel_group_cannot_establish_a_phase(self):
        peaks, model = fixture()
        for node in model['predicted_nodes'][1:]:
            node['phases'] = ['OMEGA']
        self.assertEqual(inspect(peaks, model)['status'], 'insufficient_group_support')
        peaks, model = fixture()
        for p in peaks[:6]:
            p['qy'] = 0.
        self.assertEqual(inspect(peaks, model)['status'], 'insufficient_group_support')

    def test_unreliable_clipped_and_nonpositive_measurements_are_excluded(self):
        peaks, model = fixture()
        peaks[0]['intensity_reliable'] = False
        peaks[1]['integrated_intensity'] = -1
        peaks[2]['integrated_intensity'] = float('nan')
        peaks[3]['spot_measurements'] = [dict(reliable=True, flags=['at_image_maximum'])]
        report = inspect(peaks, model)
        self.assertEqual(report['available_profiles'], 8)
        self.assertTrue(set(report['reliable_profile_ids']).isdisjoint({1, 2, 3, 4}))
        for p in peaks:
            p.pop('integrated_intensity', None)
        self.assertEqual(inspect(peaks, model)['status'], 'insufficient_intensity')

    def test_unmatched_profiles_reduce_bonus_and_are_never_assigned_by_intensity(self):
        peaks, model = fixture()
        factor = inspect(peaks, model)['factor']
        extra = [{**p, 'profile_id': p['profile_id']+12} for p in peaks]
        report = inspect(peaks+extra, model)
        self.assertAlmostEqual(report['factor'], factor/2)
        self.assertEqual(len(report['reliable_profile_ids']), 12)

    def test_brightness_cannot_rescue_failed_geometry_or_penalties(self):
        peaks, model = fixture()
        inspect(peaks, model)
        model['position_valid'] = False
        brightness.apply(model, .5)
        self.assertFalse(model['valid'])
        model.update(position_valid=True, score=.19, brightness_bonus=0.)
        brightness.apply(model, .5)
        self.assertGreater(model['score'], .2)
        self.assertFalse(model['valid'])
        for weight in (-.01, .51, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                brightness.validate_weight(weight)

    def test_ordinary_phase_pair_uses_common_scoring_and_zero_preserves_geometry(self):
        peaks, full = fixture(names=('FCC', 'HCP'))
        context = dict(radius=.05, maxima=[], g_min=1., g_max=9., x_limit=10., y_limit=10.,
                       visible=lambda q: np.ones(len(q), dtype=bool))
        settings = dict(peak_evidence_weight=0., missing_peak_weight=1.,
                        peak_evidence_half_weight_nm_inv=0., brightness_grouping_weight=.1)
        models = []
        for phase in ('FCC', 'HCP'):
            nodes = [n for n in full['predicted_nodes'] if n['phases'] == [phase]]
            model = dict(phase=phase, zone_3index=[0, 0, 1], predicted_nodes=nodes)
            models.append(fitting.evidence(model, peaks, context, settings))
        before = copy.deepcopy(models)
        baseline = core.classify(peaks, models, .02)
        spectrum = dict(peaks=peaks, df=.02, peak_width_nm_inv=.05)
        result = fitting.compare(baseline, None, spectrum, context, settings, models)
        self.assertTrue(result['combined_fit_selected'])
        combined = result['combined_fit']
        self.assertGreater(combined['brightness_bonus'], 0.)
        self.assertEqual(combined['matched_profile_count'], 12)
        self.assertAlmostEqual(combined['score'], combined['position_score']-.025+combined['brightness_bonus'])
        self.assertEqual(models, before, 'Combining phases must not modify individual candidates')
        off=fitting.compare(baseline, None, spectrum, context,
                            {**settings, 'brightness_grouping_weight': 0}, models)
        self.assertEqual(off['combined_fit']['brightness_bonus'],0.)
        self.assertTrue(off['combined_fit_selected'],'Independent geometry can support a pair with brightness off')
        self.assertEqual(off['combined_fit']['matches'],combined['matches'])

    def test_supported_pair_can_challenge_dense_leader_but_discloses_near_tie(self):
        peaks, full = fixture(names=('FCC', 'HCP'))
        context = dict(radius=.05, maxima=[], g_min=1., g_max=9., x_limit=10., y_limit=10.,
                       visible=lambda q: np.ones(len(q), dtype=bool))
        settings = dict(peak_evidence_weight=0., missing_peak_weight=.3,
                        peak_evidence_half_weight_nm_inv=0., brightness_grouping_weight=.1)
        models = [fitting.evidence(dict(phase=phase, zone_3index=[0, 0, 1],
                  predicted_nodes=[n for n in full['predicted_nodes'] if n['phases'] == [phase]]),
                  peaks, context, settings) for phase in ('FCC', 'HCP')]
        dense_nodes = [dict(q=n['q'], hkl=n['hkl']) for n in full['predicted_nodes']]
        dense_nodes += [dict(q=[7., 1.], hkl=[0, 1, 0]), dict(q=[8., 1.], hkl=[0, 2, 0])]
        dense = fitting.evidence(dict(phase='ORT', zone_3index=[0, 0, 1], predicted_nodes=dense_nodes),
                                 peaks, context, settings)
        models.insert(0, dense)
        baseline = core.classify(peaks, models, .02)
        self.assertIs(baseline['primary_model'], dense)
        self.assertIsNone(baseline['secondary_model'])
        spectrum = dict(peaks=peaks, df=.02, peak_width_nm_inv=.05)
        result = fitting.compare(baseline, None, spectrum, context, settings, models)
        self.assertTrue(result['combined_fit_selected'])
        self.assertGreater(result['combined_fit']['score'], dense['score'])
        self.assertEqual(result['label'], 'ambiguous')
        self.assertIs(result['comparison_model'], dense)
        self.assertEqual(result['ambiguity_reason'], 'brightness_group_tradeoff')
        self.assertIs(fitting.compare(baseline, None, spectrum, context,
                      {**settings, 'brightness_grouping_weight': 0}, models)['primary_model'], dense)


if __name__ == '__main__':
    unittest.main()
