"""Live snapshots must not leak mutable search records or lose completed windows."""
import json
import threading
import time
import unittest
from unittest.mock import patch
from concurrent.futures import CancelledError
import pca_fitting as fitting
import shared_spectra as spectra
from test_pca_combinations import split_pattern, OPTIONS


class LiveSpectraTests(unittest.TestCase):
    def manager(self):
        result,templates=split_pattern()
        manager=spectra.SharedSpectra();manager.result=result
        manager.job=dict(id='test',state='complete',started=time.monotonic())
        return manager,result,templates

    def test_source_snapshots_are_json_safe_and_immutable_during_search(self):
        manager,result,templates=self.manager()
        fit=fitting.fit_features;ready=threading.Event();release=threading.Event()
        def paused(result,templates,options,cancel,progress):
            def report(done,total,stage):
                manager.last_publish=0.;progress(done,total,stage)
                if done==5:
                    ready.set()
                    if not release.wait(10):raise TimeoutError('Test did not release search')
            return fit(result,templates,options,cancel,report)
        with patch.object(fitting,'fit_features',side_effect=paused):
            manager.fit('test',templates,OPTIONS)
            try:
                self.assertTrue(ready.wait(5))
                update=manager.live('test');saved=json.dumps(update,allow_nan=False)
                self.assertEqual(update['fits']['completed'],5)
                self.assertEqual(update['fits']['groups'][-1]['completed_windows'],1)
                self.assertTrue(update['fits']['groups'][-1]['candidates'])
                self.assertFalse(manager.live('test',update['revision'])['changed'])
                readable=manager.inspectable('test')
                detail=fitting.combination_detail(readable,[0,1],0,templates)
                self.assertTrue(detail['candidates'])
                with self.assertRaises(ValueError):manager.fit('test',templates,OPTIONS)
                with self.assertRaises(ValueError):manager.live('replaced')
            finally:
                release.set();manager.thread.join(10)
        self.assertEqual(saved,json.dumps(update,allow_nan=False))
        self.assertEqual(result['fits']['completed'],8)
        self.assertEqual(manager.live('test')['fit_status'],'complete')

    def test_support_deltas_and_cancel_flush_every_completed_window(self):
        manager,result,templates=self.manager()
        manager.fit('test',templates,OPTIONS);manager.thread.join(10)
        ready=threading.Event();release=threading.Event()
        def paused(result,templates,cancel,progress,publish):
            maps=dict(models=[],windows=[],counts={'unresolved':0})
            publish(maps)
            # A completed window arrives inside the publication throttle interval.
            manager.last_publish=time.monotonic()+100
            maps['windows'].append(dict(index=0,label='unresolved',candidates=[]))
            maps['counts']['unresolved']=1
            publish(maps);progress(1,4,'Checking')
            ready.set()
            if not release.wait(10):raise TimeoutError('Test did not release checks')
            if cancel.is_set():raise CancelledError()
            return maps
        with patch.object(fitting,'build',side_effect=paused):
            manager.support('test',templates)
            try:
                self.assertTrue(ready.wait(2))
                first=manager.live('test');maps=first['phase_support']
                self.assertEqual(maps['windows'],[])
                self.assertEqual(maps['counts']['unresolved'],0)
                manager.cancel.set()
            finally:
                release.set();manager.thread.join(10)
        final=manager.live('test',first['revision'],0,maps['generation'])
        self.assertEqual(final['phase_support_status'],'cancelled')
        self.assertEqual(len(final['phase_support']['windows']),1)
        self.assertEqual(result['phase_support']['completed'],1)
        self.assertEqual(result['phase_support']['total'],4)
        self.assertIsNone(manager.pending_support)
        self.assertEqual(maps['windows'],[],'published snapshots cannot change underneath a reader')
        suffix=manager.live('test',-1,1,maps['generation'])['phase_support']
        self.assertEqual(suffix['windows'],[]);self.assertEqual(suffix['window_offset'],1)
        reset=manager.live('test',-1,1,'older-run')['phase_support']
        self.assertEqual(reset['window_offset'],0);self.assertEqual(len(reset['windows']),1)
        json.dumps(final,allow_nan=False)


if __name__=='__main__':unittest.main()
