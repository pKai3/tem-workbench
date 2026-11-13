"""A page is an observer: analysis stages continue without a connected viewer."""
import copy
import json
import threading
import unittest
from unittest.mock import patch
from tem_workbench.components import shared_spectra as spectra
from tem_workbench.components import pca_fitting as fitting
from test_pca_combinations import split_pattern, OPTIONS
from test_shared_spectra import INFO, SETTINGS, OPTIONS as SAMPLING


class RetainedRunTests(unittest.TestCase):
    def test_automatic_pipeline_retains_source_and_is_readable_without_viewer(self):
        result,templates=split_pattern();manager=spectra.SharedSpectra()
        self.assertIsNone(manager.current())
        viewer=dict(file_id='source-a',settings=copy.deepcopy(SETTINGS),options=SAMPLING,fit_options=OPTIONS)
        entered=threading.Event();release=threading.Event();workers=[];fit=fitting.fit_features;build=fitting.build
        def paused(*args):
            workers.append(threading.get_ident());entered.set()
            if not release.wait(5):raise TimeoutError('Test did not release fit')
            return fit(*args)
        def checked(*args):
            workers.append(threading.get_ident());return build(*args)
        with patch.object(spectra,'compute',return_value=result),patch.object(fitting,'fit_features',side_effect=paused),patch.object(fitting,'build',side_effect=checked):
            job=manager.start(dict(info=INFO,array=None),SETTINGS,SAMPLING,'/tmp',viewer,dict(templates=templates,options=OPTIONS))
            viewer['file_id']='source-b'
            try:
                self.assertTrue(entered.wait(2))
                current=manager.current();self.assertEqual(current['viewer']['file_id'],'source-a')
                self.assertEqual(current['job']['operation'],'fit');self.assertTrue(current['job']['automatic'])
                self.assertTrue(current['job']['has_result']);json.dumps(current,allow_nan=False)
                self.assertEqual(manager.inspectable(job['id'])['fit_status'],'running')
                with self.assertRaises(ValueError):manager.fit(job['id'],templates,OPTIONS)
                current['viewer']['settings']['g_min']=100
                self.assertEqual(manager.current()['viewer']['settings']['g_min'],2.5)
            finally:release.set();manager.thread.join(10)
        self.assertFalse(manager.running());self.assertEqual(workers[0],workers[1])
        self.assertEqual(manager.current()['job']['state'],'complete')
        final=manager.completed(job['id']);self.assertEqual(final['phase_support_status'],'complete')
        self.assertEqual(len(final['phase_support']['windows']),4)
        with self.assertRaises(ValueError):manager.inspectable('replaced-id')

    def test_cancellation_between_stages_is_not_reset(self):
        result,templates=split_pattern();manager=spectra.SharedSpectra();fit=fitting.fit_features
        def cancelled(*args):
            fits=fit(*args);manager.cancel.set();return fits
        with patch.object(spectra,'compute',return_value=result),patch.object(fitting,'fit_features',side_effect=cancelled),patch.object(fitting,'build') as build:
            job=manager.start(dict(info=INFO,array=None),SETTINGS,SAMPLING,'/tmp',{},dict(templates=templates,options=OPTIONS))
            manager.thread.join(10)
        build.assert_not_called();self.assertEqual(manager.status(job['id'])['state'],'cancelled')
        self.assertEqual(manager.inspectable(job['id'])['fit_status'],'complete')
        self.assertTrue(manager.current()['job']['has_result'])

if __name__=='__main__':unittest.main()
