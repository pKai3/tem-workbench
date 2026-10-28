"""Spot-pattern analysis in detector space. No Fourier transform is performed.

Centre finding, local-contrast thresholds and spot widths are exploratory.
Coordinates are nm^-1 with x right and y up; detector coordinates are x right,
y down. Opposite observations share a profile but remain separate on display.
"""
import numpy as np
from scipy.ndimage import gaussian_filter, maximum_filter, map_coordinates
from scipy.spatial import cKDTree
import analysis_core as core

VERSION = 'direct-spots-v1'
BAND = (3., 10.)


def reciprocal_factor(unit):
    unit = str(unit).strip().lower().replace(' ', '').replace('⁻¹', '^-1').replace('−', '-')
    unit = unit.replace('**', '^').replace('ångström', 'a').replace('angstrom', 'a').replace('å', 'a').replace('^{-1}', '^-1')
    return {'1/nm': 1., 'nm^-1': 1., 'nm-1': 1., '/nm': 1.,
            '1/a': 10., 'a^-1': 10., 'a-1': 10.,
            '1/um': .001, '1/µm': .001, '1/μm': .001,
            '1/m': 1e-9, 'm^-1': 1e-9}.get(unit)


def estimate_center(array):
    """Cluster opposite-spot midpoints near the detector centre, then refine.

    A central prior disambiguates lattice-equivalent inversion centres. Return
    the detector centre when pairs are inadequate; never call that a fit.
    """
    h, w = array.shape
    fallback = {'x': (w-1)/2, 'y': (h-1)/2, 'pairs': 0,
                'method': 'detector_midpoint', 'residual_px': None}
    binning = max(1, int(np.ceil(max(h, w)/1536)))
    hh, ww = h//binning, w//binning
    a = array[:hh*binning, :ww*binning].astype(np.float32).reshape(hh, binning, ww, binning).mean(axis=(1, 3))
    signal = gaussian_filter(a, 1.2)-gaussian_filter(a, 10.)
    yy, xx = np.indices(a.shape)
    origin = np.array([(ww-1)/2, (hh-1)/2])
    radius = np.hypot(xx-origin[0], yy-origin[1])
    valid = (radius > min(hh, ww)*.04) & (radius < min(hh, ww)*.47)
    level = max(float(np.percentile(signal[valid], 99.5)), 0.)
    maxima = valid & (signal > level) & (signal == maximum_filter(signal, 7))
    y, x = np.where(maxima)
    order = np.argsort(signal[y, x])[::-1][:180]
    points = np.c_[x[order], y[order]].astype(float)
    # Subpixel centroids on the positive local signal.
    for i, (px, py) in enumerate(points.copy()):
        ix, iy = int(px), int(py)
        patch = signal[iy-3:iy+4, ix-3:ix+4]
        if patch.shape != (7, 7):
            continue
        weight = np.maximum(patch-.2*patch.max(), 0)
        if weight.sum():
            gy, gx = np.indices(weight.shape)
            points[i] = [ix-3+(gx*weight).sum()/weight.sum(), iy-3+(gy*weight).sum()/weight.sum()]
    if len(points) < 6:
        return fallback
    i, j = np.triu_indices(len(points), 1)
    mid = (points[i]+points[j])/2
    mid = mid[np.linalg.norm(mid-origin, axis=1) < .09*min(hh, ww)]
    if len(mid) < 3:
        return fallback
    tree = cKDTree(mid)
    groups = tree.query_ball_point(mid, 3.5)
    # A weak central prior selects among repeated inversion centres.
    merit = np.array([len(g) for g in groups])*np.exp(-.5*(np.linalg.norm(mid-origin, axis=1)/(.05*min(hh, ww)))**2)
    best = int(np.argmax(merit))
    if len(groups[best]) < 3:
        return fallback
    centre = np.median(mid[groups[best]], axis=0)
    tree = cKDTree(points)
    pairs = []
    for _ in range(4):
        distance, index = tree.query(2*centre-points)
        pairs = [(i, int(j)) for i, j in enumerate(index) if i < j and distance[i] < 5.]
        if len(pairs) < 3:
            return fallback
        centre = np.median([(points[i]+points[j])/2 for i, j in pairs], axis=0)
    residual = np.array([np.linalg.norm(points[i]+points[j]-2*centre) for i, j in pairs])
    x, y = centre*binning+(binning-1)/2
    return {'x': float(x), 'y': float(y), 'pairs': len(pairs), 'method': 'opposite_spot_midpoints',
            'residual_px': float(np.sqrt(np.mean(residual**2))*binning)}


