import copy
import json
import zlib
from pathlib import Path
import unittest
from unittest.mock import patch
import numpy as np
from tem_workbench.analysis import double_diffraction as dd
from tem_workbench.analysis import beta_omega
from tests.test_forbidden_reflections import model, peak


def example(phase='OMEGA', factor=1., angle=.47):
    indices = [[1,0,1],[1,0,-1],[0,0,1],[2,0,1]] if phase=='OMEGA' else [[1,0,0],[-1,0,1],[0,0,2],[1,0,1]]
    target = [2,0,0] if phase=='OMEGA' else [0,0,1]
    m,r,axes = model(phase,[0,1,0],indices,angle=angle)
    peaks=[]
    for i,h in enumerate(indices[:2]+[target]):
        p=peak(h,phase,r,axes);p['profile_id']=i+1
        p.update(qx=p['qx']*factor,qy=p['qy']*factor,observed_spots=(np.array(p['observed_spots'])*factor).tolist())
        peaks.append(p)
    for n in m['predicted_nodes']:n['q']=(np.array(n['q'])*factor).tolist()
    m['matches']=[dict(profile_id=i+1,hkl=n['hkl'],predicted_q=n['q']) for i,n in enumerate(m['predicted_nodes'][:2])]
    return m,peaks


class DoubleDiffractionTests(unittest.TestCase):
    def test_basis_absences_have_observed_allowed_paths(self):
        for phase in ['HCP','OMEGA']:
            m,p=example(phase)
            report=dd.inspect(m,p,.1,.1,20)
            self.assertEqual(report['profile_ids'],[3])
            self.assertEqual(report['remaining_profile_ids'],[])
            self.assertEqual(report['coverage_with_candidates'],1)
            path=report['hits'][0]['paths'][0]
            self.assertEqual({s['profile_id'] for s in path['steps']},{1,2})
            self.assertLess(path['measured_residual_relative'],1e-12)
            self.assertEqual(path['kind'],'same_crystal')
            json.dumps(report,allow_nan=False)

    def test_rotation_scale_order_and_signed_observations(self):
        for scale,angle in [(.07,-1.2),(37.,2.5)]:
            m,p=example(factor=scale,angle=angle);p.reverse()
            report=dd.inspect(m,p,.1*scale,.1*scale,20*scale)
            self.assertEqual(report['profile_ids'],[3])
            self.assertEqual(len(report['hits']),1,'No invented direct conjugate')
            # Reverse only a source beam: its unobserved opposite cannot seed a path.
            source=next(x for x in p if x['profile_id']==2)
            source['observed_spots']=(-np.array(source['observed_spots'])).tolist()
            self.assertEqual(dd.inspect(m,p,.1*scale,.1*scale,20*scale)['profile_ids'],[])

    def test_fft_conjugates_count_once(self):
        m,p=example()
        for v in p:v.pop('observed_spots')
        report=dd.inspect(m,p,.1,.1,20)
        self.assertEqual(report['profile_count'],1)
        self.assertEqual(len(report['hits']),2)
        self.assertEqual(report['profiles'][0]['supported_spot_count'],2)
        target=np.array([p[2]['qx'],p[2]['qy']])
        p[2]['observed_spots']=[(target+[.03,0]).tolist(),(-target+[.09,0]).tolist()]
        report=dd.inspect(m,p,.1,.1,20)
        self.assertAlmostEqual(report['rms_relative'],np.sqrt((.03**2+.09**2)/2)/report['normalization'])

    def test_repeated_scattering_vector_and_legacy_fit(self):
        m,p=example()
        p[2].update(qx=2*p[0]['qx'],qy=2*p[0]['qy'],observed_spots=(2*np.array(p[0]['observed_spots'])).tolist())
        report=dd.inspect(m,p,.1,.1,20)
        self.assertEqual(report['profile_ids'],[3])
        self.assertTrue(any([s['profile_id'] for s in path['steps']]==[1,1] for path in report['hits'][0]['paths']))
        self.assertEqual(dd.inspect({},p,.1,.1,20)['status'],'unavailable')
        m['zone_3index']=[0,0,1]
        self.assertEqual(dd.inspect(m,p,.1,.1,20)['status'],'unavailable')

    def test_unknown_and_unmatched_peaks_cannot_seed_paths(self):
        m,p=example();m['matches']=m['matches'][:1]
        self.assertEqual(dd.inspect(m,p,.1,.1,20)['profile_ids'],[])
        m,p=example();p[-1].update(qx=7.17,qy=1.31,observed_spots=[[7.17,1.31]])
        self.assertEqual(dd.inspect(m,p,.1,.1,20)['profile_ids'],[])

    def test_measured_and_predicted_sums_both_required(self):
        m,p=example()
        # Each source remains inside tolerance, but their measured sum misses.
        for source in p[:2]:source['observed_spots'][0][0]+=.08
        self.assertEqual(dd.inspect(m,p,.1,.1,20)['profile_ids'],[])

    def test_centering_extinctions_cannot_be_generated_in_one_crystal(self):
        for phase,indices,target in [('BCC',[[1,1,0],[1,-1,0],[2,0,0]],[1,0,0]),
                                     ('FCC',[[2,0,0],[0,2,0],[2,2,0]],[1,1,0]),
                                     ('ORT',[[1,0,0],[0,1,0],[1,1,0]],[2,1,0])]:
            m,r,axes=model(phase,[0,0,1],indices)
            p=[]
            for i,h in enumerate(indices+[target]):
                v=peak(h,phase,r,axes);v['profile_id']=i+1;p.append(v)
            m['matches']=[dict(profile_id=i+1,hkl=n['hkl'],predicted_q=n['q']) for i,n in enumerate(m['predicted_nodes'])]
            report=dd.inspect(m,p,.1,.1,20)
            self.assertEqual(report['status'],'checked')
            self.assertEqual(report['profile_ids'],[])

    def test_no_cross_talk_between_independent_candidates_or_score_change(self):
        m,p=example();n=copy.deepcopy(m)
        m['matches']=m['matches'][:1];n['matches']=n['matches'][1:]
        before=copy.deepcopy([m,n])
        dd.annotate([m,n],dict(kind='diffraction',peaks=p),.1,.1,20)
        self.assertTrue(all(x['double_diffraction']['profile_count']==0 for x in [m,n]))
        for x in [m,n]:x.pop('double_diffraction')
        self.assertEqual([m,n],before)

    def test_closed_index_sets_defer_only_single_fit_reports(self):
        for phase, indices in [('BCC', [[1,1,0], [1,-1,0], [2,0,0]]),
                               ('FCC', [[2,0,0], [0,2,0], [2,2,0]]),
                               ('ORT', [[1,0,0], [0,1,0], [1,1,0]])]:
            m, r, axes = model(phase, [0,0,1], indices)
            peaks = [dict(peak(h, phase, r, axes), profile_id=i) for i, h in enumerate(indices)]
            m.update(score=.4, position_score=.4, position_valid=True, valid=True,
                matches=[dict(profile_id=i, hkl=n['hkl'], predicted_q=n['q']) for i, n in enumerate(m['predicted_nodes'])])
            expected = dd.evaluate(copy.deepcopy(m), peaks, .1, .1, 20, .5)
            with patch.object(dd, 'inspect', side_effect=AssertionError('No DD score is possible')):
                fast = dd.evaluate(copy.deepcopy(m), peaks, .1, .1, 20, .5, defer_report=True)
            spectrum = dict(peaks=peaks)
            dd.annotate([fast, expected], spectrum, .1, .1, 20, reuse_report=True)
            self.assertEqual(fast, expected)
            # Two crystals can produce cross-component paths even when both
            # individual structures have closed allowed-index sets.
            with patch.object(dd, 'inspect_union', return_value={}) as inspect:
                dd.evaluate(copy.deepcopy(m), peaks, .1, .1, 20, .5,
                            components=[m, m], owners=[], defer_report=True)
                inspect.assert_called_once()

    def test_weighted_bonus_is_bounded_idempotent_and_preserves_assignments(self):
        m, peaks = example()
        m.update(score=.4, position_score=.4, position_valid=True, valid=True,
                 matched_profile_count=2, coverage=2/3)
        before = copy.deepcopy(m['matches'])
        for weight in (.6, .3, 0., 1.):
            dd.evaluate(m, peaks, .1, .1, 20, weight)
            self.assertAlmostEqual(m['score'], .4+weight/3)
            self.assertEqual(m['matches'], before)
            self.assertEqual(m['matched_profile_count'], 2)
            self.assertEqual(m['coverage'], 2/3)
        m['position_valid'] = False
        dd.apply(m, 1.)
        self.assertFalse(m['valid'], 'DD cannot supply the single-scattering screen')
        m.update(position_valid=True, score=.19+m['double_diffraction_bonus'], brightness_bonus=0.)
        dd.apply(m, 1.)
        self.assertFalse(m['valid'], 'DD cannot rescue a failed adjusted base rank')
        for weight in (-.01, 1.01, float('nan'), float('inf')):
            with self.assertRaises(ValueError): dd.validate_weight(weight)

    def test_bonus_counts_shared_targets_and_partial_observations_once(self):
        m, peaks = example()
        report = dd.inspect(m, peaks, .1, .1, 20)
        self.assertAlmostEqual(dd.scoring_factor(report, peaks), 1/3)
        report['profiles'] *= 2
        self.assertAlmostEqual(dd.scoring_factor(report, peaks), 1/3)
        peaks[-1]['observed_spots'].append([-v for v in peaks[-1]['observed_spots'][0]])
        self.assertAlmostEqual(dd.scoring_factor(report, peaks), 1/6)
        report['allowed_profile_ids'].append(3)
        self.assertEqual(dd.scoring_factor(report, peaks), 0.)

    def test_cached_candidate_weight_and_other_terms_are_independent(self):
        from tem_workbench.app.engine import Engine
        m, peaks = example()
        m.update(score=.4, position_score=.4, position_valid=True, valid=True,
                 scale_mode='fixed', scale_penalty=0., peak_evidence={})
        settings=dict(scale_mode='fixed', g_min=.1, g_max=20, enabled_phases=['OMEGA'],
                      peak_evidence_weight=0., missing_peak_weight=0., double_diffraction_weight=.6)
        result=dict(settings=settings, spectrum=dict(peaks=peaks, df=.01, peak_width_nm_inv=.1),
                    _fit_cache=zlib.compress(json.dumps([m]).encode()))
        engine = Engine.__new__(Engine)
        high = engine.cached_models(result, settings)[0]
        self.assertAlmostEqual(high['score'], .6)
        result['_fit_cache'] = zlib.compress(json.dumps([high]).encode())
        low = engine.cached_models(result, dict(settings, double_diffraction_weight=.3))[0]
        off = engine.cached_models(result, dict(settings, double_diffraction_weight=0.))[0]
        self.assertAlmostEqual(low['score'], .5)
        self.assertAlmostEqual(off['score'], .4)
        self.assertEqual(off['matches'], m['matches'])

    def test_unknown3_archived_positions(self):
        data=json.loads((Path(__file__).resolve().parents[1]/'docs/research/unknown3-omega-evidence.json').read_text())
        peaks=[dict(profile_id=p['profile_id'],qx=p['observed_q'][0],qy=p['observed_q'][1],observed_spots=p['observed_spots'],weight=1.) for p in data['profiles']]
        anchors=[dict(profile_id=14,hkl=[0,1,-1]),dict(profile_id=13,hkl=[-2,0,0])]
        result=beta_omega.fit(peaks,.2,2.5,10,anchors=anchors)
        report=result['double_diffraction']
        self.assertEqual(report['profile_ids'],[3,5,7,8])
        self.assertEqual(report['remaining_profile_ids'],[15])
        self.assertEqual(result['combined']['matched_profiles'],10)
        self.assertEqual(set(result['unexplained_profile_ids']),{3,5,7,8,15},'Single-scattering assignments stay unchanged')
        self.assertAlmostEqual(report['coverage_with_candidates'],14/15)
        self.assertTrue(any(p['kind']=='cross_component' for h in report['hits'] for p in h['paths']))
        self.assertTrue(all(abs(np.array(p['sum_reciprocal_parent'])@result['parent']['zone_3index'])<1e-8 for h in report['hits'] for p in h['paths']))
        weighted=beta_omega.fit(peaks,.2,2.5,10,anchors=anchors,settings={'double_diffraction_weight':.5})
        self.assertAlmostEqual(weighted['fit']['double_diffraction_factor'], dd.scoring_factor(weighted['double_diffraction'],peaks))
        self.assertGreater(weighted['fit']['score'],result['fit']['score'])
        self.assertEqual(weighted['combined']['matched_profiles'],10)


if __name__=='__main__':
    unittest.main()
