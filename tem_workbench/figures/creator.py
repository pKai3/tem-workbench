"""Read-only image inspection and reproducible, calibrated panel rendering."""
import base64
from datetime import datetime
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps
from scipy import ndimage

from tem_workbench.paths import RESOURCES
from tem_workbench.storage.folder_paths import atomic_json, output_folder

EXTENSIONS = {'.tif', '.tiff', '.png', '.jpg', '.jpeg'}
MAX_PANELS = 24
MAX_SOURCE_PIXELS = 150_000_000


def _source(path):
    source = Path(path).expanduser().resolve()
    if source.suffix.lower() not in EXTENSIONS or not source.is_file():
        raise ValueError('Choose an available TIFF, PNG or JPEG image.')
    return source


def _source_sidecar(path, source):
    sidecar = Path(path).expanduser().resolve()
    if sidecar != source.with_suffix('.txt') or not sidecar.is_file():
        raise ValueError(f'The matching TXT sidecar for {source.name} is missing or moved. Review this panel.')
    return sidecar


def _digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def list_images(folder):
    root = Path(folder).expanduser().resolve()
    if not root.is_dir():
        raise ValueError('Choose an available image folder.')
    images = []
    for directory, subfolders, filenames in os.walk(root, followlinks=False):
        subfolders[:] = sorted((name for name in subfolders if not name.startswith('.')), key=str.casefold)
        relative_folder = Path(directory).relative_to(root).as_posix()
        for name in sorted(filenames, key=str.casefold):
            path = Path(directory) / name
            if path.suffix.lower() in EXTENSIONS and path.is_file():
                images.append(dict(path=str(path), name=name, folder=relative_folder,
                                   has_sidecar=path.with_suffix('.txt').is_file(),
                                   relative_path=path.relative_to(root).as_posix()))
    return {'folder': str(root), 'images': images}


def thumbnail(path, size=512):
    """Return a small original-image preview for the shared visual browser UI."""
    source = _source(path)
    with Image.open(source) as original:
        if original.width * original.height > MAX_SOURCE_PIXELS:
            raise ValueError('This image exceeds the supported panel size.')
        image = ImageOps.exif_transpose(original)
        image.thumbnail((size, size), Image.Resampling.LANCZOS)
        stream = BytesIO()
        image.convert('RGB').save(stream, format='PNG')
    return stream.getvalue()


def _printed_scale(text):
    match = re.search(r'(\d+(?:\.\d+)?)\s*(nm|[µμu]m|mm)\b', text, re.I)
    if not match:
        return None
    value = float(match[1]) * {'nm': 1, 'um': 1000, 'µm': 1000, 'μm': 1000, 'mm': 1_000_000}[match[2].lower()]
    return value if math.isfinite(value) and value > 0 else None


def _recorded_date(text):
    text = str(text or '')
    for pattern, template in ((r'\b(\d{1,2}/\d{1,2}/\d{4})\b', '%d/%m/%Y'),
                              (r'\b(\d{4}[/:.-]\d{1,2}[/:.-]\d{1,2})\b', '%Y/%m/%d')):
        match = re.search(pattern, text)
        if not match:
            continue
        try:
            normalized = re.sub(r'[:.-]', '/', match[1]) if template == '%Y/%m/%d' else match[1]
            return datetime.strptime(normalized, template).date().isoformat()
        except ValueError:
            continue
    return None


