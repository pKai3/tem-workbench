"""KAM from native or companion H5OINA orientations, or saved H5OINA results.

Square neighbourhoods follow the supplied AZtec reference settings. Disorientation
uses proper crystal rotations; no phase reassignment, grain detection or cleanup.
See docs/aztec-kam.md for the independent numerical checks and supported layouts.
"""
import re
import struct
import base64
from io import BytesIO

import numpy as np
from scipy.spatial.transform import Rotation
from PIL import Image

from .h5oina import AztecReadError


def rgba_png(values):
    stream = BytesIO()
    Image.fromarray(values).save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()


def ipf_png(values, indexed=None):
    """Make missing saved IPF pixels opaque white without changing valid colours."""
    rgba = np.array(values, copy=True)
    missing = rgba[..., 3] == 0
    if indexed is not None:
        missing |= ~np.asarray(indexed, dtype=bool)
    rgba[missing] = 255
    return rgba_png(rgba)


def colour_map(values, limits, stops):
    """Display-only linear colour ramp, with unavailable pixels white."""
    ramp = np.array([[int(colour[i:i+2], 16) for i in (1, 3, 5)] for colour in stops])
    position = np.nan_to_num(np.clip((values-limits[0])/(limits[1]-limits[0]), 0, 1))
    rgba = np.empty((*values.shape, 4), dtype='u1')
    for channel in range(3):
        rgba[..., channel] = np.interp(position, np.linspace(0, 1, len(stops)), ramp[:, channel])
    rgba[..., 3] = 255
    rgba[~np.isfinite(values)] = 255
    return rgba_png(rgba)


def colour_stops(palette):
    """Shared preview/export legend colours; angular values are unaffected."""
    palettes = {
        # Four evenly spaced stops match the supplied AZtec legend. The
        # original five-stop Spectrum remains available for saved comparisons.
        'aztec': ['#0000ff', '#00ff00', '#ffff00', '#ff0000'],
        'spectrum': ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'],
        'cyan': ['#000000', '#65cfff'],
        'gray': ['#000000', '#ffffff'],
    }
    if palette in ('viridis', 'inferno'):
        from matplotlib import colormaps
        rgb = np.rint(colormaps[palette](np.linspace(0, 1, 256))[:, :3]*255).astype('u1')
        return ['#' + ''.join(f'{value:02x}' for value in colour) for colour in rgb]
    if palette not in palettes:
        raise AztecReadError('Choose AZtec, Spectrum, Viridis, Inferno, Greyscale or Cyan for KAM colours.')
    return palettes[palette]


def ipf_phases(definitions, phase):
    """Only label keys for validated symmetries actually present in this map."""
    families = {'D6': 'hexagonal', 'O': 'cubic'}
    present = [int(ident) for ident in np.unique(phase) if ident > 0]
    if any(ident not in definitions or definitions[ident].get('rotation_group') not in families
           for ident in present):
        raise AztecReadError('IPF phase symmetry is unavailable or unsupported.')
    return [dict(id=int(ident), name=definitions[int(ident)]['name'],
                 family=families[definitions[int(ident)]['rotation_group']])
            for ident in present]


def saved_ipf(reader, record, direction, shape, phases=()):
    """Use the full native saved RGB map for exactly this acquisition and axis."""
    matches = [r for r in reader._records.values() if r['table'] == 'EbsdMapImages'
               and r.get('acquisition_id') == record['acquisition_id']
               and not r.get('ebsd_preview_of') and re.fullmatch(r'IPF '+direction+r' Colou?r(?: \d+)?', r['Label'])]
    tile = dict(channel='IPF', label='IPF '+direction, unit='stored colour', direction=direction,
                provenance='Saved native IPF display colours; not recalculated or taken from H5OINA')
    if len(matches) != 1:
        return dict(tile, error='Saved IPF '+direction+' map unavailable or ambiguous')
    source = matches[0]
    values = reader.preview(source['path'])['array']
    if values.shape != (*shape, 4) or values.dtype != np.uint8:
        return dict(tile, error='Saved IPF grid differs from the full EBSD map')
    return dict(tile, image=ipf_png(values), path=source['path'], phases=list(phases),
                legend_convention='AZtec reference colour keys')


