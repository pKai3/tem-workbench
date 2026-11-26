"""Presentation-only overlays shared by batch TEM map exporters."""
import math
import re

from PIL import Image, ImageDraw, ImageFont
from tem_workbench.mapping.phase_blend import blend_support

CORNERS = ('top-left', 'top-right', 'bottom-left', 'bottom-right')
DEFAULTS = dict(legend=True, legend_position='bottom-left', legend_colour='#ffffff',
                legend_shade='#000000', legend_opacity=.72, scale_bar=True,
                scale_bar_position='bottom-right', scale_bar_colour='#ffffff', text_scale=1)


def options(style='standard', background=None, export_settings=None):
    if style not in ('standard', 'paper'):
        raise ValueError('Choose Standard or Paper for the PNG style.')
    background = background or ('white' if style == 'paper' else 'dark')
    if background not in ('white', 'dark', 'transparent'):
        raise ValueError('Choose White, Dark or Transparent for the PNG background.')
    if export_settings is not None and not isinstance(export_settings, dict):
        raise ValueError('PNG settings must be an object.')
    supplied = export_settings or {}
    settings = {**DEFAULTS, 'show_name': style == 'standard'}
    for key in settings:
        if key in supplied:
            settings[key] = supplied[key]
    for key in ('legend', 'scale_bar', 'show_name'):
        if not isinstance(settings[key], bool):
            raise ValueError('PNG overlay visibility must be on or off.')
    for key in ('legend_position', 'scale_bar_position'):
        if settings[key] not in CORNERS:
            raise ValueError('Choose a corner for each PNG overlay.')
    for key in ('legend_colour', 'legend_shade', 'scale_bar_colour'):
        if not isinstance(settings[key], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', settings[key]):
            raise ValueError('PNG colours must be RGB hex values.')
    for key, low, high in (('legend_opacity', 0, 1), ('text_scale', .5, 1.5)):
        value = settings[key]
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError('PNG text size or shading is outside its supported range.')
    return dict(settings, paper=style == 'paper', background=background,
                fill={'white': '#ffffff', 'dark': '#0c121a', 'transparent': (0, 0, 0, 0)}[background],
                mode='RGBA' if background == 'transparent' else 'RGB',
                ink='#dce6ef' if background == 'dark' else '#18212b',
                muted='#a4adba' if background == 'dark' else '#425164')


def font(size):
    size = max(1, round(size))
    try:
        return ImageFont.truetype('DejaVuSans.ttf', size)
    except OSError:
        return ImageFont.load_default(size=size)


def scale_bar(width, field_nm):
    if not isinstance(field_nm, (int, float)) or not math.isfinite(field_nm) or field_nm <= 0:
        return None
    target = field_nm * .2
    power = 10 ** math.floor(math.log10(target))
    value = min((step * power for step in (1, 2, 5, 10)), key=lambda value: abs(value - target))
    return width * value / field_nm, f'{value / 1000:.4g} µm' if value >= 1000 else f'{value:.4g} nm'


def wrap(text, measure, width):
    lines, line = [], ''
    for word in text.split():
        if line and measure(line + ' ' + word) > width:
            lines.append(line)
            line = ''
        for char in (' ' if line else '') + word:
            if line and measure(line + char) > width:
                lines.append(line)
                line = ''
            line += char
    if line:
        lines.append(line)
    return lines


def legend_layout(entries, blend, max_width, size, measure, text_bounds=None):
    pad, gap, symbol, key_gap, line = size * .3, size * .35, size * .65, size * .28, size * 1.25
    content = max_width - 2 * pad
    def key(entry, limit=content):
        text, colour = entry
        lines = wrap(text, measure, max(size, limit - symbol - key_gap))
        bounds = [text_bounds(value) for value in lines] if text_bounds else []
        ascent, descent = (-bounds[0][1], bounds[-1][3]) if bounds else (size * .8, size * .2)
        text_height = max(0, len(lines) - 1) * line + ascent + descent
        text_width = max(map(measure, lines), default=0)
        return dict(text=text, colour=colour, lines=lines, ascent=ascent, text_height=text_height, text_width=text_width,
                    width=symbol + key_gap + text_width, height=max(symbol, text_height))
    common = dict(pad=pad, gap=gap, symbol=symbol, key_gap=key_gap, line=line)
    if len(blend) == 2:
        ramp = min(size * 5.5, content * .28)
        limit = (content - ramp - 2 * gap) / 2
        left, right = key(blend[0], limit), key(blend[1], limit)
        height = max(left['height'], right['height'], size * .6)
        side = max(left['width'], right['width'])
        return dict(common, kind='ramp', left=left, right=right, ramp=ramp, side=side, content_height=height,
                    width=2 * pad + 2 * side + ramp + 2 * gap, height=2 * pad + height)
    if len(blend) == 3:
        limit = (content - gap) / 2
        keys = [key(blend[0]), key(blend[1], limit), key(blend[2], limit)]
        triangle = min(size * 4.8, content * .6)
        width = max(keys[0]['width'], 2 * max(keys[1]['width'], keys[2]['width']) + gap, triangle + size)
        band_height = max(k['height'] for k in keys)
        height = 2 * pad + 2 * band_height + 2 * gap + triangle * .87
        return dict(common, kind='triangle', keys=keys, triangle=triangle, column=(width - gap) / 2,
                    band_height=band_height, width=width + 2 * pad, height=height)
    rows, x, y, row_height, width, row_start = [], 0, 0, 0, 0, 0
    for entry in entries:
        k = key(entry)
        if x and x + k['width'] > content:
            for row in rows[row_start:]:
                row['y'] += (row_height - row['height']) / 2
            row_start = len(rows)
            y += row_height + gap
            x, row_height = 0, 0
        rows.append(dict(k, x=x, y=y))
        width = max(width, x + k['width'])
        row_height = max(row_height, k['height'])
        x += k['width'] + gap
    for row in rows[row_start:]:
        row['y'] += (row_height - row['height']) / 2
    return dict(common, kind='keys', rows=rows, width=width + 2 * pad, height=y + row_height + 2 * pad)


def overlay_boxes(bounds, legend, bar, choice, margin):
    def anchor(item, corner):
        return dict(x=bounds['x'] + (bounds['width'] - margin - item['width'] if corner.endswith('right') else margin),
                    y=bounds['y'] + (margin if corner.startswith('top') else bounds['height'] - margin - item['height']),
                    width=item['width'], height=item['height'])
    def intersects(a, b, gap):
        return (a['x'] < b['x'] + b['width'] + gap and a['x'] + a['width'] + gap > b['x']
                and a['y'] < b['y'] + b['height'] + gap and a['y'] + a['height'] + gap > b['y'])
    box = anchor(legend, choice['legend_position']) if legend else None
    scale = anchor(bar, choice['scale_bar_position']) if bar else None
    if box and (box['width'] > bounds['width'] - 2 * margin or box['height'] > bounds['height'] - 2 * margin):
        raise ValueError('The legend does not fit. Reduce Text size or turn the legend off.')
    if scale and box and intersects(scale, box, margin):
        below, above = box['y'] + box['height'] + margin, box['y'] - margin - scale['height']
        candidates = (below, above) if choice['scale_bar_position'].startswith('top') else (above, below)
        y = next((y for y in candidates if y >= bounds['y'] + margin and y + scale['height'] <= bounds['y'] + bounds['height'] - margin
                  and not intersects(dict(scale, y=y), box, margin * .5)), None)
        if y is None:
            raise ValueError('The legend and scale bar do not fit together. Reduce Text size or move an overlay.')
        scale['y'] = y
    if scale and (scale['width'] > bounds['width'] - 2 * margin or scale['height'] > bounds['height'] - 2 * margin):
        raise ValueError('The scale bar does not fit. Reduce Text size.')
    return box, scale


def paper_map(image, source, legend, caption, theme, blend=(), hex_keys=False):
    """Composite both export styles. Captions belong outside the figure and are ignored."""
    unit = image.width / 1800
    size, margin = (64 if theme['paper'] else 32) * unit * theme['text_scale'], 32 * unit
    text_font = font(size)
    measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    text_width = lambda text: measure.textlength(text, font=text_font)
    title = wrap(source.get('name', ''), text_width, image.width - 2 * margin) if theme['show_name'] else []
    heading = math.ceil(len(title) * size * 1.25 + 2 * margin) if title else 0
    out = Image.new(theme['mode'], (image.width, image.height + heading), theme['fill'])
    draw = ImageDraw.Draw(out)
    for i, text in enumerate(title):
        draw.text((margin, margin + i * size * 1.25), text, font=text_font, fill=theme['ink'], anchor='lt')
    bounds = dict(x=0, y=heading, width=image.width, height=image.height)
    out.paste(image, (round(bounds['x']), round(bounds['y'])))
    blend = blend if len(blend) in (2, 3) else ()
    layout = legend_layout(legend, blend, image.width - 2 * margin, size, text_width,
                           lambda text: text_font.getbbox(text, anchor='ls')) if theme['legend'] and (legend or blend) else None
    physical = source.get('pixel_x_nm')
    geometry = scale_bar(image.width, source['width'] * physical if isinstance(physical, (int, float)) else None) if theme['scale_bar'] else None
    bar_font = font(size * 1.06)
    bar = dict(pixels=geometry[0], label=geometry[1], width=max(geometry[0], measure.textlength(geometry[1], font=bar_font)) + size * .3,
               height=size * 1.06 * 1.2 + size * .4) if geometry else None
    box, scale = overlay_boxes(bounds, layout, bar, theme, margin)
    if layout:
        shade = Image.new('RGBA', out.size)
        rgb = tuple(int(theme['legend_shade'][i:i + 2], 16) for i in (1, 3, 5))
        ImageDraw.Draw(shade).rounded_rectangle((box['x'], box['y'], box['x'] + box['width'], box['y'] + box['height']),
                                               radius=size * .15, fill=(*rgb, round(theme['legend_opacity'] * 255)))
        out = Image.alpha_composite(out.convert('RGBA'), shade)
        draw = ImageDraw.Draw(out)
        def key(k, x, y, reverse=False):
            sy, s = y + (k['height'] - layout['symbol']) / 2, layout['symbol']
            sx = x + k['text_width'] + layout['key_gap'] if reverse else x
            if hex_keys:
                points = [(sx + s / 2 + s / 2 * math.cos(math.radians(30 + i * 60)), sy + s / 2 + s / 2 * math.sin(math.radians(30 + i * 60))) for i in range(6)]
                draw.polygon(points, fill=k['colour'], outline='#bbbbbb', width=max(1, round(s * .025)))
            else:
                draw.rectangle((sx, sy, sx + s, sy + s), fill=k['colour'], outline='#bbbbbb', width=max(1, round(s * .025)))
            tx = x + k['text_width'] if reverse else x + s + layout['key_gap']
            baseline = y + (k['height'] - k['text_height']) / 2 + k['ascent']
            for i, text in enumerate(k['lines']):
                draw.text((tx, baseline + i * layout['line']), text, font=text_font, fill=theme['legend_colour'], anchor='rs' if reverse else 'ls')
        x, y = box['x'] + layout['pad'], box['y'] + layout['pad']
        if layout['kind'] == 'keys':
            for k in layout['rows']:
                key(k, x + k['x'], y + k['y'])
        elif layout['kind'] == 'ramp':
            left, right = layout['left'], layout['right']
            key(left, x + layout['side'] - left['width'], y + (layout['content_height'] - left['height']) / 2, True)
            rx, ry = x + layout['side'] + layout['gap'], y + (layout['content_height'] - size * .42) / 2
            count = max(2, math.ceil(layout['ramp']))
            for i in range(count):
                colour, _ = blend_support([(blend[0][1], 1 - i / (count - 1)), (blend[1][1], i / (count - 1))])
                draw.rectangle((rx + i * layout['ramp'] / count, ry, rx + (i + 1) * layout['ramp'] / count, ry + size * .42), fill=colour)
            key(right, rx + layout['ramp'] + layout['gap'], y + (layout['content_height'] - right['height']) / 2)
        else:
            top, left, right = layout['keys']
            key(top, box['x'] + (box['width'] - top['width']) / 2, y + (layout['band_height'] - top['height']) / 2)
            triangle = Image.new('RGBA', (140, 122))
            pixels = triangle.load()
            for ty in range(122):
                for tx in range(140):
                    a, c = 1 - (ty + .5) / 122, (ty + .5) / 244 + (tx + .5) / 140 - .5
                    weights = (a, 1 - a - c, c)
                    if min(weights) < 0:
                        continue
                    colour, _ = blend_support([(entry[1], weight) for entry, weight in zip(blend, weights)])
                    pixels[tx, ty] = (*tuple(int(colour[i:i + 2], 16) for i in (1, 3, 5)), 255)
            triangle = triangle.resize((round(layout['triangle']), round(layout['triangle'] * .87)), Image.Resampling.BILINEAR)
            ty = y + layout['band_height'] + layout['gap']
            out.alpha_composite(triangle, (round(box['x'] + (box['width'] - layout['triangle']) / 2), round(ty)))
            by = ty + layout['triangle'] * .87 + layout['gap']
            key(left, x + (layout['column'] - left['width']) / 2, by + (layout['band_height'] - left['height']) / 2, True)
            key(right, x + layout['column'] + layout['gap'] + (layout['column'] - right['width']) / 2,
                by + (layout['band_height'] - right['height']) / 2)
    if bar:
        cx, y = scale['x'] + scale['width'] / 2, scale['y'] + size * 1.06 * 1.2
        left, thickness, border = cx - bar['pixels'] / 2, max(3, size * .18), max(1, round(size * .06))
        rgb = [int(theme['scale_bar_colour'][i:i + 2], 16) for i in (1, 3, 5)]
        stroke = '#000000' if sum(c * weight for c, weight in zip(rgb, (.2126, .7152, .0722))) > 128 else '#ffffff'
        draw.text((cx, scale['y']), bar['label'], font=bar_font, fill=theme['scale_bar_colour'], anchor='mt', stroke_width=border, stroke_fill=stroke)
        draw.rectangle((left - border, y - border, left + bar['pixels'] + border, y + thickness + border), fill=stroke)
        draw.rectangle((left, y, left + bar['pixels'], y + thickness), fill=theme['scale_bar_colour'])
    if max(out.size) > 3200:
        out.thumbnail((3200, 3200), Image.Resampling.LANCZOS)
    return out.convert(theme['mode'])
