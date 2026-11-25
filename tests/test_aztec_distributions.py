"""Distribution curves describe processed pixels, independently of rendering."""
import unittest

import numpy as np

from tem_workbench.aztec.map_distributions import map_distributions
from tem_workbench.aztec.processing import signal_view
from tem_workbench.aztec.views import acquisition_views
from tests.test_aztec_comparison import Reader


def item(values, acquisition='a', mask=None):
    values = np.asarray(values, float)
    return dict(values=values, mask=np.ones(values.shape, bool) if mask is None else np.asarray(mask, bool), acquisition=acquisition,
                distribution_key=('V', 'Ti', 'Signal ratio'),
                distribution_label='V / Ti', distribution_unit='Relative to median')


class DistributionTests(unittest.TestCase):
    def test_exceedance_uses_strict_pixel_counts_independent_of_bins(self):
        images = [item([0, 1, 1, 2, np.nan, np.inf]), item([2]*20, 'b'), item([np.nan], 'empty')]
        group = map_distributions(images, bins=2, exceedance=True)[0]
        x = group['exceedance_thresholds']; a, b, empty = group['series']
        self.assertEqual((x[0], x[256], x[-1]), (0, 1, 2))
        self.assertEqual([a['exceedance_percent'][i] for i in [0, 256, 512]], [75, 25, 0])
        self.assertEqual(b['exceedance_percent'][:-1], [100]*512)
        self.assertEqual(b['exceedance_percent'][-1], 0)
        self.assertTrue(np.all(np.diff(a['exceedance_percent']) <= 0))
        self.assertEqual(empty['exceedance_percent'], [0]*513)
        other = map_distributions(images, bins=80, exceedance=True)[0]
        self.assertEqual(a['exceedance_percent'], other['series'][0]['exceedance_percent'])
        zero = map_distributions([item([0,0])], exceedance=True)[0]
        self.assertEqual(zero['series'][0]['exceedance_percent'], [0]*513)
        self.assertGreater(zero['exceedance_thresholds'][-1], zero['exceedance_thresholds'][0])

    def test_mask_excludes_edge_extremes_from_bins_and_all_statistics(self):
        group = map_distributions([item([-100, 1, 2, 3, 100, np.nan],
                                       mask=[False, True, True, True, False, True])], bins=2, percentile=10)[0]
        stats = group['series'][0]
        self.assertEqual(group['pixel_scope'], 'normalization_interior')
        self.assertEqual(group['edges'], [1, 2, 3])
        self.assertEqual(stats['counts'], [1, 2])
        self.assertEqual((stats['pixels'], stats['excluded']), (3, 3))
        self.assertEqual((stats['minimum'], stats['maximum'], stats['mean'], stats['median']), (1, 3, 2, 2))
        np.testing.assert_allclose([stats['percentile_low'], stats['percentile_high'], stats['p99']], [1.2, 2.8, 2.98])
        empty = map_distributions([item([1, 2], mask=[False, False])])[0]['series'][0]
        self.assertEqual((empty['pixels'], empty['excluded'], sum(empty['counts'])), (0, 2, 0))
        self.assertNotIn('median', empty)
        self.assertIn('No valid pixels', empty['reason'])

    def test_shared_bins_count_every_finite_pixel_including_both_endpoints(self):
        group = map_distributions([item([0, 1, 2, np.nan]), item([1, 1, 3, np.inf], 'b')], bins=3)[0]
        self.assertEqual(group['edges'], [0, 1, 2, 3])
        a, b = group['series']
        self.assertEqual(a['counts'], [1, 1, 1])
        self.assertEqual(b['counts'], [0, 2, 1])
        self.assertEqual((a['pixels'], a['excluded'], b['excluded']), (3, 1, 1))
        self.assertEqual((a['minimum'], a['maximum'], b['maximum']), (0, 2, 3))
        self.assertAlmostEqual(a['p99'], 1.98)
        self.assertEqual(group['percentiles'], [10, 90])
        self.assertAlmostEqual(a['percentile_low'], .2)
        self.assertAlmostEqual(a['percentile_high'], 1.8)
        self.assertEqual(a['mean'], 1)

    def test_complementary_percentiles_use_exact_pixels_not_bin_centres(self):
        values = np.array([0, 1, 2, 3, 100, np.nan])
        for percentile in (0, .1, 20, 49.9):
            group = map_distributions([item(values)], bins=2, percentile=percentile)[0]
            stats = group['series'][0]
            self.assertEqual(group['percentiles'], [percentile, 100-percentile])
            np.testing.assert_allclose([stats['percentile_low'], stats['percentile_high']],
                                       np.percentile(values[:-1], [percentile, 100-percentile]))
            self.assertEqual(stats['median'], 2)
            self.assertEqual(stats['mean'], 21.2)
            self.assertEqual(stats['maximum'], 100)
        for percentile in (-1, 50, 100, np.nan, np.inf):
            with self.subTest(percentile=percentile), self.assertRaises(ValueError):
                map_distributions([item(values)], percentile=percentile)

    def test_different_map_sizes_have_matching_proportions(self):
        group = map_distributions([item([1, 2, 3]), item(np.tile([1, 2, 3], 100), 'b')])[0]
        a, b = group['series']
        np.testing.assert_array_equal(np.array(a['counts'])/a['pixels'], np.array(b['counts'])/b['pixels'])

    def test_constant_and_empty_maps_have_finite_bins_and_explicit_missing_values(self):
        for value in (0, -1, 100):
            group = map_distributions([item([value]*10), item([np.nan], 'b')])[0]
            self.assertTrue(np.all(np.diff(group['edges']) > 0))
            self.assertEqual(sum(group['series'][0]['counts']), 10)
            self.assertEqual(group['series'][0]['maximum'], value)
            self.assertEqual(group['series'][1]['pixels'], 0)
            self.assertIn('reason', group['series'][1])
        self.assertEqual(sum(map_distributions([item([np.nan])])[0]['series'][0]['counts']), 0)

    def test_current_smoothing_ratio_and_normalization_are_used_before_clipping(self):
        reader = Reader()
        ramp = np.tile(np.linspace(.2, 4, 32), (32, 1))
        for path in reader.arrays:
            reader.arrays[path] *= ramp if path.endswith('-V') else 1 + ramp/10
        options = dict(acquisitions=['a', 'b'], signals=['Ti', 'V'], mode='both', denominator='Ti',
                       comparison=True, smoothing=2, normalisation='median', low=.9, high=1.1,
                       scale_scope='all', map_distributions=True)
        result = acquisition_views(reader, options)
        self.assertEqual(len(result['distributions']), 3, 'Signals and ratios must remain separate')
        group = next(g for g in result['distributions'] if g['label'] == 'V / Ti')
        processed = signal_view(reader.arrays['/XrayMapImages/a-V'], reader.arrays['/XrayMapImages/a-Ti'],
                                sigma=2, normalisation='median')
        expected = processed['values'][processed['mask']]
        series = group['series'][0]
        self.assertEqual(series['pixels'], 20*20, 'Use normalization’s 3σ interior')
        self.assertEqual(series['excluded'], 32*32-20*20)
        self.assertAlmostEqual(series['median'], 1)
        self.assertEqual(series['maximum'], expected.max())
        self.assertGreater(series['maximum'], options['high'], 'Colour clipping must not truncate the distribution')
        counts, _ = np.histogram(expected, group['edges'])
        self.assertEqual(series['counts'], counts.tolist())
        np.testing.assert_allclose([series['mean'], series['median'], series['percentile_low'], series['percentile_high']],
                                   [expected.mean(), *np.percentile(expected, [50, 10, 90])])
        alternate_tails = acquisition_views(reader, {**options, 'distribution_percentile': 20})
        self.assertEqual(result['rows'], alternate_tails['rows'])
        for before, after in zip(result['distributions'], alternate_tails['distributions']):
            self.assertEqual(before['edges'], after['edges'])
            self.assertEqual(after['percentiles'], [20, 80])
            self.assertEqual([s['counts'] for s in before['series']], [s['counts'] for s in after['series']])
        for scope in ('all', 'element', 'off'):
            alternate = acquisition_views(reader, {**options, 'scale_scope': scope, 'map_palette': 'black', 'low': .1, 'high': 2})
            self.assertEqual(result['distributions'], alternate['distributions'])
        raw = acquisition_views(reader, {**options, 'normalisation': 'none', 'smoothing': 0})
        raw_group = next(g for g in raw['distributions'] if g['label'] == 'V / Ti')
        self.assertEqual(raw_group['unit'], 'Signal ratio')
        self.assertNotEqual(group['series'][0]['maximum'], raw_group['series'][0]['maximum'])
        hidden = acquisition_views(reader, {**options, 'map_distributions': False})
        self.assertIsNone(hidden['distributions'])
        self.assertEqual(hidden['rows'], result['rows'], 'Turning curves on must not change maps or statistics')

    def test_normalization_baselines_and_interior_counts_match_in_both_views(self):
        reader = Reader()
        ramp = np.arange(32*32, dtype=float).reshape(32, 32)/100 + 1
        for path in reader.arrays:
            reader.arrays[path] *= ramp if path.endswith('-V') else 1 + ramp/10
        # An invalid ratio region checks that the histogram reuses validity as
        # well as the border, including when smoothing is off.
        reader.arrays['/XrayMapImages/a-Ti'][10:22, 10:22] = 0
        for comparison in (False, True):
            for smoothing, unit in ((0, 'px'), (2, 'px'), (4, 'nm')):
                if not comparison and unit == 'nm':
                    continue
                sigma = smoothing/2 if unit == 'nm' else smoothing
                for normalization, statistic, percentile in [('median', 'median', 1), ('mean', 'mean', 1),
                                                              ('p20', 'percentile_low', 20), ('none', None, 1)]:
                    with self.subTest(comparison=comparison, smoothing=smoothing, unit=unit, normalization=normalization):
                        result = acquisition_views(reader, dict(acquisitions=['a', 'b'], signals=['V'], mode='ratio',
                                                   denominator='Ti', comparison=comparison, smoothing=smoothing,
                                                   smoothing_unit=unit, normalisation=normalization, map_distributions=True,
                                                   distribution_percentile=percentile))
                        group = result['distributions'][0]
                        for series in group['series']:
                            acquisition = series['acquisition']
                            processed = signal_view(reader.arrays[f'/XrayMapImages/{acquisition}-V'],
                                                    reader.arrays[f'/XrayMapImages/{acquisition}-Ti'],
                                                    sigma=sigma, normalisation=normalization)
                            expected = processed['values'][processed['mask']]
                            self.assertEqual(series['pixels'], expected.size)
                            self.assertEqual(sum(series['counts']), expected.size)
                            self.assertEqual(series['counts'], np.histogram(expected, group['edges'])[0].tolist())
                            np.testing.assert_allclose([series['minimum'], series['maximum'], series['mean'], series['median'],
                                                        series['percentile_low'], series['percentile_high']],
                                                       [expected.min(), expected.max(), expected.mean(),
                                                        *np.percentile(expected, [50, percentile, 100-percentile])])
                            if statistic:
                                self.assertAlmostEqual(series[statistic], 1)
