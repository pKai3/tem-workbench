"""Independent fractional-position fixtures and negative controls for parent/variants."""
import itertools
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
import analysis_core as core
import beta_omega as joint
import raster_images
from engine import Engine
from crystal_templates import allowed


# [011]beta diffraction positions in units (sqrt(2)/3, 2/3)/a_beta.
# Explicit indices, independent of the implementation's variant generator.
BETA = [(3,0),(0,3),(-3,3),(3,3),(6,0)]
W1 = [(2,1),(1,2),(-4,1),(4,2),(-1,4),(-5,2)]
W2 = [(-2,1),(-1,2),(4,1),(-4,2),(1,4),(5,2)]


def fixture(variants=2, factor=3.2, angle=.37):
    rows = BETA + (W1 if variants else []) + (W2 if variants == 2 else [])
    q = np.array(rows)*[np.sqrt(2)/3, 2/3]
    z = (q[:,0]+1j*q[:,1])*factor*np.exp(1j*angle)
    return [dict(profile_id=i+1, qx=float(p.real), qy=float(p.imag), weight=4. if i < 5 else 2.,
                 observed_spots=[[float(p.real), float(p.imag)], [-float(p.real), -float(p.imag)]]) for i,p in enumerate(z)]


class BetaOmegaTests(unittest.TestCase):
    def test_four_variants_obey_metric_or_and_cubic_symmetry(self):
        bases = [joint.variant_basis(i) for i in range(4)]
        for i,basis in enumerate(bases):
            cell = np.linalg.inv(basis).T
            np.testing.assert_allclose(np.linalg.norm(cell,axis=1), [np.sqrt(2),np.sqrt(2),np.sqrt(3)/2])
            self.assertAlmostEqual(cell[0]@cell[1], -1.)
            np.testing.assert_allclose(cell[2]/np.linalg.norm(cell[2]), np.array(joint.AXES[i])/np.sqrt(3))
            self.assertAlmostEqual((cell[0]+cell[1])@cell[2],0.)
            self.assertEqual(sorted(abs(cell[0]+cell[1])),[0,1,1])
        # Every proper cubic symmetry permutes the four unoriented c axes.
        axes={tuple(abs(v[0])*np.array(v)//v[0]) for v in joint.AXES}
        for perm in itertools.permutations(range(3)):
            for signs in itertools.product((-1,1),repeat=3):
                matrix=np.eye(3,dtype=int)[list(perm)]*np.array(signs)[:,None]
                if round(np.linalg.det(matrix))!=1:continue
                for axis in joint.AXES:
                    v=np.array(axis)@matrix
                    self.assertIn(tuple(v*(1 if v[0]>0 else -1)),axes)
        # Structure factor, not the implementation's allowed-reflection rule.
        sites=np.array([[0,0,0],[2/3,1/3,.5],[1/3,2/3,.5]])
        for c in range(1,5):
            q,h=joint.lattice((0,1,1),component=c)
            self.assertTrue((abs(np.exp(2j*np.pi*h@sites.T).sum(axis=1))>1e-8).all())
            np.testing.assert_allclose((h@bases[c-1])@np.array([0,1,1]),0,atol=1e-8)

    def test_two_variants_union_and_shared_accounting(self):
        peaks=fixture();r=joint.fit(peaks,.12,1.6,10.56)
        self.assertEqual(r['status'],'beta_omega_candidate')
        self.assertEqual(sum(c['active'] for c in r['components']),3)
        self.assertAlmostEqual(r['combined']['coverage'],1.)
        self.assertLess(r['combined']['rms_relative'],1e-10)
        self.assertEqual(r['combined']['matched_profiles'],len(peaks))
        self.assertAlmostEqual(r['combined']['complexity_cost'],.025)
        self.assertAlmostEqual(r['fit']['additional_pattern_penalty'],.025)
        self.assertEqual(r['fit']['additional_pattern_count'],1)
        self.assertEqual(r['fit']['additional_pattern_basis'],'related_phase_family')
        self.assertEqual(len({a['profile_id'] for a in r['assignments']}),len(peaks))
        self.assertGreater(sum(c['matched_profiles'] for c in r['components']),len(peaks))
        self.assertTrue(all(c['exclusive_profiles']>=2 for c in r['components'][1:] if c['active']))
        self.assertIsNone(r['parent']['absolute_cell_nm'])
        active = [c for c in r['components'] if c['active'] and c['id'] != 'beta']
        self.assertEqual([c['display_label'] for c in active], ['ω1', 'ω2'])
        for c in active:
            self.assertEqual(c['c_axis_beta'], list(joint.AXES[int(c['id'][5:])-1]))
        self.assertTrue(all('display_label' not in c for c in r['components'] if not c['active']))
        json.dumps(r,allow_nan=False)

    def test_scale_rotation_and_order_invariance(self):
        for scale,angle in [(0.07,1.17),(37.,-.21)]:
            peaks=fixture(factor=scale,angle=angle);peaks.reverse()
            r=joint.fit(peaks,.0375*scale,.5*scale,3.3*scale)
            self.assertEqual(sum(c['active'] for c in r['components']),3)
            self.assertAlmostEqual(r['combined']['coverage'],1.)
            self.assertAlmostEqual(r['parent']['reciprocal_scale'],scale,places=5)

    def test_two_parent_reflections_survive_satellite_dominated_search(self):
        peaks=[p for p in fixture() if np.hypot(p['qx'],p['qy'])<7.7]
        for p in peaks:p['weight']=1. if p['profile_id']<=5 else 4.
        r=joint.fit(peaks,.12,1.6,7.7)
        self.assertEqual(sum(c['active'] for c in r['components']),3)
        self.assertAlmostEqual(r['parent']['reciprocal_scale'],3.2,places=6)
        self.assertEqual(r['parent']['matched_profiles'],2)
        self.assertTrue(r['parent']['requires_variant_support'])
        self.assertAlmostEqual(r['combined']['coverage'],1.)
        self.assertAlmostEqual(r['combined']['beta_only_coverage'],2/len(peaks))

    def test_nominal_absences_are_geometry_diagnostics_not_allowed_evidence(self):
        peaks=fixture(angle=0)
        for i,(x,y) in enumerate([(1,1),(2,2),(-1,1),(-2,2)]):
            peaks.append(dict(profile_id=101+i,qx=x*np.sqrt(2)/3*3.2,qy=y*2/3*3.2,weight=1))
        anchors=[dict(profile_id=1,hkl=[0,1,-1]),dict(profile_id=2,hkl=[-2,0,0])]
        r=joint.fit(peaks,.12,1.6,10.56,anchors=anchors)
        self.assertEqual(sum(c['active'] for c in r['components']),3)
        self.assertEqual(r['combined']['matched_profiles'],17)
        self.assertEqual(r['combined']['geometry_matched_profiles'],21)
        self.assertEqual(set(r['nominal_absence_profile_ids']),{101,102,103,104})
        self.assertEqual(r['unexplained_geometry_profile_ids'],[])
        for row in r['assignments'][-4:]:
            self.assertEqual(row['component'],'unexplained')
            self.assertEqual(row['compatible_components'],[])
            for index in row['geometry_diagnostic']['indices']:
                self.assertFalse(allowed([index['hkl']],'OMEGA')[0])

    def test_beta_only_and_single_variant_do_not_claim_two(self):
        for count in (0,1):
            r=joint.fit(fixture(count),.12,1.6,10.56)
            self.assertEqual(sum(c['active'] for c in r['components']),count+1)
            self.assertEqual(r['status'],'beta_only' if count==0 else 'beta_omega_candidate')
            self.assertAlmostEqual(r['fit']['additional_pattern_penalty'],.025 if count else 0.)
            self.assertEqual(r['fit']['additional_pattern_count'],int(count>0))

    def test_unrelated_spots_remain_unexplained_without_harming_component_fit(self):
        peaks=fixture();peaks.append(dict(profile_id=999,qx=2.17,qy=7.71,weight=1))
        r=joint.fit(peaks,.12,1.6,10.56)
        self.assertIn(999,r['unexplained_profile_ids'])
        self.assertEqual(sum(c['active'] for c in r['components']),3)
        self.assertTrue(all(c['rms_relative']<1e-10 for c in r['components'] if c['active']))

    def test_noise_does_not_pass_related_variant_screen(self):
        rng=np.random.default_rng(711)
        angles=rng.uniform(0,np.pi,32);radius=rng.uniform(2,10,32)
        peaks=[dict(profile_id=i+1,qx=float(r*np.cos(a)),qy=float(r*np.sin(a)),weight=1) for i,(r,a) in enumerate(zip(radius,angles))]
        spectrum=dict(peaks=peaks,df=.02,peak_width_nm_inv=.12,kind='diffraction')
        for tolerance in (.12,core.matching_parameters(spectrum)['distance_scale_nm_inv']):
            result=joint.fit(peaks,tolerance,1.6,10.56)
            self.assertIn(result['status'],('unresolved','insufficient_parent'))

    def test_insufficient_parent_keeps_unexplained_observations(self):
        peaks=fixture()[:2];result=joint.fit(peaks,.12,1.6,10.56)
        self.assertEqual(result['status'],'insufficient_parent')
        self.assertEqual(result['unexplained_profile_ids'],[1,2])
        self.assertEqual([a['component'] for a in result['assignments']],['unexplained']*2)
        self.assertEqual(result['assignments'][0]['observed_spots'],peaks[0]['observed_spots'])

    def test_dense_predictions_cover_full_disk(self):
        # [001] beta: independently count all allowed integer h,k in the disk.
        # A fixed index-8 cube misses outer nodes and can overrate this parent.
        q,h=joint.predictions((0,0,1),1,.25+0j,0,.2,3.,None)
        expected=sum(1 for x in range(-12,13) for y in range(-12,13)
                     if (x+y)%2==0 and 0<(x*x+y*y)<=144)//2
        self.assertEqual(len(q),expected)
        self.assertGreater(np.max(abs(h)),8)

    def test_anchors_constrain_geometry_and_reject_inconsistent_indices(self):
        anchors=[dict(profile_id=1,hkl=[0,1,-1]),dict(profile_id=2,hkl=[-2,0,0])]
        r=joint.fit(fixture(),.12,1.6,10.56,anchors=anchors)
        self.assertAlmostEqual(r['combined']['coverage'],1.)
        with self.assertRaisesRegex(ValueError,'disagree'):
            joint.fit(fixture(),.12,1.6,10.56,anchors=[anchors[0],dict(profile_id=2,hkl=[-4,0,0])])
        with self.assertRaises(ValueError):
            joint.fit(fixture(),.12,1.6,10.56,anchors=[anchors[0],dict(profile_id=100,hkl=[-2,0,0])])


    def test_union_uses_common_score_and_evidence_costs(self):
        import analysis_core as core
        peaks=fixture()
        r=joint.fit(peaks,.12,1.6,10.56,settings={'peak_evidence_weight':.3,'missing_peak_weight':1.2})
        m=r['fit']; common=core.score_prediction_nodes(peaks,m['predicted_nodes'],.12)
        self.assertAlmostEqual(m['position_score'],common['score'])
        self.assertAlmostEqual(m['score'],m['position_score']-m['scale_penalty']+m['weak_peak_bonus']-m['missing_peak_penalty']-m['additional_pattern_penalty'])
        self.assertEqual(len({tuple(n['q']) for n in m['predicted_nodes']}),len(m['predicted_nodes']))
        self.assertIn('peak_evidence',m)
        self.assertEqual(m['missing_peak_weight'],1.2)
        self.assertAlmostEqual(m['missing_peak_penalty'],1.2*m['peak_evidence']['missing_factor'])

    def test_soft_brightness_supports_parent_and_pooled_variants_without_moving_spots(self):
        peaks=fixture()
        for p in peaks:
            p.update(integrated_intensity=800. if p['profile_id']<=5 else 100., intensity_reliable=True)
        off=joint.fit(peaks,.12,1.6,10.56,settings={'brightness_grouping_weight':0})
        on=joint.fit(peaks,.12,1.6,10.56,settings={'brightness_grouping_weight':.1})
        self.assertGreater(on['fit']['brightness_bonus'],0)
        self.assertEqual(on['fit']['predicted_nodes'],off['fit']['predicted_nodes'])
        self.assertEqual(on['fit']['matches'],off['fit']['matches'])
        self.assertAlmostEqual(on['fit']['score']-off['fit']['score'],on['fit']['brightness_bonus'])
        grouping=on['fit']['brightness_grouping']
        self.assertEqual([g['phase'] for g in grouping['groups']],['BCC','OMEGA'])
        self.assertEqual(len(grouping['reliable_profile_ids']),len(peaks))
        self.assertTrue(grouping['shared_profile_ids'])
        json.dumps(on,allow_nan=False)

    def test_uncalibrated_source_roundtrip_and_engine(self):
        n=512;yy,xx=np.indices((n,n));cal=20/n;center=[n/2,n/2]
        array=np.full((n,n),100.)
        for p in fixture(factor=2.):
            for sign in (-1,1):
                x=center[0]+sign*p['qx']/cal;y=center[1]-sign*p['qy']/cal
                array+=250*np.exp(-((xx-x)**2+(yy-y)**2)/(2*1.3**2))
        with tempfile.TemporaryDirectory() as root:
            from PIL import Image
            path=Path(root)/'pattern.tif';Image.fromarray(array.astype('float32')).save(path)
            store=Path(root)/'calibrations.json';raster_images.save(store,path,array,dict(method='relative_diffraction'))
            saved=raster_images.stored(store,path,array)
            self.assertEqual(saved['units'],'relative')
            engine=Engine(dict(data_root=root,output_root=root))
            item=dict(array=array,info=dict(id='fixture',image_kind='diffraction',width=n,height=n,pixel_x_nm_inv=cal,pixel_y_nm_inv=cal,
                       beam_center=dict(x=n/2,y=n/2),reciprocal_calibrated=False),limits=[100,350])
            roi=dict(x=0,y=0,w=n,h=n)
            result=engine.analyze(item,roi,dict(enabled_phases=['BCC','OMEGA'],material='unknown',g_max=8,diffraction={'exclude_radius_nm_inv':.5,'refine_center':False}),images=False,cache_candidates=True)
            self.assertIn(result['beta_omega']['status'],('beta_omega_candidate','beta_omega_ambiguous'))
            self.assertEqual(result['spectrum']['coordinate_units'],'relative')
            self.assertTrue(result['models'])
            self.assertTrue(all(m.get('fitted_a_nm') is None for m in result['models']))
            self.assertEqual(engine.rescore(result,.5)['beta_omega']['fit']['score'],result['beta_omega']['fit']['score'])
            # Stored pixel anchors survive a stale/renumbered profile ID.
            parent_rows=[a for a in result['beta_omega']['assignments'] if 'beta' in a['compatible_components']]
            a=parent_rows[0]
            b=next(b for b in parent_rows[1:] if joint.spread(np.array([a['observed_q'],b['observed_q']]))>.5)
            anchors=[]
            cx,cy=result['spectrum']['beam_center_px'];sx,sy=result['spectrum']['reciprocal_pixel_size']
            for row in (a,b):
                hkl=next(i['hkl'] for i in row['indices'] if i['component']=='beta')
                anchors.append(dict(profile_id=999,hkl=hkl,detector_position=[cx+row['observed_q'][0]/sx,cy-row['observed_q'][1]/sy]))
            anchored=engine.analyze(item,roi,dict(result['settings'],beta_parent_anchors=anchors),images=False)
            self.assertEqual([a['profile_id'] for a in anchored['beta_omega']['parent']['anchors']],[a['profile_id'],b['profile_id']])
            # Direct rescoring reconsiders parent/subset choices using the same
            # measurements, including detector-bound anchors with stale IDs.
            off=engine.rescore(anchored,0,brightness_weight=0)
            restored=engine.rescore(off,0,brightness_weight=.1)
            self.assertIs(restored['spectrum'],anchored['spectrum'])
            self.assertEqual(restored['classification'],anchored['classification'])
            self.assertEqual(restored['beta_omega']['fit'],anchored['beta_omega']['fit'])
            self.assertEqual(off['settings']['brightness_grouping_weight'],0)
            with self.assertRaises(ValueError):
                engine.validate(item,roi,dict(brightness_grouping_weight=.51))
            # Calibration state never forces a phase search.
            geometry=engine.analyze(item,roi,dict(result['settings'],enabled_phases=['BCC']),images=False)
            self.assertNotIn('beta_omega',geometry)
            self.assertTrue(geometry['models'])
            self.assertEqual([(m['zone_3index'],m['score'],m['predicted_nodes']) for m in geometry['models']],[(m['zone_3index'],m['score'],m['predicted_nodes']) for m in result['models'] if m['phase']=='BCC'])
            self.assertEqual(geometry['spectrum']['coordinate_units'],'relative')
            self.assertFalse(any('nm⁻¹' in flag or 'Prediction scales are fitted' in flag for flag in geometry['classification']['flags']))
            calibrated={**item,'info':{**item['info'],'reciprocal_calibrated':True}}
            combined=engine.analyze(calibrated,roi,dict(result['settings'],enabled_phases=['BCC','OMEGA'],material='unknown',scale_mode='auto_uniform'),images=False,cache_candidates=True)
            self.assertTrue(combined['models'],'The optional linked search retains independent phase candidates')
            self.assertIn('beta_omega',combined)
            rescored=engine.rescore(combined,.2)
            self.assertEqual(rescored['beta_omega']['fit']['score'],combined['beta_omega']['fit']['score'])
            self.assertEqual(rescored['classification'],combined['classification'])
            _,migrated=engine.validate(item,roi,dict(diffraction_model='beta_omega'))
            self.assertEqual(migrated['phase_search_version'],2)
            self.assertNotIn('search_beta_omega',migrated)
            self.assertNotIn('diffraction_model',migrated)
            _,explicit=engine.validate(item,roi,dict(diffraction_model='beta_omega',search_beta_omega=False))
            self.assertNotIn('search_beta_omega',explicit)
