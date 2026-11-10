"""Fixed square windows on square/triangular centres; explicit overlap aggregation.

These are spatial support frequencies, never physical phase fractions. Each pass
is normalized separately before equal-pass averaging. Missing fits count as no
passing support; rank is averaged only where a candidate exists.
"""
import math
import numpy as np

VERSION = 'overlap-v6'
MAX_WINDOWS = 10000


def _add_rim(samples, info, w, h, passes):
    """Append full-size, border-anchored windows without moving interior samples."""
    def positions(values, limit, length):
        ordered = sorted({0, limit, *values})
        result = set(ordered)
        # Fill any end gap longer than a window, including pixel-rounding gaps.
        for a, b in zip(ordered, ordered[1:]):
            count = math.ceil((b-a)/length)
            result.update(round(a+(b-a)*i/count) for i in range(1, count))
        return sorted(result)

    counts = []
    for pass_id in range(passes):
        rois = [s['roi'] for s in samples if s['pass_id'] == pass_id]
        seen = {(r['x'], r['y']) for r in rois}
        top, bottom = min(r['y'] for r in rois), max(r['y'] for r in rois)
        xmax, ymax = info['width']-w, info['height']-h
        border = []
        for row, y in ((top, 0), (bottom, ymax)):
            border.extend((x, y) for x in positions([r['x'] for r in rois if r['y'] == row], xmax, w))
        for x in (0, xmax):
            border.extend((x, y) for y in positions([r['y'] for r in rois], ymax, h))
        count = 0
        for x, y in border:
            if (x, y) in seen:
                continue
            seen.add((x, y))
            samples.append(dict(roi=dict(x=x, y=y, w=w, h=h), pass_id=pass_id, rim=True))
            count += 1
            if len(samples) > MAX_WINDOWS:
                raise ValueError(f'Map exceeds {MAX_WINDOWS} windows including the rim. Increase spacing, reduce passes or use a larger window.')
        counts.append(count)
    return counts


