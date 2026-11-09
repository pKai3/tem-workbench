"""Native-pixel aperture photometry, independent of any phase prediction.

Image values are arbitrary signal units, not calibrated electron counts.
Opposite observations are measured separately and averaged at profile level.
"""
import numpy as np

VERSION = 'aperture-photometry-v2'


def measure(array, spots, valid=None, *, check_clipping=True):
    """Integrate a measured spot footprint over a robust local background plane.

    Never clip individual negative residuals: that would turn background noise
    into positive signal. Overlapping apertures partition pixels by normalized
    distance. Incomplete apertures are reported, not extrapolated.
    """
    h, w = array.shape
    radii = np.array([max(2., 2.5*float(s['width_px'])/2.355) for s in spots])
    centres = np.array([[s['x_px'], s['y_px']] for s in spots]).reshape(-1, 2)
    maximum = float(np.max(array))
    for i, spot in enumerate(spots):
        if spot.get('exclude_only'):
            continue
        x, y = centres[i]; radius = radii[i]
        reach = int(np.ceil(2.5*radius))
        x0, x1 = max(0, int(x)-reach), min(w, int(x)+reach+2)
        y0, y1 = max(0, int(y)-reach), min(h, int(y)+reach+2)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        dx, dy = xx-x, yy-y
        distance = np.hypot(dx, dy)
        good = np.isfinite(array[y0:y1, x0:x1])
        if valid is not None:
            good &= valid[y0:y1, x0:x1]
        aperture = (distance <= radius) & good
        ring = (distance >= 1.5*radius) & (distance <= 2.5*radius) & good
        before = int(aperture.sum())
        for j in np.flatnonzero(np.linalg.norm(centres-centres[i], axis=1) < 2.5*radius+radii):
            if j == i:
                continue
            other = np.hypot(xx-centres[j, 0], yy-centres[j, 1])
            ring &= other > 1.25*radii[j]
            aperture &= (other > radii[j]) | (distance/radius < other/radii[j]) | ((distance/radius == other/radii[j]) & (i < j))
        flags = []
        # Compare with the exact pixel-centre footprint. The continuous circle
        # area can falsely flag small, fully contained FFT apertures as clipped.
        span = int(np.ceil(radius))
        full_y, full_x = np.ogrid[int(y)-span:int(y)+span+2, int(x)-span:int(x)+span+2]
        expected_pixels = int(np.count_nonzero((full_x-x)**2+(full_y-y)**2 <= radius**2))
        fraction = min(1., before/max(expected_pixels, 1))
        if fraction < .9:
            flags.append('aperture_clipped')
        if aperture.sum() < .95*before:
            flags.append('overlap_partitioned')
        if spot.get('manual'):
            flags.append('width_estimated')
        spot['photometry'] = report = dict(version=VERSION, aperture_radius_px=float(radius),
            aperture_pixels=int(aperture.sum()), aperture_fraction=float(fraction),
            background_pixels=int(ring.sum()), flags=flags, reliable=False)
        if ring.sum() < 24 or aperture.sum() < 4:
            flags.append('insufficient_background' if ring.sum() < 24 else 'insufficient_aperture')
            report.update(integrated_intensity=None, background=None, peak_height=None)
            continue
        values = np.asarray(array[y0:y1, x0:x1], dtype=float)
        design = np.column_stack((np.ones(int(ring.sum())), dx[ring]/radius, dy[ring]/radius))
        z = values[ring]; keep = np.ones(len(z), dtype=bool)
        coefficients = np.array([np.median(z), 0., 0.])
        for _ in range(4):
            if keep.sum() < 24:
                break
            coefficients = np.linalg.lstsq(design[keep], z[keep], rcond=None)[0]
            residual = z-design@coefficients
            spread = max(1e-6, 1.4826*float(np.median(abs(residual[keep]-np.median(residual[keep])))))
            keep = abs(residual) <= 3*spread
        background = coefficients[0]+coefficients[1]*dx/radius+coefficients[2]*dy/radius
        signal = values-background
        integral = float(np.sum(signal[aperture]))
        # Raster clipping cannot be recovered by integration; expose it.
        if check_clipping and maximum > 0 and np.count_nonzero(aperture & (values >= maximum)) >= 3:
            flags.append('at_image_maximum')
        report.update(integrated_intensity=integral, background=float(coefficients[0]),
            background_spread=float(spread), peak_height=float(np.max(signal[aperture])),
            reliable=not any(f in flags for f in ('aperture_clipped', 'overlap_partitioned', 'width_estimated')))
    return spots


