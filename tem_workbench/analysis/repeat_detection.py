"""Reusable, read-only repeat-region candidate scoring.

No file I/O, grouping decisions, or Workbench UI dependencies. Callers supply
image arrays, stored native FFT peaks, and acquisition metadata. A candidate is
evidence for human review, never an instruction to merge acquisitions.
"""
from dataclasses import dataclass
from collections.abc import Mapping, Sequence
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.signal import fftconvolve


@dataclass(frozen=True)
class MatchSettings:
    image_side: int = 128
    image_sigma: float = 1.0
    fft_bins: int = 192
    fft_half_range: float = 10.0
    fft_sigma: float = 0.8
    min_image_overlap: float = 0.65
    stage_tolerance: float = 0.001
    field_relative_tolerance: float = 0.01
    sequence_gap: int = 5
    stage_fft_threshold: float = 0.85
    image_ncc_threshold: float = 0.85
    image_fft_threshold: float = 0.65


def image_fingerprint(image, settings=MatchSettings()):
    """Low-pass luminance image, standardized for translation matching."""
    image = image if isinstance(image, Image.Image) else Image.fromarray(np.asarray(image))
    image = image.convert('L').resize((settings.image_side, settings.image_side), Image.Resampling.LANCZOS)
    arr = gaussian_filter(np.asarray(image, dtype=float), settings.image_sigma)
    return (arr - arr.mean()) / (arr.std() + 1e-12)


def fft_fingerprint(windows: Sequence[Mapping], settings=MatchSettings()):
    """L2-normalized native peak-density histogram; preserve reciprocal axes.

    Accepts [qx,qy] or [peak_id,qx,qy]. Each window has unit total positive
    peak weight before adding Friedel partners. Coordinates use nm^-1.
    """
    h = np.zeros((settings.fft_bins, settings.fft_bins), dtype=float)
    for window in windows:
        p = np.asarray(window.get('peak_positions', []), dtype=float)
        if p.ndim != 2 or p.shape[1] not in (2, 3):
            continue
        p = p[:, -2:]
        weights = np.asarray(window.get('peak_weights', np.ones(len(p))), dtype=float)
        if weights.shape != (len(p),):
            weights = np.ones(len(p))
        valid = np.isfinite(p).all(axis=1) & np.isfinite(weights)
        p, weights = p[valid], np.maximum(weights[valid], 0)
        weights = weights / (weights.sum() + 1e-12)
        p = np.concatenate([p, -p])
        h += np.histogram2d(p[:, 1], p[:, 0], bins=settings.fft_bins,
                            range=[[-settings.fft_half_range, settings.fft_half_range]] * 2,
                            weights=np.tile(weights, 2))[0]
    h = gaussian_filter(h, settings.fft_sigma)
    return h / (np.linalg.norm(h) + 1e-12)


def translation_ncc(a, b, min_overlap=0.65):
    """Best overlap-normalized correlation and (x,y) shift in thumbnail pixels.

    Translation only, with at least min_overlap of the full image retained.
    Do not apply to unequal physical fields, rotations, or different detectors
    without a separately validated registration step.
    """
    a, b = np.asarray(a, float), np.asarray(b, float)
    if a.shape != b.shape or a.ndim != 2 or not 0 < min_overlap <= 1:
        raise ValueError('Equal 2-D shapes and an overlap fraction in (0,1] are required')
    if not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError('Images must contain finite values')
    ones = np.ones(a.shape)
    prod = fftconvolve(a, b[::-1, ::-1], mode='full')
    num = fftconvolve(ones, ones, mode='full')
    sa = fftconvolve(a, ones, mode='full')
    sb = fftconvolve(ones, b[::-1, ::-1], mode='full')
    aa = fftconvolve(a*a, ones, mode='full')
    bb = fftconvolve(ones, (b*b)[::-1, ::-1], mode='full')
    corr = (prod-sa*sb/np.maximum(num, 1)) / np.sqrt(np.maximum(
        (aa-sa*sa/np.maximum(num, 1)) * (bb-sb*sb/np.maximum(num, 1)), 1e-9))
    corr[num < min_overlap*a.size] = -1
    y, x = np.unravel_index(np.argmax(corr), corr.shape)
    return float(corr[y, x]), [int(x-a.shape[1]+1), int(y-a.shape[0]+1)]


def _stage_matches(a, b, tolerance):
    keys = ('x', 'y', 'alpha', 'beta')
    try:
        return all(np.isfinite(float(a[k])) and np.isfinite(float(b[k]))
                   and abs(float(a[k])-float(b[k])) < tolerance for k in keys)
    except (KeyError, TypeError, ValueError):
        return False


def compare_pair(a, b, settings=MatchSettings(), *, search_all=False, image_only=False):
    """Return review evidence, or None if outside the metadata search scope.

    Entries contain id, sample, number, stage, field_nm, image and fft.
    The sample should be a stable project-qualified identity in multi-project
    callers. Missing metadata must not become a positive match.
    """
    if a.get('sample') is None or a.get('sample') != b.get('sample'):
        return None
    stage_equal = _stage_matches(a.get('stage') or {}, b.get('stage') or {}, settings.stage_tolerance)
    try:
        adjacent = abs(int(a['number'])-int(b['number'])) <= settings.sequence_gap
    except (KeyError, TypeError, ValueError):
        adjacent = False
    if not search_all and not stage_equal and not adjacent:
        return None
    fs = float(np.sum(a['fft']*b['fft'])) if a.get('fft') is not None and b.get('fft') is not None else None
    try:
        field_a, field_b = np.asarray(a['field_nm'], float), np.asarray(b['field_nm'], float)
        same_scale = bool(np.all(field_a > 0) and np.all(field_b > 0) and
                          np.all(np.abs(field_a/field_b-1) < settings.field_relative_tolerance))
    except (KeyError, TypeError, ValueError):
        same_scale = False
    unknown_scale = (image_only and a.get('field_nm') is None and b.get('field_nm') is None
                     and a.get('dimensions') is not None and a['dimensions'] == b.get('dimensions'))
    nc, shift = translation_ncc(a['image'], b['image'], settings.min_image_overlap) if same_scale or unknown_scale else (None, None)
    candidate = (stage_equal and fs is not None and fs >= settings.stage_fft_threshold) or (
        nc is not None and fs is not None and nc >= settings.image_ncc_threshold and fs >= settings.image_fft_threshold)
    # Without saved native peaks, image-only suggestions need a stronger match.
    # Unknown calibration is explicitly retained as a limitation of that match.
    if image_only and fs is None and nc is not None:
        candidate = candidate or nc >= (.98 if unknown_scale else .90)
    return dict(a=a['id'], b=b['id'], exact_stage_metadata=stage_equal,
                same_magnification=bool(same_scale), fft_cosine=fs, image_ncc=nc,
                translation_pixels=shift, thumbnail_shape=list(a['image'].shape), proposed=bool(candidate))


def candidate_pairs(entries, settings=MatchSettings()):
    pairs = []
    for i, a in enumerate(entries):
        for b in entries[i+1:]:
            pair = compare_pair(a, b, settings)
            if pair is not None:
                pairs.append(pair)
    return sorted(pairs, key=lambda r: (not r['proposed'], -int(r['exact_stage_metadata']),
                                      -(r['image_ncc'] or 0), -(r['fft_cosine'] or 0)))