def defaults(info):
    centre = info['beam_center']
    return {'center_x': centre['x'], 'center_y': centre['y'],
            'pixel_x_nm_inv': info['pixel_x_nm_inv'], 'pixel_y_nm_inv': info['pixel_y_nm_inv'],
            'exclude_radius_nm_inv': 2.5, 'spot_sigma_px': 2., 'spot_snr': 6., 'masks': []}


def validate(info, supplied):
    if not isinstance(supplied, dict):
        raise ValueError('Diffraction settings must be an object.')
    value = defaults(info)
    for key in value.keys()-{'masks'}:
        value[key] = float(supplied.get(key, value[key]))
    if not all(np.isfinite(v) for k, v in value.items() if k != 'masks'):
        raise ValueError('Diffraction settings must be finite.')
    if not (0 <= value['center_x'] < info['width'] and 0 <= value['center_y'] < info['height']):
        raise ValueError('Beam centre must lie inside the detector image.')
    if not (1e-6 <= value['pixel_x_nm_inv'] <= 10 and 1e-6 <= value['pixel_y_nm_inv'] <= 10):
        raise ValueError('Use a positive reciprocal calibration in nm⁻¹ per pixel.')
    if not (0 <= value['exclude_radius_nm_inv'] <= 9.5 and .5 <= value['spot_sigma_px'] <= 10 and 2 <= value['spot_snr'] <= 30):
        raise ValueError('Use exclusion radius 0–9.5 nm⁻¹, smoothing 0.5–10 px and spot contrast 2–30.')
    masks = supplied.get('masks', [])
    if not isinstance(masks, list) or len(masks) > 20:
        raise ValueError('Use at most 20 exclusion rectangles.')
    value['masks'] = []
    for rect in masks:
        x, y, w, h = [float(rect[k]) for k in ('x', 'y', 'w', 'h')]
        if not all(np.isfinite([x, y, w, h])) or min(x, y) < 0 or min(w, h) <= 0 or x+w > info['width'] or y+h > info['height']:
            raise ValueError('Exclusion rectangles must lie inside the detector image.')
        value['masks'].append(dict(x=x, y=y, w=w, h=h))
    return value


def visible(points, settings, shape, margin=0.):
    """Whether each signed reciprocal position has an unobstructed neighbourhood."""
    points = np.asarray(points).reshape(-1, 2)
    sx, sy = settings['pixel_x_nm_inv'], settings['pixel_y_nm_inv']
    x = settings['center_x']+points[:, 0]/sx
    y = settings['center_y']-points[:, 1]/sy
    h, w = shape
    good = ((x >= margin/sx) & (x <= w-1-margin/sx) &
            (y >= margin/sy) & (y <= h-1-margin/sy) &
            (np.linalg.norm(points, axis=1) >= settings['exclude_radius_nm_inv']+margin))
    for rect in settings['masks']:
        good &= ~((x >= rect['x']-margin/sx) & (x <= rect['x']+rect['w']+margin/sx) &
                  (y >= rect['y']-margin/sy) & (y <= rect['y']+rect['h']+margin/sy))
    return good


