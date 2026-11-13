"""Soft positional evidence must admit offsets without giving away full credit."""
import unittest
import numpy as np
from tem_workbench.analysis import analysis_core as core
from tem_workbench.analysis import beta_omega
from tem_workbench.analysis import peak_evidence


class PositionalMatchingTests(unittest.TestCase):
    def test_distance_scale_includes_distortion_and_follows_coordinate_units(self):
        peaks = [dict(qx=g, qy=0.) for g in (3., 6., 9.)]
        spectrum = dict(peaks=peaks, df=.02, peak_width_nm_inv=.113,kind='diffraction')
        p = core.matching_parameters(spectrum)
        self.assertAlmostEqual(p['distance_scale_nm_inv'],np.hypot(.113,.04*6.))
        self.assertGreater(core.positional_quality(.3,p['distance_scale_nm_inv']),.35)
        for factor in (.01, 3.):
            scaled = dict(peaks=[dict(qx=v['qx']*factor,qy=0.) for v in peaks],
                          df=.02*factor,peak_width_nm_inv=.113*factor,kind='diffraction')
            params = core.matching_parameters(scaled)
            self.assertAlmostEqual(params['distance_scale_nm_inv'],p['distance_scale_nm_inv']*factor)
            self.assertAlmostEqual(core.positional_quality(.3*factor,params['distance_scale_nm_inv']),
                                   core.positional_quality(.3,p['distance_scale_nm_inv']))

    def test_fft_retains_window_response_scale(self):
        spectrum = dict(peaks=[dict(qx=8.,qy=0.)],df=.02,peak_width_nm_inv=.15,kind='fft')
        self.assertEqual(core.matching_parameters(spectrum)['distance_scale_nm_inv'],.15)
        spectrum['peak_width_nm_inv']=.05
        self.assertEqual(core.matching_parameters(spectrum)['distance_scale_nm_inv'],.1)

    def test_loss_is_monotone_continuous_and_scale_invariant(self):
        width = .113
        distances = np.linspace(0., 5*width, 1001)
        q = core.positional_quality(distances, width)
        self.assertEqual(q[0], 1.)
        self.assertTrue((np.diff(q)<=0).all())
        self.assertGreater(float(core.positional_quality(.3,width)),0.)
        self.assertLess(float(core.positional_quality(.3,width)),.1)
        self.assertEqual(float(core.positional_quality(4*width,width)),0.)
        self.assertLess(float(core.positional_quality(4*width-1e-8,width)),1e-7)
        self.assertAlmostEqual(float(core.positional_quality(width-1e-9,width)),
                               float(core.positional_quality(width+1e-9,width)),places=7)
        np.testing.assert_allclose(core.positional_quality(distances*.013,width*.013),q,atol=1e-14)

    def test_chance_allowance_integrates_the_actual_soft_kernel(self):
        angle = np.linspace(0,np.pi/2,50001)
        for r,p,width in ((6.,6.,.113),(6.,6.3,.113),(2.,4.,.7),(1.,1.,1.),(3.,8.,.1)):
            distance = np.sqrt((r-p)**2+2*r*p*(1-np.cos(angle)))
            expected = np.trapezoid(core.positional_quality(distance,width),angle)*2/np.pi
            actual = core.positional_chance([r],[p],width)[0]
            self.assertAlmostEqual(actual,expected,places=8)
            self.assertAlmostEqual(core.positional_chance([r*.01],[p*.01],width*.01)[0],actual)
        self.assertGreater(core.positional_chance([6.],[6.,6.1],.2)[0],core.positional_chance([6.],[6.],.2)[0])

    def test_displaced_matches_are_one_to_one_and_shared_by_independent_and_linked_search(self):
        q = np.array([[4.,0.],[0.,4.],[4.,4.],[-4.,4.]])
        nodes = [dict(q=v.tolist(),hkl=[i+1,0,0]) for i,v in enumerate(q)]
        context = dict(radius=.1,g_min=2.,g_max=9.,x_limit=10.,y_limit=10.,maxima=[])
        ranks, deficits = [], []
        for offset in (0., .05, .1, .15, .25, .35):
            observed = q+offset*q/np.linalg.norm(q,axis=1)[:,None]
            peaks = [dict(profile_id=i+1,qx=v[0],qy=v[1],weight=1.) for i,v in enumerate(observed)]
            # A duplicate observation cannot claim the same prediction twice.
            duplicated = peaks+[dict(peaks[0],profile_id=99,weight=.5)]
            model = core.score_prediction_nodes(duplicated,nodes,.1)
            pairs,residuals,_ = beta_omega.assign(observed,q,np.ones(4),.1)
            self.assertEqual(len(pairs),4)
            self.assertEqual(model['matched_profile_count'],4)
            self.assertNotIn(99,[m['profile_id'] for m in model['matches']])
            np.testing.assert_allclose(sorted(residuals),sorted(m['residual_nm_inv'] for m in model['matches']))
            np.testing.assert_allclose([m['quality'] for m in model['matches']],core.positional_quality(offset,.1),atol=1e-14)
            model.update(position_score=model['score'],position_valid=model['valid'])
            peak_evidence.inspect(model,context)
            peak_evidence.apply(model,0.,missing_weight=.5)
            ranks.append(model['score']);deficits.append(model['missing_peak_penalty'])
        self.assertTrue((np.diff(ranks)<0).all())
        self.assertEqual(deficits,[0.]*len(deficits),'Assigned profiles pay only positional cost')

    def test_weak_maxima_still_provide_only_graded_support(self):
        context = dict(radius=.1,g_min=2.,g_max=9.,x_limit=10.,y_limit=10.,maxima=[])
        costs = []
        for distance in (.15,.25,.35,.401):
            q = [4.+distance,0.]
            context['maxima'] = [dict(q=q,strength=.4,weak_id=1,local_contrast=4.,enrichment=3.)]
            model = dict(predicted_nodes=[dict(q=[4.,0.])],matches=[],position_score=.8,position_valid=True)
            peak_evidence.inspect(model,context)
            peak_evidence.apply(model,.2,missing_weight=1.)
            costs.append(model['missing_peak_penalty'])
        self.assertTrue((np.diff(costs)>0).all())
        self.assertEqual(costs[-1],1.)

    def test_distortion_allowance_does_not_hide_unsupported_predictions(self):
        spectrum = dict(peaks=[dict(qx=6.,qy=0.)],df=.02,peak_width_nm_inv=.1,kind='diffraction')
        original = dict(radius=.1,g_min=2.,g_max=9.,x_limit=10.,y_limit=10.,maxima=[])
        context = core.matching_context(spectrum,original)
        # Inside the narrow physical footprint, but closer to the band edge
        # than the distortion allowance: absence must remain assessable.
        model = dict(predicted_nodes=[dict(q=[2.15,0.])],matches=[],position_score=.8,position_valid=True)
        peak_evidence.inspect(model,context)
        peak_evidence.apply(model,0.,missing_weight=1.)
        self.assertEqual(model['peak_evidence']['nodes'][0]['status'],'unsupported')
        self.assertEqual(model['missing_peak_penalty'],1.)
        self.assertEqual(context['radius'],original['radius'])
        self.assertNotIn('position_scale',original)

    def test_unmatched_nodes_keep_cost_when_other_matches_are_displaced(self):
        q = np.array([[4.,0.],[0.,4.],[4.,4.],[-4.,4.]])
        nodes = [dict(q=v.tolist(),hkl=[i+1,0,0]) for i,v in enumerate(q)]
        observed = q[:3]*1.07
        peaks = [dict(profile_id=i+1,qx=v[0],qy=v[1],weight=1.) for i,v in enumerate(observed)]
        context = core.matching_context(dict(peaks=peaks,df=.02,peak_width_nm_inv=.1,kind='diffraction'),
            dict(radius=.1,g_min=2.,g_max=9.,x_limit=10.,y_limit=10.,maxima=[]))
        model = core.score_prediction_nodes(peaks,nodes,context['position_scale'])
        model.update(position_score=model['score'],position_valid=model['valid'])
        peak_evidence.inspect(model,context)
        peak_evidence.apply(model,0.,missing_weight=2.)
        self.assertEqual(model['matched_profile_count'],3)
        self.assertEqual(model['peak_evidence']['unsupported_count'],1)
        self.assertEqual(model['missing_peak_penalty'],.5)
        self.assertTrue(all(n['missing_fraction']==0 for n in model['peak_evidence']['nodes'] if n['status']=='detected'))


if __name__ == '__main__':
    unittest.main()
