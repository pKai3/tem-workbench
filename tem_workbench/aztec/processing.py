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
    if not math.isfinite(sigma) or not 0 <= sigma <= 128:
        raise ValueError('Smoothing must be between 0 and 128 samples/pixels.')
    smooth = gaussian_filter1d if values.ndim == 1 else gaussian_filter
    filtered = smooth(values, sigma, mode='reflect') if sigma else values.copy()
    raw = values.copy()
    valid = np.ones(values.shape, bool)
    if denominator is not None:
        den = np.asarray(denominator, dtype=float)
        if den.shape != values.shape or not np.isfinite(den).all():
            raise ValueError('The ratio channels must use the same finite sample grid.')
        den_smooth = smooth(den, sigma, mode='reflect') if sigma else den
        raw = np.divide(raw, den, out=np.full_like(raw, np.nan), where=den>0)
        filtered = np.divide(filtered, den_smooth, out=np.full_like(filtered, np.nan), where=den_smooth>0)
        valid &= den_smooth > 0
    if values.ndim == 2 and sigma:
        # As in the map report: exclude a 3σ rim from normalization statistics.
        edge = int(np.ceil(3*sigma))
        valid[:edge] = valid[-edge:] = False
        valid[:, :edge] = valid[:, -edge:] = False
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
