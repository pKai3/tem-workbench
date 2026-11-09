import copy
import json
import unittest
from unittest.mock import patch

import numpy as np

import analysis_core as core
import spot_intensity
from engine import Engine


class FFTBrightnessTests(unittest.TestCase):
    def test_native_power_integrals_gain_conjugates_and_brightness_ids(self):
        n=256; y,x=np.indices((n,n))
        image=4*np.cos(2*np.pi*(30*x+10*y)/n)+np.cos(2*np.pi*(45*x-35*y)/n)
        a=core.spectrum(image,.03,.03,profile_fraction=.15)
        b=core.spectrum(3*image+70,.03,.03,profile_fraction=.15)
        self.assertEqual(len(a['peaks']),2)
        ranked=sorted(a['peaks'],key=lambda p:p['profile_id'])
        self.assertGreater(ranked[0]['integrated_intensity'],ranked[1]['integrated_intensity'])
        self.assertAlmostEqual(ranked[0]['integrated_intensity']/ranked[1]['integrated_intensity'],16,delta=.1)
        for peak in a['peaks']:
            self.assertTrue(peak['intensity_reliable'])
            self.assertEqual(peak['intensity_observation_count'],2)
            records=peak['spot_measurements']
            self.assertAlmostEqual(records[0]['integrated_intensity']/records[1]['integrated_intensity'],1,places=5)
            self.assertAlmostEqual(peak['integrated_intensity'],sum(m['integrated_intensity'] for m in records)/2)
            self.assertFalse(any('at_image_maximum' in m['flags'] for m in records))
            other=min(b['peaks'],key=lambda p:abs(p['g_nm_inv']-peak['g_nm_inv']))
            self.assertAlmostEqual(other['integrated_intensity']/peak['integrated_intensity'],9,delta=.002)
            self.assertNotIn('_fft_position_px',peak)
        self.assertEqual(a['profile_numbering'],'integrated_intensity_descending')
        self.assertEqual(a['photometry']['units'],'FFT power × bins')
        json.dumps(a['peaks'],allow_nan=False)

    def test_incomplete_fft_apertures_are_flagged(self):
        n=64;y,x=np.indices((n,n));power=20+100*np.exp(-((x-1)**2+(y-30)**2)/2)
        fx=np.fft.fftshift(np.fft.fftfreq(n));fy=-fx
        peaks=[dict(profile_id=1,qx=float(fx[1]),qy=float(fy[30]),profile_area_bins=9)]
        spot_intensity.measure_fft(power,fx,fy,peaks,1.44)
        self.assertFalse(peaks[0]['intensity_reliable'])
        self.assertTrue(any('aperture_clipped' in m['flags'] for m in peaks[0]['spot_measurements']))

    def test_fft_phase_grouping_and_cached_grid_reweight_reuse_measurements(self):
        engine=Engine({});n=384;pixel=.025;y,x=np.indices((n,n));image=np.zeros((n,n))
        for phase,amplitude,angle in [('FCC',4.,.25),('HCP',1.,1.05)]:
            template=next(t for t in engine.templates if t['phase']==phase and t['zone_3index']==[0,0,1] and t['mirror']==1)
            q=core.rotation(template['q'],angle)
            for qx,qy in q[(np.linalg.norm(q,axis=1)>2.5)&(np.linalg.norm(q,axis=1)<9)]:
                image+=amplitude*np.cos(2*np.pi*pixel*(qx*x-qy*y))
        item=dict(array=image.astype(np.float32),info=dict(image_kind='real_space',pixel_x_nm=pixel,pixel_y_nm=pixel),limits=[-40,40])
        roi=dict(x=0,y=0,w=n,h=n)
        settings=dict(enabled_phases=['FCC','HCP'],scale_mode='fixed',g_min=2.5,g_max=10,
                      fft_minimum_separation=.2,fft_minimum_enrichment=1.8,threshold=.15,brightness_grouping_weight=.1)
        result=engine.analyze(item,roi,settings,images=False,cache_candidates=True)
        combined=result['classification']['combined_fit']
        self.assertTrue(result['classification']['combined_fit_selected'])
        self.assertGreater(combined['brightness_bonus'],0.)
        levels={g['phase']:g['relative_level'] for g in combined['brightness_grouping']['groups']}
        self.assertGreater(levels['FCC'],8*levels['HCP'])
        peaks=result['spectrum']['peaks'];original=copy.deepcopy(peaks)
        ids={p['profile_id'] for p in peaks}
        self.assertEqual(ids,set(range(1,len(peaks)+1)))
        self.assertEqual([p['profile_id'] for p in sorted(peaks,key=lambda p:p['integrated_intensity'],reverse=True)],list(range(1,len(peaks)+1)))
        for model in result['models']+[combined]:
            self.assertTrue(all(m['profile_id'] in ids for m in model['matches']))
        with patch.object(core,'spectrum',side_effect=AssertionError('Cached reweight must not repeat the FFT')):
            off=engine.rescore(result,.1,brightness_weight=0)
            restored=engine.rescore(off,.1,brightness_weight=.1)
        self.assertTrue(off['classification']['combined_fit_selected'])
        self.assertEqual(off['classification']['combined_fit']['brightness_bonus'],0.)
        self.assertEqual(restored['classification'],result['classification'])
        self.assertEqual(peaks,original)
        self.assertIs(restored['spectrum'],result['spectrum'])
        fresh_off=engine.analyze(item,roi,{**settings,'brightness_grouping_weight':0},images=False)
        self.assertEqual(off['classification'],fresh_off['classification'])
        self.assertEqual(off['spectrum']['peaks'],fresh_off['spectrum']['peaks'])


if __name__=='__main__':
    unittest.main()
