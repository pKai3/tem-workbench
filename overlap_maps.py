"""Fixed square windows on square/triangular centres; explicit overlap aggregation.

These are spatial support frequencies, never physical phase fractions. Each pass
is normalized separately before equal-pass averaging. Missing fits count as no
passing support; rank is averaged only where a candidate exists.
"""
import math
import numpy as np

VERSION = 'overlap-v1'
MAX_WINDOWS = 5000


def sampling(info, options):
    if not isinstance(options, dict):
        raise ValueError('Overlapping map settings must be an object.')
    width = float(options.get('window_nm', 5))
    spacing = float(options.get('spacing_nm', 2.5))
    layout = options.get('layout', 'hex')
    passes = options.get('passes', 1)
    if not all(math.isfinite(v) and v > 0 for v in (width, spacing)):
        raise ValueError('Window width and centre spacing must be positive finite values.')
    if layout not in ('hex', 'square') or type(passes) is not int or passes not in (1, 3, 7):
        raise ValueError('Choose hex/square centres and 1, 3 or 7 placement passes.')
    if spacing > width:
        raise ValueError('Centre spacing must not exceed window width.')
    # Square in real space; anisotropic pixels may require rectangular arrays.
    w, h = [int(round(width/info[key])) for key in ('pixel_x_nm', 'pixel_y_nm')]
    if min(w, h) < 32 or w > info['width'] or h > info['height']:
        raise ValueError('Windows must fit the image and be at least 32 pixels on each side.')
    sx, sy = spacing/info['pixel_x_nm'], spacing/info['pixel_y_nm']
    sy *= math.sqrt(3)/2 if layout == 'hex' else 1
    if min(sx, sy) < 1:
        raise ValueError('Centre spacing must be at least one pixel.')
    # Fractions of the two lattice basis vectors, not random jitter.
    offsets = [(0., 0.), (1/3, 1/3), (2/3, 2/3), (1/3, 0.), (0., 1/3), (2/3, 0.), (0., 2/3)][:passes]
    samples = []
    for pass_id, (u, v) in enumerate(offsets):
        dx, dy = (u + (v/2 if layout == 'hex' else 0))*sx, v*sy
        seen = set()
        for row in range(-2, int((info['height']-h)/sy)+3):
            y = int(round(row*sy+dy))
            if y < 0 or y+h > info['height']:
                continue
            for col in range(-2, int((info['width']-w)/sx)+3):
                x = int(round((col + (row % 2)/2 if layout == 'hex' else col)*sx+dx))
                if x < 0 or x+w > info['width'] or (x, y) in seen:
                    continue
                seen.add((x, y))
                samples.append(dict(roi=dict(x=x, y=y, w=w, h=h), pass_id=pass_id))
                if len(samples) > MAX_WINDOWS:
                    raise ValueError(f'Map exceeds {MAX_WINDOWS} windows. Increase spacing, reduce passes or use a larger window.')
    if not samples or {s['pass_id'] for s in samples} != set(range(passes)):
        raise ValueError('Some placement passes have no full windows. Reduce window size or number of passes.')
    return samples, dict(mode='overlap', version=VERSION, layout=layout, window_nm=width,
                        spacing_nm=spacing, passes=passes, offsets_basis=offsets,
                        actual_window_px=[w,h], actual_window_nm=[w*info['pixel_x_nm'], h*info['pixel_y_nm']],
                        sample_count=len(samples), edge_policy='full_windows_only', adaptive=False)


def aggregate(job, resolution=64):
    """Evaluate a fixed raster at pixel centres. Weight exp(-8*(dx²+dy²))
    inside each square footprint, with dx/dy normalized by window width/height.
    Raster resolution is display sampling, not measurement resolution.
    """
    source, options = job['source'], job['grid']
    phases = job['settings'].get('enabled_phases', ['HCP','BCC','FCC'])
    nx = resolution
    ny = max(1, round(resolution*source['height']/source['width']))
    xs = (np.arange(nx)+.5)*source['width']/nx
    ys = (np.arange(ny)+.5)*source['height']/ny
    xx, yy = np.meshgrid(xs, ys)
    shape = (options['passes'], ny, nx)
    weights = np.zeros(shape); counts = np.zeros((ny,nx), dtype=int)
    best_weight = np.zeros((ny,nx)); representative = np.full((ny,nx), '', dtype=object)
    supported = {p:np.zeros(shape) for p in phases}
    ranks = {p:np.zeros(shape) for p in phases}
    present = {p:np.zeros(shape) for p in phases}
    separate = np.zeros(shape)
    for region in job['regions']:
        roi = region['roi']; k = region['pass_id']
        dx = (xx-roi['x']-roi['w']/2)/roi['w']
        dy = (yy-roi['y']-roi['h']/2)/roi['h']
        inside = (np.abs(dx)<.5)&(np.abs(dy)<.5)
        weight = np.where(inside, np.exp(-8*(dx*dx+dy*dy)), 0.)
        weights[k] += weight; counts += inside
        closer = weight > best_weight
        representative[closer] = region['id']; best_weight[closer] = weight[closer]
        if region['classification']['label'] == 'coexisting_candidates':
            separate[k] += weight
        for phase in phases:
            models = [m for m in region['models'] if m['phase']==phase]
            passing = [m for m in models if m['valid']]
            if passing:
                supported[phase][k] += weight
            if models:
                # Same passing-first selection as grid best_zones; otherwise best rejected.
                model = max(passing or models, key=lambda m:m['score'])
                ranks[phase][k] += weight*model['score']; present[phase][k] += weight
    available = weights > 0
    pass_counts = available.sum(axis=0)
    def per_pass(values, denominator=weights):
        return np.divide(values, denominator, out=np.zeros_like(values), where=denominator>0)
    def mean_pass(values, mask=available):
        return np.divide((values*mask).sum(axis=0), mask.sum(axis=0), out=np.zeros((ny,nx)), where=mask.sum(axis=0)>0)
    fields = {}
    for phase in phases:
        frequency = per_pass(supported[phase])
        spread = np.where(available, frequency, -np.inf).max(axis=0)-np.where(available, frequency, np.inf).min(axis=0)
        spread[pass_counts<2] = 0
        rank_available = present[phase]>0
        fields[phase] = dict(support=mean_pass(frequency), spread=spread,
                            rank=mean_pass(per_pass(ranks[phase],present[phase]),rank_available),
                            fit_presence=mean_pass(per_pass(present[phase])))
    separate_mean = mean_pass(per_pass(separate))
    cells = []
    for y in range(ny):
        for x in range(nx):
            if not pass_counts[y,x]:continue
            cells.append(dict(x=x, y=y, samples=int(counts[y,x]), passes=int(pass_counts[y,x]),
                              region_id=representative[y,x],
                              phases={p:{key:round(float(value[y,x]),6) for key,value in f.items()} for p,f in fields.items()},
                              separate_support=round(float(separate_mean[y,x]),6)))
    summaries = {p:dict(mean_support=round(float(f['support'][pass_counts>0].mean()),6),
                       mean_fit_presence=round(float(f['fit_presence'][pass_counts>0].mean()),6)) for p,f in fields.items()} if cells else {}
    return dict(version=VERSION, width=nx, height=ny, cells=cells, phases=summaries,
                coverage_percent=100*len(cells)/(nx*ny),
                method='Gaussian centre weight exp(-8*(dx²+dy²)) within footprint; normalize each pass, then equal-pass mean',
                interpretation='Passing-fit frequency, not phase fraction. Missing fits count as no passing support. Rank excludes missing fits. Spread is max-minus-min pass support, not statistical uncertainty. Raster-centre coverage is approximate.')
