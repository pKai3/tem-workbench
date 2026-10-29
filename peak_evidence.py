"""Exploratory prediction-site checks, separate from initial peak detection.

Local maxima are found without reference to any crystal template. Each model
can claim a weak maximum at most once. Opposite Fourier spots are one profile.
The local contrast and rotated controls are heuristics, not p-values or a CTF.
"""
import numpy as np
from scipy.ndimage import gaussian_filter, maximum_filter
from scipy.optimize import linear_sum_assignment
import analysis_core as core

VERSION = 'local-maxima-v1'
DEFAULT_WEIGHT = .10


def prepare(spectrum, shape, sx, sy):
    log = spectrum['log']
    h, w = shape
    g_max = spectrum.get('g_max', 10.)
    g_min = spectrum.get('g_min', 3.)
    fx = core.fftshift(core.fftfreq(w, sx)); fx = fx[abs(fx) <= g_max*1.05]
    fy = -core.fftshift(core.fftfreq(h, sy)); fy = fy[abs(fy) <= g_max*1.05]
    xx, yy = np.meshgrid(fx, fy)
    g = np.hypot(xx, yy); df = spectrum['df']
    radial_bin = np.floor(g/df).astype(int)
    count = np.bincount(radial_bin.ravel())
    radial_mean = np.bincount(radial_bin.ravel(), weights=log.ravel())/np.maximum(count, 1)
    residual = gaussian_filter(log-radial_mean[radial_bin], .65)
    radius = max(.10, core.peak_width(spectrum))
    mask = ((residual == maximum_filter(residual, size=3, mode='nearest')) &
            (residual >= 1.8) & (g > 0) & (g >= g_min) & (g <= g_max) &
            ((yy > 1e-8) | ((abs(yy) < 1e-8) & (xx > 0))))
    strong = np.array([[p['qx'], p['qy']] for p in spectrum['peaks']]).reshape(-1, 2)
    candidates = []
    dx, dy = 1/(w*sx), 1/(h*sy)
    rx, ry = int(np.ceil(4*radius/dx)), int(np.ceil(4*radius/dy))
    for y, x in np.argwhere(mask):
        q = np.array([fx[x], fy[y]])
        if len(strong) and np.minimum(np.linalg.norm(strong-q, axis=1), np.linalg.norm(strong+q, axis=1)).min() < radius:
            continue  # Do not count a strong profile or its shoulder again.
        x0, x1 = max(0, x-rx), min(len(fx), x+rx+1)
        y0, y1 = max(0, y-ry), min(len(fy), y+ry+1)
        distance = np.hypot(xx[y0:y1, x0:x1]-q[0], yy[y0:y1, x0:x1]-q[1])
        annulus = residual[y0:y1, x0:x1][(distance >= 2*radius) & (distance <= 4*radius)]
        if len(annulus) < 24:
            continue
        background = float(np.median(annulus))
        noise = max(.15, 1.4826*float(np.median(abs(annulus-background))))
        prominence = (float(residual[y, x])-background)/noise
        if prominence < 2.:
            continue
        candidates.append({'q': q.tolist(), 'enrichment': float(residual[y, x]),
                           'local_contrast': prominence, 'background': background,
                           'background_spread': noise,
                           'strength': min(.5, (prominence-1)/6)})
    # One weak feature per window-broadened profile, independent of phase.
    maxima = []
    for peak in sorted(candidates, key=lambda p: p['enrichment'], reverse=True):
        q = np.array(peak['q'])
        if any(min(np.linalg.norm(q-np.array(p['q'])), np.linalg.norm(q+np.array(p['q']))) < radius for p in maxima):
            continue
        peak['weak_id'] = len(maxima)+1
        maxima.append(peak)
    return {'maxima': maxima, 'radius': radius, 'g_min': g_min, 'g_max': g_max,
            'x_limit': float(min(abs(fx[0]), abs(fx[-1]))),
            'y_limit': float(min(abs(fy[0]), abs(fy[-1])))}


def qualities(points, maxima, radius):
    if not len(maxima):
        return np.zeros((len(points), 0)), np.zeros((len(points), 0))
    q = np.array([p['q'] for p in maxima])
    distance = np.minimum(np.linalg.norm(points[:, None]-q[None], axis=2),
                          np.linalg.norm(points[:, None]+q[None], axis=2))
    quality = np.exp(-.5*(distance/(radius/2))**2)*np.array([p['strength'] for p in maxima])
    quality[distance > radius] = 0
    return quality, distance


