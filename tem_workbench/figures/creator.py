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
from PIL import Image, ImageDraw, ImageFont, ImageOps
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


def _footer_and_bar(image):
    gray = np.asarray(image.convert('L'))
    height, width = gray.shape
    dark = np.mean(gray < 35, axis=1)
    footer = next((y for y in range(max(1, int(height * .65)), int(height * .98))
                   if dark[y] > .96 and dark[y - 1] < .75
                   and np.median(dark[y:min(height, y + max(12, height // 50))]) > .85), None)
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
        scale_nm = None
        scale_source = None
        sidecar_bar_px = None
        sidecar = source.with_suffix('.txt')
        if sidecar.is_file():
            text = sidecar.read_text(encoding='utf-8', errors='replace')
            marker = re.search(r'\$\$SM_MICRON_MARKER\s+([^\r\n]+)', text)
            scale_nm = _printed_scale(marker[1]) if marker else None
            sidecar_bar = re.search(r'\$\$SM_MICRON_BAR\s+(\d+(?:\.\d+)?)', text)
            sidecar_bar_px = float(sidecar_bar[1]) if sidecar_bar else None
            if scale_nm:
                scale_source = 'sidecar label; bar width measured from image'
        if scale_nm is None and bar and shutil.which('tesseract'):
            label = image.crop((bar['x'] + bar['w'], footer, width, min(height, footer + max(45, bar['h'] * 2))))
            stream = BytesIO()
            label.save(stream, format='PNG')
            result = subprocess.run(['tesseract', 'stdin', 'stdout', '--psm', '7'], input=stream.getvalue(),
                                    capture_output=True, timeout=5, check=False)
            scale_nm = _printed_scale(result.stdout.decode('utf-8', errors='replace'))
            if scale_nm:
                scale_source = 'footer OCR; confirm before export'
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


def _badge(panel, label, colour):
    if colour is not None and not re.fullmatch(r'#[0-9a-fA-F]{6}', colour):
        raise ValueError('Use #RRGGBB for the panel label colour.')
    width = panel.width
    font = _font(max(18, round(width * .039)))
    overlay = Image.new('RGBA', panel.size)
    draw = ImageDraw.Draw(overlay)
    label = str(label)[:120]
    while label and draw.textbbox((0, 0), label, font=font)[2] > width - 32:
        label = label[:-2] + '…'
    text_width = draw.textbbox((0, 0), label, font=font)[2]
    x, y = max(6, width // 80), max(6, width // 80)
    padding = max(6, width // 70)
    draw.rounded_rectangle((x, y, x + text_width + 2 * padding, y + max(24, round(width * .055)) + padding),
                           radius=max(4, width // 160), fill=colour or (5, 10, 16, 200))
    draw.text((x + padding, y + padding // 2), label, font=font,
              fill=_label_ink(colour) if colour else 'white')
    return Image.alpha_composite(panel.convert('RGBA'), overlay).convert('RGB')


def _nice_bar(nm_per_display_px, width):
    target = nm_per_display_px * width * .17
    exponent = math.floor(math.log10(target))
    candidates = [step * 10 ** power for power in range(exponent - 1, exponent + 2) for step in (1, 2, 5)]
    return min(candidates, key=lambda value: abs(math.log(value / target)))


def _panel(slot, width, aspect, strict):
    source = _source(slot['path'])
    if _digest(source) != slot.get('sha256'):
        raise ValueError(f'{source.name} changed since this panel was saved. Replace it explicitly.')
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
    content_height = image.height if scale_mode == 'keep' else int(slot['content_height'])
    if not 1 <= content_height <= image.height:
        raise ValueError('Invalid saved image-field boundary. Replace this panel.')
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
    aspect = float(recipe.get('aspect', 4 / 3))
    if aspect not in (1, 4 / 3, 16 / 9):
        raise ValueError('Choose square, 4:3 or 16:9 panels.')
    width = 420 if preview else 1000
    gap, margin = (12, 18) if preview else (24, 36)
    rows = math.ceil(len(slots) / columns)
    tile_height = round(width / aspect)
    color = 'white' if recipe.get('background', 'white') == 'white' else '#101820'
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
            panel = _panel(slot, width, aspect, strict=not preview)
            label = str(slot.get('label') or Path(slot['path']).stem)[:120]
            figure.paste(_badge(panel, label, slot.get('label_colour')), (x, y))
    stream = BytesIO()
    figure.save(stream, format='PNG', dpi=(300, 300))
    return stream.getvalue()


def preview(recipe):
    return 'data:image/png;base64,' + base64.b64encode(render(recipe, preview=True)).decode('ascii')


def panel_preview(slot, aspect=4 / 3):
    aspect = float(aspect)
    if aspect not in (1, 4 / 3, 16 / 9):
        raise ValueError('Choose square, 4:3 or 16:9 panels.')
    panel = _badge(_panel(slot, 1000, aspect, strict=False),
                   slot.get('label') or Path(slot['path']).stem, slot.get('label_colour'))
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
