"""Reusable EDX report operations, without report paths or specimen-specific rules.

Extracted from the user's analyse_maps.py, analyse_profiles.py and
horizontal_ratio_overlays.py in EDX/Analysis/scripts. Preserve their Gaussian
reflect boundaries, smoothing-before-division, median/P20 conventions, and
proper (unmirrored) start-to-end image rotation. Inputs are never modified.
"""
import math

import numpy as np
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates

FWHM_PER_SIGMA = 2.35482  # Preserve the value used by the existing reports.
ELEMENT_COLOURS = {'Ti':'#a7b8ce', 'V':'#db65ed', 'Fe':'#49dba2', 'Al':'#ffb14e', 'Ga':'#65cfff'}


def signal_view(numerator, denominator=None, *, sigma=0, normalisation='none'):
    values = np.asarray(numerator, dtype=float)
    if values.ndim not in (1, 2) or not values.size or not np.isfinite(values).all():
        raise ValueError('Choose a finite element profile or map.')
    sigmas=np.broadcast_to(np.asarray(sigma,float),(values.ndim,))
    if not np.isfinite(sigmas).all() or np.any((sigmas<0)|(sigmas>128)):
        raise ValueError('Smoothing must be between 0 and 128 samples/pixels.')
    has_smoothing=bool(np.any(sigmas))
    smooth = gaussian_filter1d if values.ndim == 1 else gaussian_filter
    filtered = smooth(values, sigma, mode='reflect') if has_smoothing else values.copy()
    raw = values.copy()
    valid = np.ones(values.shape, bool)
    if denominator is not None:
        den = np.asarray(denominator, dtype=float)
        if den.shape != values.shape or not np.isfinite(den).all():
            raise ValueError('The ratio channels must use the same finite sample grid.')
        den_smooth = smooth(den, sigma, mode='reflect') if has_smoothing else den
        raw = np.divide(raw, den, out=np.full_like(raw, np.nan), where=den>0)
        filtered = np.divide(filtered, den_smooth, out=np.full_like(filtered, np.nan), where=den_smooth>0)
        valid &= den_smooth > 0
    if values.ndim == 2 and has_smoothing:
        # As in the map report: exclude a 3σ rim from normalization statistics.
        ey,ex=np.ceil(3*sigmas).astype(int)
        if ey:valid[:ey] = valid[-ey:] = False
        if ex:valid[:, :ex] = valid[:, -ex:] = False
    mask = valid & np.isfinite(filtered)
    baseline = 1.
    if normalisation not in ('none', 'median', 'mean', 'p20'):
        raise ValueError('Choose no normalization, median, mean, or P20.')
    if normalisation != 'none':
        if not mask.any():
            raise ValueError('No valid interior samples remain for normalization; reduce smoothing.')
        baseline = float(np.mean(filtered[mask]) if normalisation == 'mean' else
                         np.percentile(filtered[mask], 50 if normalisation == 'median' else 20))
        if baseline <= 0:
            raise ValueError(f'{normalisation.capitalize()} is zero; choose '+('Mean or Off.' if normalisation != 'mean' else 'Off.'))
    return dict(raw=raw/baseline, values=filtered/baseline, baseline=baseline, mask=mask)


