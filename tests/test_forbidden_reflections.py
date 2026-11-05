import copy
import unittest
import numpy as np
from crystal_templates import reciprocal, allowed
from forbidden_reflections import inspect, annotate


def model(phase, zone, indices, a=.33, c=.468, angle=.47):
    h = np.asarray(indices)
    r = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    # Basal zone uses xy, a prismatic zone xz.
    axes = [0, 1] if zone == [0, 0, 1] else [0, 2]
    q = reciprocal(h, phase, a=a, c=c)[:, axes] @ r
    return dict(phase=phase, zone_3index=zone, score=.75, matches=[],
                predicted_nodes=[dict(hkl=i.tolist(), q=v.tolist()) for i, v in zip(h, q)]), r, axes


def peak(h, phase, rotation, axes, a=.33, c=.468, direct=True, offset=(0, 0)):
    q = reciprocal(np.asarray([h]), phase, a=a, c=c)[0, axes] @ rotation + offset
    p = dict(profile_id=1, qx=float(q[0]), qy=float(q[1]))
    if direct:
        p['observed_spots'] = [q.tolist()]
    return p


class ForbiddenReflectionTests(unittest.TestCase):
    def test_centering_rules_with_rotated_scaled_lattice(self):
        for phase, nodes, forbidden in [('BCC', [[1,1,0],[1,-1,0],[2,0,0]], [1,0,0]),
                                        ('FCC', [[2,0,0],[0,2,0],[2,2,0]], [1,1,0])]:
            m, rotation, axes = model(phase,[0,0,1],nodes,a=.51)
            p = peak(forbidden,phase,rotation,axes,a=.51,offset=(.015,-.01))
            report = inspect(m,[p],.1,.2,10)
            self.assertEqual(report['profile_count'],1)
            self.assertEqual(report['hits'][0]['hkl'],forbidden)
            self.assertAlmostEqual(report['hits'][0]['residual_nm_inv'],np.hypot(.015,.01))
            self.assertEqual(report['rule_kind'],'centering')
            self.assertEqual(len(report['hits']),1, 'do not invent opposite direct observation')

    def test_hcp_basis_and_fft_conjugate_count(self):
        m,r,axes = model('HCP',[0,1,0],[[1,0,0],[0,0,2],[1,0,1]],a=.295)
        p = peak([0,0,1],'HCP',r,axes,a=.295,direct=False)
        report = inspect(m,[p],.1,.2,10)
        self.assertEqual(report['profile_count'],1)
        self.assertEqual(len(report['hits']),2)
        self.assertEqual(report['rule_kind'],'basis')

    def test_allowed_assigned_outside_and_no_rules(self):
        m,r,axes = model('BCC',[0,0,1],[[1,1,0],[1,-1,0],[2,0,0]])
        allowed_peak = peak([1,1,0],'BCC',r,axes)
        self.assertEqual(inspect(m,[allowed_peak],.1,.2,10)['hits'],[])
        p = peak([1,0,0],'BCC',r,axes)
        self.assertEqual(inspect(m,[p],.1,4,10)['hits'],[])
        self.assertEqual(inspect(m,[p],.1,.2,2)['hits'],[])
        m['matches']=[dict(profile_id=1)]
        self.assertEqual(inspect(m,[p],.1,.2,10)['hits'],[])
        self.assertEqual(inspect(dict(phase='ORT'),[p],.1,.2,10)['status'],'not_applicable')

    def test_legacy_nodes_without_indices_are_unavailable(self):
        m = dict(phase='BCC', predicted_nodes=[{'q': [1, 0]}, {'q': [0, 1]}])
        self.assertEqual(inspect(m, [], .1, 2.5, 10)['status'], 'unavailable')

    def test_diagnostic_does_not_change_fit(self):
        m,r,axes = model('BCC',[0,0,1],[[1,1,0],[1,-1,0],[2,0,0]])
        before=copy.deepcopy(m)
        annotate([m],dict(peaks=[peak([1,0,0],'BCC',r,axes)]),.1,.2,10)
        self.assertEqual(m.pop('forbidden_reflections')['profile_count'],1)
        self.assertEqual(m,before)

    def test_zone_constraint_and_skew_projection(self):
        # A non-Cartesian zone requires checking h+k+l=0, not rounding each
        # inferred index independently and assuming it belongs to the zone.
        m,_,_=model('BCC',[0,0,1],[[1,1,0],[1,-1,0],[2,0,0]])
        m['zone_3index']=[1,1,0]
        m['predicted_nodes']=[dict(hkl=[1,-1,0],q=[3,1]),dict(hkl=[0,0,2],q=[1,4]),dict(hkl=[1,-1,2],q=[4,5])]
        p=dict(profile_id=2,qx=.51,qy=2.,observed_spots=[[.51,2.]])
        report=inspect(m,[p],.1,.1,10)
        self.assertEqual(report['hits'][0]['hkl'],[0,0,1])
        for hit in report['hits']:
            self.assertFalse(allowed(np.array([hit['hkl']]),'BCC')[0])


if __name__ == '__main__':
    unittest.main()
