"""Auto strength searches past the first passing fit without recalculating FFTs."""
import unittest
from unittest.mock import patch
import numpy as np
import analysis_core as core
import demo_data
from engine import Engine


class AutoStrengthChecks(unittest.TestCase):
    def setUp(self):
        n = 256
        yy, xx = np.indices((n, n))
        frequencies = [(25, 5), (29, 5), (38, 21), (42, 39), (6, 42), (15, 60), (47, 30), (57, 19)]
        image = sum((i+1)*np.cos(2*np.pi*(x*xx+y*yy)/n)
                    for i, (x, y) in enumerate(frequencies)).astype(np.float32)
        self.engine = Engine({})
        self.item = dict(array=image, info=dict(image_kind='real_space', pixel_x_nm=.03, pixel_y_nm=.03), limits=[-40,40])
        self.roi = dict(x=0,y=0,w=n,h=n)

    def controlled_search(self, score, passing=True):
        def fit(s, *_):
            n=len(s['peaks'])
            models=[dict(score=score(n),valid=passing)] if n >= 4 else []
            return models, models
        with patch.object(self.engine, '_fit_spectrum', side_effect=fit), \
             patch.object(self.engine, 'classify', return_value={'label':'unresolved','flags':[]}), \
             patch.object(core, 'purity', return_value={}), \
             patch.object(core, 'spectrum', wraps=core.spectrum) as fft:
            result=self.engine.analyze(self.item,self.roi,dict(fft_auto_strength=True),images=False)
        self.assertEqual(fft.call_count,1)
        return result

    def test_search_continues_after_pass_and_selects_interior_maximum(self):
        result=self.controlled_search(lambda n: .8-.05*abs(n-5))
        report=result['spectrum']['auto_peak_strength']
        self.assertGreater(report['tested_sets'],2)
        self.assertEqual(len(result['spectrum']['peaks']),5)
        self.assertTrue(all(t['passing'] for t in report['trials']))
        self.assertEqual(result['models'][0]['score'],max(t['rank'] for t in report['trials']))

    def test_no_pass_stays_rejected_and_ties_keep_more_profiles(self):
        result=self.controlled_search(lambda n:.18,passing=False)
        self.assertEqual(result['spectrum']['auto_peak_strength']['selection'],'below_threshold')
        self.assertFalse(result['models'][0]['valid'])
        self.assertEqual(len(result['spectrum']['peaks']),max(t['profiles'] for t in result['spectrum']['auto_peak_strength']['trials']))

    @unittest.skipUnless(demo_data.ID in demo_data.DEMOS, 'Install the optional demo pack for this integration test')
    def test_real_fits_reproduce_selected_manual_cutoff_and_cached_reweight(self):
        item=self.engine.load('demo/st1221')
        roi=dict(x=2662,y=3891,w=205,h=205)
        settings=dict(fft_auto_strength=True,scale_mode='auto_hcp_ac',enabled_phases=['HCP','BCC'])
        auto=self.engine.analyze(item,roi,settings,images=True,cache_candidates=True)
        manual=self.engine.analyze(item,roi,{**settings,'fft_auto_strength':False,
            'fft_minimum_enrichment':auto['spectrum']['minimum_peak_enrichment']},images=True)
        self.assertEqual(auto['images'],manual['images'])
        self.assertEqual(auto['models'],manual['models'])
        self.assertEqual(auto['spectrum']['peaks'],manual['spectrum']['peaks'])
        accepted=[t['rank'] for t in auto['spectrum']['auto_peak_strength']['trials'] if t['passing']]
        if accepted:
            self.assertEqual(max(m['score'] for m in auto['models'] if m['valid']),max(accepted))
        rescored=self.engine.rescore(auto,.2)
        self.assertEqual(rescored['spectrum']['peaks'],auto['spectrum']['peaks'])
        self.assertTrue(rescored['settings']['fft_auto_strength'])

    def test_auto_validation_and_disabled_phase_search(self):
        with self.assertRaises(ValueError):
            self.engine.validate(self.item,self.roi,dict(fft_auto_strength='true'))
        result=self.engine.analyze(self.item,self.roi,dict(fft_auto_strength=True,enabled_phases=[]),images=False)
        self.assertEqual(result['spectrum']['auto_peak_strength']['status'],'skipped')
        self.assertEqual(result['spectrum']['minimum_peak_enrichment'],3.)


if __name__=='__main__':unittest.main()
