"""Spot-pattern analysis in detector space. No Fourier transform is performed.

Centre finding, local-contrast thresholds and spot widths are exploratory.
Coordinates are nm^-1 with x right and y up; detector coordinates are x right,
y down. Opposite observations share a profile but remain separate on display.
"""
import os
import numpy as np
from scipy.ndimage import gaussian_filter, maximum_filter, map_coordinates, label, distance_transform_edt
from scipy.spatial import cKDTree
from scipy.optimize import least_squares
import analysis_core as core

VERSION = 'direct-spots-v2'
DEFAULT_G_MAX = 10.
CENTER_REFINEMENT_VERSION = 'shared-center-v1'


def reciprocal_factor(unit):
    unit = str(unit).strip().lower().replace(' ', '').replace('⁻¹', '^-1').replace('−', '-')
    unit = unit.replace('**', '^').replace('ångström', 'a').replace('angstrom', 'a').replace('å', 'a').replace('^{-1}', '^-1')
    return {'1/nm': 1., 'nm^-1': 1., 'nm-1': 1., '/nm': 1.,
            '1/a': 10., 'a^-1': 10., 'a-1': 10.,
            '1/um': .001, '1/µm': .001, '1/μm': .001,
            '1/m': 1e-9, 'm^-1': 1e-9}.get(unit)