def inspect(model, context):
    points = np.array([node['q'] for node in model['predicted_nodes']])
    n = len(points); radius = context['radius']; maxima = context['maxima']
    assigned = {m['node_index'] for m in model['matches']}
    separations = np.minimum(np.linalg.norm(points[:, None]-points[None], axis=2),
                             np.linalg.norm(points[:, None]+points[None], axis=2))
    np.fill_diagonal(separations, np.inf)
    radii = np.linalg.norm(points, axis=1)
    assessable = ((radii-radius >= context.get('g_min', 3.)) & (radii+radius <= context.get('g_max', 10.)) &
                  (abs(points[:, 0])+radius <= context['x_limit']) &
                  (abs(points[:, 1])+radius <= context['y_limit']) &
                  (separations.min(axis=1) >= radius))
    if 'visible' in context:
        assessable &= context['visible'](points)
    quality, distance = qualities(points, maxima, radius)
    eligible = assessable.copy()
    for i in assigned:
        eligible[i] = False
    quality[~eligible] = 0
    chosen = {}
    if len(maxima):
        rows, cols = linear_sum_assignment(np.c_[-quality, np.zeros((n, n))])
        chosen = {int(i): int(j) for i, j in zip(rows, cols) if j < len(maxima) and quality[i, j] > 0}
    nodes = []
    for i in range(n):
        record = {'node_index': i, 'status': 'detected' if i in assigned else
                  'weak' if i in chosen else 'unsupported' if assessable[i] else 'unassessable'}
        if i in chosen:
            j = chosen[i]; peak = maxima[j]
            record.update(weak_id=peak['weak_id'], observed_q=peak['q'],
                          local_contrast=peak['local_contrast'], enrichment=peak['enrichment'],
                          offset_nm_inv=float(distance[i, j]), quality=float(quality[i, j]))
            if 'observed_spots' in peak:
                record['observed_spots'] = peak['observed_spots']
        nodes.append(record)
    # Same radii, different angles: subtract average chance weak-spot support.
    controls = []
    for angle in (-75, -60, -45, -30, -15, 15, 30, 45, 60, 75, 90):
        rotated = core.rotation(points, np.radians(angle))
        control, _ = qualities(rotated, maxima, radius)
        control[~eligible] = 0
        if 'visible' in context:
            control[~context['visible'](rotated)] = 0
        control[(abs(rotated[:, 0])+radius > context['x_limit']) |
                (abs(rotated[:, 1])+radius > context['y_limit'])] = 0
        rows, cols = linear_sum_assignment(np.c_[-control, np.zeros((n, n))])
        controls.append(sum(float(control[i, j]) for i, j in zip(rows, cols) if j < len(maxima))/n)
    weak_support = sum(row.get('quality', 0.) for row in nodes)/max(n, 1)
    control_support = float(np.mean(controls))
    unsupported = sum(row['status'] == 'unsupported' for row in nodes)
    unassessable = sum(row['status'] == 'unassessable' for row in nodes)
    model['peak_evidence'] = {
        'version': VERSION, 'nodes': nodes, 'detected_count': len(assigned),
        'weak_count': len(chosen), 'unsupported_count': unsupported,
        'unassessable_count': unassessable, 'search_radius_nm_inv': radius,
        'weak_support': weak_support, 'control_support': control_support,
        'bonus_factor': max(0., weak_support-control_support),
        'missing_factor': unsupported/max(n-unassessable, 1)}
    return model


def apply(model, weight):
    weight = float(weight)
    if not np.isfinite(weight) or not 0 <= weight <= .5:
        raise ValueError('Peak evidence weight must be between 0 and 0.5.')
    evidence = model.get('peak_evidence', {})
    bonus = weight*evidence.get('bonus_factor', 0.)
    missing = weight*evidence.get('missing_factor', 0.)
    model.update(weak_peak_bonus=bonus, missing_peak_penalty=missing, peak_evidence_weight=weight)
    model['score'] = model['position_score']-model.get('scale_penalty', 0.)+bonus-missing
    # Weak peaks may rerank an existing fit, but do not supply the four-profile
    # screen or the unique-profile evidence needed for a second structure.
    model['valid'] = bool(model['position_valid'] and model['score'] > .20)
    return model