def measure_fft(power, fx, fy, peaks, window_fwhm_bins, neighbours=()):
    """Native linear FFT-power integrals, before display/log processing.

    Use the observed component's equivalent radius plus one window-response
    FWHM as the aperture radius (minimum two bins). Both conjugate spots are
    measured, then averaged as one profile. Fourier maxima are not detector
    saturation, so only aperture/background/overlap checks apply.
    """
    h, w = power.shape
    dx, dy = float(fx[1]-fx[0]), float(fy[0]-fy[1])
    spots, pairs = [], []
    def positions(peak):
        x, y = peak.get('_fft_position_px', ((peak['qx']-fx[0])/dx, (fy[0]-peak['qy'])/dy))
        return ((x, y), ((2*(w//2)-x) % w, (2*(h//2)-y) % h))
    for peak in peaks:
        radius = max(2., np.sqrt(peak['profile_area_bins']/np.pi)+window_fwhm_bins)
        pair = []
        for px, py in positions(peak):
            spot = dict(x_px=float(px), y_px=float(py), width_px=float(radius*2.355/2.5),
                        q=[float(fx[0]+px*dx), float(fy[0]-py*dy)])
            pair.append(spot); spots.append(spot)
        pairs.append(pair)
    # Detection cutoff/separation changes must not silently absorb the signal
    # of a nearby component that is no longer in the retained profile list.
    centres = [(spot['x_px'], spot['y_px']) for spot in spots]
    for peak in neighbours:
        radius = max(2., np.sqrt(peak['profile_area_bins']/np.pi)+window_fwhm_bins)
        for x, y in positions(peak):
            if any(np.hypot(x-px, y-py) < .25 for px, py in centres):
                continue
            spots.append(dict(x_px=float(x), y_px=float(y), width_px=float(radius*2.355/2.5), exclude_only=True))
            centres.append((x, y))
    measure(power, spots, check_clipping=False)
    for peak, pair in zip(peaks, pairs):
        peak.pop('_fft_position_px', None)
        for spot in pair:
            spot['photometry'].update(version='fft-aperture-power-v1',
                                      aperture_source='component_area_plus_window_response')
        peak.update(profile_measurements(pair))
    return dict(method='fft-aperture-power-v1', units='FFT power × bins',
                profile_aggregation='mean_of_reliable_conjugates',
                weighting='original radial-background enrichment',
                aperture='equivalent component radius + window power FWHM, minimum 2 bins')


def number_profiles(peaks):
    """Brightness IDs without reordering detector/fitting inputs.

    Missing/nonfinite integrals sort last. Equal values retain detection order.
    Call before fitting (and on copies for each automatic-strength trial).
    """
    key = 'integrated_intensity' if any('integrated_intensity' in p for p in peaks) else 'intensity'
    def value(peak):
        signal = peak.get(key)
        return float(signal) if signal is not None and np.isfinite(signal) else -np.inf
    for index, peak in enumerate(sorted(peaks, key=value, reverse=True), 1):
        peak['profile_id'] = index


def profile_measurements(spots):
    records = [dict(q=s['q'], x_px=s['x_px'], y_px=s['y_px'], **s['photometry']) for s in spots]
    usable = [r for r in records if r['integrated_intensity'] is not None]
    reliable = [r for r in usable if r['reliable']]
    chosen = reliable or usable
    return dict(integrated_intensity=float(np.mean([r['integrated_intensity'] for r in chosen])) if chosen else None,
                intensity_reliable=bool(reliable), intensity_observation_count=len(chosen),
                spot_measurements=records)


def apply_weights(peaks):
    """Bounded relative signal weights; detection confidence stays separate.

    Square-root compression and a 1–6 cap keep weak additional patterns usable.
    Scaling all image values by a constant does not change relative weights.
    Incomplete measurements keep their previous contrast weight.
    """
    usable = [p['integrated_intensity'] for p in peaks if p.get('intensity_reliable') and (p.get('integrated_intensity') or 0) > 0]
    reference = float(np.median(usable)) if usable else None
    for p in peaks:
        p['detection_weight'] = p['weight']
        p['weight_source'] = 'local_contrast'
        if reference and p.get('intensity_reliable') and p['integrated_intensity'] > 0:
            p['weight'] = float(np.clip(3*np.sqrt(p['integrated_intensity']/reference), 1., 6.))
            p['weight_source'] = 'integrated_intensity'
    return dict(method=VERSION, profile_aggregation='mean_of_reliable_observations',
                weighting='clip(3 * sqrt(integrated_intensity / median_reliable_intensity), 1, 6)',
                reference_intensity=reference, units='image signal × pixels')
