import unittest
import copy
import itertools
from unittest.mock import patch
import numpy as np
import analysis_core as core
import beta_omega
import diffraction_fitting as fitting
from engine import Engine
from materials import reference_settings


class UnifiedDiffractionTests(unittest.TestCase):
    def test_calibrated_parent_preserves_all_stored_bcc_axes_and_handedness(self):
        engine = Engine({})
        for template in (t for t in engine.templates if t['phase'] == 'BCC'):
            for angle in (-.41, 1.13):
                with self.subTest(zone=template['zone_3index'], mirror=template['mirror'], angle=angle):
                    q = core.rotation(template['q']*1.027, angle)
                    model = dict(phase='BCC', zone_3index=template['zone_3index'], mirror=template['mirror'],
                        scale_a=1.027, scale_penalty=.037, fitted_a_nm=.33/1.027,
                        predicted_nodes=[dict(q=p.tolist(), hkl=h.tolist()) for p,h in zip(q,template['hkl'])])
                    original = copy.deepcopy(model)
                    parent = fitting.calibrated_parent(model, 6.1)
                    reconstructed = beta_omega.transform(template['hkl'] @ beta_omega.projection(parent['zone'], parent['mirror']), parent['factor'])*6.1
                    np.testing.assert_allclose(reconstructed, q, atol=1e-10)
                    self.assertAlmostEqual(abs(parent['factor'])*6.1, 1.027/.33)
                    self.assertEqual(parent['scale_penalty'], .037)
                    self.assertEqual(parent['scale_metadata']['scale_a'], 1.027)
                    self.assertEqual(model, original)

    def test_calibrated_113_parent_and_variants_survive_legacy_basis_conversion(self):
        engine = Engine({})
        zone = [1,-3,-1]
        settings = dict(**reference_settings(dict(material='titanium',enabled_phases=['BCC','OMEGA'])),
            scale_mode='auto_uniform', scale_penalty_strength=.1, ca_penalty_strength=.1,
            peak_evidence_weight=.1, missing_peak_weight=.1, peak_evidence_half_weight_nm_inv=0.,
            brightness_grouping_weight=0., double_diffraction_weight=0., g_min=2., g_max=10.)
        context = dict(maxima=[], radius=.12, g_min=2., g_max=10., x_limit=12., y_limit=12.,
                       visible=lambda q: np.ones(len(q), dtype=bool))
        # Independent 3D enumeration, projected through the legacy template's
        # axes. Do not manufacture the fixture via the linked prediction code.
        h = np.array(list(itertools.product(range(-6,7), repeat=3)))
        cell = np.array([[1.,-1.,0.], [0.,1.,-1.], [.5,.5,.5]])
        sites = np.array([[0,0,0], [2/3,1/3,.5], [1/3,2/3,.5]])
        for template in (t for t in engine.templates if t['phase']=='BCC' and t['zone_3index']==zone):
            rows = []
            for c, axis in enumerate((None, (1,1,1), (-1,1,-1))):
                vectors = h if axis is None else h @ np.linalg.inv(cell*np.array(axis)).T
                allowed = h.sum(axis=1)%2==0 if axis is None else abs(np.exp(2j*np.pi*h@sites.T).sum(axis=1))>1e-8
                q = core.rotation(vectors @ template['projection']*1.023/.33, .37)
                g = np.linalg.norm(q, axis=1)
                keep = allowed & (abs(vectors @ zone)<1e-8) & (g>=2.) & (g<=10.)
                q = core.canonical(q[keep])
                rows.append({tuple(np.round(v,8)): v for v in q})
            for omega, distorted in ((False, False), (True, False), (True, True)):
                combined = {key:value for row in (rows if omega else rows[:1]) for key,value in row.items()}
                peaks = [dict(profile_id=i+1,qx=float(v[0]),qy=float(v[1]),g_nm_inv=float(np.linalg.norm(v)),
                              weight=6. if key in rows[0] else 2.) for i,(key,v) in enumerate(combined.items())]
                if distorted:
                    for peak in peaks:
                        v = np.array([peak['qx'],peak['qy']]) @ [[1.018,.012],[.006,.982]]
                        peak.update(qx=float(v[0]),qy=float(v[1]),g_nm_inv=float(np.linalg.norm(v)))
                spectrum = dict(peaks=peaks,df=.02,peak_width_nm_inv=.12,kind='diffraction')
                models, candidates, related = fitting.search(engine,spectrum,settings,context,False)
                expected_scale = core.matching_parameters(spectrum)['distance_scale_nm_inv']
                self.assertTrue(all(abs(m['position_matching']['distance_scale_nm_inv']-expected_scale)<1e-12
                                    for m in candidates))
                parent = next(m for m in models if m['phase']=='BCC')
                if not distorted:
                    self.assertTrue(parent['valid'])
                self.assertAlmostEqual(parent['reciprocal_scale'],1.023/.33,delta=.04 if distorted else 1e-6)
                if omega:
                    self.assertIsNotNone(related)
                    self.assertTrue(related['fit']['valid'])
                    self.assertEqual(len(related['fit']['component_ids']),3)
                    self.assertAlmostEqual(related['fit']['additional_pattern_penalty'],.025)
                    self.assertEqual(related['fit']['additional_pattern_count'],1)
                    self.assertAlmostEqual(related['combined']['coverage'],1.)
                    self.assertAlmostEqual(related['fit']['position_matching']['distance_scale_nm_inv'],expected_scale)
                    common = core.score_prediction_nodes(peaks,related['fit']['predicted_nodes'],expected_scale)
                    self.assertAlmostEqual(related['fit']['position_score'],common['score'])
                    self.assertEqual(related['fit']['peak_evidence']['detected_missing_equivalent_count'],0.)
                    if distorted:
                        self.assertGreater(related['fit']['rms_nm_inv'],.05)
                        self.assertTrue(any(m['residual_nm_inv']>.12 for m in related['fit']['matches']))
                        self.assertTrue(any(m['quality']<.95 for m in related['fit']['matches']))
                    else:
                        self.assertLess(related['fit']['rms_nm_inv'],1e-7)
                else:
                    self.assertIsNone(related)
                    self.assertAlmostEqual(parent['coverage'],1.)

    def test_relative_fcc_runs_without_beta_and_is_scale_invariant(self):
        engine = Engine({})
        template = next(t for t in engine.templates if t['phase']=='FCC' and t['zone_3index']==[0,0,1] and t['mirror']==1)
        q=core.rotation(template['q'],.27)
        q=q[(np.linalg.norm(q,axis=1)>2.5)&(np.linalg.norm(q,axis=1)<10)]
        results=[]
        for factor in (1.,.01):
            peaks=[dict(profile_id=i+1,qx=float(x*factor),qy=float(y*factor),g_nm_inv=float(np.hypot(x,y)*factor),weight=3.) for i,(x,y) in enumerate(q)]
            s=dict(peaks=peaks,df=.02*factor,peak_width_nm_inv=.12*factor,kind='diffraction')
            settings=dict(**reference_settings(dict(material='unknown',enabled_phases=['FCC'])),
                scale_mode='auto_uniform',scale_penalty_strength=0.,ca_penalty_strength=.1,
                peak_evidence_weight=.1,peak_evidence_half_weight_nm_inv=0.,g_min=2.5*factor,g_max=10*factor)
            context=dict(maxima=[],radius=.12*factor,g_min=2.5*factor,g_max=10*factor,x_limit=10*factor,y_limit=10*factor,visible=lambda q:np.ones(len(q),dtype=bool))
            models, candidates, related=fitting.search(engine,s,settings,context,True)
            self.assertIsNone(related);self.assertTrue(models)
            self.assertEqual({m['phase'] for m in models},{'FCC'})
            self.assertTrue(models[0]['valid']);self.assertIsNone(models[0]['fitted_a_nm'])
            results.append(models[0])
        self.assertAlmostEqual(results[0]['coverage'],results[1]['coverage'])
        self.assertAlmostEqual(results[0]['quality_coverage'],results[1]['quality_coverage'])
        self.assertAlmostEqual(results[0]['score'],results[1]['score'])
        self.assertAlmostEqual(results[0]['chance_density_penalty'],results[1]['chance_density_penalty'])

    def test_ambiguity_names_actual_passing_rival_and_never_forces_related_fit(self):
        primary=dict(phase='BCC',zone_3index=[0,1,1],score=.70,valid=True)
        base=dict(label='bcc_compatible',primary_model=primary,secondary_model=None,flags=[])
        related=dict(fit=dict(score=.74,valid=True,coverage=.8,component_ids=['beta','omega1']))
        r=fitting.compare(base,related,{}, {}, {})
        self.assertEqual(r['label'],'ambiguous');self.assertTrue(related['selected'])
        self.assertIs(related['comparison']['rival'],primary)
        self.assertEqual(r['ambiguity_reason'],'related_pattern_tradeoff')
        primary['score']=.90
        r=fitting.compare(base,related,{}, {}, {})
        self.assertEqual(r['label'],'bcc_compatible');self.assertFalse(related['selected'])
        self.assertFalse(related['comparison']['ambiguous'])
        related['fit']['valid']=False;primary['score']=.74
        r=fitting.compare(base,related,{}, {}, {})
        self.assertFalse(related['comparison']['ambiguous'])
        self.assertIs(r['primary_model'],primary)

    def test_same_phase_union_is_an_explicit_winner_without_brightness(self):
        primary=dict(phase='BCC',zone_3index=[0,1,1],score=.569,valid=True)
        secondary=dict(phase='BCC',zone_3index=[0,1,1],score=.566,valid=True)
        combined=dict(phase='BCC+BCC',zone_3index=[0,1,1],score=.795,valid=True,coverage=1.,brightness_bonus=0.)
        base=dict(label='multiple_orientations',primary_model=primary,secondary_model=secondary,flags=[])
        related=dict(fit=dict(score=.716,valid=True,coverage=.78,component_ids=['beta','omega1','omega2']))
        with patch.object(fitting,'union_fit',return_value=combined):
            result=fitting.compare(base,related,dict(peaks=[]),{},dict(brightness_grouping_weight=0))
            self.assertTrue(result['combined_fit_selected'])
            self.assertIs(result['combined_fit'],combined)
            self.assertEqual(result['combined_fit_components'],[primary,secondary])
            self.assertFalse(related['selected'])
            self.assertIs(related['comparison']['rival'],combined)
            self.assertEqual(result['label'],'ambiguous')
            self.assertNotIn('combined_fit',base,'Comparison must not mutate the initial classification')
            # This is a normal phase-combination decision, not a beta/omega special case.
            alone=fitting.compare(base,None,dict(peaks=[]),{},dict(brightness_grouping_weight=0))
            self.assertTrue(alone['combined_fit_selected'])
            self.assertEqual(alone['label'],'multiple_orientations')
            # A stronger related candidate replaces the winner, retaining the rival for inspection.
            related['fit']['score']=.9
            winner=fitting.compare(base,related,dict(peaks=[]),{},dict(brightness_grouping_weight=0))
            self.assertTrue(related['selected'])
            self.assertFalse(winner['combined_fit_selected'])
            self.assertIs(winner['primary_model'],related['fit'])
            self.assertEqual(winner['combined_fit_components'],[primary,secondary])
            # Failed or lower-scoring unions cannot displace a passing primary.
            for score,valid in ((.95,False),(.5,True)):
                combined.update(score=score,valid=valid)
                rejected=fitting.compare(base,None,dict(peaks=[]),{},dict(brightness_grouping_weight=0))
                self.assertFalse(rejected['combined_fit_selected'])
                self.assertIs(rejected['primary_model'],primary)


if __name__=='__main__':
    unittest.main()
