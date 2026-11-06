"""Independent ideal-omega structure factors and end-to-end indexing checks."""
import itertools
import json
import unittest
import numpy as np
import analysis_core as core
from crystal_templates import allowed, reciprocal
from engine import Engine
from materials import reference_settings
import scale_fitting as fitting
from forbidden_reflections import inspect


class OmegaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine({})
        cls.settings = {**reference_settings({'enabled_phases':['OMEGA']}), 'g_min':3., 'g_max':10.}
        cls.templates = cls.engine.templates_for(cls.settings)

    def template(self, zone):
        return next(t for t in self.templates if t['zone_3index']==zone and t['mirror']==1)

    def peaks(self, t, sa=1., sc=1.):
        q = core.rotation(fitting.prediction_points(t, sa, sc), .43)
        q = core.canonical(q[(np.linalg.norm(q,axis=1)>=3)&(np.linalg.norm(q,axis=1)<=10)])
        return [dict(profile_id=i+1,qx=float(x),qy=float(y),weight=4.) for i,(x,y) in enumerate(q)]

    def test_structure_factor_from_three_atomic_sites(self):
        h = np.array(list(itertools.product(range(-4,5),repeat=3)))
        sites = np.array([[0,0,0],[2/3,1/3,1/2],[1/3,2/3,1/2]])
        f = np.exp(2j*np.pi*h@sites.T).sum(axis=1)
        np.testing.assert_array_equal(allowed(h,'OMEGA'),abs(f)>1e-8)
        np.testing.assert_array_equal(allowed([[0,0,1],[1,0,0],[1,0,1],[1,1,0]],'OMEGA'),[True,False,True,True])
        self.assertFalse(np.array_equal(allowed(h,'OMEGA'),allowed(h,'HCP')))

    def test_zone_geometry_and_edited_references(self):
        self.assertEqual(len(self.templates),36)
        edited=self.engine.templates_for({**self.settings,'omega_a':.48,'omega_c':.30})
        for templates,a,c in [(self.templates,.4614,.2832),(edited,.48,.30)]:
            for t in templates:
                np.testing.assert_array_equal(t['hkl']@t['zone_3index'],0)
                self.assertTrue(allowed(t['hkl'],'OMEGA').all())
                np.testing.assert_allclose(t['projection'].T@t['projection'],np.eye(2),atol=1e-12)
                for sa,sc in [(1.,1.),(.94,1.07)]:
                    q=fitting.prediction_points(t,sa,sc)
                    v=reciprocal(t['hkl'],'OMEGA',a=a,c=c)*[sa,sa,sc]
                    np.testing.assert_allclose(q@q.T,v@v.T,atol=1e-8)
        self.assertFalse(np.array_equal(self.templates[0]['q'],edited[0]['q']))

    def test_scale_modes_recover_cell_and_penalty(self):
        t=self.template([0,1,0])
        for mode,sa,sc in [('auto_uniform',1.04,1.04),('auto_hcp_ac',1.03,.97),('auto_hcp_ratio',1.03,.97)]:
            m=fitting.search(self.peaks(t,sa,sc),[t],.08,mode,scale_penalty_strength=0,ca_penalty_strength=0)[0]
            self.assertTrue(m['valid'],mode)
            self.assertLess(m['rms_nm_inv'],1e-6)
            self.assertAlmostEqual(m['fitted_a_nm'],.4614/sa,places=6)
            self.assertAlmostEqual(m['fitted_c_nm'],.2832/sc,places=6)
            if mode=='auto_hcp_ratio':
                fitting.penalize(m,m['scale_a'],m['scale_c'],.1,ca_strength=.2)
                self.assertGreater(m['ca_ratio_penalty'],0)
        fixed=core.search(self.peaks(t),[t],1.,.08)[0]
        self.assertAlmostEqual(fixed['nominal_c_nm'],.2832)
        basal=self.template([0,0,1])
        m=fitting.search(self.peaks(basal),[basal],.08,'auto_hcp_ac')[0]
        self.assertFalse(m['c_axis_visible'])
        self.assertEqual(m['scale_parameter_count'],1)

    def test_forbidden_diagnostic_uses_omega_basis(self):
        t=self.template([0,1,0])
        m=core.search(self.peaks(t),[t],1.,.08)[0]
        q=core.rotation(fitting.prediction_points(t,1.,1.,hkl=np.array([[1,0,0]])),.43)[0]
        p=dict(profile_id=999,qx=float(q[0]),qy=float(q[1]),observed_spots=[q.tolist()])
        report=inspect(m,[p],.1,.2,10)
        self.assertEqual(report['profile_count'],1)
        self.assertEqual(report['rule_kind'],'basis')

    def test_fft_and_direct_pipelines_and_rescore(self):
        t=self.template([0,1,0]); waves=self.peaks(t)
        n=256;pixel=.04;yy,xx=np.indices((n,n))
        data=100+sum(np.cos(2*np.pi*pixel*(p['qx']*xx+p['qy']*yy)) for p in waves)
        fft=dict(array=data,info=dict(id='omega-fft',name='Omega FFT',width=n,height=n,pixel_x_nm=pixel,pixel_y_nm=pixel,can_index=True),limits=[80,120])
        n=512;cal=.045;yy,xx=np.indices((n,n));center=np.array([256.,256.])
        data=100+np.random.default_rng(42).normal(0,.2,(n,n))
        for p in waves:
            for sign in [-1,1]:
                x,y=center+sign*np.array([p['qx'],-p['qy']])/cal
                data+=250*np.exp(-((xx-x)**2+(yy-y)**2)/(2*1.6**2))
        direct=dict(array=data,info=dict(id='omega-direct',name='Omega detector',image_kind='diffraction',width=n,height=n,pixel_x_nm_inv=cal,pixel_y_nm_inv=cal,beam_center=dict(x=center[0],y=center[1],pairs=4,method='fixture',residual_px=0),can_index=True),limits=[99,351])
        for item in [fft,direct]:
            h,w=item['array'].shape
            result=self.engine.analyze(item,dict(x=0,y=0,w=w,h=h),dict(enabled_phases=['OMEGA'],scale_mode='auto_hcp_ratio',scale_penalty_strength=0,diffraction={'refine_center':False}),images=False,cache_candidates=True)
            self.assertTrue(result['models'])
            self.assertEqual({m['phase'] for m in result['models']},{'OMEGA'})
            self.assertTrue(any(m['valid'] for m in result['models']))
            self.assertEqual(result['settings']['omega_a'],.4614)
            rescored=self.engine.rescore(result,.1)
            self.assertTrue(rescored['models'])
            json.dumps({k:v for k,v in rescored.items() if not k.startswith('_')},allow_nan=False)
            self.assertEqual(self.engine.cached_models(result,{**result['settings'],'enabled_phases':[]}),[])