def _acquisition_metadata(source, sidecar_text='', description='', footer_text=''):
    """Read acquisition fields only from recorded image or sidecar evidence."""
    metadata = {}

    def put(key, raw, unit, origin):
        if raw is None:
            return
        text = str(raw).strip()
        match = re.match(r'^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Zµμ]*)', text)
        if not match:
            return
        value = float(match[1])
        if not math.isfinite(value):
            return
        if value <= 0:
            return
        suffix = match[2]
        if key == 'magnification':
            value *= {'k': 1000, 'm': 1_000_000}.get(suffix[:1].lower(), 1)
            suffix = '×'
        elif key == 'voltage_kv':
            if suffix.lower() == 'v' or value >= 1000:
                value /= 1000
            suffix = 'kV'
        if key not in metadata:
            metadata[key] = dict(value=value, unit=suffix or unit, source=origin)

    def sidecar(key):
        match = re.search(r'(?m)^' + re.escape(key) + r'\s+([^\r\n]+)', sidecar_text)
        return match[1] if match else None

    put('probe', sidecar('$$SM_PROBE_NO'), '', 'TXT $$SM_PROBE_NO')
    if 'probe' in metadata:
        metadata['probe']['kind'] = 'number'
    else:
        put('probe', sidecar('$$SM_PROBE_CURRENT'), '', 'TXT $$SM_PROBE_CURRENT; unit not stated')
        if 'probe' in metadata:
            metadata['probe']['kind'] = 'current'

    magnification = re.search(r'(?i)[x×]\s*(\d{1,3}(?:\s*,\s*\d{3})+|\d{3,7})', footer_text)
    if magnification:
        put('magnification', re.sub(r'[^\d]', '', magnification[1]), '×', 'Footer OCR')
    voltage = re.search(r'(?i)\b(\d+(?:\.\d+)?)\s*kV\b', footer_text)
    if voltage:
        put('voltage_kv', voltage[1], 'kV', 'Footer OCR')
    distance = re.search(r'(?i)\bWD\s*(\d+(?:\.\d+)?)\s*(mm|µm|um)?', footer_text)
    if distance:
        put('working_distance', distance[1] + (distance[2] or ''), '', 'Footer OCR')

    description = str(description or '')
    for key, pattern, unit in (
        ('magnification', r'(?i)\b(?:magnification|mag)\s*[:=]\s*([\d.]+\s*[kM]?[x×]?)', '×'),
        ('voltage_kv', r'(?i)\b(?:EHT|accelerating voltage|accel voltage|HV)\s*[:=]\s*([\d.]+\s*(?:kV|V)?)', 'kV'),
        ('working_distance', r'(?i)\b(?:working distance|WD)\s*[:=]\s*([\d.]+\s*(?:mm|µm|um)?)', ''),
    ):
        match = re.search(pattern, description)
        if match:
            put(key, match[1], unit, 'TIFF ImageDescription')

    for text, origin in ((footer_text, 'Footer OCR'), (sidecar('$CM_DATE'), 'TXT $CM_DATE'),
                         (description, 'TIFF ImageDescription')):
        recorded = _recorded_date(text)
        if recorded:
            metadata['acquisition_date'] = dict(value=recorded, source=origin)
            break
    return metadata


def _sidecar_match(source, text, width, height, content_height, bar_px):
    """Report independent checks without relying on mutable file timestamps."""
    def field(key):
        match = re.search(r'(?m)^' + re.escape(key) + r'\s+([^\r\n]+)', text)
        return match[1].strip() if match else None

    checks = {}
    warnings = []
    title = field('$CM_TITLE')
    if title:
        compact = lambda value: re.sub(r'[^a-z0-9]+', '', value.casefold())
        checks['title'] = compact(source.stem).startswith(compact(title))
        if not checks['title']:
            warnings.append('TXT title does not match the image name.')
    full_size = field('$CM_FULL_SIZE')
    match = re.match(r'^(\d+)\s+(\d+)', full_size or '')
    if match and int(match[1]) > 0 and int(match[2]) > 0:
        recorded = [int(match[1]), int(match[2])]
        checks['field_size'] = recorded in ([width, content_height], [width, height])
        checks['recorded_field_size'] = recorded
        if not checks['field_size']:
            warnings.append('TXT image-field size differs from the detected image field.')
    recorded_bar = field('$$SM_MICRON_BAR')
    if recorded_bar and bar_px:
        match = re.match(r'^\d+(?:\.\d+)?', recorded_bar)
        if match and float(match[0]) > 0:
            checks['bar_width'] = abs(float(match[0]) - bar_px) <= max(3, .08 * bar_px)
            if not checks['bar_width']:
                warnings.append('TXT scale-bar width differs from the image measurement.')
    date, time = field('$CM_DATE'), field('$CM_TIME')
    if date and time:
        try:
            acquired = datetime.strptime(date + ' ' + time, '%Y/%m/%d %H:%M:%S')
            checks['acquired_at'] = acquired.isoformat(timespec='seconds')
            checks['file_time_delta_seconds'] = round(abs((datetime.fromtimestamp(source.stat().st_mtime)
                                                            - acquired).total_seconds()))
        except ValueError:
            pass
    return checks, warnings


