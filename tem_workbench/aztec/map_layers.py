"""Display-only additive EDS layers on the unchanged native pixel grid."""
import base64
from io import BytesIO
import re

import numpy as np
from PIL import Image

from .h5oina import AztecReadError


def settings(options):
    layout = options.get('eds_layout', 'separate')
    if layout not in ('separate', 'layered', 'both'):
        raise AztecReadError('Choose Separate, Layered or Both for EDS maps.')
    layers = options.get('eds_layers', {})
    if not isinstance(layers, dict) or len(layers) > 32:
        raise AztecReadError('Choose up to 32 EDS layers.')
    for channel, layer in layers.items():
        if not isinstance(channel, str) or not isinstance(layer, dict):
            raise AztecReadError('Invalid EDS layer settings.')
        if 'colour' in layer and not re.fullmatch(r'#[0-9a-fA-F]{6}', str(layer['colour'])):
            raise AztecReadError('Choose a valid colour for each EDS layer.')
        strength = layer.get('strength', 1)
        if not isinstance(strength, (int, float)) or not np.isfinite(strength) or not 0 <= strength <= 1:
            raise AztecReadError('EDS layer strength must be between 0 and 100%.')
    return layout, layers


def composite(items, layers):
    """Add clipped, exposure-scaled colours; no resizing or changes to values."""
    shape = items[0]['values'].shape
    if any(item['values'].shape != shape for item in items):
        raise AztecReadError('EDS layers must have matching native pixel grids.')
    rgb = np.zeros((*shape, 3), dtype=float)
    valid = np.zeros(shape, dtype=bool)
    metadata = []
    for item in items:
        tile, values = item['tile'], item['values']
        strength = layers.get(tile['channel'], {}).get('strength', 1)
        low, high = tile[item['field'] + '_limits']
        scaled = np.where(np.isfinite(values), np.clip((values-low)/(high-low or 1), 0, 1), 0)
        if item['opacity'] is not None:
            scaled *= np.nan_to_num(np.clip(item['opacity'], 0, 1), nan=0)
        colour = tile['colour']
        rgb += scaled[..., None] * strength * np.array([int(colour[i:i+2], 16) for i in (1, 3, 5)])
        if strength > 0:
            valid |= np.isfinite(values)
        metadata.append(dict(channel=tile['channel'], label=item['distribution_label'], colour=colour,
                             strength=strength, limits=[low, high], unit=item['distribution_unit']))
    rgba = np.dstack([np.uint8(np.clip(rgb, 0, 255)), np.uint8(valid)*255])
    output = BytesIO()
    Image.fromarray(rgba).save(output, format='PNG', compress_level=9)
    return dict(image='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode(),
                shape=list(shape), full_resolution=True, layers=metadata,
                blend='additive', note='Display colours add on black; overlap may saturate. No numerical mixing.')


def attach(rows, pending_images, options, layout, layers):
    if layout == 'separate':
        return
    mode = options.get('mode', 'signal')
    for row in rows:
        if row['kind'] != 'map' or row.get('error'):
            continue
        row['layered'] = {}
        quantities = [('signal', False)] if mode == 'signal' else [('ratio', True)] if mode == 'ratio' else [('signal', False), ('ratio', True)]
        for name, ratio in quantities:
            items = [item for item in pending_images if item['acquisition'] == row['acquisition'] and item['ratio'] == ratio]
            label = 'Layered ratios' if ratio else 'Layered elements'
            expected = [tile for tile in row['tiles'] if not ratio or not tile.get('denominator_reference')]
            missing = [tile['channel'] for tile in expected if not any(item['tile'] is tile for item in items)]
            # Also identify selected channels absent from this acquisition.
            missing += [channel for channel in options.get('signals', [])
                        if (not ratio or channel != options.get('denominator', 'Ti'))
                        and not any(tile['channel'] == channel or tile['channel'].split()[0] == channel for tile in row['tiles'])]
            if items:
                row['layered'][name] = dict(composite(items, layers), label=label, missing=missing)
            else:
                row['layered'][name] = dict(label=label, error='No available layers.', missing=missing)
