"""Cached map weights reuse geometry without changing results or blocking reads."""
import copy
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tem_workbench.analysis import double_diffraction
from tem_workbench.analysis import forbidden_reflections
from tem_workbench.app.engine import Engine
from tem_workbench.app.server import Workbench
from tests.test_parallel_execution import image


def public(result):
    return {key: value for key, value in result.items() if not key.startswith('_')}


class CachedMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine({})
        cls.result = cls.engine.analyze(image(), dict(x=0, y=0, w=256, h=256),
            dict(scale_mode='auto_hcp_ratio', enabled_phases=['HCP', 'BCC', 'FCC', 'OMEGA'],
                 double_diffraction_weight=0), images=False, cache_candidates=True)

    def test_cached_and_cold_weights_match_without_mutating_old_results(self):
        original = copy.deepcopy(self.result)
        result = self.result
        for weights in ((.12, .3, .25, 8., .25, .3, .3),
                        (.2, .1, .1, 8., .4, .15, .6),
                        (.1, .3, .15, 0., .1, 0., 0.),
                        (.12, .3, .25, 8., .25, .3, .3)):
            old = result
            previous = copy.deepcopy(old)
            result = self.engine.rescore(old, *weights)
            cold = self.engine.rescore(self.result, *weights)
            self.assertEqual(public(result), public(cold))
            self.assertEqual(previous['spectrum'], result['spectrum'])
            self.assertEqual(old, previous)
        self.assertEqual(self.result, original)
        self.assertIs(result['spectrum'], self.result['spectrum'])
        self.assertIs(result['_fit_cache'], self.result['_fit_cache'])
        before, _ = self.engine.cached_fit_pool(self.result)
        after, reports = self.engine.cached_fit_pool(result)
        self.assertTrue(reports)
        self.assertEqual(len(before), len(after))
        for a, b in zip(before, after):
            self.assertEqual({k: v for k, v in a.items() if k not in ('double_diffraction', 'forbidden_reflections')},
                             {k: v for k, v in b.items() if k not in ('double_diffraction', 'forbidden_reflections')})

    def test_same_geometry_does_not_repeat_single_fit_diagnostics(self):
        warmed = self.engine.rescore(self.result, .1, dd_weight=.5)
        previous = copy.deepcopy(warmed)
        with patch.object(double_diffraction, 'inspect', side_effect=AssertionError('Repeated DD geometry')), \
             patch.object(forbidden_reflections, 'inspect', side_effect=AssertionError('Repeated absences')):
            again = self.engine.rescore(warmed, .1, dd_weight=.5)
        self.assertEqual(public(warmed), public(again))
        self.assertEqual(warmed, previous)
        self.assertEqual(warmed['_fit_cache'], again['_fit_cache'])
        self.assertEqual(warmed['_fit_diagnostics'], again['_fit_diagnostics'])
        for model in again['models']:
            self.assertNotIn('scoring_factor', model['double_diffraction'])
            self.assertEqual(model['double_diffraction']['observation_kind'], 'image_fft')


def workbench():
    app = Workbench.__new__(Workbench)
    app.job_lock = threading.RLock()
    region = dict(id='cell', roi=dict(x=0, y=0, w=32, h=32), leaf=True, depth=0,
                  elapsed_ms=0, classification=dict(label='unresolved'), models=[],
                  _fit_cache=b'cached', _fit_diagnostics=b'diagnostics')
    app.jobs = {'grid': dict(id='grid', state='complete', cancel=False, settings={},
                            grid={}, regions=[region, dict(region, id='other')])}
    app.engine = SimpleNamespace(rescore=lambda region, *weights: dict(region, weight=weights[0]))
    return app


class MapUpdateConcurrencyTests(unittest.TestCase):
    def test_status_remains_available_and_newer_weights_win(self):
        app = workbench()
        entered, release = threading.Event(), threading.Event()
        calls = []

        def rescore(region, strength, *weights):
            calls.append(strength)
            if strength == .1:
                entered.set()
                if not release.wait(3):
                    raise AssertionError('Test did not release old update')
            return dict(region, weight=strength)

        app.engine.rescore = rescore
        with ThreadPoolExecutor(3) as workers:
            old = workers.submit(app.rescore, 'grid', .1)
            try:
                self.assertTrue(entered.wait(2))
                status = workers.submit(app.status, 'grid', True).result(timeout=1)
                self.assertNotIn('rescore', status)
                self.assertFalse(any(key.startswith('_') for key in status))
                self.assertFalse(any(key.startswith('_') for region in status['regions'] for key in region))
                self.assertTrue(all('weight' not in r for r in status['regions']))
                latest = workers.submit(app.rescore, 'grid', .2).result(timeout=1)
                self.assertEqual(latest['settings']['scale_penalty_strength'], .2)
            finally:
                release.set()
            with self.assertRaisesRegex(ValueError, 'newer map update'):
                old.result(timeout=2)
        self.assertEqual(calls.count(.1), 1, 'Superseded work stops between windows')
        self.assertTrue(all(r['weight'] == .2 for r in app.jobs['grid']['regions']))
        self.assertNotIn('_rescore_token', app.jobs['grid'])

    def test_discarded_job_is_not_restored(self):
        app = workbench()
        def rescore(region, *weights):
            with app.job_lock:
                app.jobs.clear()
            return region
        app.engine.rescore = rescore
        with self.assertRaisesRegex(ValueError, 'no longer in memory'):
            app.rescore('grid', .1)
        self.assertEqual(app.jobs, {})

    def test_region_or_aggregation_failure_keeps_entire_previous_map(self):
        for aggregation_failure in (False, True):
            app = workbench()
            app.jobs['grid'].update(grid=dict(mode='overlap'), aggregation=dict(previous=True))
            previous = copy.deepcopy(app.jobs)
            if not aggregation_failure:
                app.engine.rescore = Mock(side_effect=ValueError('region failed'))
            with patch('tem_workbench.app.server.overlap_maps.aggregate', side_effect=ValueError('aggregate failed')):
                with self.assertRaisesRegex(ValueError, 'failed'):
                    app.rescore('grid', .1)
            self.assertEqual(app.jobs, previous)


if __name__ == '__main__':
    unittest.main()