def sampling(info, options):
    if not isinstance(options, dict):
        raise ValueError('Overlapping map settings must be an object.')
    size_mode = options.get('size_mode', 'fixed_nm')
    if size_mode not in ('fixed_nm', 'image_percent'):
        raise ValueError('Choose fixed nm or image-relative window size.')
    # Legacy image-relative requests used window-relative spacing implicitly.
    spacing_mode = options.get('spacing_mode', 'window_percent' if size_mode == 'image_percent' else 'fixed_nm')
    if spacing_mode not in ('fixed_nm', 'window_percent'):
        raise ValueError('Choose fixed nm or window-relative centre spacing.')
    sizing = dict(size_mode=size_mode, spacing_mode=spacing_mode)
    if size_mode == 'image_percent':
        percent = float(options.get('window_percent', 10))
        if not (math.isfinite(percent) and .1 <= percent <= 100):
            raise ValueError('Use window 0.1–100% of the shorter image dimension.')
        extent = min(info['width']*info['pixel_x_nm'], info['height']*info['pixel_y_nm'])
        width = extent*percent/100
        sizing.update(window_percent=percent,
                      reference_extent_nm=extent, reference_dimension='shorter_physical_side')
    else:
        width = float(options.get('window_nm', 5))
    if spacing_mode == 'window_percent':
        spacing_percent = float(options.get('spacing_percent', 100))
        if not (math.isfinite(spacing_percent) and 1 <= spacing_percent <= 100):
            raise ValueError('Use spacing 1–100% of the window.')
        spacing = width*spacing_percent/100
        sizing['spacing_percent'] = spacing_percent
    else:
        spacing = float(options.get('spacing_nm', 2.5))
    layout = options.get('layout', 'hex')
    passes = options.get('passes', 1)
    sample_edges = options.get('sample_edges', False)
    if type(sample_edges) is not bool:
        raise ValueError('Sample image rim must be on or off.')
    if not all(math.isfinite(v) and v > 0 for v in (width, spacing)):
        raise ValueError('Window width and centre spacing must be positive finite values.')
    if layout not in ('hex', 'square') or type(passes) is not int or passes not in (1, 3, 7, 9):
        raise ValueError('Choose hex/square centres and 1, 3 or 9 placement passes.')
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
    offsets = [(0., 0.), (1/3, 1/3), (2/3, 2/3), (1/3, 0.), (0., 1/3), (2/3, 0.), (0., 2/3), (1/3, 2/3), (2/3, 1/3)][:passes]
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
    # Centre the complete set together, preserving relative pass offsets and
    # lattice spacing. Integer pixels leave at most a one-pixel margin mismatch.
    shift = []
    for axis, size, extent in (('x', 'w', 'width'), ('y', 'h', 'height')):
        low = min(s['roi'][axis] for s in samples)
        high = max(s['roi'][axis]+s['roi'][size] for s in samples)
        delta = (info[extent]-high-low)//2
        shift.append(delta)
        for sample in samples:
            sample['roi'][axis] += delta
    rim_counts = _add_rim(samples, info, w, h, passes) if sample_edges else [0]*passes
    return samples, dict(mode='overlap', version=VERSION, **sizing, layout=layout, window_nm=width,
                        spacing_nm=spacing, passes=passes, offsets_basis=offsets,
                        actual_window_px=[w,h], actual_window_nm=[w*info['pixel_x_nm'], h*info['pixel_y_nm']],
                        sample_count=len(samples), sample_edges=sample_edges, rim_sample_count=sum(rim_counts),
                        rim_samples_per_pass=rim_counts,
                        edge_policy='full_windows_with_boundary_rim' if sample_edges else 'full_windows_only',
                        placement_origin='centred_sample_bounds', centering_shift_px=shift, adaptive=False)


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
    result = _aggregate_points(job, xx, yy)
    # Evaluate the same readings directly at hex centres, not raster winners.
    # A display cap bounds work for unusually fine spacing and large windows.
    spacing = options.get('spacing_nm', options.get('window_nm', 5)/2)
    physical_area = source['width']*source['pixel_x_nm']*source['height']*source['pixel_y_nm']
    spacing = max(spacing, math.sqrt(physical_area/(4000*math.sqrt(3)/2)))
    sx, sy = spacing/source['pixel_x_nm'], spacing/source['pixel_y_nm']*math.sqrt(3)/2
    rows = max(1, int(source['height']/sy))
    cols = max(1, int(source['width']/sx))
    points = [(col*sx+(row%2)*sx/2, row*sy) for row in range(rows) for col in range(cols)]
    ox = (source['width']-max(x for x,y in points))/2
    oy = (source['height']-max(y for x,y in points))/2
    if options.get('sample_edges', False):
        # Continue the same display lattice across the border. Its outer tiles
        # are evaluated at the nearest in-image pixel centre and still clipped
        # by both renderers to the footprints of actually completed windows.
        points = [(col*sx+(row%2)*sx/2+ox, row*sy+oy)
                  for row in range(-1, rows+1) for col in range(-1, cols+1)]
        points = [(x,y) for x,y in points if -sx/2 < x < source['width']+sx/2
                  and -sy*2/3 < y < source['height']+sy*2/3]
    else:
        points = [(x+ox,y+oy) for x,y in points]
    hx = np.array([[x for x,y in points]]); hy = np.array([[y for x,y in points]])
    if options.get('sample_edges', False):
        hx = np.clip(hx, .5, source['width']-.5)
        hy = np.clip(hy, .5, source['height']-.5)
    hex_result = _aggregate_points(job, hx, hy)
    for cell in hex_result['cells']:
        cell['cx'], cell['cy'] = points[cell['x']]
        if options.get('sample_edges', False):
            cell['sample_x'], cell['sample_y'] = float(hx[0, cell['x']]), float(hy[0, cell['x']])
        candidates = [(p,f) for p,f in cell['phases'].items() if f['fit_presence']>0]
        cell['winner'] = max(candidates, key=lambda pf:pf[1]['rank'])[0] if candidates else None
    result['hex'] = dict(cells=hex_result['cells'], spacing_nm=spacing,
                         radius_x=sx/math.sqrt(3), radius_y=spacing/source['pixel_y_nm']/math.sqrt(3),
                         edge_sampling='nearest_in_image_pixel' if options.get('sample_edges', False) else 'tile_centre',
                         interpretation='Highest averaged rank among available phase fits. Fading shows winning phase passing frequency; not phase identity or fraction.')
    return result


def _aggregate_points(job, xx, yy):
    """Shared aggregation for raster and hex centres, including equal-pass means."""
    options = job['grid']
    phases = job['settings'].get('enabled_phases', ['HCP','BCC','FCC'])
    ny, nx = xx.shape
    shape = (options['passes'], ny, nx)
    weights = np.zeros(shape); counts = np.zeros((ny,nx), dtype=int)
    best_weight = np.zeros((ny,nx)); representative = np.full((ny,nx), '', dtype=object)
    supported = {p:np.zeros(shape) for p in phases}
    passing_ranks = {p:np.zeros(shape) for p in phases}
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
                passing_ranks[phase][k] += weight*max(m['score'] for m in passing)
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
        fields[phase] = dict(support=mean_pass(frequency), passing_strength=mean_pass(per_pass(passing_ranks[phase])), spread=spread,
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
                       mean_passing_strength=round(float(f['passing_strength'][pass_counts>0].mean()),6),
                       mean_fit_presence=round(float(f['fit_presence'][pass_counts>0].mean()),6)) for p,f in fields.items()} if cells else {}
    return dict(version=VERSION, width=nx, height=ny, cells=cells, phases=summaries,
                coverage_percent=100*len(cells)/(nx*ny),
                method='Gaussian centre weight exp(-8*(dx²+dy²)) within footprint; normalize each pass, then equal-pass mean',
                interpretation='Passing frequency counts each passing window equally. Passing strength averages the best passing rank per phase, counting failed/missing fits as zero. Rank excludes missing fits. Neither is a phase fraction or probability. Spread is max-minus-min pass support, not statistical uncertainty. Raster-centre coverage is approximate.')