def _profiles(spots, radius):
    profiles = []
    for spot in sorted(spots, key=lambda p: p['local_contrast'], reverse=True):
        q = core.canonical(np.array([spot['q']]))[0]
        group = next((p for p in profiles if min(np.linalg.norm(q-p['q']), np.linalg.norm(q+p['q'])) < radius), None)
        if group is None:
            profiles.append({'q': q, 'spots': [spot]})
        else:
            group['spots'].append(spot)
    for p in profiles:
        # Align to this group's reference before averaging. Independently folding
        # almost-horizontal spots can put them on opposite sides of the x axis.
        observations = np.array([s['q'] for s in p['spots']])
        observations[observations @ p['q'] < 0] *= -1
        p['q'] = core.canonical(observations.mean(axis=0, keepdims=True))[0]
    return profiles


def spectrum(array, settings):
    h, w = array.shape
    sx, sy = settings['pixel_x_nm_inv'], settings['pixel_y_nm_inv']
    cx, cy = settings['center_x'], settings['center_y']
    # Work on original detector pixels within the displayed band plus filter margin.
    sigma = settings['spot_sigma_px']
    pad = int(np.ceil(24*sigma))
    x0, x1 = max(0, int(cx-10.5/sx)-pad), min(w, int(np.ceil(cx+10.5/sx))+pad+1)
    y0, y1 = max(0, int(cy-10.5/sy)-pad), min(h, int(np.ceil(cy+10.5/sy))+pad+1)
    raw = array[y0:y1, x0:x1].astype(np.float32)
    yy, xx = np.indices(raw.shape)
    qx, qy = (xx+x0-cx)*sx, (cy-yy-y0)*sy
    g = np.hypot(qx, qy)
    valid = visible(np.c_[qx.ravel(), qy.ravel()], settings, array.shape).reshape(raw.shape)
    # Normalised filtering avoids turning a manually masked beamstop edge into a peak.
    def blur(width):
        return gaussian_filter(raw*valid, width)/np.maximum(gaussian_filter(valid.astype(np.float32), width), 1e-6)
    residual = blur(sigma)-blur(6*sigma)
    band = valid & (g >= BAND[0]) & (g <= BAND[1])
    noise = max(1e-6, 1.4826*float(np.median(abs(residual[band]-np.median(residual[band]))))) if band.any() else 1.
    size = max(3, int(4*sigma)//2*2+1)
    mask = band & (residual == maximum_filter(residual, size)) & (residual > 2*noise)
    ys, xs = np.where(mask)
    order = np.argsort(residual[ys, xs])[::-1][:500]
    spots = []
    outer = max(6, int(np.ceil(8*sigma)))
    inner = max(2, int(np.ceil(3*sigma)))
    weak_cutoff = min(3., settings['spot_snr'])
    for i in order:
        y, x = int(ys[i]), int(xs[i])
        if min(x, y, raw.shape[1]-1-x, raw.shape[0]-1-y) < outer:
            continue
        q = np.array([qx[y, x], qy[y, x]])
        if not visible([q], settings, array.shape, margin=2*sigma*max(sx, sy))[0]:
            continue
        distance = np.hypot(xx[y-outer:y+outer+1, x-outer:x+outer+1]-x,
                            yy[y-outer:y+outer+1, x-outer:x+outer+1]-y)
        patch = residual[y-outer:y+outer+1, x-outer:x+outer+1]
        annulus = patch[(distance >= 4*sigma) & (distance <= 8*sigma) & valid[y-outer:y+outer+1, x-outer:x+outer+1]]
        if len(annulus) < 24:
            continue
        bg = float(np.median(annulus))
        spread = max(noise*.25, 1.4826*float(np.median(abs(annulus-bg))), 1e-6)
        contrast = (float(residual[y, x])-bg)/spread
        if contrast < weak_cutoff:
            continue
        peak = residual[y-inner:y+inner+1, x-inner:x+inner+1]
        weights = np.maximum(peak-max(bg, .2*float(residual[y, x])), 0)
        total = float(weights.sum())
        if not total:
            continue
        gy, gx = np.indices(weights.shape)
        dx, dy = float((weights*(gx-inner)).sum()/total), float((weights*(gy-inner)).sum()/total)
        px, py = x+x0+dx, y+y0+dy
        refined_q = np.array([(px-cx)*sx, (cy-py)*sy])
        if not BAND[0] <= np.linalg.norm(refined_q) <= BAND[1]:
            continue
        width = 2.355*np.sqrt(float((weights*((gx-inner-dx)**2*sx*sx+(gy-inner-dy)**2*sy*sy)).sum()/total)/2)
        spots.append({'q': [(px-cx)*sx, (cy-py)*sy], 'x_px': px, 'y_px': py,
                      'local_contrast': float(contrast), 'enrichment': float(np.log1p(contrast)),
                      'width_nm_inv': float(width), 'intensity': float(array[int(round(py)), int(round(px))])})
    strong = [p for p in spots if p['local_contrast'] >= settings['spot_snr']]
    width = float(np.median([p['width_nm_inv'] for p in strong])) if strong else 2.355*sigma*max(sx, sy)
    width = float(np.clip(width, 2*max(sx, sy), .30))
    radius = max(.10, width)
    profiles = _profiles(strong, radius)[:70]
    peaks = []
    for i, p in enumerate(profiles):
        q = p['q']; strength = max(s['local_contrast'] for s in p['spots'])
        peaks.append({'profile_id': i+1, 'qx': float(q[0]), 'qy': float(q[1]),
                      'g_nm_inv': float(np.linalg.norm(q)), 'local_contrast': strength,
                      'log_local_contrast': float(np.log1p(strength)),
                      'weight': float(np.clip(np.log1p(strength), 1, 6)),
                      'observed_spots': [s['q'] for s in p['spots']]})
    maxima = []
    for p in _profiles([s for s in spots if s['local_contrast'] < settings['spot_snr']], radius):
        if any(min(np.linalg.norm(p['q']-[s['qx'], s['qy']]), np.linalg.norm(p['q']+[s['qx'], s['qy']])) < radius for s in peaks):
            continue
        strongest = max(p['spots'], key=lambda s: s['local_contrast'])
        maxima.append({'weak_id': len(maxima)+1, 'q': p['q'].tolist(),
                       'observed_spots': [s['q'] for s in p['spots']],
                       'strength': min(.5, (strongest['local_contrast']-1)/6),
                       'local_contrast': strongest['local_contrast'], 'enrichment': strongest['enrichment']})
    # Display resampling is separate from the native-pixel detector and fitting.
    axis = np.linspace(-10.5, 10.5, 768)
    ax, ay = np.meshgrid(axis, axis[::-1])
    image = map_coordinates(array, [cy-ay/sy, cx+ax/sx], order=1, mode='constant', cval=0., prefilter=False)
    log = np.log1p(np.maximum(image, 0))
    context = {'maxima': maxima, 'radius': radius, 'x_limit': max(cx, w-1-cx)*sx,
               'y_limit': max(cy, h-1-cy)*sy,
               'visible': lambda q: visible(q, settings, array.shape, radius) | visible(-q, settings, array.shape, radius)}
    complete_band = min(cx*sx, (w-1-cx)*sx, cy*sy, (h-1-cy)*sy) >= BAND[1]
    result = {'kind': 'diffraction', 'log': log, 'extent': [-10.5, 10.5, -10.5, 10.5],
              'peaks': peaks, 'df': max(sx, sy), 'peak_width_nm_inv': width,
              'weak_maxima': maxima, 'profile_threshold': settings['spot_snr'],
              'observed_spot_count': sum(len(p['observed_spots']) for p in peaks),
              'beam_center_px': [cx, cy], 'reciprocal_pixel_size': [sx, sy],
              'full_band_on_detector': complete_band, 'can_index': bool(band.any()),
              'mask_count': len(settings['masks']), 'detector': VERSION}
    return result, context
