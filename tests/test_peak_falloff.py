import copy
import json
import math
import threading
import unittest
import zlib
import numpy as np
from unittest.mock import patch

from tem_workbench.analysis import peak_evidence as evidence
from tem_workbench.app.engine import Engine


def model():
    statuses = ['detected', 'weak', 'unsupported', 'unsupported', 'unassessable']
    return dict(phase='HCP', position_score=.8, position_valid=True,
                scale_penalty=.1, scale_mode='fixed',
                predicted_nodes=[{'q': [g, 0]} for g in [3, 5, 4, 8, 12]],
                peak_evidence=dict(nodes=[dict(node_index=i, status=status, **({'quality': .4} if status=='weak' else {})) for i, status in enumerate(statuses)],
                                   bonus_factor=.08, missing_factor=.5))


class FalloffTests(unittest.TestCase):
    def test_cached_displaced_detection_never_pays_a_missing_cost(self):
        m = model()
        # Saved v5 evidence carried an additional distance-dependent deficit.
        m['peak_evidence']['nodes'][0].update(quality=.01,presence_quality=.02)
        evidence.apply(m,0,missing_weight=1.)
        self.assertEqual(m['peak_evidence']['nodes'][0]['missing_fraction'],0.)
        self.assertEqual(m['peak_evidence']['detected_missing_equivalent_count'],0.)
        self.assertAlmostEqual(m['missing_peak_penalty'],.65)

    def test_uniform_mode_and_half_weight(self):
        m = model()
        evidence.apply(m, .5)
        self.assertAlmostEqual(m['score'], .8-.1+.04-.5*2.6/4)
        evidence.apply(m, .5, 8)
        self.assertEqual(m['peak_evidence']['nodes'][3]['missing_weight'], .5)
        self.assertAlmostEqual(m['missing_peak_penalty'], .5*(.6*2**(-(5/8)**2)+2**(-.25)+.5)/4)
        self.assertEqual(m['weak_peak_bonus'], .04)
        self.assertEqual(m['position_score'], .8)
        self.assertEqual(m['scale_penalty'], .1)

    def test_outer_missing_counts_less_and_unassessable_is_excluded(self):
        m = model()
        evidence.apply(m, .5, 8)
        weights = [n['missing_weight'] for n in m['peak_evidence']['nodes']]
        self.assertGreater(weights[2], weights[3])
        self.assertAlmostEqual(m['peak_evidence']['unweighted_missing_factor'], .65)
        # All assessable predictions missing still receive reduced outer costs.
        for n in m['peak_evidence']['nodes'][:-1]:
            n['status'] = 'unsupported'
        evidence.apply(m, .5, 8)
        self.assertLess(m['missing_peak_penalty'], .5)

    def test_reweighting_is_reversible(self):
        m = model()
        evidence.apply(m, .5, 0)
        uniform = m['score']
        evidence.apply(m, .5, 8)
        self.assertGreater(m['score'], uniform)
        evidence.apply(m, .5, 0)
        self.assertEqual(m['score'], uniform)
        evidence.apply(m, 0, 8)
        self.assertAlmostEqual(m['score'], .7)
        self.assertEqual(m['missing_peak_penalty'], 0)

    def test_no_strong_evidence_created(self):
        m = model(); m['position_valid'] = False
        evidence.apply(m, .5, .1)
        self.assertFalse(m['valid'])
        self.assertAlmostEqual(m['weak_peak_bonus'], .04)

    def test_validation_and_legacy_fit(self):
        for value in [-1, 31, math.nan, math.inf]:
            with self.assertRaises(ValueError):
                evidence.apply(model(), .1, value)
        m = model(); del m['peak_evidence']['nodes']
        evidence.apply(m, .5)
        self.assertEqual(m['missing_peak_penalty'], .25)
        with self.assertRaises(ValueError):
            evidence.apply(m, .5, 8)

    def test_cached_rescore_preserves_observations_and_settings(self):
        engine = Engine.__new__(Engine)
        result = dict(settings=dict(scale_mode='fixed', peak_evidence_weight=.5, g_min=2.5, g_max=10),
                      spectrum={'df': .2, 'peaks': [{'profile_id': 0, 'qx': 3, 'qy': 0}]}, width_nm=5, height_nm=5,
                      _fit_cache=zlib.compress(json.dumps([model()]).encode()))
        original = copy.deepcopy(result)
        with patch('tem_workbench.app.engine.core.retain', side_effect=lambda ms: ms), patch.object(engine, 'classify', return_value={}):
            updated = engine.rescore(result, 0, half_weight_nm_inv=8)
            restored = engine.rescore(updated, 0, half_weight_nm_inv=0)
        self.assertEqual(result, original)
        self.assertEqual(updated['settings']['peak_evidence_half_weight_nm_inv'], 8)
        self.assertEqual(updated['spectrum'], original['spectrum'])
        self.assertGreater(updated['models'][0]['score'], restored['models'][0]['score'])

    def test_independent_weights_and_zero_disable_only_their_own_term(self):
        m=model()
        evidence.apply(m,.2,missing_weight=1.2)
        self.assertAlmostEqual(m['weak_peak_bonus'],.016)
        self.assertAlmostEqual(m['missing_peak_penalty'],1.2*.65)
        evidence.apply(m,0,missing_weight=1.2)
        self.assertEqual(m['weak_peak_bonus'],0)
        self.assertAlmostEqual(m['missing_peak_penalty'],1.2*.65)
        evidence.apply(m,.2,missing_weight=0)
        self.assertAlmostEqual(m['weak_peak_bonus'],.016)
        self.assertEqual(m['missing_peak_penalty'],0)
        for value in (-.01,2.01,math.nan,math.inf):
            with self.assertRaises(ValueError):evidence.apply(m,.1,missing_weight=value)

    def test_weak_support_provides_graded_relief_never_full_exemption(self):
        costs=[]
        for quality in (0.,.1,.4,.5):
            m=model();m['peak_evidence']['nodes'][1]['quality']=quality
            evidence.apply(m,0,missing_weight=1)
            costs.append(m['missing_peak_penalty'])
            self.assertAlmostEqual(m['peak_evidence']['nodes'][1]['missing_fraction'],1-quality)
            self.assertEqual(m['peak_evidence']['nodes'][0]['missing_fraction'],0)
            self.assertEqual(m['peak_evidence']['nodes'][-1]['missing_fraction'],0)
        self.assertEqual(costs,sorted(costs,reverse=True))
        self.assertAlmostEqual(costs[0],3/4)
        self.assertAlmostEqual(costs[-1],2.5/4)

    def test_cached_legacy_weight_migrates_once_and_changes_independently(self):
        engine=Engine.__new__(Engine)
        result=dict(settings=dict(scale_mode='fixed',peak_evidence_weight=.3,g_min=2.5,g_max=10),
                    spectrum={'df':.2,'peaks':[{'profile_id':0,'qx':3,'qy':0}]},width_nm=5,height_nm=5,
                    _fit_cache=zlib.compress(json.dumps([model()]).encode()))
        with patch('tem_workbench.app.engine.core.retain',side_effect=lambda ms:ms),patch.object(engine,'classify',return_value={}):
            bonus_only=engine.rescore(result,0,evidence_weight=0)
            stronger=engine.rescore(bonus_only,0,missing_weight=1.5)
            restored=engine.rescore(stronger,0,evidence_weight=.3,missing_weight=.3)
        self.assertEqual(bonus_only['settings']['missing_peak_weight'],.3)
        self.assertEqual(stronger['settings']['peak_evidence_weight'],0)
        self.assertEqual(stronger['models'][0]['weak_peak_bonus'],0)
        self.assertGreater(stronger['models'][0]['missing_peak_penalty'],bonus_only['models'][0]['missing_peak_penalty'])
        self.assertEqual(restored['models'][0]['predicted_nodes'],model()['predicted_nodes'])
        self.assertNotIn('missing_peak_weight',result['settings'])

    def test_request_validation_migrates_legacy_value_and_accepts_extended_range(self):
        engine=Engine.__new__(Engine)
        item=dict(array=np.zeros((32,32)),info={});roi=dict(x=0,y=0,w=32,h=32)
        _,old=engine.validate(item,roi,dict(peak_evidence_weight=.4))
        self.assertEqual(old['missing_peak_weight'],.4)
        _,new=engine.validate(item,roi,dict(peak_evidence_weight=0,missing_peak_weight=2))
        self.assertEqual(new['missing_peak_weight'],2)
        for value in (-.01,2.01,math.nan,math.inf):
            with self.assertRaises(ValueError):engine.validate(item,roi,dict(missing_peak_weight=value))

    def test_grid_rescore_propagates_independent_cost_and_rejects_invalid_before_mutation(self):
        from tem_workbench.app.server import Workbench
        app=Workbench.__new__(Workbench);app.engine=Engine.__new__(Engine);app.job_lock=threading.RLock()
        app.jobs={'example':dict(state='complete',settings=dict(peak_evidence_weight=.3),regions=[{}],grid={})}
        with patch.object(app.engine,'rescore',return_value={}) as rescore,patch.object(app,'status',return_value={}):
            app.rescore('example',0,evidence_weight=0,missing_weight=1.2)
            self.assertEqual(rescore.call_args.args[5],1.2)
            self.assertEqual(app.jobs['example']['settings']['missing_peak_weight'],1.2)
            app.rescore('example',0,evidence_weight=.2)
            self.assertEqual(rescore.call_args.args[5],1.2)
            app.rescore('example',0,brightness_weight=.25)
            self.assertEqual(rescore.call_args.args[6],.25)
            self.assertEqual(app.jobs['example']['settings']['brightness_grouping_weight'],.25)
            original=copy.deepcopy(app.jobs)
            with self.assertRaises(ValueError):app.rescore('example',0,brightness_weight=.51)
            self.assertEqual(app.jobs,original)
            with self.assertRaises(ValueError):app.rescore('example',0,missing_weight=2.1)
            self.assertEqual(app.jobs,original)


if __name__ == '__main__':
    unittest.main()