def spatial_structure(numerator, denominator=None, *, sigma=0, permutations=256):
    """Exploratory shuffle check adapted from analyse_joint_elements.py.

    Shuffle paired channels, then replay smoothing-before-division. This asks
    about spatial ordering, not photon uncertainty or the fraction of noise.
    Relative standard deviation makes the result independent of display gain
    and normalization. Preserve correlations between channels at each sample.
    """
    a = np.asarray(numerator, dtype=float)
    b = None if denominator is None else np.asarray(denominator, dtype=float)
    if a.ndim not in (1, 2) or not a.size or not np.isfinite(a).all() or (b is not None and (b.shape != a.shape or not np.isfinite(b).all())):
        return {'available': False, 'reason': 'A complete finite profile or map is required.'}
    sigmas = np.broadcast_to(np.asarray(sigma, float), (a.ndim,))
    if not np.isfinite(sigmas).all() or np.any((sigmas < 0) | (sigmas > 128)):
        return {'available': False, 'reason': 'Smoothing must be between 0 and 128 samples/pixels.'}
    if not np.any(sigmas > 0):
        return {'available': False, 'reason': 'Use nonzero smoothing to check spatial structure.'}
    edges = np.ceil(3*sigmas).astype(int)
    interior_shape = np.asarray(a.shape)-2*edges
    if np.any(interior_shape <= 0) or np.prod(interior_shape) < 16:
        return {'available': False, 'reason': 'Too few interior samples at this smoothing width; reduce smoothing.'}
    interior = tuple(slice(int(e), -int(e) if e else None) for e in edges)
    axes = tuple(range(-a.ndim, 0))

    def variation(x, y=None):
        # A leading dimension holds independent permutations, never smoothed.
        widths = (0,)*(x.ndim-a.ndim)+tuple(sigmas)
        x = gaussian_filter(x, widths, mode='reflect')
        if y is not None:
            y = gaussian_filter(y, widths, mode='reflect')
            x = np.divide(x, y, out=np.full_like(x, np.nan), where=y > 0)
        x = x[(Ellipsis,)+interior]
        mean = np.mean(x, axis=axes)
        return np.divide(np.std(x, axis=axes), mean, out=np.full_like(mean, np.nan), where=mean > 0)

    observed = float(variation(a, b))
    if not np.isfinite(observed):
        return {'available': False, 'reason': 'Undefined ratio or nonpositive mean in the interior; no reliable shuffle comparison.'}
    # Bound the working set for full-resolution maps; never downsample the data.
    batch = max(1, min(16, 1048576//a.size))
    rng = np.random.default_rng(20261113)
    shuffled = []
    for first in range(0, permutations, batch):
        count = min(batch, permutations-first)
        indices = np.asarray([rng.permutation(a.size) for _ in range(count)])
        x = a.ravel()[indices].reshape((count,)+a.shape)
        y = None if b is None else b.ravel()[indices].reshape((count,)+a.shape)
        shuffled.extend(variation(x, y).tolist())
    shuffled = np.asarray(shuffled)
    if not np.isfinite(shuffled).all():
        return {'available': False, 'reason': 'Shuffled ratios include empty denominator regions; comparison unavailable.'}
    typical = float(np.median(shuffled))
    if typical <= np.finfo(float).eps:
        return {'available': False, 'reason': 'No measurable shuffled variation; structure ratio is undefined.'}
    return dict(available=True, observed_cv=observed, shuffled_cv=typical,
                structure_ratio=observed/typical, shuffled_95=float(np.percentile(shuffled,95)),
                permutations=permutations, interior_samples=int(np.prod(interior_shape)),
                above_shuffled_95=bool(observed > np.percentile(shuffled,95)))


def horizontal_crop(image, start, end, *, width=1200, pad=.035, top=.23, bottom=.23):
    """Rotate start-to-end and centre the crop on the physical scan path."""
    a = np.asarray(image, dtype=float)
    start, end = np.asarray(start, float), np.asarray(end, float)
    delta = end-start; length = float(np.linalg.norm(delta))
    if a.ndim != 2 or start.shape != (2,) or end.shape != (2,) or not np.isfinite([*start,*end,length]).all() or length <= 0:
        raise ValueError('A valid image and distinct scan endpoints are required.')
    tangent = delta/length; normal = np.array([-tangent[1], tangent[0]])
    matrix = np.column_stack([tangent, normal])
    umin, umax = -pad*length, (1+pad)*length
    vmin, vmax = -top*length, bottom*length
    height = round(width*(vmax-vmin)/(umax-umin))
    # Equal sampling pitch in both directions preserves the image's proportions.
    pitch=(umax-umin)/width
    vcentre=(vmin+vmax)/2
    vmin,vmax=vcentre-height*pitch/2,vcentre+height*pitch/2
    us=umin+(np.arange(width)+.5)*pitch
    vs=vmin+(np.arange(height)+.5)*pitch
    u,v=np.meshgrid(us,vs)
    sx=start[0]+u*tangent[0]+v*normal[0]
    sy=start[1]+u*tangent[1]+v*normal[1]
    crop=map_coordinates(a,[sy,sx],order=1,mode='constant',cval=np.nan)
    return dict(array=crop, extent=[umin,umax,vmin,vmax], length_px=length,
                source_from_rotated=matrix.tolist())