def _tesseract_path():
    found = shutil.which('tesseract')
    if found:
        return found
    for location in ('/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract'):
        if Path(location).is_file():
            return location
    return None


def _ocr_image(image, *, psm=6, whitelist=None):
    executable = _tesseract_path()
    if not executable:
        return ''
    stream = BytesIO()
    image.convert('RGB').save(stream, format='PNG')
    command = [executable, 'stdin', 'stdout', '--psm', str(psm)]
    if whitelist:
        command.extend(['-c', 'tessedit_char_whitelist=' + whitelist])
    try:
        result = subprocess.run(command, input=stream.getvalue(), capture_output=True,
                                timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ''
    return result.stdout.decode('utf-8', errors='replace').strip() if result.returncode == 0 else ''


def _footer_ocr(image, footer, bar):
    if footer >= image.height or not _tesseract_path():
        return '', None
    band = image.crop((0, footer, image.width, image.height))
    text = _ocr_image(band.resize((band.width * 2, band.height * 2)), psm=6)
    if not bar:
        return text, None

    # The short scale label sits on the upper footer row, often well right of the bar.
    gray = np.asarray(image.convert('L'))
    left = min(image.width, bar['x'] + bar['w'] + 5)
    right = min(image.width, left + round(image.width * .3))
    top = max(footer, bar['y'] - 5)
    bottom = min(image.height, bar['y'] + bar['h'] + 20)
    labels, _ = ndimage.label(gray[top:bottom, left:right] > 180)
    glyphs = []
    for slices in ndimage.find_objects(labels):
        if slices is None:
            continue
        ys, xs = slices
        if ys.stop - ys.start >= 5 and xs.stop - xs.start >= 2:
            glyphs.append((left + xs.start, left + xs.stop, top + ys.start, top + ys.stop))
    glyphs.sort()
    if not glyphs:
        return text, None
    group = [glyphs[0]]
    for glyph in glyphs[1:]:
        if glyph[0] - group[-1][1] > max(24, round(image.width * .012)):
            break
        group.append(glyph)
    x0 = max(left, group[0][0] - 18)
    x1 = min(image.width, max(g[1] for g in group) + 18)
    y0 = max(footer, min(g[2] for g in group) - 10)
    y1 = min(image.height, max(g[3] for g in group) + 10)
    focused = image.crop((x0, y0, x1, y1))
    focused = focused.resize((focused.width * 4, focused.height * 4))
    label = _ocr_image(focused, psm=7, whitelist='0123456789.umµμ')
    scale_nm = _printed_scale(label)
    if scale_nm is None:
        plain = _ocr_image(focused, psm=7)
        plain = re.sub(r'^[Il|](?=\s*[uµμ]m\b)', '1', plain.strip())
        scale_nm = _printed_scale(plain)
    return text, scale_nm


def _footer_and_bar(image):
    gray = np.asarray(image.convert('L'))
    height, width = gray.shape
    dark = np.mean(gray < 35, axis=1)
    footer = next((y for y in range(max(1, int(height * .65)), int(height * .98))
                   if dark[y] > .96 and dark[y - 1] < .75
                   and np.mean(dark[y:y + 6]) > .96), None)
    if footer is None:
        return height, None
    region = gray[footer:footer + min(height - footer, max(40, (height - footer) * 2 // 3))]
    labels, _ = ndimage.label(region > 220)
    candidates = []
    for index, slices in enumerate(ndimage.find_objects(labels), 1):
        if slices is None:
            continue
        ys, xs = slices
        bar_width, bar_height = xs.stop - xs.start, ys.stop - ys.start
        if not (width * .01 <= bar_width <= width * .4 and 2 <= bar_height <= max(45, height * .025)
                and bar_width / bar_height >= 4):
            continue
        fill = np.mean(labels[slices] == index)
        if fill > .85:
            candidates.append((bar_width * fill, dict(x=xs.start, y=footer + ys.start,
                                                       w=bar_width, h=bar_height)))
    return footer, max(candidates, key=lambda item: item[0])[1] if candidates else None


def inspect_image(path):
    source = _source(path)
    with Image.open(source) as raw:
        if raw.width * raw.height > MAX_SOURCE_PIXELS:
            raise ValueError('This image is too large for the figure editor.')
        image = ImageOps.exif_transpose(raw)
        width, height = image.size
        footer, bar = _footer_and_bar(image)
        description = raw.tag_v2.get(270) if hasattr(raw, 'tag_v2') else raw.info.get('description')
        footer_text, scale_nm = _footer_ocr(image, footer, bar)
        scale_source = 'Footer OCR; verify against original' if scale_nm else None
        sidecar_bar_px = None
        sidecar = source.with_suffix('.txt')
        sidecar_text = ''
        metadata_sidecar = None
        if sidecar.is_file():
            sidecar_text = sidecar.read_text(encoding='utf-8', errors='replace')
            checks, warnings = _sidecar_match(source, sidecar_text, width, height, footer,
                                              bar['w'] if bar else None)
            metadata_sidecar = dict(path=str(sidecar), sha256=_digest(sidecar),
                                    checks=checks, warnings=warnings)
            sidecar_bar = re.search(r'\$\$SM_MICRON_BAR\s+(\d+(?:\.\d+)?)', sidecar_text)
            sidecar_bar_px = float(sidecar_bar[1]) if sidecar_bar else None
        analysis = None
        companion = source.with_suffix('.json')
        if companion.is_file():
            try:
                saved = json.loads(companion.read_text(encoding='utf-8'))
                origin = saved.get('source')
                if isinstance(origin, dict) and (origin.get('sha256_pixels') or origin.get('content_sha256')):
                    analysis = dict(path=str(companion), sha256=_digest(companion),
                                    source_id=origin.get('id'), source_sha256=origin.get('content_sha256') or origin.get('sha256_pixels'),
                                    method=saved.get('grid', {}).get('component_method') or saved.get('grid', {}).get('mode') or saved.get('method'))
            except (OSError, ValueError, TypeError, AttributeError):
                pass
        return dict(path=str(source), name=source.name, sha256=_digest(source), width=width,
                    height=height, content_height=footer, footer_detected=footer < height,
                    bar=bar, bar_px=bar['w'] if bar else None, scale_nm=scale_nm,
                    scale_source=scale_source, sidecar_bar_px=sidecar_bar_px, analysis=analysis,
                    metadata=_acquisition_metadata(source, sidecar_text, description, footer_text),
                    metadata_sidecar=metadata_sidecar,
                    footer_ocr_text=footer_text, ocr_available=bool(_tesseract_path()),
                    inspection_version=4,
                    scale_mode='replace' if footer < height and bar else 'keep')


def original_preview(path):
    source = _source(path)
    with Image.open(source) as raw:
        if raw.width * raw.height > MAX_SOURCE_PIXELS:
            raise ValueError('This image is too large for the figure editor.')
        image = ImageOps.exif_transpose(raw).convert('RGB')
    image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    stream = BytesIO()
    image.save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')


def _font(size):
    try:
        return ImageFont.truetype(RESOURCES / 'NotoSans.ttf', size)
    except OSError:
        return ImageFont.load_default(size=size)


def _scale_label(value_nm):
    unit, value = ('µm', value_nm / 1000) if value_nm >= 1000 else ('nm', value_nm)
    return f'{value:g} {unit}'


def _label_ink(hex_colour):
    linear = []
    for index in (1, 3, 5):
        value = int(hex_colour[index:index + 2], 16) / 255
        linear.append(value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4)
    return '#0b1520' if sum(a * b for a, b in zip(linear, (.2126, .7152, .0722))) > .179 else 'white'


def _badge(panel, label, colour, reserved_right=0):
    if colour is not None and not re.fullmatch(r'#[0-9a-fA-F]{6}', colour):
        raise ValueError('Use #RRGGBB for the panel label colour.')
    width = panel.width
    font = _font(max(18, round(width * .039)))
    overlay = Image.new('RGBA', panel.size)
    draw = ImageDraw.Draw(overlay)
    label = str(label)[:120]
    original = label
    while label and draw.textbbox((0, 0), label, font=font)[2] > max(25, width - 32 - reserved_right):
        label = label[:-1]
    if label != original and label:
        label = label[:-1] + '…'
    text_width = draw.textbbox((0, 0), label, font=font)[2]
    x, y = max(6, width // 80), max(6, width // 80)
    padding = max(6, width // 70)
    draw.rounded_rectangle((x, y, x + text_width + 2 * padding, y + max(24, round(width * .055)) + padding),
                           radius=max(4, width // 160), fill=colour or (5, 10, 16, 200))
    draw.text((x + padding, y + padding // 2), label, font=font,
              fill=_label_ink(colour) if colour else 'white')
    return Image.alpha_composite(panel.convert('RGBA'), overlay).convert('RGB')


METADATA_FIELDS = ('magnification', 'voltage_kv', 'probe', 'working_distance')


def _metadata_lines(slot, selected):
    metadata = slot.get('metadata') or {}
    lines = []
    for key in selected:
        entry = metadata.get(key)
        if not isinstance(entry, dict) or entry.get('value') is None:
            continue
        value = float(entry['value'])
        if not math.isfinite(value) or value <= 0:
            continue
        unit = str(entry.get('unit') or '')
        if key == 'magnification':
            lines.append(f'{value:,.0f}×')
        elif key == 'voltage_kv':
            lines.append(f'{value:g}kV')
        elif key == 'probe':
            lines.append(f'P{value:g}' if entry.get('kind') == 'number'
                         else f'I={value:g}{unit}')
        elif key == 'working_distance':
            lines.append(f'WD {value:g}{unit}')
    return lines


def _metadata_badge(panel, lines):
    if not lines:
        return panel
    width = panel.width
    font = _font(max(14, round(width * .032)))
    padding = max(6, width // 70)
    line_height = max(20, round(width * .044))
    measure = ImageDraw.Draw(panel)
    box_width = max(measure.textbbox((0, 0), line, font=font)[2] for line in lines) + 2 * padding
    x, y = width - box_width - max(6, width // 80), max(6, width // 80)
    overlay = Image.new('RGBA', panel.size)
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle((x, y, x + box_width, y + len(lines) * line_height + padding),
                           radius=max(4, width // 160), fill=(5, 10, 16, 200))
    for index, line in enumerate(lines):
        draw.text((x + padding, y + padding // 2 + index * line_height), line, font=font, fill='white')
    return Image.alpha_composite(panel.convert('RGBA'), overlay).convert('RGB')


def _nice_bar(nm_per_display_px, width):
    target = nm_per_display_px * width * .17
    exponent = math.floor(math.log10(target))
    candidates = [step * 10 ** power for power in range(exponent - 1, exponent + 2) for step in (1, 2, 5)]
    return min(candidates, key=lambda value: abs(math.log(value / target)))


def _tone_quantiles(image):
    rgb = np.asarray(image, dtype=np.float32)
    luminance = rgb[..., 0] * .2126 + rgb[..., 1] * .7152 + rgb[..., 2] * .0722
    return np.percentile(luminance, [5, 95])


def _tone_target(slots, aspect):
    ranges = [_tone_quantiles(_panel(slot, 240, aspect, strict=False, raw_only=True))
              for slot in slots if slot.get('path')]
    return tuple(np.median(ranges, axis=0)) if len(ranges) > 1 else None


def _adjust_tone(image, slot, target):
    if target is not None:
        low, high = _tone_quantiles(image)
        rgb = np.asarray(image, dtype=np.float32)
        if high - low >= 5:
            rgb = (rgb - low) * ((target[1] - target[0]) / (high - low)) + target[0]
        else:
            rgb += (target[0] + target[1]) / 2 - (low + high) / 2
        image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB')
    brightness, contrast = float(slot.get('brightness', 1)), float(slot.get('contrast', 1))
    if not (math.isfinite(brightness) and math.isfinite(contrast)
            and .25 <= brightness <= 3 and .25 <= contrast <= 3):
        raise ValueError('Panel brightness and contrast must be between 0.25 and 3.')
    if contrast != 1:
        image = ImageEnhance.Contrast(image).enhance(contrast)
    if brightness != 1:
        image = ImageEnhance.Brightness(image).enhance(brightness)
    return image


def _panel(slot, width, aspect, strict, tone_target=None, raw_only=False):
    source = _source(slot['path'])
    if _digest(source) != slot.get('sha256'):
        raise ValueError(f'{source.name} changed since this panel was saved. Replace it explicitly.')
    sidecar = slot.get('metadata_sidecar')
    if strict and sidecar and _digest(_source_sidecar(sidecar['path'], source)) != sidecar.get('sha256'):
        raise ValueError(f'The metadata sidecar for {source.name} changed. Review or replace this panel.')
    analysis = slot.get('analysis')
    if strict and analysis and _digest(_source_analysis(analysis['path'])) != analysis.get('sha256'):
        raise ValueError(f'The linked analysis for {source.name} changed. Review or replace this panel.')
    with Image.open(source) as raw:
        if raw.width * raw.height > MAX_SOURCE_PIXELS:
            raise ValueError('This image is too large for the figure editor.')
        image = ImageOps.exif_transpose(raw).convert('RGB')
    scale_mode = slot.get('scale_mode', 'replace')
    if scale_mode not in ('replace', 'keep'):
        raise ValueError('Choose a supported scale display mode.')
    content_height = int(slot.get('content_height', image.height))
    if not 1 <= content_height <= image.height:
        raise ValueError('Invalid saved image-field boundary. Replace this panel.')
    bar = slot.get('bar')
    if strict and scale_mode == 'keep' and isinstance(bar, dict) and bar.get('y', -1) >= content_height:
        raise ValueError(f'The source scale bar for {source.name} is outside the cropped field. Add a calibrated bar.')
    image = image.crop((0, 0, image.width, content_height))
    zoom = float(slot.get('zoom', 1))
    cx, cy = float(slot.get('center_x', .5)), float(slot.get('center_y', .5))
    if not (1 <= zoom <= 20 and 0 <= cx <= 1 and 0 <= cy <= 1):
        raise ValueError('Panel zoom and centre must be within the image.')
    crop_w = min(image.width, image.height * aspect) / zoom
    crop_h = crop_w / aspect
    left = min(max(cx * image.width - crop_w / 2, 0), image.width - crop_w)
    top = min(max(cy * image.height - crop_h / 2, 0), image.height - crop_h)
    image = image.crop((round(left), round(top), round(left + crop_w), round(top + crop_h)))
    height = round(width / aspect)
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    if raw_only:
        return image
    image = _adjust_tone(image, slot, tone_target)
    if scale_mode == 'keep':
        return image
    bar_px, scale_nm = slot.get('bar_px'), slot.get('scale_nm')
    if not bar_px or not scale_nm:
        if strict:
            raise ValueError(f'Confirm the printed scale value and bar width for {source.name} before export.')
        return image
    bar_px, scale_nm = float(bar_px), float(scale_nm)
    if not (math.isfinite(bar_px) and math.isfinite(scale_nm) and bar_px > 0 and scale_nm > 0):
        raise ValueError('Scale bar length and value must be positive.')
    nm_per_display_px = scale_nm / bar_px * (crop_w / width)
    chosen_nm = _nice_bar(nm_per_display_px, width)
    length = round(chosen_nm / nm_per_display_px)
    if not 0 < length < width * .4:
        raise ValueError('Scale bar would not fit this panel.')
    draw = ImageDraw.Draw(image)
    margin = max(16, round(width * .035))
    bar_height = max(5, round(width * .008))
    position = slot.get('scale_position', 'left')
    if position not in ('left', 'right'):
        raise ValueError('Choose Left or Right for the scale bar.')
    x = margin if position == 'left' else width - margin - length
    y = height - margin - bar_height
    draw.rectangle((x - 2, y - 2, x + length + 2, y + bar_height + 2), fill='black')
    draw.rectangle((x, y, x + length, y + bar_height), fill='white')
    draw.text((x, y - max(30, round(width * .047))), _scale_label(chosen_nm), font=_font(max(19, round(width * .035))),
              fill='white', stroke_width=max(2, width // 300), stroke_fill='black')
    return image


def _source_analysis(path):
    source = Path(path).expanduser().resolve()
    if source.suffix.lower() != '.json' or not source.is_file():
        raise ValueError('The linked analysis JSON is unavailable. Replace this panel.')
    return source


def render(recipe, preview=False):
    if not isinstance(recipe, dict):
        raise ValueError('Expected a saved figure recipe.')
    slots = recipe.get('slots')
    if not isinstance(slots, list) or not 1 <= len(slots) <= MAX_PANELS:
        raise ValueError(f'Choose 1–{MAX_PANELS} image panels.')
    columns = int(recipe.get('columns', 2))
    if columns not in (1, 2, 3, 4):
        raise ValueError('Choose 1–4 columns.')
    metadata_overlay = recipe.get('metadata_overlay', [])
    if not isinstance(metadata_overlay, list) or any(key not in METADATA_FIELDS for key in metadata_overlay):
        raise ValueError('Choose supported metadata overlay fields.')
    aspect = float(recipe.get('aspect', 4 / 3))
    if aspect not in (1, 4 / 3, 16 / 9):
        raise ValueError('Choose square, 4:3 or 16:9 panels.')
    width = 420 if preview else 1000
    gap, margin = (12, 18) if preview else (24, 36)
    rows = math.ceil(len(slots) / columns)
    tile_height = round(width / aspect)
    color = 'white' if recipe.get('background', 'white') == 'white' else '#101820'
    tone_target = _tone_target(slots, aspect) if recipe.get('match_tone') else None
    figure = Image.new('RGB', (columns * width + (columns - 1) * gap + 2 * margin,
                               rows * tile_height + (rows - 1) * gap + 2 * margin), color)
    for index, slot in enumerate(slots):
        x = margin + (index % columns) * (width + gap)
        y = margin + (index // columns) * (tile_height + gap)
        if not slot.get('path'):
            if not preview:
                raise ValueError(f'Choose an image for slot {index + 1} before export.')
            panel = Image.new('RGB', (width, tile_height), '#e8edf2' if color == 'white' else '#263746')
            placeholder = ImageDraw.Draw(panel)
            placeholder.rounded_rectangle((16, 16, width - 16, tile_height - 16), radius=8,
                                          outline='#94a5b8', width=2)
            placeholder.text((28, 28), f'Slot {index + 1} · choose image', font=_font(22),
                             fill='#263445' if color == 'white' else '#edf5fc')
            figure.paste(panel, (x, y))
        else:
            panel = _panel(slot, width, aspect, strict=not preview, tone_target=tone_target)
            label = str(slot.get('label') or Path(slot['path']).stem)[:120]
            lines = _metadata_lines(slot, metadata_overlay)
            reserved = max((ImageDraw.Draw(panel).textbbox((0, 0), line,
                        font=_font(max(14, round(width * .032))))[2] for line in lines), default=0) + (24 if lines else 0)
            panel = _badge(panel, label, slot.get('label_colour'), reserved_right=reserved)
            figure.paste(_metadata_badge(panel, lines), (x, y))
    stream = BytesIO()
    figure.save(stream, format='PNG', dpi=(300, 300))
    return stream.getvalue()


def preview(recipe):
    return 'data:image/png;base64,' + base64.b64encode(render(recipe, preview=True)).decode('ascii')


def panel_preview(slot, aspect=4 / 3, metadata_overlay=None, recipe=None):
    aspect = float(aspect)
    if aspect not in (1, 4 / 3, 16 / 9):
        raise ValueError('Choose square, 4:3 or 16:9 panels.')
    tone_target = _tone_target(recipe.get('slots', []), aspect) if recipe and recipe.get('match_tone') else None
    panel = _panel(slot, 1000, aspect, strict=False, tone_target=tone_target)
    lines = _metadata_lines(slot, metadata_overlay or [])
    reserved = max((ImageDraw.Draw(panel).textbbox((0, 0), line, font=_font(32))[2]
                    for line in lines), default=0) + (24 if lines else 0)
    panel = _metadata_badge(_badge(panel, slot.get('label') or Path(slot['path']).stem,
                                   slot.get('label_colour'), reserved_right=reserved), lines)
    stream = BytesIO()
    panel.save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')


def export(recipe, sources, output_root):
    data = render(recipe)
    paths = [slot['path'] for slot in recipe['slots']]
    destinations = {output_folder(sources, output_root, path=path) for path in paths}
    folder = next(iter(destinations)) if len(destinations) == 1 else Path(output_root).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    name = re.sub(r'[^\w.-]+', '_', str(recipe.get('name') or 'Figure')).strip('._')[:80] or 'Figure'
    stem = f'{name}_{datetime.now().astimezone():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:6]}'
    png = folder / (stem + '.png')
    manifest = folder / (stem + '.json')
    png.write_bytes(data)
    atomic_json(manifest, {'schema_version': 1, 'recipe': recipe,
                           'exported_at': datetime.now().astimezone().isoformat()})
    return {'png': str(png), 'recipe': str(manifest)}
