"""File navigation must remain available during slow interactive fitting."""
from concurrent.futures import ThreadPoolExecutor
import threading
import unittest
from tem_workbench.app.server import Workbench


class InteractiveSwitchTests(unittest.TestCase):
    def test_new_image_can_load_and_analyze_before_old_analysis_finishes(self):
        started = threading.Event()
        release = threading.Event()
        old = {'_diffraction_cache': {'entries': [('old', 'immutable pixels')]}}
        new = {'_diffraction_cache': {'entries': []}}

        class FakeEngine:
            def __init__(self):
                self.loaded = {'old': old}
                self._template_cache = {'initial': []}

            def load(self, file_id):
                item = old if file_id == 'old' else new
                self.loaded.clear()
                self.loaded[file_id] = item
                return item

            def analyze(self, item, roi, settings):
                if roi == 'old':
                    started.set()
                    if not release.wait(5):
                        raise TimeoutError('Old calculation was never released')
                item['_diffraction_cache']['entries'].append((roi, 'cached'))
                self._template_cache[roi] = []
                return roi

        app = Workbench.__new__(Workbench)
        app.lock = threading.RLock()
        app.engine = FakeEngine()
        with ThreadPoolExecutor(2) as pool:
            previous = pool.submit(app.analyze_interactive, {'file_id': 'old', 'roi': 'old'})
            try:
                self.assertTrue(started.wait(2))
                current = pool.submit(app.analyze_interactive, {'file_id': 'new', 'roi': 'new'})
                self.assertEqual(current.result(timeout=2)[1], 'new')
                self.assertFalse(previous.done())
                self.assertEqual(old['_diffraction_cache']['entries'], [('old', 'immutable pixels')])
            finally:
                release.set()
            self.assertEqual(previous.result(timeout=2)[1], 'old')
        self.assertIs(app.engine.loaded['new'], new)
        self.assertEqual(new['_diffraction_cache']['entries'], [('new', 'cached')])
        self.assertEqual(old['_diffraction_cache']['entries'], [('old', 'immutable pixels')])
        self.assertIn('new', app.engine._template_cache)


if __name__ == '__main__':
    unittest.main()
