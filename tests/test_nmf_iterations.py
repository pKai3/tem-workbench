"""Iteration budgets preserve defaults, early stopping, cancellation and provenance."""
from concurrent.futures import CancelledError
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import numpy as np
from tem_workbench.components import shared_spectra as spectra, component_grid
from test_shared_spectra import INFO, SETTINGS, OPTIONS
from tools.nmf_iteration_comparison import compare_windows, compare_aggregates, window_metrics, winners


class NmfIterationTests(unittest.TestCase):
    def test_default_is_identical_to_explicit_300_and_longer_runs_keep_improving(self):
        rng=np.random.default_rng(28)
        x=(rng.random((40,4))@rng.random((4,100))+.02*rng.random((40,100))).astype(np.float32)
        default=spectra.decompose_nmf(x,4)
        explicit=spectra.decompose_nmf(x,4,iterations=300)
        for key in ('components','scores','residual'):
            np.testing.assert_array_equal(default[key],explicit[key])
        progress=[]
        longer=spectra.decompose_nmf(x,4,iterations=305,progress=lambda *args:progress.append(args))
        self.assertEqual(longer['iteration_limit'],305)
        self.assertEqual(longer['iterations'],305)
        self.assertEqual(progress[-1][:2],(305,305))
        self.assertLess(longer['relative_reconstruction_error'],default['relative_reconstruction_error'])

    def test_early_stopping_and_cancellation_still_apply(self):
        x=np.random.default_rng(3).random((30,100)).astype(np.float32)
        result=spectra.decompose_nmf(x,1,iterations=3000)
        self.assertTrue(result['converged'])
        self.assertLess(result['iterations'],3000)
        stop=threading.Event()
        def progress(*_):stop.set()
        with self.assertRaises(CancelledError):
            spectra.decompose_nmf(x,4,stop,progress,iterations=3000)

    def test_short_final_interval_does_not_claim_ten_step_convergence(self):
        x=np.random.default_rng(4).random((12,30)).astype(np.float32)
        errors=[np.full(len(x),value/len(x)) for value in (100,99,98,97,96,95.99999,95.99999)]
        for limit,expected in ((51,False),(60,True)):
            with self.subTest(limit=limit),patch.object(spectra,'reconstruction_errors',side_effect=errors):
                result=spectra.decompose_nmf(x,2,iterations=limit)
            self.assertEqual(result['iterations'],limit)
            self.assertEqual(result['converged'],expected)

    def test_validation_and_pca_isolation(self):
        for bad in (True,False,np.bool_(True),None,[],0,-1,10001,300.5,float('nan'),float('inf'),'bad'):
            with self.subTest(value=bad),self.assertRaisesRegex(ValueError,'NMF iteration limit'):
                spectra.plan(INFO,SETTINGS,{**OPTIONS,'method':'nmf','nmf_max_iterations':bad})
        self.assertEqual(spectra.plan(INFO,SETTINGS,{**OPTIONS,'method':'nmf'})['nmf_max_iterations'],300)
        self.assertNotIn('nmf_max_iterations',spectra.plan(INFO,SETTINGS,{**OPTIONS,'method':'pca','nmf_max_iterations':'bad'}))
        options,_,_=component_grid.options_for(INFO,{'window_nm':5.12,'spacing_nm':2.56},
                                               {'method':'nmf','options':{'nmf_max_iterations':3000}},1)
        self.assertEqual(spectra.plan(INFO,SETTINGS,options)['nmf_max_iterations'],3000)

    def test_sampling_summary_and_export_keep_requested_and_actual_limits(self):
        info={**INFO,'width':128,'height':128}
        image=np.random.default_rng(8).normal(size=(128,128)).astype(np.float32)
        result=spectra.compute(image,info,SETTINGS,dict(method='nmf',window_nm=1.28,spacing_nm=1.28,components=2,nmf_max_iterations=60))
        self.assertEqual(result['plan']['nmf_max_iterations'],60)
        self.assertEqual(result['iteration_limit'],60)
        self.assertLessEqual(result['iterations'],60)
        self.assertEqual(spectra.summary(result)['iteration_limit'],60)
        with tempfile.TemporaryDirectory() as folder,patch.object(spectra,'export_staging_root',return_value=Path(folder)/'stage'):
            files=spectra.export(result,Path(folder)/'export')['files']
            meta=json.loads(Path(files[1]).read_text())
            self.assertEqual(meta['iteration_limit'],60)
            self.assertEqual(meta['plan']['nmf_max_iterations'],60)
            self.assertEqual(meta['iterations'],result['iterations'])
            with np.load(files[0],allow_pickle=False) as saved:
                self.assertEqual(json.loads(str(saved['metadata'])),meta)

    def test_comparison_uses_passing_evidence_and_handles_gains_and_losses(self):
        fit=lambda model,phase,score,valid=True:dict(model=model,phase=phase,score=score,valid=valid)
        maps=dict(windows=[dict(candidates=[fit(0,'BCC',.9,False),fit(1,'HCP',.5)]),dict(candidates=[])])
        self.assertEqual(winners(maps,[0]),[None,None])
        self.assertEqual(window_metrics(winners(maps,[0,1]))['winning_phases'],{'HCP':1})
        before=[None,fit(0,'HCP',.6),fit(1,'BCC',.8),fit(2,'HCP',.5)]
        after=[fit(5,'BCC',.4),None,fit(9,'HCP',.9),fit(8,'HCP',.5)]
        compared=compare_windows(before,after)
        self.assertEqual([compared[k] for k in ('gained','lost','changed_winning_phase','rank_improved','rank_worsened')],[1,1,1,2,1])
        self.assertAlmostEqual(compared['mean_best_passing_rank_change'],-.025)

    def test_continuous_comparison_keeps_grid_and_phase_alignment(self):
        a=dict(keys=['HCP'],cells=[dict(x=0,y=0,phases={'HCP':dict(support=.4,passing_strength=.2)})])
        b=dict(keys=['BCC'],cells=[dict(x=0,y=0,phases={'BCC':dict(support=.8,passing_strength=.3)})])
        compared=compare_aggregates(a,b)
        self.assertEqual(compared['HCP']['support']['mean_absolute_change'],.4)
        self.assertEqual(compared['BCC']['passing_strength']['max_absolute_change'],.3)
        b['cells'][0]['x']=1
        with self.assertRaisesRegex(ValueError,'grids differ'):compare_aggregates(a,b)


if __name__=='__main__':unittest.main()
