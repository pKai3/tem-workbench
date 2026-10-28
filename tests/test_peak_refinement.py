"""Focused checks for evidence bookkeeping and optional child refinement."""
import copy
import threading
import unittest
from types import SimpleNamespace
import numpy as np
import peak_evidence
import adaptive_refinement as adaptive
from server import Workbench


def model(phase='HCP', zone=(1, -1, 0), score=.7, valid=True):
    return dict(phase=phase, zone_3index=list(zone), score=score, valid=valid, coverage=.8)


class EvidenceChecks(unittest.TestCase):
    def test_weak_assignment_is_one_to_one_and_phase_neutral(self):
        nodes = [dict(q=q) for q in ([4., 1.], [4.3, 1.], [0., 6.], [9.95, 0.])]
        source = dict(predicted_nodes=nodes, matches=[dict(node_index=2)],
                      position_score=.7, position_valid=True, scale_penalty=.05)
        context = dict(radius=.2, x_limit=10.5, y_limit=10.5, maxima=[
            dict(q=[-4.15, -1.], strength=.4, weak_id=1, local_contrast=3.4, enrichment=2.2)])
        a=peak_evidence.inspect({**copy.deepcopy(source), 'phase':'HCP'}, context)
        b=peak_evidence.inspect({**copy.deepcopy(source), 'phase':'BCC'}, context)
        self.assertEqual(a['peak_evidence'], b['peak_evidence'])
        self.assertEqual([a['peak_evidence'][k] for k in ('detected_count','weak_count','unsupported_count','unassessable_count')], [1,1,1,1])
        peak_evidence.apply(a, .1)
        self.assertGreater(a['missing_peak_penalty'], 0)
        original=copy.deepcopy(a)
        peak_evidence.apply(a, .1)
        self.assertEqual(a,original)
        peak_evidence.apply(a, 0)
        self.assertAlmostEqual(a['score'], .65)
        a['position_valid']=False
        peak_evidence.apply(a, .5)
        self.assertFalse(a['valid'])

    def test_child_comparison_never_uses_parent_score(self):
        parent=dict(classification=dict(primary_model=model(score=.99)))
        alternative=model(zone=(0,1,0), score=.7)
        child=dict(id='child',settings={},classification=dict(label='hcp_compatible',primary_model=alternative))
        for score, expected in ((.55,True),(.68,False)):
            engine=SimpleNamespace(cached_models=lambda *_: [model(score=score)])
            self.assertEqual(adaptive.review(parent,[child],engine)['retain_children'],expected)
            parent['classification']['primary_model']['score']=.01
            self.assertEqual(adaptive.review(parent,[child],engine)['retain_children'],expected)
        child['classification']['primary_model']=model(score=.99)
        self.assertFalse(adaptive.review(parent,[child],engine)['retain_children'])
        child['classification']['label']='ambiguous'
        self.assertFalse(adaptive.review(parent,[child],engine)['retain_children'])
        child['classification']['label']='coexisting_candidates'
        self.assertTrue(adaptive.review(parent,[child],engine)['retain_children'])


    def test_mixed_child_assignability_retains_children(self):
        parent = dict(classification=dict(primary_model=model()))
        engine = SimpleNamespace(cached_models=lambda *_: [model()])
        def child(index, label):
            return dict(id=str(index), settings={}, classification=dict(
                label=label, primary_model=model(valid=label in adaptive.PASSING)))
        for labels, expected in [
            (['hcp_compatible', 'hcp_compatible', 'unresolved', 'insufficient'], True),
            (['hcp_compatible', 'ambiguous', 'ambiguous', 'ambiguous'], True),
            (['unresolved', 'insufficient', 'unresolved', 'insufficient'], False),
            (['hcp_compatible'] * 4, False),
        ]:
            with self.subTest(labels=labels):
                children = [child(i, label) for i, label in enumerate(labels)]
                decision = adaptive.review(parent, children, engine)
                self.assertEqual(decision['retain_children'], expected)
                self.assertEqual(decision['passing_children'], labels.count('hcp_compatible'))
                # A partial trial must not replace its parent.
                if expected:
                    self.assertFalse(adaptive.review(parent, children[1:], engine)['retain_children'])


