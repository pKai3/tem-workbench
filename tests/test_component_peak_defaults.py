"""Component peak defaults and the native FFT positional allowance."""
import unittest
import numpy as np
import analysis_core as core
import nmf_fitting as fitting
import pca_fitting as pca
import shared_spectra as spectra
from test_pca_fitting import synthetic


class ComponentPeakDefaultsTests(unittest.TestCase):
    def test_default_rejects_weak_background_maxima_without_dropping_lattice_peaks(self):
        result,_,_=synthetic()
        signal=np.zeros((spectra.RADIAL_BINS,spectra.ANGULAR_BINS))
        # Resolved strong spots plus weaker isolated maxima around the same ring.
        signal[65,::7]=.25
        signal[65,::28]=1.
        result['settings']['fft_minimum_separation']=.1
        old=fitting.detect_peaks(signal,result,.2)
        default=fitting.detect_peaks(signal,result,pca.validate_options(result,{}))
        self.assertGreater(len(old),3*len(default))
        self.assertEqual(len(default),len(signal[65,::28]))
        self.assertTrue(all(p['relative_strength']==1. for p in default))
        self.assertEqual(pca.validate_options(result,{'peak_fraction':.2}),.2)
        result['plan']['method']='nmf'
        self.assertEqual(fitting.validate_options(result,{}),pca.DEFAULT_PEAK_FRACTION)

    def test_width_agrees_with_normal_fft_for_all_tapers_and_anisotropic_pixels(self):
        result,_,_=synthetic()
        rng=np.random.default_rng(4)
        shape=(96,128);sx,sy=.04,.05
        image=rng.normal(size=shape)
        result['plan'].update(window_pixels=[128,96],window_nm=[128*sx,96*sy])
        for taper in ('hann','none','tukey'):
            for alpha in (.2,.8):
                result['settings'].update(fft_window=taper,fft_tukey_alpha=alpha)
                ordinary=core.spectrum(image,sx,sy,window=taper,tukey_alpha=alpha,g_min=2.5,g_max=9.)
                expected=core.matching_parameters(ordinary)['distance_scale_nm_inv']
                self.assertAlmostEqual(fitting.matching_width(result),expected,places=12)
                result['plan'].update(angular_sigma_deg=5,spacing_sigma_percent=5)
                self.assertEqual(fitting.matching_width(result),expected)

    def test_hann_response_counts_modest_displacement_but_not_search_tail(self):
        result,_,_=synthetic();result['settings'].update(fft_window='hann',scale_mode='fixed')
        q=np.array([[3.,0.],[0.,4.],[3.,4.],[6.,0.],[6.,4.],[0.,8.]])
        model=dict(phase='BCC',predicted_nodes=[dict(q=v.tolist(),hkl=[i,0,0]) for i,v in enumerate(q)],scale_penalty=0.)
        df=1/min(result['plan']['window_nm'])
        def peaks(distance):
            shifted=q+distance*q/np.linalg.norm(q,axis=1)[:,None]
            return [dict(profile_id=i,qx=v[0],qy=v[1],weight=1.) for i,v in enumerate(shifted)]
        observed=peaks(1.2*df)
        old=pca.match_local(observed,model,df,result['settings'])
        self.assertFalse(old['valid']);self.assertEqual(old['profiles'],[])
        new=pca._local(result,observed,model)
        self.assertTrue(new['valid']);self.assertEqual(len(new['profiles']),6)
        far=pca._local(result,peaks(2*fitting.matching_width(result)),model)
        self.assertFalse(far['valid']);self.assertEqual(far['profiles'],[])
        self.assertGreater(len(far['match']['matches']),0)

    def test_native_noise_windows_do_not_support_a_fixed_lattice(self):
        result,templates,_=synthetic();result['settings']['fft_window']='hann'
        pca.fit_lobes(result,templates,{})
        model=pca.unique_models(result)[0]
        rng=np.random.default_rng(149)
        for _ in range(12):
            signal=spectra.local_spectrum(rng.normal(size=result['plan']['window_pixels']),result['plan'],
                                         result['settings'],result['radii'],result['angles'])
            peaks=fitting.detect_peaks(signal,result,fitting.DEFAULT_PEAK_FRACTION)
            local=pca._local(result,peaks,model)
            self.assertTrue(local is None or not local['valid'])


if __name__=='__main__':unittest.main()
