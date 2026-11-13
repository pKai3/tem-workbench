"""Distinct lattice hypotheses must differ geometrically, not just in peak IDs."""
import copy
import unittest
import numpy as np
from tem_workbench.analysis import analysis_core as core


POINTS = np.array([[3.,0.], [0.,4.], [3.,4.], [6.,0.], [6.,4.],
                   [0.,8.], [3.,8.], [9.99,0.], [0.,9.99]])


def candidate(score=.5142, angle=50., scale=1., ids=range(9), band=(2.5,10.)):
    q = core.rotation(POINTS*scale,np.radians(angle))
    q = q[(np.linalg.norm(q,axis=1)>=band[0])&(np.linalg.norm(q,axis=1)<=band[1])]
    return dict(phase='HCP',zone_3index=[0,1,-1],rotation_deg=angle,score=score,
                matches=[dict(profile_id=i) for i in ids],
                predicted_nodes=[dict(q=p.tolist(),hkl=[i,0,0]) for i,p in enumerate(q)],
                position_matching=dict(distance_scale_nm_inv=.12),fitting_band_nm_inv=list(band))


class CandidateRetentionTests(unittest.TestCase):
    def test_nine_and_seven_match_subsets_keep_the_better_geometry(self):
        best=candidate();worse=candidate(.4903,angle=50.1,ids=range(7))
        before=copy.deepcopy([worse,best])
        self.assertEqual(core.retain([worse,best]),[best])
        self.assertEqual([worse,best],before)  # no union or mutation of evidence

    def test_small_cell_change_at_band_boundary_does_not_make_a_new_fit(self):
        best=candidate();worse=candidate(.4903,scale=1.005,ids=range(7))
        self.assertEqual([len(c['predicted_nodes']) for c in (best,worse)],[9,7])
        self.assertTrue(core.same_solution(best,worse))
        self.assertTrue(core.same_solution(worse,best))
        self.assertEqual(core.retain([worse,best]),[best])

    def test_resolved_rotation_and_scale_survive_even_with_identical_peak_ids(self):
        best=candidate()
        for other in (candidate(.49,angle=52.),candidate(.49,scale=1.02)):
            with self.subTest(angle=other['rotation_deg']):
                self.assertEqual(core.retain([other,best]),[best,other])
        anisotropic=candidate(.48)
        for node in anisotropic['predicted_nodes']: node['q'][1]*=1.03
        self.assertFalse(core.same_solution(best,anisotropic))

    def test_antipodal_permutation_and_reindexing_are_not_new_geometry(self):
        best=candidate();copy_fit=candidate(.49,angle=230.,ids=range(7))
        copy_fit['predicted_nodes'].reverse()
        self.assertEqual(core.retain([copy_fit,best]),[best])

    def test_phase_zone_and_related_components_remain_alternatives(self):
        best=candidate()
        for update in (dict(phase='OMEGA'),dict(zone_3index=[0,1,0]),
                       dict(related_pattern=True,component_ids=['beta','omega1'])):
            other={**candidate(.49),**update}
            self.assertFalse(core.same_solution(best,other))
        a={**best,'related_pattern':True,'component_ids':['beta','omega1']}
        b={**candidate(.49),'related_pattern':True,'component_ids':['beta','omega2']}
        self.assertFalse(core.same_solution(a,b))

    def test_missing_interior_prediction_is_not_ignored(self):
        best=candidate();subset=candidate(.49)
        subset['predicted_nodes'].pop(3)
        self.assertFalse(core.same_solution(best,subset))
        self.assertFalse(core.same_solution(subset,best))

    def test_pairs_are_one_to_one(self):
        best=candidate();other=candidate(.49)
        other['predicted_nodes'][3]=copy.deepcopy(other['predicted_nodes'][2])
        self.assertFalse(core.same_solution(best,other))

    def test_boundary_exception_requires_known_common_band(self):
        best=candidate();other=candidate(.49,scale=1.005)
        del other['fitting_band_nm_inv']
        self.assertFalse(core.same_solution(best,other))
        other['fitting_band_nm_inv']=[2.5,9.95]
        self.assertFalse(core.same_solution(best,other))

    def test_one_width_is_inclusive_and_uses_the_smaller_width(self):
        best=candidate();other=candidate(.49)
        best.pop('fitting_band_nm_inv');other.pop('fitting_band_nm_inv')
        # A uniform translation is only a controlled geometry perturbation here.
        for node in other['predicted_nodes']: node['q'][0]+=.12
        self.assertTrue(core.same_solution(best,other))
        other['position_matching']['distance_scale_nm_inv']=.10
        self.assertFalse(core.same_solution(best,other))

    def test_comparison_follows_coordinate_units(self):
        best=candidate();other=candidate(.49,scale=1.005,ids=range(7))
        for model in (best,other):
            for node in model['predicted_nodes']:node['q']=(np.array(node['q'])*7).tolist()
            model['position_matching']['distance_scale_nm_inv']*=7
            model['fitting_band_nm_inv']=(np.array(model['fitting_band_nm_inv'])*7).tolist()
        self.assertTrue(core.same_solution(best,other))

    def test_neighbour_chain_does_not_merge_distinct_endpoints(self):
        a=candidate(.6,angle=50.);b=candidate(.5,angle=50.5);c=candidate(.4,angle=51.)
        self.assertTrue(core.same_solution(a,b));self.assertTrue(core.same_solution(b,c))
        self.assertFalse(core.same_solution(a,c))
        self.assertEqual(core.retain([c,b,a]),[a,c])


if __name__=='__main__':unittest.main()