def settings(options):
    size = options.get('kam_kernel', 3)
    maximum = options.get('kam_max_angle', 5.)
    minimum = options.get('kam_min_angle', 0.)
    periphery = options.get('kam_periphery', True)
    if isinstance(size, bool) or size not in (3, 5, 7, 9):
        raise AztecReadError('Choose a 3×3, 5×5, 7×7 or 9×9 KAM kernel.')
    try:
        maximum = float(maximum)
    except (TypeError, ValueError):
        raise AztecReadError('KAM maximum angle must be greater than 0 and at most 180°.') from None
    if not np.isfinite(maximum) or not 0 < maximum <= 180:
        raise AztecReadError('KAM maximum angle must be greater than 0 and at most 180°.')
    try:
        minimum = float(minimum)
    except (TypeError, ValueError):
        raise AztecReadError('KAM minimum angle must be at least 0 and less than the maximum angle.') from None
    if not np.isfinite(minimum) or not 0 <= minimum < maximum:
        raise AztecReadError('KAM minimum angle must be at least 0 and less than the maximum angle.')
    if not isinstance(periphery, bool):
        raise AztecReadError('Choose All or Periphery for KAM neighbours.')
    return dict(kernel_size=int(size), minimum_angle_degrees=minimum, maximum_angle_degrees=maximum, only_periphery=periphery)


def native_phases(data):
    """Read the inspected DatabasePhase v1 and explicit PhaseId NBFX fields."""
    from .native import blob_payloads, native_string
    start = data.find(b'@\x17phaseForAcquisitionList')
    end = data.find(b'@\x0escreenPosition', start)
    if start < 0 or end < 0:
        raise AztecReadError('Native phase definitions are not decoded for KAM.')
    phases = {}
    for section in re.split(rb'[@^_]\x13PhaseForAcquisition', data[start:end])[1:]:
        if b'a:DatabasePhase' not in section:
            raise AztecReadError('This native phase variant is not decoded for KAM.')
        payload = next(blob_payloads(section, marker=b'^\x04Blob'), b'')
        if len(payload) < 59 or struct.unpack_from('<I', payload)[0] != 1 or payload[56] != 0:
            raise AztecReadError('Native crystal definition differs from the validated KAM layout.')
        alpha, beta, a, b, c, gamma = struct.unpack_from('<6d', payload, 4)
        laue = struct.unpack_from('<I', payload, 52)[0]
        label, _ = native_string(payload, 57)
        match = re.search(rb'[@^_]\x07PhaseId(\x83|\x89.|\x8b..|\x8d....)', section, re.S)
        if not match:
            raise AztecReadError('Native phase ID is unavailable for KAM.')
        token = match[1]
        ident = 1 if token == b'\x83' else int.from_bytes(token[1:], 'little', signed=True)
        if not 0 < ident < 256 or ident in phases:
            raise AztecReadError('Native phase IDs are ambiguous for KAM.')
        if not np.isfinite([alpha, beta, gamma, a, b, c]).all() or min(a, b, c) <= 0:
            raise AztecReadError('Native crystal dimensions are invalid for KAM.')
        if laue == 9 and np.allclose([alpha, beta, gamma], [90, 90, 120]) and np.isclose(a, b):
            group = 'D6'
        elif laue == 11 and np.allclose([alpha, beta, gamma], 90) and np.allclose([a, b, c], a):
            group = 'O'
        else:
            raise AztecReadError(f'KAM crystal symmetry is not validated for {label} (Laue group {laue}).')
        phases[ident] = dict(name=label, laue_group=laue, rotation_group=group)
    if not phases:
        raise AztecReadError('Native phase definitions are unavailable for KAM.')
    return phases