def estimate_center(array):
    """Cluster opposite-spot midpoints near the detector centre, then refine.

    A central prior and, when visible, the beam-stop shadow disambiguate
    lattice-equivalent inversion centres. The shadow constrains the choice;
    opposite spots still measure the centre. Fall back when pairs are inadequate.
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
    # A lattice can have several inversion centres. Prefer one under a clearly
    # dark central obstruction, rather than equating the silhouette centroid
    # (which includes the shaft) with the direct beam.
    smoothed = gaussian_filter(a, 2.)
    near = radius < .12*min(hh, ww)
    background = float(np.median(smoothed[near]))
    components, _ = label(near & (smoothed < .12*background))
    counts = np.bincount(components.ravel())
    ids = [i for i in np.unique(components[radius < .08*min(hh, ww)]) if i and counts[i] >= 12]
    shadow = np.isin(components, ids)
    use_shadow = background > 0 and bool(ids) and shadow.sum() < .20*near.sum()
    if use_shadow:
        distance = distance_transform_edt(~shadow)
        indices = np.round(mid).astype(int)
        outside = distance[indices[:, 1], indices[:, 0]]
        merit *= .01+.99*np.exp(-.5*(outside/max(2., .004*min(hh, ww)))**2)
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
            'residual_px': float(np.sqrt(np.mean(residual**2))*binning), 'beamstop_prior': bool(use_shadow)}


def defaults(info):
    centre = info['beam_center']
    return {'center_x': centre['x'], 'center_y': centre['y'],
            'pixel_x_nm_inv': info['pixel_x_nm_inv'], 'pixel_y_nm_inv': info['pixel_y_nm_inv'],
            'exclude_radius_nm_inv': 2.5, 'spot_sigma_px': 2., 'spot_snr': 9.,
            'refine_center': True, 'max_center_shift_px': 50., 'smoothing_workers': 0, 'masks': [], 'peak_edits': []}


def validate(info, supplied):
    if not isinstance(supplied, dict):
        raise ValueError('Diffraction settings must be an object.')
    value = defaults(info)
    value['refine_center'] = supplied.get('refine_center', value['refine_center'])
    if not isinstance(value['refine_center'], bool):
        raise ValueError('Translation refinement must be on or off.')
    value['smoothing_workers'] = supplied.get('smoothing_workers', 0)
    smoothing_worker_count(value['smoothing_workers'])
    for key in value.keys()-{'masks', 'peak_edits', 'refine_center', 'smoothing_workers'}:
        value[key] = float(supplied.get(key, value[key]))
    if not all(np.isfinite(v) for k, v in value.items() if k not in {'masks', 'peak_edits'}):
        raise ValueError('Diffraction settings must be finite.')
    if not (0 <= value['center_x'] < info['width'] and 0 <= value['center_y'] < info['height']):
        raise ValueError('Beam centre must lie inside the detector image.')
    if not (1e-6 <= value['pixel_x_nm_inv'] <= 10 and 1e-6 <= value['pixel_y_nm_inv'] <= 10):
        raise ValueError('Use a positive reciprocal calibration in nm⁻¹ per pixel.')
    if not (0 <= value['exclude_radius_nm_inv'] < 30 and .5 <= value['spot_sigma_px'] <= 10 and 2 <= value['spot_snr'] <= 30):
        raise ValueError('Use exclusion radius from 0 to below 30 nm⁻¹, smoothing 0.5–10 px and spot contrast 2–30.')
    if not 1 <= value['max_center_shift_px'] <= 200:
        raise ValueError('Use a translation limit between 1 and 200 detector pixels.')
    masks = supplied.get('masks', [])
    if not isinstance(masks, list) or len(masks) > 20:
        raise ValueError('Use at most 20 exclusion rectangles.')
    value['masks'] = []
    for rect in masks:
        x, y, w, h = [float(rect[k]) for k in ('x', 'y', 'w', 'h')]
        if not all(np.isfinite([x, y, w, h])) or min(x, y) < 0 or min(w, h) <= 0 or x+w > info['width'] or y+h > info['height']:
            raise ValueError('Exclusion rectangles must lie inside the detector image.')
        value['masks'].append(dict(x=x, y=y, w=w, h=h))
    edits = supplied.get('peak_edits', [])
    if not isinstance(edits, list) or len(edits) > 200:
        raise ValueError('Use at most 200 peak edits; undo or reset edits first.')
    value['peak_edits'] = []
    for edit in edits:
        if not isinstance(edit, dict) or edit.get('action') not in ('add', 'remove'):
            raise ValueError('Peak edits must add or remove an observation.')
        x, y, radius = [float(edit[k]) for k in ('x', 'y', 'radius_px')]
        if not all(np.isfinite([x,y,radius])) or not (0 <= x < info['width'] and 0 <= y < info['height'] and 1 <= radius <= 50):
            raise ValueError('Peak edits need detector coordinates and a radius of 1–50 pixels.')
        value['peak_edits'].append(dict(action=edit['action'], x=x, y=y, radius_px=radius))
    return value


def manual_spot(array, settings, x, y):
    """Measure local contrast at an operator-selected coordinate, without inventing intensity."""
    h,w = array.shape
    radius = max(5, int(4*settings['spot_sigma_px']))
    x0,x1=max(0,int(x)-radius),min(w,int(x)+radius+1)
    y0,y1=max(0,int(y)-radius),min(h,int(y)+radius+1)
    yy,xx=np.mgrid[y0:y1,x0:x1]; patch=array[y0:y1,x0:x1]
    annulus=patch[np.hypot(xx-x,yy-y)>=radius*.65]
    background=float(np.median(annulus))
    spread=max(float(1.4826*np.median(abs(annulus-background))), 1e-6)
    intensity=float(map_coordinates(array,[[y],[x]],order=1)[0])
    contrast=max(0.,(intensity-background)/spread)
    sx,sy=settings['pixel_x_nm_inv'],settings['pixel_y_nm_inv']
    return dict(x_px=x,y_px=y,q=[(x-settings['center_x'])*sx,(settings['center_y']-y)*sy],
                local_contrast=contrast,enrichment=float(np.log1p(contrast)),intensity=intensity,
                width_nm_inv=2.355*settings['spot_sigma_px']*max(sx,sy),
                width_px=2.355*settings['spot_sigma_px'],manual=True)


def edit_spots(array, settings, spots):
    """Replay ordered pixel-coordinate edits on a copy; never mutate cached detections."""
    result=list(spots)
    for edit in settings.get('peak_edits', []):
        x,y,r=edit['x'],edit['y'],edit['radius_px']
        result=[p for p in result if np.hypot(p['x_px']-x,p['y_px']-y)>r]
        if edit['action']=='add':
            spot=manual_spot(array,settings,x,y)
            q=spot['q']; g=np.linalg.norm(q)
            if g>0 and settings['exclude_radius_nm_inv'] <= g <= settings.get('g_max',10.) and visible([q],settings,array.shape)[0]:
                result.append(spot)
    return result


def snap_peak(array, settings, x, y, radius=12):
    """Bounded native-pixel search with light smoothing; no model prediction involved."""
    h,w=array.shape
    if not np.isfinite([x,y,radius]).all() or not (0<=x<w and 0<=y<h and 1<=radius<=50):
        raise ValueError('Choose a point inside the detector and a snap radius of 1–50 px.')
    x0,x1=max(0,int(x-radius)-3),min(w,int(x+radius)+4)
    y0,y1=max(0,int(y-radius)-3),min(h,int(y+radius)+4)
    from scipy.ndimage import gaussian_filter
    signal=gaussian_filter(array[y0:y1,x0:x1].astype(float),1.)
    yy,xx=np.mgrid[y0:y1,x0:x1]
    sx,sy=settings['pixel_x_nm_inv'],settings['pixel_y_nm_inv']
    q=np.c_[((xx-settings['center_x'])*sx).ravel(),((settings['center_y']-yy)*sy).ravel()]
    good=(np.hypot(xx-x,yy-y)<=radius)&visible(q,settings,array.shape).reshape(xx.shape)&(np.linalg.norm(q,axis=1).reshape(xx.shape)<=settings.get('g_max',10.))
    if not good.any():raise ValueError('That location is outside the fitting band or inside an exclusion.')
    iy,ix=np.unravel_index(np.argmax(np.where(good,signal,-np.inf)),signal.shape)
    return dict(x=float(ix+x0),y=float(iy+y0))


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
        # Duplicate signed detections are removed before pairing. Only opposite
        # observations can join here; close resolved spots on the same side
        # must not become one profile merely because the pairing radius is wide.
        group = next((p for p in profiles
                      if min(np.linalg.norm(q-p['q']), np.linalg.norm(q+p['q'])) < radius
                      and all(np.dot(spot['q'], s['q']) < 0 for s in p['spots'])), None)
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


def _spot_scales(minimum):
    scales = [float(minimum)]
    while scales[-1] < 32:
        scales.append(scales[-1]*2)
    return scales


def _deduplicate_spots(spots, minimum):
    """Suppress repeated signed centroids inside one measured spot footprint.

    Process the strongest blob response first. This deliberately does not fold
    opposite spots or depend on a predicted crystal structure.
    """
    kept = []
    for spot in sorted(spots, key=lambda p: p['response'], reverse=True):
        if any(np.hypot(spot['x_px']-p['x_px'], spot['y_px']-p['y_px']) <
               max(1.5*minimum, .75*max(spot['width_px'], p['width_px'])) for p in kept):
            continue
        kept.append(spot)
    return kept


# Native Gaussian filters release the GIL. Bound both threads and queued arrays.
def smoothing_worker_count(requested=0):
    if isinstance(requested, bool) or not isinstance(requested, int) or not 0 <= requested <= 8:
        raise ValueError('Use Auto (0) or 1–8 diffraction smoothing threads.')
    return min(requested or 2, os.cpu_count() or 1)


def _scale_blurs(raw, valid, widths, workers=0):
    from concurrent.futures import ThreadPoolExecutor
    from collections import deque
    workers = smoothing_worker_count(workers)
    weighted = raw*valid
    mask = valid.astype(np.float32)
    def blur(width):
        return gaussian_filter(weighted, width)/np.maximum(gaussian_filter(mask, width), 1e-6)
    if workers <= 1:
        yield from map(blur, widths)
        return
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix='tem-spots') as pool:
        pending = deque()
        widths = iter(widths)
        for width in widths:
            pending.append(pool.submit(blur, width))
            if len(pending) >= workers:
                yield pending.popleft().result()
        while pending:
            yield pending.popleft().result()


def _spot_candidates(raw, valid, band, scales, workers=0):
    # Compare blob responses across sizes. A small annulus inside a broad spot
    # mistakes the spot itself for noisy background; each size gets its own
    # background annulus outside that feature. No crystal predictions enter here.
    blurred = _scale_blurs(raw, valid, [scales[0], *(2*s for s in scales)], workers)
    smooth = next(blurred)
    previous = smooth
    fields = []
    for following in blurred:
        fields.append(previous-following)
        previous = following
    spots = []
    for k, (scale, field) in enumerate(zip(scales, fields)):
        noise = max(1e-6, 1.4826*float(np.median(abs(field[band]-np.median(field[band]))))) if band.any() else 1.
        maxima = band & (field > 2*noise) & (field == maximum_filter(field, 2*max(1, int(round(scale)))+1))
        if k:
            maxima &= field > fields[k-1]
        if k+1 < len(fields):
            maxima &= field >= fields[k+1]
        ys, xs = np.where(maxima)
        order = np.argsort(field[ys, xs])[::-1][:250]
        outer = int(np.ceil(8*scale))
        gy, gx = np.mgrid[-outer:outer+1, -outer:outer+1]
        distance = np.hypot(gx, gy)
        annulus_mask = (distance >= 4*scale) & (distance <= 8*scale)
        core_mask = distance <= 3*scale
        for i in order:
            y, x = int(ys[i]), int(xs[i])
            if min(x, y, raw.shape[1]-1-x, raw.shape[0]-1-y) < outer:
                continue
            sl = np.s_[y-outer:y+outer+1, x-outer:x+outer+1]
            ring = annulus_mask & valid[sl]
            if ring.sum() < 24 or not valid[y-max(1,int(scale)):y+max(1,int(scale))+1,
                                                     x-max(1,int(scale)):x+max(1,int(scale))+1].all():
                continue
            background = float(np.median(field[sl][ring]))
            spread = max(.25*noise, 1.4826*float(np.median(abs(field[sl][ring]-background))), 1e-6)
            contrast = float((field[y, x]-background)/spread)
            if contrast < 2.:
                continue
            # Refine on native pixels at the user's minimum smoothing, using a
            # neighbourhood sized to this blob. Keep one centre for a broad core.
            patch = smooth[sl]
            bg = float(np.median(patch[ring]))
            # A blob must also rise above the background in the smoothed
            # detector intensity, not just in the difference-of-Gaussians field.
            native_spread = max(.25*noise, 1.4826*float(np.median(abs(patch[ring]-bg))), 1e-6)
            contrast = min(contrast, float((smooth[y, x]-bg)/native_spread))
            if contrast < 2.:
                continue
            weights = np.maximum(patch-(bg+.2*max(0., float(smooth[y, x])-bg)), 0)*valid[sl]*core_mask
            total = float(weights.sum())
            if not total:
                continue
            dx, dy = float((weights*gx).sum()/total), float((weights*gy).sum()/total)
            vx = float((weights*(gx-dx)**2).sum()/total)
            vy = float((weights*(gy-dy)**2).sum()/total)
            spots.append({'x_px': x+dx, 'y_px': y+dy, 'local_contrast': contrast,
                          'response': float(field[y, x]), 'width_px': 2.355*np.sqrt((vx+vy)/2),
                          'variance_x': vx, 'variance_y': vy, 'detection_sigma_px': scale})
    return spots


def _prepare_detector(array, settings):
    h, w = array.shape
    sx, sy = settings['pixel_x_nm_inv'], settings['pixel_y_nm_inv']
    cx, cy = settings['center_x'], settings['center_y']
    sigma = settings['spot_sigma_px']
    scales = _spot_scales(sigma)
    pad = int(np.ceil(8*scales[-1]))
    g_max = settings.get('g_max', DEFAULT_G_MAX)
    span = g_max*1.05
    x0, x1 = max(0, int(cx-span/sx)-pad), min(w, int(np.ceil(cx+span/sx))+pad+1)
    y0, y1 = max(0, int(cy-span/sy)-pad), min(h, int(np.ceil(cy+span/sy))+pad+1)
    raw = array[y0:y1, x0:x1].astype(np.float32)
    yy, xx = np.indices(raw.shape)
    qx, qy = (xx+x0-cx)*sx, (cy-yy-y0)*sy
    g = np.hypot(qx, qy)
    valid = visible(np.c_[qx.ravel(), qy.ravel()], settings, array.shape).reshape(raw.shape)
    band = valid & (g > 0) & (g >= settings['exclude_radius_nm_inv']) & (g <= g_max)
    candidates = _spot_candidates(raw, valid, band, scales, settings.get('smoothing_workers', 0))
    deduplicated = _deduplicate_spots(candidates, sigma)
    spots = []
    for spot in deduplicated:
        px, py = spot['x_px']+x0, spot['y_px']+y0
        q = np.array([(px-cx)*sx, (cy-py)*sy])
        if not settings['exclude_radius_nm_inv'] <= np.linalg.norm(q) <= g_max or np.linalg.norm(q)==0 or not visible([q], settings, array.shape)[0]:
            continue
        spot.update(q=q.tolist(), x_px=px, y_px=py,
                    enrichment=float(np.log1p(spot['local_contrast'])),
                    width_nm_inv=float(2.355*np.sqrt((spot['variance_x']*sx*sx+spot['variance_y']*sy*sy)/2)),
                    intensity=float(array[int(round(py)), int(round(px))]))
        spots.append(spot)
    # Display resampling is separate from the native-pixel detector and fitting.
    axis = np.linspace(-span, span, 768)
    ax, ay = np.meshgrid(axis, axis[::-1])
    image = map_coordinates(array, [cy-ay/sy, cx+ax/sx], order=1, mode='constant', cval=0., prefilter=False)
    log = np.log1p(np.maximum(image, 0))
    return {'spots': spots, 'log': log, 'scales': scales, 'can_index': bool(band.any()),
            'duplicate_count': len(candidates)-len(deduplicated)}


def _cached_detector(array, settings, cache):
    sx, sy = settings['pixel_x_nm_inv'], settings['pixel_y_nm_inv']
    key = (settings.get('g_max', DEFAULT_G_MAX), array.__array_interface__['data'][0], array.shape, array.strides,
           settings['center_x'], settings['center_y'], sx, sy, settings['spot_sigma_px'],
           settings['exclude_radius_nm_inv'],
           tuple(tuple(r[k] for k in ('x', 'y', 'w', 'h')) for r in settings['masks']))
    entries = cache.setdefault('entries', []) if cache is not None else []
    for i, (previous, prepared) in enumerate(entries):
        if previous == key:
            entries.append(entries.pop(i))
            return prepared
    prepared = _prepare_detector(array, settings)
    if cache is not None:
        entries.append((key, prepared))
        del entries[:-2]  # The starting and fitted centres; no accumulating image cache.
    return prepared


def refine_translation(spots, settings, shape):
    """Fit a shared origin to independent opposite-spot midpoints in detector pixels.

    For a signed pair p+=c+g, p-=c-g, its midpoint measures c independently
    of g (and hence of crystal phase, scale and rotation). Robust positional
    least squares estimates two translations; intensities need not be equal.
    The search is local to the user's anchor and never advances that anchor.
    """
    anchor = np.array([settings['center_x'], settings['center_y']])
    limit = settings.get('max_center_shift_px', 50.)
    report = {'version': CENTER_REFINEMENT_VERSION, 'enabled': settings.get('refine_center', True),
              'status': 'disabled', 'applied': False, 'starting_center_px': anchor.tolist(),
              'fitted_center_px': anchor.tolist(), 'shift_px': [0., 0.],
              'prediction_translation_nm_inv': [0., 0.], 'max_shift_px': limit,
              'pair_count': 0, 'rms_before_px': None, 'rms_after_px': None,
              'near_limit': False}
    if not report['enabled']:
        report['reason'] = 'Translation is fixed at the selected centre.'
        return report
    strong = sorted((p for p in spots if p['local_contrast'] >= settings['spot_snr']),
                    key=lambda p: p['local_contrast'], reverse=True)[:160]
    report.update(status='insufficient_pairs', reason='Fewer than three consistent opposite-spot pairs in two directions within the shift limit; starting centre retained.')
    if len(strong) < 6:
        return report
    points = np.array([[p['x_px'], p['y_px']] for p in strong])
    tolerance = float(np.clip(.20*np.median([p['width_px'] for p in strong]), 1., 6.))
    i, j = np.triu_indices(len(points), 1)
    midpoints = (points[i]+points[j])/2
    keep = ((np.linalg.norm(midpoints-anchor, axis=1) <= limit+2*tolerance) &
            (np.sum((points[i]-anchor)*(points[j]-anchor), axis=1) < 0))
    i, j, midpoints = i[keep], j[keep], midpoints[keep]
    if len(midpoints) < 3:
        return report
    groups = cKDTree(midpoints).query_ball_point(midpoints, 2*tolerance)
    solutions = []
    for seed in sorted(range(len(groups)), key=lambda k: len(groups[k]), reverse=True):
        if len(groups[seed]) < 3:
            break
        centre = np.median(midpoints[groups[seed]], axis=0)
        if any(np.linalg.norm(centre-p['centre']) < 2*tolerance for p in solutions):
            continue
        chosen = []
        for _ in range(3):
            distance = np.linalg.norm(midpoints-centre, axis=1)
            used, chosen = set(), []
            for k in np.argsort(distance):
                if distance[k] > 2*tolerance:
                    break
                if int(i[k]) in used or int(j[k]) in used:
                    continue
                chosen.append(int(k));used.update((int(i[k]), int(j[k])))
            if len(chosen) < 3:
                break
            centres = midpoints[chosen]
            centre = least_squares(lambda c: (2*(c-centres)).ravel(), centre,
                                   loss='soft_l1', f_scale=2*tolerance).x
        if len(chosen) < 3:
            continue
        chosen = np.array(chosen)
        chosen = chosen[np.linalg.norm(midpoints[chosen]-centre, axis=1) <= tolerance]
        if len(chosen) < 3:
            continue
        centres = midpoints[chosen]
        centre = least_squares(lambda c: (2*(c-centres)).ravel(), np.median(centres, axis=0),
                               loss='soft_l1', f_scale=2*tolerance).x
        directions = points[i[chosen]]-centre
        directions /= np.linalg.norm(directions, axis=1)[:, None]
        if np.max(abs(directions[:, 0, None]*directions[None, :, 1]-
                      directions[:, 1, None]*directions[None, :, 0])) < np.sin(np.radians(20)):
            continue
        rms = float(np.sqrt(np.mean(np.sum((2*(centres-centre))**2, axis=1))))
        solutions.append({'centre': centre, 'chosen': chosen, 'rms': rms})
    if not solutions:
        return report
    solutions.sort(key=lambda p: (-len(p['chosen']), p['rms'], np.linalg.norm(p['centre']-anchor)))
    best = solutions[0];centre = best['centre'];chosen = best['chosen']
    if any(len(p['chosen']) >= max(3, .85*len(chosen)) and
           np.linalg.norm(p['centre']-centre) > 2*tolerance for p in solutions[1:]):
        report.update(status='ambiguous', reason='Competing opposite-spot centres within the search neighbourhood; starting centre retained. Narrow the limit or place the centre closer.')
        return report
    shift = centre-anchor
    if np.linalg.norm(shift) > limit or not (0 <= centre[0] < shape[1] and 0 <= centre[1] < shape[0]):
        report.update(status='outside_limit', reason='The supported centre lies outside the translation limit; starting centre retained.')
        return report
    before = float(np.sqrt(np.mean(np.sum((2*(midpoints[chosen]-anchor))**2, axis=1))))
    report.update(status='refined', applied=True, fitted_center_px=centre.tolist(), shift_px=shift.tolist(),
                  prediction_translation_nm_inv=[float(shift[0]*settings['pixel_x_nm_inv']),
                                                  float(-shift[1]*settings['pixel_y_nm_inv'])],
                  pair_count=len(chosen), rms_before_px=before, rms_after_px=best['rms'],
                  pair_midpoints_px=midpoints[chosen].tolist(),
                  near_limit=bool(np.linalg.norm(shift) >= .95*limit),
                  reason='One shared translation fitted from opposite-spot positions before crystal rotation and scale fitting.')
    return report


def spectrum(array, settings, cache=None, g_max=10.):
    """Analyze detector spots, optionally refining a shared translation first.

    Keep input settings as the reproducible starting point. Only the working
    centre changes; native pixels and reciprocal pixel calibration are untouched.
    """
    h, w = array.shape
    settings = {**settings, 'g_max': g_max}
    g_min = settings['exclude_radius_nm_inv']
    if not 0 <= g_min < g_max:
        raise ValueError('Central exclusion must be smaller than the outer fitting limit.')
    prepared = _cached_detector(array, settings, cache)
    translation = refine_translation(edit_spots(array, settings, prepared['spots']), settings, array.shape)
    if translation['applied']:
        cx, cy = translation['fitted_center_px']
        settings = {**settings, 'center_x': cx, 'center_y': cy}
        # Recheck masks and the fitting band at the fitted origin. Cache both passes.
        prepared = _cached_detector(array, settings, cache)
    sx, sy = settings['pixel_x_nm_inv'], settings['pixel_y_nm_inv']
    cx, cy = settings['center_x'], settings['center_y']
    sigma = settings['spot_sigma_px']
    spots = [p for p in edit_spots(array, settings, prepared['spots']) if p.get('manual') or p['local_contrast'] >= min(3., settings['spot_snr'])]
    strong = [p for p in spots if p.get('manual') or p['local_contrast'] >= settings['spot_snr']]
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
                      'observed_spots': [s['q'] for s in p['spots']],
                      'manual_observed_spots': [s['q'] for s in p['spots'] if s.get('manual')]})
    maxima = []
    for p in _profiles([s for s in spots if not s.get('manual') and s['local_contrast'] < settings['spot_snr']], radius):
        if any(min(np.linalg.norm(p['q']-[s['qx'], s['qy']]), np.linalg.norm(p['q']+[s['qx'], s['qy']])) < radius for s in peaks):
            continue
        strongest = max(p['spots'], key=lambda s: s['local_contrast'])
        maxima.append({'weak_id': len(maxima)+1, 'q': p['q'].tolist(),
                       'observed_spots': [s['q'] for s in p['spots']],
                       'strength': min(.5, (strongest['local_contrast']-1)/6),
                       'local_contrast': strongest['local_contrast'], 'enrichment': strongest['enrichment']})
    context = {'maxima': maxima, 'radius': radius, 'g_min': g_min, 'g_max': g_max, 'x_limit': max(cx, w-1-cx)*sx,
               'y_limit': max(cy, h-1-cy)*sy,
               'visible': lambda q: visible(q, settings, array.shape, radius) | visible(-q, settings, array.shape, radius)}
    complete_band = min(cx*sx, (w-1-cx)*sx, cy*sy, (h-1-cy)*sy) >= g_max
    result = {'kind': 'diffraction', 'log': prepared['log'], 'extent': [-g_max*1.05, g_max*1.05, -g_max*1.05, g_max*1.05], 'g_min': g_min, 'g_max': g_max,
              'peak_edit_count': len(settings.get('peak_edits', [])), 'peaks': peaks, 'df': max(sx, sy), 'peak_width_nm_inv': width,
              'weak_maxima': maxima, 'profile_threshold': settings['spot_snr'],
              'observed_spot_count': sum(len(p['observed_spots']) for p in peaks),
              'beam_center_px': [cx, cy], 'center_refinement': translation, 'reciprocal_pixel_size': [sx, sy],
              'full_band_on_detector': complete_band, 'can_index': prepared['can_index'],
              'mask_count': len(settings['masks']), 'detector': VERSION,
              'detection_scales_px': prepared['scales'], 'duplicate_count': prepared['duplicate_count']}
    return result, context
