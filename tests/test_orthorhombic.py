"""Generic primitive geometry, dimensional observability and scoring integration."""
import unittest
import numpy as np
from tem_workbench.analysis import analysis_core as core
from tem_workbench.app.engine import Engine
from tem_workbench.analysis.materials import reference_settings
from tem_workbench.analysis.crystal_templates import reciprocal, allowed
from tem_workbench.analysis.orthorhombic import transform
from tem_workbench.analysis import scale_fitting as fitting

class Orthorhombic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine=Engine({})
        cls.settings={**reference_settings({'enabled_phases':['ORT']}),'g_min':3.,'g_max':10.}
        cls.templates=cls.engine.templates_for(cls.settings)

    def template(self,zone):
        return next(t for t in self.templates if t['zone_3index']==zone and t['mirror']==1)

    def peaks(self,t,scales):
        q=core.rotation(t['q']@transform(t,scales),.43)
        q=q[(np.linalg.norm(q,axis=1)>=3)&(np.linalg.norm(q,axis=1)<=10)]
        return [dict(profile_id=i+1,qx=float(x),qy=float(y),weight=4.) for i,(x,y) in enumerate(q)]

    def test_geometry_zone_law_and_no_absences(self):
        h=np.array([[1,0,0],[1,1,0],[1,1,1]])
        np.testing.assert_allclose(reciprocal(h,'ORT',a=.3,b=.4,c=.5),h/[.3,.4,.5])
        self.assertTrue(allowed(h,'ORT').all())
        self.assertEqual(len(self.templates),38)
        for t in self.templates:
            np.testing.assert_array_equal(t['hkl']@t['zone_3index'],0)
            np.testing.assert_allclose(t['projection'].T@t['projection'],np.eye(2),atol=1e-12)
            g=reciprocal(t['hkl'],'ORT',a=.3,b=.4,c=.5)
            np.testing.assert_allclose(np.linalg.norm(t['q'],axis=1),np.linalg.norm(g,axis=1))
        self.assertIsNotNone(self.template([1,0,2]))
        self.assertIsNotNone(self.template([2,0,1])) # not symmetry-equivalent

    def test_independent_axes_and_cached_penalties(self):
        t=self.template([1,1,1]);scales=np.array([1.03,.98,1.06])
        models=fitting.search(list(reversed(self.peaks(t,scales))),[t],.08,'auto_hcp_ratio',scale_penalty_strength=0)
        m=models[0]
        self.assertTrue(m['valid']);self.assertLess(m['rms_nm_inv'],1e-6)
        np.testing.assert_allclose([m['fitted_'+a+'_nm'] for a in 'abc'],np.array([.3,.4,.5])/scales,atol=1e-6)
        self.assertEqual(m['scale_parameter_count'],3)
        fitting.penalize(m,m['scale_a'],m['scale_c'],.1)
        self.assertAlmostEqual(m['scale_penalty'],.1*np.mean(((scales-1)/.05)**2))
        fitting.penalize(m,m['scale_a'],None,0)
        self.assertAlmostEqual(m['score'],m['position_score'])

    def test_principal_zone_does_not_measure_invisible_axis(self):
        t=self.template([0,0,1])
        m=fitting.search(self.peaks(t,[1.04,.97,1]),[t],.08,'auto_hcp_ac',scale_penalty_strength=0)[0]
        self.assertTrue(m['valid']);self.assertEqual(m['axis_observable'],[True,True,False])
        self.assertIsNone(m['fitted_c_nm']);self.assertEqual(m['scale_parameter_count'],2)

    def test_component_seed_uses_same_refinement(self):
        t=self.template([1,1,1]);peaks=self.peaks(t,[1.03,.98,1.06])
        ordinary=fitting.search(peaks,[t],.08,'auto_hcp_ratio',scale_penalty_strength=0)[0]
        seed=dict(ordinary,id=23,scale_b=1.)
        checked=fitting.search(peaks,[t],.08,'auto_hcp_ratio',scale_penalty_strength=0,hypotheses=[seed])[0]
        self.assertEqual(checked['source_hypothesis'],23)
        self.assertAlmostEqual(checked['score'],ordinary['score'],places=7)
        self.assertAlmostEqual(checked['scale_b'],.98,places=5)

    def test_partially_identifiable_zone_still_fits(self):
        t=self.template([1,1,0])
        m=fitting.search(self.peaks(t,[1.02,.98,1.04]),[t],.08,'auto_hcp_ac',scale_penalty_strength=0)[0]
        self.assertTrue(m['valid']);self.assertLess(m['rms_nm_inv'],1e-5)
        self.assertEqual(m['axis_observable'],[False,False,True])
        self.assertIsNone(m['fitted_a_nm']);self.assertIsNone(m['fitted_b_nm'])
        self.assertEqual(m['scale_parameter_count'],2)

    def test_uniform_and_fixed_modes(self):
        t=self.template([1,1,1]);peaks=self.peaks(t,[1.04]*3)
        m=fitting.search(peaks,[t],.08,'auto_uniform',scale_penalty_strength=0)[0]
        self.assertLess(m['rms_nm_inv'],1e-6)
        self.assertAlmostEqual(m['fitted_b_nm'],.4/1.04,places=6)
        fixed=core.search(peaks,[t],1.04,.08)[0]
        self.assertLess(fixed['rms_nm_inv'],1e-6)
        self.assertEqual(fixed['nominal_b_nm'],.4)

    def test_full_fft_pipeline_and_cached_rescore(self):
        t=self.template([1,1,1]); n=256; pixel=.04
        yy,xx=np.indices((n,n))
        waves=self.peaks(t,[1.03,.98,1.06])
        data=100+sum(np.cos(2*np.pi*pixel*(v['qx']*xx+v['qy']*yy)) for v in waves)
        item=dict(array=data,info=dict(id='ort-test',name='Synthetic orthorhombic',width=n,height=n,pixel_x_nm=pixel,pixel_y_nm=pixel,can_index=True),limits=[80,120])
        result=self.engine.analyze(item,dict(x=0,y=0,w=n,h=n),dict(enabled_phases=['ORT'],scale_mode='auto_hcp_ratio',scale_penalty_strength=0),images=False,cache_candidates=True)
        self.assertTrue(result['models'])
        self.assertEqual({m['phase'] for m in result['models']},{'ORT'})
        rescored=self.engine.rescore(result,.1)
        self.assertTrue(rescored['models'])
        self.assertGreaterEqual(rescored['models'][0]['scale_penalty'],0)

    def test_edited_references_invalidate_template_cache(self):
        edited=self.engine.templates_for({**self.settings,'ort_b':.45})
        original=self.template([0,0,1])
        changed=next(t for t in edited if t['id']==original['id'])
        self.assertEqual(changed['reference_b_nm'],.45)
        self.assertFalse(np.array_equal(changed['q'],original['q']))