def calculate(euler, phase, phases, *, kernel_size=3, minimum_angle_degrees=0., maximum_angle_degrees=5., only_periphery=True):
    """Return degrees and eligible-neighbour counts; absent values remain NaN.

    Bunge ZXZ orientations map crystal to specimen. For same-phase pairs,
    min_s angle(q_a^-1 q_b s) uses the maximum absolute quaternion dot product
    with the proper symmetry group. Undirected pairs contribute to both pixels.
    """
    configuration = settings(dict(kam_kernel=kernel_size, kam_min_angle=minimum_angle_degrees,
                                  kam_max_angle=maximum_angle_degrees, kam_periphery=only_periphery))
    minimum_angle_degrees = configuration['minimum_angle_degrees']
    maximum_angle_degrees = configuration['maximum_angle_degrees']
    phase = np.asarray(phase)
    euler = np.asarray(euler, dtype=float)
    if phase.ndim != 2 or not phase.size or euler.shape != phase.shape + (3,):
        raise AztecReadError('KAM needs matching two-dimensional phase and Euler grids.')
    valid = (phase > 0) & np.isfinite(euler).all(axis=-1)
    for ident in np.unique(phase[valid]):
        if ident not in phases or phases[ident]['rotation_group'] not in ('D6', 'O'):
            raise AztecReadError(f'No validated crystal symmetry for phase {ident}.')
    safe = np.where(valid[..., None], euler, 0.)
    quaternions = Rotation.from_euler('ZXZ', safe.reshape(-1, 3)).as_quat().reshape(phase.shape + (4,))
    total = np.zeros(phase.shape)
    counts = np.zeros(phase.shape, dtype=np.uint16)
    height, width = phase.shape
    radius = kernel_size // 2
    symmetries = {ident: Rotation.create_group(info['rotation_group']).as_quat()
                  for ident, info in phases.items()}
    for dy in range(radius + 1):
        for dx in range(-radius, radius + 1):
            if (dy == 0 and dx <= 0) or (only_periphery and max(abs(dx), dy) != radius):
                continue
            if dy >= height or abs(dx) >= width:
                continue
            aa = (slice(0, height-dy), slice(max(0, -dx), min(width, width-dx)))
            bb = (slice(dy, height), slice(max(0, dx), min(width, width+dx)))
            same = valid[aa] & valid[bb] & (phase[aa] == phase[bb])
            angles = np.full(same.shape, np.nan)
            for ident, symmetry in symmetries.items():
                mask = same & (phase[aa] == ident)
                if not mask.any():
                    continue
                relative = (Rotation.from_quat(quaternions[aa][mask]).inv()
                            * Rotation.from_quat(quaternions[bb][mask])).as_quat()
                # Bound temporary arrays even for the largest supported companion.
                dots = np.zeros(len(relative))
                for rotation in symmetry:
                    dots = np.maximum(dots, np.abs(np.einsum('ij,j->i', relative, rotation)))
                angles[mask] = np.degrees(2*np.arccos(np.clip(dots, 0., 1.)))
            eligible = (np.isfinite(angles) & (angles >= minimum_angle_degrees - 1e-10)
                        & (angles <= maximum_angle_degrees + 1e-10))
            contribution = np.where(eligible, angles, 0.)
            total[aa] += contribution
            total[bb] += contribution
            counts[aa] += eligible
            counts[bb] += eligible
    values = np.divide(total, counts, out=np.full_like(total, np.nan), where=counts > 0)
    return values, counts


def native_inputs(reader, record, *, include_phases=True):
    source = reader._records[record['source_path']]
    phases = native_phases(reader.record_blob(source)) if include_phases else None
    def field(name):
        return reader.ebsd_field_preview(dict(source_path=source['path'], field=name,
                                             path=source['path']+'/'+name))['array']
    phase = field('phase')
    euler = np.stack([field('euler_'+str(index)) for index in (1, 2, 3)], axis=-1)
    return phase, euler, phases


def native_preview(reader, record, options=None):
    configuration = settings(options or {})
    source = reader._records[record['source_path']]
    phase, euler, phases = native_inputs(reader, record)
    values, counts = calculate(euler, phase, phases, **configuration)
    provenance = dict(method='Kernel average misorientation', state='acquired', source_mode='native', recalculated=True,
                      source_path=source['path'], orientation_unit='radians', unit='degrees',
                      kernel_shape='Square', **configuration,
                      phases={str(k): v for k, v in phases.items()},
                      eligible_neighbours='Indexed, same phase, within the inclusive minimum/maximum angles; no wrapping at edges',
                      missing_values='NaN for unindexed pixels or no eligible neighbours',
                      cleanup=False, reindexing=False)
    return dict(path=record['path'], kind='image', array=values, shape=list(values.shape),
                dtype=str(values.dtype), unit='degrees', label='KAM (recalculated)',
                neighbour_counts=counts, kam=provenance, ipf_phases=ipf_phases(phases, phase),
                note='KAM recalculated from acquired native orientations; no cleanup or re-indexing. '
                     'Unindexed pixels and pixels without eligible neighbours are unavailable.')