class FakeEngine:
    def __init__(self, interrupt=False, mixed=False):
        self.mixed=mixed;self.interrupt=interrupt;self.waiting=threading.Event();self.release=threading.Event()
    def analyze(self,item,roi,settings,**kwargs):
        if self.interrupt and roi['w']==32:
            self.waiting.set()
            if not self.release.wait(2):raise RuntimeError('Test timeout')
        alternative=not self.mixed and roi['w']==32 and roi['x']==0 and roi['y']==0
        primary=model(zone=(0,1,0) if alternative else (1,-1,0))
        label='unresolved' if self.mixed and roi['w']==32 and roi['x']<64 and roi['y']==32 else 'hcp_compatible'
        primary['valid']=label in adaptive.PASSING
        return dict(roi=roi,settings=settings,models=[primary],elapsed_ms=1,
                    classification=dict(label=label,primary_model=primary),
                    periodicity=dict(substantial_second_pattern=False),_fit_cache=b'cached')
    def cached_models(self,*_):return [model(score=.4)]


class GridChecks(unittest.TestCase):
    def run_grid(self, interrupt=False, enabled=True, mixed=False):
        app=Workbench.__new__(Workbench);app.engine=FakeEngine(interrupt,mixed)
        app.jobs={};app.lock=threading.Lock();app.job_lock=threading.RLock()
        item={'info':dict(width=128,height=128,pixel_x_nm=.05,pixel_y_nm=.05,can_index=True)}
        # Execute the worker with a tracked thread, without starting an HTTP server.
        original=threading.Thread;threads=[]
        def thread(*args,**kwargs):
            result=original(*args,**kwargs);threads.append(result);return result
        from unittest.mock import patch
        with patch('server.threading.Thread',thread):
            job_id=app.grid(item,dict(scale_mode='fixed'),2,True,1.,enabled)['id']
        if interrupt:
            self.assertTrue(app.engine.waiting.wait(2))
            app.jobs[job_id]['cancel']=True;app.engine.release.set()
        threads[0].join(3)
        self.assertFalse(threads[0].is_alive())
        return app.jobs[job_id]

    def test_children_replace_parent_only_when_useful_and_area_is_preserved(self):
        job=self.run_grid()
        self.assertEqual(job['state'],'complete')
        self.assertEqual(job['lookahead'],dict(checked=4,refined=1,retained=3))
        leaves=[r for r in job['regions'] if r['leaf']]
        self.assertEqual(len(leaves),7)
        self.assertEqual(sum(r['roi']['w']*r['roi']['h'] for r in leaves),128**2)
        self.assertTrue(all(not r['leaf'] for r in job['regions'] if r['trial_only']))
        off=self.run_grid(enabled=False)
        self.assertEqual(off['processed'],4)

    def test_mixed_children_replace_passing_parent_without_losing_area(self):
        job=self.run_grid(mixed=True)
        leaves=[r for r in job['regions'] if r['leaf']]
        self.assertEqual(job['state'],'complete')
        self.assertEqual(job['lookahead'],dict(checked=4,refined=1,retained=3))
        self.assertEqual(len(leaves),7)
        self.assertEqual(sum(r['roi']['w']*r['roi']['h'] for r in leaves),128**2)
        self.assertEqual(sum(r['classification']['label']=='unresolved' for r in leaves),2)
        decision=next(r['lookahead'] for r in job['regions'] if r.get('lookahead',{}).get('retain_children'))
        self.assertEqual((decision['passing_children'],decision['unassigned_children']),(2,2))

    def test_cancel_during_child_trial_retains_parent(self):
        job=self.run_grid(interrupt=True)
        self.assertEqual(job['state'],'cancelled')
        leaves=[r for r in job['regions'] if r['leaf']]
        self.assertEqual(len(leaves),4)
        self.assertEqual(sum(r['roi']['w']*r['roi']['h'] for r in leaves),128**2)
        self.assertTrue(all(r.get('lookahead',{}).get('state')=='incomplete' for r in leaves))


if __name__=='__main__':unittest.main()
