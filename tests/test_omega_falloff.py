"""Omega tolerance must not relax beta evidence or omit chance correction."""
import unittest
from unittest.mock import patch
import numpy as np
from tem_workbench.analysis import analysis_core as core
from tem_workbench.analysis import beta_omega
from tem_workbench.analysis import scale_fitting
from tem_workbench.analysis import diffraction_fitting
from tem_workbench.app.engine import Engine

class OmegaFalloffTests(unittest.TestCase):
    def test_shared_nodes_stay_tight_and_chance_widens(self):
        q=np.array([[4.,0.],[0.,4.],[4.,4.],[-4.,4.]])
        nodes=[dict(q=v.tolist(),hkl=[i,0,0],components=[{'component':c} for c in owners])
               for i,(v,owners) in enumerate(zip(q,[[0],[0,1],[1],[2]]))]
        peaks=[dict(profile_id=i,qx=v[0],qy=v[1],weight=1.) for i,v in enumerate(q+.3*q/np.linalg.norm(q,axis=1)[:,None])]
        widths=core.omega_node_scales(nodes,.1,3.)
        np.testing.assert_allclose(widths,[.1,.1,.3,.3])
        base=core.score_prediction_nodes(peaks,nodes,.1)
        same=core.score_prediction_nodes(peaks,nodes,.1,core.omega_node_scales(nodes,.1,1.))
        wide=core.score_prediction_nodes(peaks,nodes,.1,widths)
        self.assertEqual(base['score'],same['score'])
        a={m['profile_id']:m['quality'] for m in base['matches']}
        b={m['profile_id']:m['quality'] for m in wide['matches']}
        for i in [0,1]: self.assertEqual(a[i],b[i])
        for i in [2,3]: self.assertGreater(b[i],a[i])
        self.assertGreater(wide['chance_density_penalty'],base['chance_density_penalty'])
        pairs,_,_=beta_omega.assign(np.array([[p['qx'],p['qy']] for p in peaks]),q,np.ones(4),widths)
        self.assertEqual(pairs,[(i,i) for i in range(4)])

    def test_standalone_search_width_and_direct_evidence(self):
        engine=Engine({})
        templates=[next(t for t in engine.templates if t['phase']==p) for p in ['OMEGA','BCC']]
        peaks=[dict(profile_id=i,qx=i+3.,qy=i%2+1.,weight=1.) for i in range(5)]
        with patch.object(scale_fitting,'_seed_candidates',return_value=[]) as seeds:
            scale_fitting.search(peaks,templates,.1,'auto_uniform',omega_falloff_multiplier=3.)
        np.testing.assert_allclose([c.args[2] for c in seeds.call_args_list],[.3,.1])
        nodes=[dict(q=[4.,0.],hkl=[1,0,0]),dict(q=[0.,4.],hkl=[0,1,0])]
        observations=[dict(profile_id=i,qx=n['q'][0]+.2,qy=n['q'][1],weight=1.) for i,n in enumerate(nodes)]
        context=dict(radius=.1,position_scale=.1,g_min=2.,g_max=10.,maxima=[],x_limit=10.,y_limit=10.)
        settings=dict(omega_falloff_multiplier=3.,peak_evidence_weight=0.,missing_peak_weight=0.,peak_evidence_half_weight_nm_inv=0.,brightness_grouping_weight=0.)
        model=dict(phase='OMEGA',predicted_nodes=nodes,scale_penalty=0.)
        diffraction_fitting.evidence(model,observations,context,settings)
        np.testing.assert_allclose(model['position_matching']['node_distance_scales_nm_inv'],[.3,.3])

    def test_beta_only_fft_is_unchanged_and_does_not_gain_variants(self):
        from test_fft_beta_omega import fixture
        engine,item,roi,settings=fixture(False)
        original=engine.analyze(item,roi,settings,images=False)
        widened=engine.analyze(item,roi,{**settings,'omega_falloff_multiplier':5.},images=False)
        beta=lambda result: next(m for m in result['models'] if m['phase']=='BCC' and not m.get('related_pattern'))
        self.assertEqual(beta(original)['score'],beta(widened)['score'])
        self.assertFalse(widened.get('beta_omega',{}).get('selected',False))
        self.assertEqual(widened['settings']['omega_falloff_multiplier'],5.)

    def test_validation_default_bounds_and_export_setting(self):
        engine=Engine({})
        item=dict(array=np.zeros((32,32)),info=dict(image_kind='real_space'))
        roi=dict(x=0,y=0,w=32,h=32)
        self.assertEqual(engine.validate(item,roi,{})[1]['omega_falloff_multiplier'],1.)
        self.assertEqual(engine.validate(item,roi,dict(omega_falloff_multiplier=2.5))[1]['omega_falloff_multiplier'],2.5)
        for value in [0.,5.1,float('nan')]:
            with self.assertRaises(ValueError): engine.validate(item,roi,dict(omega_falloff_multiplier=value))

if __name__=='__main__': unittest.main()