def comparison_views(reader, options, *, export_arrays=None, sources=None):
    """Use the common map presentation/export contract, retaining angular units."""
    from .views import acquisition_key, png, match_overview_tones
    from .map_distributions import map_distributions
    choices=options.get('kam_sources',{})
    if not isinstance(choices,dict):raise AztecReadError('Choose a KAM source for each acquisition.')
    direction = options.get('ipf_direction', 'Z')
    if direction not in ('X', 'Y', 'Z'):
        raise AztecReadError('Choose IPF X, Y or Z.')
    palette = options.get('kam_palette', 'aztec')
    stops = colour_stops(palette)
    if options.get('mode', 'signal') != 'signal' or options.get('normalisation', 'none') != 'none' or float(options.get('smoothing', 0)) != 0:
        raise AztecReadError('KAM uses angular values without signal ratios, normalization or image smoothing.')
    ids = sources if sources is not None else options.get('acquisitions', [])
    if not isinstance(ids, list) or not 1 <= len(ids) <= 32:
        raise AztecReadError('Select one or more KAM acquisitions (up to 32).')
    low, high = float(options.get('low', 0)), float(options.get('high', 5))
    if not np.isfinite([low, high]).all() or low < 0 or high <= low:
        raise AztecReadError('KAM colour limits must be nonnegative and maximum greater than minimum.')
    scope = options.get('scale_scope', 'all')
    if scope not in ('all', 'element', 'off'):
        raise AztecReadError('Choose shared or independent KAM colour scales.')
    rows, distributions = [], []
    for item in ids:
        if sources is not None:
            reader, acquisition, source = item
            identity = acquisition_key(source, acquisition)
        else:
            acquisition, source, identity = item, str(reader.path), item
        mode=choices.get(identity,options.get('kam_source','native'))
        if mode not in ('native','h5_processed','h5_saved'):
            raise AztecReadError('Choose Native OIPX, H5OINA processed or Saved H5OINA KAM.')
        reader.inspect()
        records = [r for r in reader._records.values() if r['table'] == 'KamMapImages' and r['acquisition_id'] == acquisition]
        if len(records) != 1:
            raise AztecReadError('Choose an acquisition with one full native EBSD map for KAM.')
        record = records[0]
        meta = next(a for a in reader.inspect()['acquisitions'] if a['index'] == record['site_id'])
        from . import h5_kam
        match=h5_kam.availability(reader,record)
        row = dict(acquisition=identity, native_acquisition=acquisition, source=str(source),
                   label=' / '.join(filter(None, [meta['specimen'], meta['label'], record['acquisition_label']])),
                   sample_name=meta['specimen'] or meta['label'], short_label=record['acquisition_label'],
                   kind='map', channel_table='KamMapImages', data_kind='kam', h5oina=match,
                   source_label={'native':'Native OIPX','h5_processed':'H5OINA processed','h5_saved':'Saved H5OINA KAM'}[mode])
        if mode=='native':result=native_preview(reader,record,options)
        else:
            try:result=h5_kam.preview(reader,record,dict(options,kam_source=mode),match)
            except (OSError,ValueError,KeyError) as error:
                row.update(error=str(error),tiles=[],kam=dict(source_mode=mode));rows.append(row);continue
        values, counts = result['array'], result['neighbour_counts']
        row.update(kam=result['kam'],valid_pixels=int(np.isfinite(values).sum()),excluded_pixels=int((~np.isfinite(values)).sum()),
                   width=values.shape[1],height=values.shape[0],distance_unit='px')
        site = reader.site(record['site_id'])
        region = next((r for r in site['regions'] if record['path'] in r['paths']), None)
        geometry = site.get('geometry', {})
        scale = (geometry.get('field_width_nm') or 0) * geometry.get('step', 0)
        if region and region['kind'] == 'rectangle':
            start, end = np.asarray(region['points'])
            width, height = np.abs(end-start)
            if scale:
                row.update(width=float(width*scale), height=float(height*scale), distance_unit='nm')
                row['kam']['step_nm'] = [row['width']/values.shape[1], row['height']/values.shape[0]]
        from .map_overviews import attach
        attach(reader, row, record, values.shape, options)
        finite = values[np.isfinite(values)]
        limits = [0., max(float(np.percentile(finite, 99)), .01)] if scope == 'off' and finite.size else [low, high]
        colour = '#65cfff'
        row['tiles'] = [dict(label='KAM · '+row['source_label'], channel='KAM', path=record['path'], colour=colour,
                             image=colour_map(values, limits, stops),
                             image_limits=limits, unit='degrees', baseline=1.)]
        row['tiles'].append(saved_ipf(reader, record, direction, values.shape, result['ipf_phases']) if mode=='native' else result['ipf'])
        row['ipf'] = {k: v for k, v in row['tiles'][-1].items() if k != 'image'}
        row['statistics'] = dict(available=False, reason='KAM is an angular map; elemental signal spatial checks do not apply.')
        if export_arrays is not None:
            export_arrays.add(row, 'KAM', 'saved' if mode=='h5_saved' else 'recalculated', values, 'degrees',
                              path=row['kam']['source_path'], kam=row['kam'],data_source=row['kam'].get('source_file'))
            if counts is not None:export_arrays.add(row, 'Eligible neighbours', 'recalculated', counts, 'count', path=row['kam']['source_path'],data_source=row['kam'].get('source_file'))
        distributions.append(dict(values=values, acquisition=identity, distribution_key=('KAM', 'degrees'),
                                  distribution_label='KAM', distribution_unit='degrees'))
        rows.append(row)
    if options.get('match_overview_tone'):
        match_overview_tones(rows)
    modes={row['acquisition']:row['kam']['source_mode'] for row in rows}
    counts={key:list(modes.values()).count(key) for key in ('native','h5_processed','h5_saved')}
    labels={'native':'Native OIPX','h5_processed':'H5OINA processed','h5_saved':'Saved H5OINA KAM'}
    caption='KAM · '+' · '.join(f'{labels[key]}: {count}' for key,count in counts.items() if count)
    configuration=settings(options) if counts['native']+counts['h5_processed'] else dict(saved=True)
    if not configuration.get('saved'):
        n=configuration['kernel_size'];neighbours='periphery' if configuration['only_periphery'] else 'all neighbours'
        caption+=f" · Recalculated: {n}×{n} {neighbours}, {configuration['minimum_angle_degrees']:g}–{configuration['maximum_angle_degrees']:g}°"
    saved_settings={(row['kam'].get('kernel_size'),row['kam'].get('only_periphery'),row['kam'].get('minimum_angle_degrees'),row['kam'].get('maximum_angle_degrees')) for row in rows if row['kam']['source_mode']=='h5_saved' and not row.get('error')}
    if len(saved_settings)==1:
        n,periphery,minimum,maximum=next(iter(saved_settings))
        caption+=f" · Saved: {n}×{n} {'periphery' if periphery else 'all neighbours'}, max {maximum:g}°, min {'not stored' if minimum is None else str(minimum)+'°'}"
    return dict(rows=rows, mode='signal', normalisation='none', map_palette='black', smoothing=0,kam_sources=modes,kam_caption=caption,
                low=low, high=high, comparison=bool(options.get('comparison')), shared_scales=scope!='off',
                scale_scope=scope, colour_scale_scope=scope, smoothing_unit='px', structure_only=False,
                distributions=map_distributions(distributions, bins=320, percentile=options.get('distribution_percentile', 10), exceedance=True) if options.get('map_distributions') else None,
                kam=configuration, kam_palette=palette, kam_colour_stops=stops, ipf_direction=direction,
                note=caption+'. No additional orientation cleanup. IPF uses saved colours from the selected source; overview images remain native.')
