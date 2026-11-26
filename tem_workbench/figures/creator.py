"""Read-only image inspection and reproducible, calibrated panel rendering."""
import base64
from datetime import datetime
from functools import lru_cache
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps
from scipy import ndimage

from tem_workbench.paths import RESOURCES
from tem_workbench.image_tone import tone_quantiles as _tone_quantiles, tone_target, match_tone
from tem_workbench.storage.folder_paths import atomic_json, output_folder
from tem_workbench.storage.mode_folders import scan_folders
from tem_workbench.storage.preview_files import sidecar_path
from tem_workbench.figures import dm4_source, instrument_metadata

EXTENSIONS = {'.dm4', '.tif', '.tiff', '.png', '.jpg', '.jpeg'}
INSPECTION_VERSION = 11
MAX_SOURCE_PIXELS = dm4_source.MAX_SOURCE_PIXELS
MAX_EXACT_ESTIMATE_PIXELS = 8_000_000
MAX_PREVIEW_PIXELS = 16_000_000


def _source(path):
    source = Path(path).expanduser().resolve()
    if source.suffix.lower() not in EXTENSIONS:
        raise ValueError('Choose an available DM4, TIFF, PNG or JPEG image.')
    if not source.is_file():
        raise ValueError(f'{source.name} is missing. Rescan images to reconnect its source.')
    return source


def _open_image(source, dm_reader=None):
    return dm4_source.image(source, dm_reader) if source.suffix.lower() == '.dm4' else Image.open(source)


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


def list_images(folder, outputs=(), *, scope=None):
    root = Path(folder).expanduser().resolve()
    if not root.is_dir():
        raise ValueError('Choose an available image folder.')
    images, dm4_files = [], []
    for directory, filenames in scan_folders(root, outputs, scope=scope):
        relative_folder = directory.relative_to(root).as_posix()
        native_stems = {Path(name).stem for name in filenames
                        if Path(name).suffix.lower() == '.dm4' and (directory / name).is_file()}
        previews = {Path(name).stem: directory / name for name in filenames
                    if Path(name).suffix.lower() == '.png' and (directory / name).is_file()}
        for name in sorted(filenames, key=str.casefold):
            path = directory / name
            if path.suffix.lower() == '.dm4' and path.is_file():
                dm4_files.append(path)
            if path.suffix.lower() == '.png' and path.stem in native_stems:
                continue  # Paired PNGs are browser previews, never duplicate figure sources.
            if path.suffix.lower() in EXTENSIONS and path.is_file():
                native = path.suffix.lower() == '.dm4'
                preview = previews.get(path.stem) if native else path
                images.append(dict(path=str(path), name=name, folder=relative_folder,
                                   extension=path.suffix.lower(),
                                   thumbnail_path=str(preview) if preview else None,
                                   has_sidecar=None if native else path.with_suffix('.txt').is_file(),
                                   relative_path=path.relative_to(root).as_posix()))
    return {'folder': str(root), 'images': images, 'dm4_count': len(dm4_files),
            'dm4_missing_previews': sum(not sidecar_path(path).is_file() for path in dm4_files)}


def thumbnail(path, size=512):
    """Return a small original-image preview for the shared visual browser UI."""
    source = _source(path)
    if source.suffix.lower() == '.dm4':
        source = sidecar_path(source)
        if not source.is_file():
            raise ValueError('Create DM4 previews to show a browser thumbnail.')
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

    magnification = re.search(r'(?i)(?:[x×]\s*|\bmag(?:nification)?\s*[:=]?\s*)(\d+(?:\s*,\s*\d{3})*(?:\.\d+)?\s*[kM]?)', footer_text)
    if not magnification:
        magnification = re.search(r'(?i)\b(\d+(?:,\d{3})*(?:\.\d+)?\s*[kM]?)\s*[x×]\b', footer_text)
    if magnification:
        put('magnification', re.sub(r'[,\s]', '', magnification[1]), '×', 'Footer OCR')
    voltage = re.search(r'(?i)\b(\d+(?:\.\d+)?)\s*k(?:V\b|¥)', footer_text)
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
                                env={**os.environ, 'OMP_THREAD_LIMIT': '1', 'OMP_NUM_THREADS': '1'},
                                timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ''
    return result.stdout.decode('utf-8', errors='replace').strip() if result.returncode == 0 else ''


def _footer_ocr(image, footer, bar):
    if footer >= image.height or not _tesseract_path():
        return '', None, ''
    band = image.crop((0, footer, image.width, image.height)).convert('RGB')
    background = int(np.median(np.asarray(band.convert('L'))))
    if bar:
        # The bar is a graphic. Its white edges otherwise become stray OCR letters.
        ImageDraw.Draw(band).rectangle((bar['x'] - 4, bar['y'] - footer - 4,
                                        bar['x'] + bar['w'] + 4, bar['y'] - footer + bar['h'] + 4),
                                       fill=(background,) * 3)
    if background < 128:
        band = ImageOps.invert(band)
    factor = 4 if band.height < 60 else 2
    enlarged = band.resize((band.width * factor, band.height * factor))
    line_text = _ocr_image(enlarged, psm=6)
    sparse_text = _ocr_image(enlarged, psm=11)
    def score(candidate):
        return sum(bool(re.search(pattern, candidate, re.I)) for pattern in (
            r'[x×]\s*\d[\d,. ]*(?:k|M)?', r'\d+(?:\.\d+)?\s*k(?:V\b|¥)',
            r'\bWD\s*\d', r'\d{1,4}/\d{1,2}/\d{2,4}'))
    text = sparse_text if score(sparse_text) > score(line_text) else line_text or sparse_text
    if not bar:
        return text, None, ''

    # A standalone physical-length line can be the scale label; WD remains excluded.
    standalone = ''
    for line in text.splitlines():
        candidate = re.sub(r'^[Il|](?=\s*[uµμ]m\b)', '1', line.strip())
        if re.fullmatch(r'\d+(?:\.\d+)?\s*(?:nm|[uµμ]m|mm)', candidate, re.I):
            standalone = line.strip()
            break
    standalone_scale = _printed_scale(re.sub(r'^[Il|](?=\s*[uµμ]m\b)', '1', standalone)) if standalone else None

    # Scale labels may sit above, below or to either side of a bar/ruler.
    # Read nearby text from the masked footer, never the specimen or filename.
    span = max(bar['w'], round(image.width * .25))
    x, y, w, h = bar['x'], bar['y'] - footer, bar['w'], bar['h']
    nearby = [(x - span, y - h, x, y + 2 * h + 20),
              (x + w, y - h, x + w + span, y + 2 * h + 20),
              (x - 20, 0, x + w + 20, y),
              (x - 20, y + h, x + w + 20, band.height)]
    for box in nearby:
        left, top, right, bottom = (max(0, int(box[0])), max(0, int(box[1])),
                                    min(band.width, int(box[2])), min(band.height, int(box[3])))
        if right - left < 8 or bottom - top < 6:
            continue
        region = band.crop((left, top, right, bottom))
        if np.asarray(region.convert('L')).std() < 2:
            continue
        focused = region.resize((region.width * 4, region.height * 4))
        label = _ocr_image(focused, psm=6)
        for line in label.splitlines():
            candidate = re.sub(r'^[Il|](?=\s*[uµμ]m\b)', '1', line.strip())
            if re.fullmatch(r'\d+(?:\.\d+)?\s*(?:nm|[uµμ]m|mm)', candidate, re.I):
                return text, _printed_scale(candidate), candidate

    # The short scale label sits on the upper footer row, often well right of the bar.
    gray = np.asarray(image.convert('L'))
    left = min(image.width, bar['x'] + bar['w'] + 5)
    right = min(image.width, left + round(image.width * .3))
    top = max(footer, bar['y'] - 5)
    bottom = min(image.height, bar['y'] + bar['h'] + 20)
    labels, _ = ndimage.label(gray[top:bottom, left:right] > 180 if background < 128 else gray[top:bottom, left:right] < 75)
    glyphs = []
    for slices in ndimage.find_objects(labels):
        if slices is None:
            continue
        ys, xs = slices
        if ys.stop - ys.start >= 5 and xs.stop - xs.start >= 2:
            glyphs.append((left + xs.start, left + xs.stop, top + ys.start, top + ys.stop))
    glyphs.sort()
    if not glyphs:
        return text, standalone_scale, standalone
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
    label = _ocr_image(focused, psm=7, whitelist='0123456789.numµμ')
    scale_nm = _printed_scale(label)
    scale_text = label
    if scale_nm is None:
        plain = _ocr_image(focused, psm=7)
        scale_text = plain or label
        scale_nm = _printed_scale(re.sub(r'^[Il|](?=\s*[uµμ]m\b)', '1', plain.strip()))
    return text, scale_nm or standalone_scale, scale_text if scale_nm else standalone or scale_text


def _correct_footer_scale(text, scale_nm):
    """Show the independently read scale label without changing stored raw OCR."""
    if not text:
        return text
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if scale_nm is None:
        return '\n'.join(lines)
    label = _scale_label(scale_nm)
    for index, line in enumerate(lines):
        if re.match(r'(?i)^\s*WD\b', line):
            continue
        match = re.search(r'(?i)(?<![\w.])(?:a\s+)?(?:\d+(?:\.\d+)?|[Il|l])\s*(?:[upµμ]m|nm)\b', line)
        if match:
            lines[index] = line[:match.start()] + label + line[match.end():]
            return '\n'.join(lines)
    return 'Scale label: ' + label + '\n' + text


def _footer_and_bar(image, recorded_footer=None):
    gray = np.asarray(image.convert('L'))
    height, width = gray.shape
    dark = np.mean(gray < 35, axis=1)
    footer = recorded_footer if recorded_footer is not None else next((y for y in range(max(1, int(height * .65)), int(height * .98))
                   if dark[y] > .96 and dark[y - 1] < .75
                   and np.mean(dark[y:y + 6]) > .96), None)
    if footer is None:
        # Short TEM footers and light-background strips need not start with six
        # empty black rows. Require a sharp boundary and a sustained flat band.
        sample = gray[-max(4, min(32, round(height * .01))):]
        background = int(np.bincount(sample.ravel(), minlength=256).argmax())
        flat = np.mean((gray >= max(0, background - 20)) & (gray <= min(255, background + 20)), axis=1)
        for y in range(max(1, int(height * .65)), height - 11):
            if (flat[y] >= .85 and flat[y] - flat[y - 1] > .2
                    and np.median(flat[y:]) >= .85 and np.mean(flat[y:]) >= .8):
                footer = y
                break
    if footer is None or footer >= height:
        return height, None
    region = gray[footer:]
    background = int(np.median(region))
    labels, _ = ndimage.label(region > 180 if background < 128 else region < 75)
    candidates = []
    for index, slices in enumerate(ndimage.find_objects(labels), 1):
        if slices is None:
            continue
        ys, xs = slices
        bar_width, bar_height = xs.stop - xs.start, ys.stop - ys.start
        fill = np.mean(labels[slices] == index)
        aspect = bar_width / bar_height
        if not (width * .01 <= bar_width <= width * .4 and 2 <= bar_height <= max(45, height * .025)
                and aspect >= 2):
            continue
        # Low-magnification SEM bars can be only twice as wide as they are tall.
        # Require these compact candidates to be nearly solid, so joined footer
        # letters and ruler ticks do not become calibration measurements.
        if fill > (.95 if aspect < 4 else .85):
            candidates.append((bar_width * fill, dict(x=xs.start, y=footer + ys.start,
                                                       w=bar_width, h=bar_height)))
    return footer, max(candidates, key=lambda item: item[0])[1] if candidates else None


def inspect_image(path, *, dm_reader=None):
    source = _source(path)
    if source.suffix.lower() == '.dm4':
        recorded = dm4_source.inspect(source, dm_reader)
        return dict(path=str(source), name=source.name, sha256=_digest(source), source_format='dm4',
                    **recorded, content_height=recorded['height'], detected_content_height=recorded['height'],
                    footer_detected=False, content_height_source='DM4 image dimensions',
                    bar=None, bar_px=None, scale_nm=None, scale_source=None, sidecar_bar_px=None,
                    analysis=None, metadata_sidecar=None, footer_ocr_text='', footer_ocr_raw_text='',
                    scale_ocr_text='', ocr_available=False, inspection_version=INSPECTION_VERSION,
                    scale_mode='metadata' if recorded['pixel_size_nm'] else 'keep')
    with Image.open(source) as raw:
        if raw.width * raw.height > MAX_SOURCE_PIXELS:
            raise ValueError('This image is too large for the figure editor.')
        image = ImageOps.exif_transpose(raw)
        width, height = image.size
        description = raw.tag_v2.get(270) if hasattr(raw, 'tag_v2') else raw.info.get('description')
        sidecar = source.with_suffix('.txt')
        sidecar_text = ''
        if sidecar.is_file():
            data = sidecar.read_bytes()
            sidecar_text = data.decode('utf-16' if data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig', errors='replace')
        recorded = instrument_metadata.read(description, sidecar_text, source, width, height)
        if raw.getexif().get(274, 1) != 1:
            recorded = {'metadata': recorded['metadata']}
        footer, bar = _footer_and_bar(image, recorded.get('content_height'))
        footer_raw_text, scale_nm, scale_text = _footer_ocr(image, footer, bar)
        footer_text = _correct_footer_scale(footer_raw_text, scale_nm)
        scale_source = 'Footer OCR; verify against original' if scale_nm else None
        sidecar_bar_px = None
        metadata_sidecar = None
        if sidecar.is_file():
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
                    height=height, content_height=footer, detected_content_height=footer,
                    footer_detected=footer < height,
                    content_height_source=recorded.get('content_height_source', 'Image pixels'),
                    pixel_size_nm=recorded.get('pixel_size_nm'), pixel_size_source=recorded.get('pixel_size_source'),
                    bar=bar, bar_px=bar['w'] if bar else None, scale_nm=scale_nm,
                    scale_source=scale_source, sidecar_bar_px=sidecar_bar_px, analysis=analysis,
                    metadata={**_acquisition_metadata(source, sidecar_text, description, footer_raw_text), **recorded['metadata']},
                    metadata_sidecar=metadata_sidecar,
                    footer_ocr_text=footer_text, footer_ocr_raw_text=footer_raw_text,
                    scale_ocr_text=scale_text, ocr_available=bool(_tesseract_path()), inspection_version=INSPECTION_VERSION,
                    scale_mode='metadata' if recorded.get('pixel_size_nm') else 'replace' if footer < height and bar else 'keep')


def original_preview(path, *, dm_reader=None):
    source = _source(path)
    with _open_image(source, dm_reader) as raw:
        if raw.width * raw.height > MAX_SOURCE_PIXELS:
            raise ValueError('This image is too large for the figure editor.')
        image = ImageOps.exif_transpose(raw).convert('RGB')
    image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    stream = BytesIO()
    image.save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')


def footer_preview(path, content_height, *, dm_reader=None):
    """Return the rows removed from a panel so the source footer can be inspected."""
    source = _source(path)
    with _open_image(source, dm_reader) as raw:
        if raw.width * raw.height > MAX_SOURCE_PIXELS:
            raise ValueError('This image is too large for the figure editor.')
        image = ImageOps.exif_transpose(raw)
        row = int(content_height)
        if not 1 <= row < image.height:
            raise ValueError('No footer rows are trimmed at this crop boundary.')
        footer = image.crop((0, row, image.width, image.height)).convert('RGB')
    footer.thumbnail((2400, 1000), Image.Resampling.LANCZOS)
    stream = BytesIO()
    footer.save(stream, format='PNG')
    return stream.getvalue()


@lru_cache(maxsize=2)
def _system_ui_font_path(semibold):
    if sys.platform == 'darwin':
        return Path('/System/Library/Fonts/SFNS.ttf')
    if os.name == 'nt':
        return Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / ('seguisb.ttf' if semibold else 'segoeui.ttf')
    executable = shutil.which('fc-match')
    if executable:
        try:
            result = subprocess.run([executable, '-f', '%{file}',
                                     'system-ui:style=Semibold' if semibold else 'system-ui'],
                                    capture_output=True, text=True, timeout=2, check=False)
            if result.returncode == 0 and result.stdout.strip():
                return Path(result.stdout.strip())
        except (OSError, subprocess.TimeoutExpired):
            pass
    return None


def _font(size, *, system_ui=False, semibold=False):
    if system_ui:
        path = _system_ui_font_path(semibold)
        if path and path.is_file():
            try:
                font = ImageFont.truetype(path, size)
                if semibold and sys.platform == 'darwin':
                    font.set_variation_by_name('Semibold')
                return font
            except (OSError, ValueError):
                pass
    try:
        font = ImageFont.truetype(RESOURCES / 'NotoSans.ttf', size)
        if semibold:
            font.set_variation_by_name('SemiBold')
        return font
    except (OSError, ValueError):
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


def _annotation_atoms(value):
    """Parse plain text with one-character or braced sub/superscripts."""
    atoms = []
    index = 0
    while index < len(value):
        char = value[index]
        escaped = False
        if char == '\\' and index + 1 < len(value):
            index += 1
            char = value[index]
            escaped = True
        if not escaped and char in ('_', '^') and atoms and index + 1 < len(value):
            index += 1
            if value[index] == '{':
                end = value.find('}', index + 1)
                if end < 0:
                    atoms.append({'base': char, 'sub': '', 'sup': ''})
                    continue
                script = value[index + 1:end]
                index = end
            else:
                script = value[index]
            atoms[-1]['sub' if char == '_' else 'sup'] = script
        else:
            atoms.append({'base': char, 'sub': '', 'sup': ''})
        index += 1
    return atoms


def _annotations(panel, slot):
    annotations = slot.get('annotations', [])
    if not isinstance(annotations, list) or len(annotations) > 40:
        raise ValueError('Use at most 40 panel annotations.')
    if not annotations:
        return panel
    image = panel.convert('RGBA')
    draw = ImageDraw.Draw(image)
    width, height = image.size
    for item in annotations:
        if not isinstance(item, dict) or item.get('type') not in ('arrow', 'text'):
            raise ValueError('Unsupported panel annotation.')
        colour = item.get('color', '#ffffff')
        if not isinstance(colour, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', colour):
            raise ValueError('Use #RRGGBB for annotation colour.')
        keys = ('x1', 'y1', 'x2', 'y2') if item['type'] == 'arrow' else ('x', 'y')
        try:
            coordinates = [float(item[key]) for key in keys]
        except (KeyError, TypeError, ValueError):
            raise ValueError('Invalid annotation position.') from None
        if any(not math.isfinite(value) or not 0 <= value <= 1 for value in coordinates):
            raise ValueError('Annotation positions must be inside the panel.')
        if item['type'] == 'arrow':
            try:
                thickness = float(item.get('width', 3))
            except (TypeError, ValueError):
                raise ValueError('Arrow thickness must be between 1 and 12.') from None
            if not math.isfinite(thickness) or not 1 <= thickness <= 12:
                raise ValueError('Arrow thickness must be between 1 and 12.')
            stroke = max(1, round(thickness * width / 320))
            x1, y1, x2, y2 = coordinates[0] * width, coordinates[1] * height, coordinates[2] * width, coordinates[3] * height
            distance = math.hypot(x2 - x1, y2 - y1)
            if distance < 1:
                continue
            ux, uy = (x2 - x1) / distance, (y2 - y1) / distance
            head = min(distance * .55, max(stroke * 3, width * .026))
            wing = head * .42
            base_x, base_y = x2 - ux * head, y2 - uy * head
            draw.line((round(x1), round(y1), round(base_x + ux * head * .2), round(base_y + uy * head * .2)),
                      fill=colour, width=stroke)
            draw.polygon(((x2, y2), (base_x - uy * wing, base_y + ux * wing),
                          (base_x + uy * wing, base_y - ux * wing)), fill=colour)
        else:
            value = item.get('text', '')
            try:
                size = float(item.get('size', 30))
            except (TypeError, ValueError):
                raise ValueError('Text size must be between 12 and 72.') from None
            if not isinstance(value, str) or len(value) > 120 or '\n' in value or not math.isfinite(size) or not 12 <= size <= 72:
                raise ValueError('Text annotations need one line of up to 120 characters and size 12–72.')
            pixel_size = max(10, round(size * width / 320))
            base_font = _font(pixel_size, system_ui=True, semibold=True)
            script_font = _font(max(8, round(pixel_size * .68)), system_ui=True, semibold=True)
            cursor = coordinates[0] * width
            top = coordinates[1] * height
            stroke = max(1, round(width / 640))
            for atom in _annotation_atoms(value):
                base = atom['base']
                draw.text((round(cursor), round(top)), base, font=base_font, fill=colour,
                          stroke_width=stroke, stroke_fill='black')
                after_base = cursor + draw.textlength(base, font=base_font)
                script_widths = []
                for key, offset in (('sup', -.16), ('sub', .47)):
                    script = atom[key]
                    if script:
                        draw.text((round(after_base), round(top + pixel_size * offset)), script,
                                  font=script_font, fill=colour, stroke_width=stroke, stroke_fill='black')
                        script_widths.append(draw.textlength(script, font=script_font))
                cursor = after_base + (max(script_widths) if script_widths else 0)
    return image.convert('RGB')


def _badge(panel, label, colour, reserved_right=0):
    if colour is not None and (not isinstance(colour, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', colour)):
        raise ValueError('Use #RRGGBB for the panel label colour.')
    width = panel.width
    font = _font(max(18, round(width * 18 / 320)), system_ui=True, semibold=True)
    overlay = Image.new('RGBA', panel.size)
    draw = ImageDraw.Draw(overlay)
    label = str(label)[:120]
    x = y = max(6, round(width * 5 / 320))
    padding = max(6, round(width * 7 / 320))
    stroke = 0
    available = max(0, width - x - 2 * padding - reserved_right)
    if draw.textbbox((0, 0), label, font=font, stroke_width=stroke)[2] > available:
        while label and draw.textbbox((0, 0), label + '…', font=font, stroke_width=stroke)[2] > available:
            label = label[:-1]
        label = label + '…' if label else ''
    if not label:
        return panel
    bounds = draw.textbbox((0, 0), label, font=font, stroke_width=stroke)
    text_width, text_height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    draw.rounded_rectangle((x, y, x + text_width + 2 * padding, y + text_height + 2 * padding),
                           radius=max(4, round(width * 4 / 320)), fill=colour or (5, 10, 16, 200))
    ink = _label_ink(colour) if colour else 'white'
    draw.text((x + padding - bounds[0], y + padding - bounds[1]), label, font=font,
              fill=ink, stroke_width=stroke, stroke_fill=ink)
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


def _metadata_layout(lines, font):
    """Right-align values against a shared unit column."""
    measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    parts = []
    for line in lines:
        match = re.fullmatch(r'(.*?\d(?:[.,]\d+)*)(×|[A-Za-zµμ]+)', line)
        parts.append((match[1], match[2]) if match else (line, ''))
    value_width = max((measure.textlength(value, font=font) for value, _ in parts), default=0)
    unit_width = max((measure.textlength(unit, font=font) for _, unit in parts), default=0)
    gap = max(3, round(font.size * .18)) if unit_width else 0
    return parts, value_width, unit_width, gap


def _metadata_badge(panel, lines):
    if not lines:
        return panel
    width = panel.width
    font = _font(max(14, round(width * 12 / 320)), system_ui=True)
    padding = max(6, width // 70)
    line_height = max(20, round(width * 16 / 320))
    parts, value_width, unit_width, gap = _metadata_layout(lines, font)
    box_width = math.ceil(value_width + gap + unit_width) + 2 * padding
    x, y = width - box_width - max(6, width // 80), max(6, width // 80)
    overlay = Image.new('RGBA', panel.size)
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle((x, y, x + box_width, y + len(lines) * line_height + padding),
                           radius=max(4, width // 160), fill=(5, 10, 16, 200))
    boundary = x + padding + value_width
    for index, (value, unit) in enumerate(parts):
        baseline = y + padding // 2 + index * line_height
        draw.text((boundary - draw.textlength(value, font=font), baseline), value, font=font, fill='white')
        if unit:
            draw.text((boundary + gap, baseline), unit, font=font, fill='white')
    return Image.alpha_composite(panel.convert('RGBA'), overlay).convert('RGB')


def _metadata_reserved(width, lines):
    if not lines:
        return 0
    font = _font(max(14, round(width * 12 / 320)), system_ui=True)
    _, values, units, unit_gap = _metadata_layout(lines, font)
    return (math.ceil(values + units + unit_gap) + 2 * max(6, width // 70)
            + max(6, width // 80) + 12)


def _nice_bar(nm_per_display_px, width):
    target = nm_per_display_px * width * .17
    exponent = math.floor(math.log10(target))
    candidates = [step * 10 ** power for power in range(exponent - 1, exponent + 2) for step in (1, 2, 5)]
    return min(candidates, key=lambda value: abs(math.log(value / target)))


def _tone_target(slots, aspect, figure_crop_metadata=True, dm_reader=None):
    ranges = [_tone_quantiles(_panel(slot, 240, aspect, strict=False, raw_only=True,
                                     figure_crop_metadata=figure_crop_metadata, dm_reader=dm_reader))
              for slot in slots if slot.get('path')]
    return tone_target(ranges)


def _crop_metadata(slot, figure_crop_metadata):
    override = slot.get('crop_metadata')
    return override if isinstance(override, bool) else figure_crop_metadata


def _is_placeholder(slot):
    if slot.get('kind') != 'placeholder':
        return False
    if slot.get('path'):
        raise ValueError('A placeholder cannot also contain a source image. Replace or clear the panel.')
    return True


def _placeholder_panel(slot, width, aspect):
    """Render an intentional missing acquisition, without image metadata or calibration."""
    fields = slot.get('placeholder', {})
    if not isinstance(fields, dict):
        raise ValueError('Expected placeholder details.')
    values = {}
    for key in ('title', 'sample', 'location'):
        value = fields.get(key, 'Not acquired' if key == 'title' else '')
        if not isinstance(value, str) or len(value) > 120:
            raise ValueError('Placeholder text must be at most 120 characters per field.')
        values[key] = ' '.join(value.split())
    magnification = fields.get('target_magnification_x')
    if magnification is not None and (isinstance(magnification, bool)
            or not isinstance(magnification, (int, float))
            or not math.isfinite(magnification) or magnification <= 0):
        raise ValueError('Target magnification must be a positive number, or left blank.')
    details = [values[key] for key in ('sample', 'location') if values[key]]
    if magnification is not None:
        details.append(f'Target {magnification:,.8g}×')
    height = math.ceil(width / aspect)
    panel = Image.new('RGB', (width, height), 'black')
    draw = ImageDraw.Draw(panel)
    # Proportions match the supplied missing-acquisition TIFF; fit extreme Auto shapes too.
    scale = min(width / 1000, height / 800)
    lines = [(values['title'] or 'Not acquired', 60, -150),
             (' | '.join(details), 36, -65),
             ('PLACEHOLDER - NO MICROSCOPE DATA', 26, 15),
             ('Acquisition kV: not applicable', 22, 70),
             ('No specimen scale calibration', 20, 110)]
    for text, size, offset in lines:
        if not text:
            continue
        font_size = max(1, round(size * scale))
        font = _font(font_size, system_ui=True)
        while font_size > 1 and draw.textlength(text, font=font) > width * .88:
            font_size -= 1
            font = _font(font_size, system_ui=True)
        draw.text((width / 2, height / 2 + offset * scale), text,
                  font=font, anchor='mm', fill='white')
    return panel


def _figure_aspect(recipe):
    selected = recipe.get('aspect', 4 / 3)
    if selected == 'auto':
        ratios = []
        for slot in recipe.get('slots', []):
            if not slot.get('path'):
                continue
            width = float(slot.get('width') or 0)
            height = float((slot.get('content_height') or slot.get('height') or 0)
                           if _crop_metadata(slot, recipe.get('crop_metadata', True))
                           else (slot.get('height') or 0))
            if math.isfinite(width) and math.isfinite(height) and width > 0 and height > 0:
                ratios.append(width / height)
        return float(np.median(ratios)) if ratios else 4 / 3
    aspect = float(selected)
    if aspect not in (1, 4 / 3, 16 / 9):
        raise ValueError('Choose Auto, square, 4:3 or 16:9 panels.')
    return aspect


def _export_panel_width(slots, aspect, figure_crop_metadata):
    """Keep every displayed source crop at or above its native pixel size."""
    width = 1000
    for slot in slots:
        if not slot.get('path'):
            continue
        image_width = float(slot.get('width') or 0)
        image_height = float((slot.get('content_height') or slot.get('height') or 0)
                             if _crop_metadata(slot, figure_crop_metadata) else (slot.get('height') or 0))
        zoom = float(slot.get('zoom', 1))
        if not all(math.isfinite(value) and value > 0 for value in (image_width, image_height, zoom)):
            raise ValueError('Reinspect each source image before full-resolution export.')
        native_crop = min(image_width, image_height * aspect) / zoom
        width = max(width, math.ceil(native_crop))
    return width


@lru_cache(maxsize=256)
def _sampled_png_bytes_per_pixel(path, digest, content_height, crop_metadata, aspect,
                                 zoom, center_x, center_y, panel_width, dm_reader=None):
    """Measure representative final-size texture without encoding the whole figure."""
    source = _source(path)
    with _open_image(source, dm_reader) as raw:
        if raw.width * raw.height > MAX_SOURCE_PIXELS:
            raise ValueError('This image is too large for the figure editor.')
        image = ImageOps.exif_transpose(raw).convert('RGB')
    if not 1 <= content_height <= image.height:
        raise ValueError('Invalid saved image-field boundary. Replace this panel.')
    image = image.crop((0, 0, image.width, content_height if crop_metadata else image.height))
    if not (1 <= zoom <= 20 and 0 <= center_x <= 1 and 0 <= center_y <= 1):
        raise ValueError('Panel zoom and centre must be within the image.')
    crop_width = min(image.width, image.height * aspect) / zoom
    crop_height = crop_width / aspect
    left = min(max(center_x * image.width - crop_width / 2, 0), image.width - crop_width)
    top = min(max(center_y * image.height - crop_height / 2, 0), image.height - crop_height)
    image = image.crop((round(left), round(top), round(left + crop_width), round(top + crop_height)))
    scale = panel_width / image.width
    sample_width = min(image.width, image.height, max(1, round(256 / scale)))
    target_width = max(1, round(sample_width * scale))
    total_bytes = 0
    total_pixels = 0
    for fx in (.2, .5, .8):
        for fy in (.2, .5, .8):
            x = round((image.width - sample_width) * fx)
            y = round((image.height - sample_width) * fy)
            patch = image.crop((x, y, x + sample_width, y + sample_width))
            if patch.width != target_width:
                patch = patch.resize((target_width, target_width), Image.Resampling.LANCZOS)
            stream = BytesIO()
            patch.save(stream, format='PNG')
            total_bytes += stream.tell()
            total_pixels += target_width * target_width
    return total_bytes / total_pixels


def _figure_columns(recipe):
    value = recipe.get('columns', 2)
    try:
        columns = int(value)
        if isinstance(value, bool) or columns < 1 or float(value) != columns:
            raise ValueError
    except (ValueError, TypeError, OverflowError):
        raise ValueError('Use a positive whole number of columns.') from None
    return columns


def estimate_png_size(recipe, *, dm_reader=None):
    """Measure small outputs exactly; sample native-detail PNG patches for large ones."""
    if not isinstance(recipe, dict) or not isinstance(recipe.get('slots'), list):
        raise ValueError('Expected a saved figure recipe.')
    slots = recipe['slots']
    if not slots:
        raise ValueError('Choose at least one image panel.')
    columns = _figure_columns(recipe)
    crop_metadata = recipe.get('crop_metadata', True)
    if not isinstance(crop_metadata, bool):
        raise ValueError('Choose whether to crop metadata bars.')
    padding = int(recipe.get('image_padding', 36))
    if not 0 <= padding <= 200:
        raise ValueError('Image padding must be between 0 and 200 pixels.')
    percent = recipe.get('export_scale_percent', 100)
    if isinstance(percent, bool) or not isinstance(percent, (int, float)) or not math.isfinite(percent) or not 25 <= percent <= 100:
        raise ValueError('Export size must be between 25% and 100%.')
    aspect = _figure_aspect(recipe)
    panel_width = math.ceil(_export_panel_width(slots, aspect, crop_metadata) * percent / 100)
    panel_height = math.ceil(panel_width / aspect)
    canvas_width = columns * panel_width + (columns + 1) * padding
    canvas_height = math.ceil(len(slots) / columns) * panel_height + (math.ceil(len(slots) / columns) + 1) * padding
    filled = [slot for slot in slots if _is_placeholder(slot) or slot.get('path')]
    if not filled:
        raise ValueError('Choose an image or placeholder to estimate the PNG size.')
    if canvas_width * canvas_height <= MAX_EXACT_ESTIMATE_PIXELS and len(filled) == len(slots):
        return {'estimated_size_bytes': len(render(recipe, dm_reader=dm_reader)), 'width': canvas_width,
                'height': canvas_height, 'exact': True}
    rates = []
    for slot in filled:
        if _is_placeholder(slot):
            stream = BytesIO()
            _placeholder_panel(slot, panel_width, aspect).save(stream, format='PNG')
            rates.append(len(stream.getvalue()) / (panel_width * panel_height))
            continue
        source = _source(slot['path'])
        if _digest(source) != slot.get('sha256'):
            raise ValueError(f'{source.name} changed since this panel was saved. Replace it explicitly.')
        height = int(slot.get('content_height') or slot.get('height') or 0)
        rates.append(_sampled_png_bytes_per_pixel(
            slot['path'], slot.get('sha256'), height,
            _crop_metadata(slot, crop_metadata), aspect, float(slot.get('zoom', 1)),
            float(slot.get('center_x', .5)), float(slot.get('center_y', .5)), panel_width, dm_reader))
    # Allow for labels, bars and compression-stream variation outside sampled patches.
    estimate = round(canvas_width * canvas_height * (sum(rates) / len(rates)) * 1.05)
    return {'estimated_size_bytes': estimate, 'width': canvas_width,
            'height': canvas_height, 'exact': False}


def _adjust_tone(image, slot, target):
    image = match_tone(image, target)
    brightness, contrast = float(slot.get('brightness', 1)), float(slot.get('contrast', 1))
    if not (math.isfinite(brightness) and math.isfinite(contrast)
            and .25 <= brightness <= 3 and .25 <= contrast <= 3):
        raise ValueError('Panel brightness and contrast must be between 0.25 and 3.')
    if contrast != 1:
        image = ImageEnhance.Contrast(image).enhance(contrast)
    if brightness != 1:
        image = ImageEnhance.Brightness(image).enhance(brightness)
    return image


def _panel(slot, width, aspect, strict, tone_target=None, raw_only=False, figure_sharpness=1,
           figure_crop_metadata=True, figure_scale_bar_overlay=True,
           figure_scale_bar_position='left', dm_reader=None):
    source = _source(slot['path'])
    if _digest(source) != slot.get('sha256'):
        raise ValueError(f'{source.name} changed since this panel was saved. Replace it explicitly.')
    sidecar = slot.get('metadata_sidecar')
    if strict and sidecar and _digest(_source_sidecar(sidecar['path'], source)) != sidecar.get('sha256'):
        raise ValueError(f'The metadata sidecar for {source.name} changed. Review or replace this panel.')
    analysis = slot.get('analysis')
    if strict and analysis and _digest(_source_analysis(analysis['path'])) != analysis.get('sha256'):
        raise ValueError(f'The linked analysis for {source.name} changed. Review or replace this panel.')
    with _open_image(source, dm_reader) as raw:
        if raw.width * raw.height > MAX_SOURCE_PIXELS:
            raise ValueError('This image is too large for the figure editor.')
        image = ImageOps.exif_transpose(raw).convert('RGB')
    scale_mode = slot.get('scale_mode', 'replace')
    if scale_mode not in ('replace', 'metadata', 'keep'):
        raise ValueError('Choose a supported scale display mode.')
    saved_content_height = int(slot.get('content_height', image.height))
    if not 1 <= saved_content_height <= image.height:
        raise ValueError('Invalid saved image-field boundary. Replace this panel.')
    content_height = saved_content_height if _crop_metadata(slot, figure_crop_metadata) else image.height
    bar = slot.get('bar')
    if strict and figure_scale_bar_overlay and scale_mode == 'keep' and isinstance(bar, dict) and bar.get('y', -1) >= content_height:
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
    height = math.ceil(width / aspect)
    if image.size != (width, height):
        image = image.resize((width, height), Image.Resampling.LANCZOS)
    if raw_only:
        return image
    image = _adjust_tone(image, slot, tone_target)
    sharpness = float(slot.get('sharpness') if slot.get('sharpness') is not None else figure_sharpness)
    if not math.isfinite(sharpness) or not 0 <= sharpness <= 3:
        raise ValueError('Sharpness must be between 0 and 3.')
    if sharpness != 1:
        image = ImageEnhance.Sharpness(image).enhance(sharpness)
    if not figure_scale_bar_overlay or scale_mode == 'keep':
        return image
    bar_px, scale_nm = (1, slot.get('pixel_size_nm')) if scale_mode == 'metadata' else (slot.get('bar_px'), slot.get('scale_nm'))
    if not bar_px or not scale_nm:
        if strict:
            if scale_mode == 'metadata':
                raise ValueError(f'Reinspect the recorded pixel size for {source.name} before export.')
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
    position = slot.get('scale_position') or figure_scale_bar_position
    if position not in ('left', 'right'):
        raise ValueError('Choose Left or Right for the scale bar.')
    x = margin if position == 'left' else width - margin - length
    y = height - margin - bar_height
    style = slot.get('scale_style', 'standard')
    if style not in ('standard', 'plaque'):
        raise ValueError('Choose a supported scale bar style.')
    if style == 'plaque':
        label = _scale_label(chosen_nm)
        font = _font(max(20, round(width * 24 / 320)), system_ui=True, semibold=True)
        label_box = draw.textbbox((0, 0), label, font=font)
        label_width = label_box[2] - label_box[0]
        label_height = label_box[3] - label_box[1]
        inset = max(8, round(width * .018))
        plaque_width = max(length, label_width) + 2 * inset
        plaque_height = bar_height + label_height + 3 * inset
        plaque_x = margin if position == 'left' else width - margin - plaque_width
        plaque_y = height - margin - plaque_height
        draw.rectangle((plaque_x, plaque_y, plaque_x + plaque_width, plaque_y + plaque_height), fill='black')
        bar_x = plaque_x + (plaque_width - length) / 2
        draw.rectangle((round(bar_x), plaque_y + inset, round(bar_x + length), plaque_y + inset + bar_height), fill='white')
        draw.text((round(plaque_x + (plaque_width - label_width) / 2 - label_box[0]),
                   round(plaque_y + 2 * inset + bar_height - label_box[1])),
                  label, font=font, fill='white')
        return image
    draw.rectangle((x - 2, y - 2, x + length + 2, y + bar_height + 2), fill='black')
    draw.rectangle((x, y, x + length, y + bar_height), fill='white')
    label = _scale_label(chosen_nm)
    font = _font(max(19, round(width * 14 / 320)), system_ui=True)
    stroke = max(2, width // 300)
    bounds = draw.textbbox((0, 0), label, font=font, stroke_width=stroke)
    label_width = bounds[2] - bounds[0]
    label_x = min(max(x + (length - label_width) / 2 - bounds[0], margin),
                  width - margin - label_width - bounds[0])
    label_y = y - max(7, round(width * .008)) - bounds[3]
    draw.text((round(label_x), round(label_y)), label, font=font,
              fill='white', stroke_width=stroke, stroke_fill='black')
    return image


def _source_analysis(path):
    source = Path(path).expanduser().resolve()
    if source.suffix.lower() != '.json' or not source.is_file():
        raise ValueError('The linked analysis JSON is unavailable. Replace this panel.')
    return source


def _render(recipe, preview=False, *, dm_reader=None, preview_width=None):
    if not isinstance(recipe, dict):
        raise ValueError('Expected a saved figure recipe.')
    slots = recipe.get('slots')
    if not isinstance(slots, list) or not slots:
        raise ValueError('Choose at least one image panel.')
    columns = _figure_columns(recipe)
    metadata_overlay = recipe.get('metadata_overlay', [])
    if not isinstance(metadata_overlay, list) or any(key not in METADATA_FIELDS for key in metadata_overlay):
        raise ValueError('Choose supported metadata overlay fields.')
    aspect = _figure_aspect(recipe)
    figure_crop_metadata = recipe.get('crop_metadata', True)
    if not isinstance(figure_crop_metadata, bool):
        raise ValueError('Choose whether to crop metadata bars.')
    scale_bar_overlay = recipe.get('scale_bar_overlay', True)
    if not isinstance(scale_bar_overlay, bool):
        raise ValueError('Choose whether to overlay scale bars.')
    scale_bar_position = recipe.get('scale_bar_position', 'left')
    if scale_bar_position not in ('left', 'right'):
        raise ValueError('Choose Left or Right for the figure scale bars.')
    padding = int(recipe.get('image_padding', 36))
    if not 0 <= padding <= 200:
        raise ValueError('Image padding must be between 0 and 200 pixels.')
    scale_percent = recipe.get('export_scale_percent', 100)
    if isinstance(scale_percent, bool) or not isinstance(scale_percent, (int, float)) or not math.isfinite(scale_percent) or not 25 <= scale_percent <= 100:
        raise ValueError('Export size must be between 25% and 100%.')
    export_width = math.ceil(_export_panel_width(slots, aspect, figure_crop_metadata) * scale_percent / 100)
    width = 420 if preview else export_width
    rows = math.ceil(len(slots) / columns)
    if preview and preview_width is not None:
        if (isinstance(preview_width, bool) or not isinstance(preview_width, (int, float))
                or not math.isfinite(preview_width) or not 320 <= preview_width <= 6000):
            raise ValueError('Choose a preview width from 320 to 6000 pixels.')
        width = math.ceil(preview_width / (columns + (columns + 1) * padding / export_width))
    if preview:
        # Bound the whole preview, including tall Auto panels and large grids.
        while True:
            gap = round(padding * width / export_width)
            pixels = (columns * width + (columns + 1) * gap) * (rows * math.ceil(width / aspect) + (rows + 1) * gap)
            if pixels <= MAX_PREVIEW_PIXELS:
                break
            if width <= 1:
                raise ValueError('The selected panel shape is too tall to preview.')
            width = max(1, min(width - 1, math.floor(width * math.sqrt(MAX_PREVIEW_PIXELS / pixels))))
    margin = round(padding * width / export_width)
    gap = margin
    tile_height = math.ceil(width / aspect)
    color = 'white' if recipe.get('background', 'white') == 'white' else '#101820'
    tone_target = _tone_target(slots, aspect, figure_crop_metadata, dm_reader) if recipe.get('match_tone') else None
    figure_sharpness = float(recipe.get('sharpness', 1))
    if not math.isfinite(figure_sharpness) or not 0 <= figure_sharpness <= 3:
        raise ValueError('Figure sharpness must be between 0 and 3.')
    figure_width = columns * width + (columns + 1) * margin
    figure_height = rows * tile_height + (rows + 1) * margin
    figure = Image.new('RGB', (figure_width, figure_height), color)
    for index, slot in enumerate(slots):
        x = margin + (index % columns) * (width + gap)
        y = margin + (index // columns) * (tile_height + gap)
        if _is_placeholder(slot):
            figure.paste(_placeholder_panel(slot, width, aspect), (x, y))
        elif not slot.get('path'):
            if not preview:
                raise ValueError(f'Choose an image or create a placeholder for slot {index + 1} before export.')
            panel = Image.new('RGB', (width, tile_height), '#e8edf2' if color == 'white' else '#263746')
            placeholder = ImageDraw.Draw(panel)
            inset = min(round(16 * width / 420), (min(width, tile_height) - 1) // 2)
            placeholder.rounded_rectangle((inset, inset, width - 1 - inset, tile_height - 1 - inset),
                                          radius=round(8 * width / 420),
                                          outline='#94a5b8', width=max(1, round(2 * width / 420)))
            placeholder.text((round(28 * width / 420), round(28 * width / 420)),
                             f'Slot {index + 1} · choose image', font=_font(max(1, round(22 * width / 420))),
                             fill='#263445' if color == 'white' else '#edf5fc')
            figure.paste(panel, (x, y))
        else:
            panel = _panel(slot, width, aspect, strict=not preview, tone_target=tone_target,
                           figure_sharpness=figure_sharpness, figure_crop_metadata=figure_crop_metadata,
                           figure_scale_bar_overlay=scale_bar_overlay,
                           figure_scale_bar_position=scale_bar_position, dm_reader=dm_reader)
            label = str(slot.get('label') or Path(slot['path']).stem)[:120]
            lines = _metadata_lines(slot, metadata_overlay)
            reserved = _metadata_reserved(width, lines)
            if slot.get('label_visible', True):
                panel = _badge(panel, label, slot.get('label_colour'), reserved_right=reserved)
            figure.paste(_annotations(_metadata_badge(panel, lines), slot), (x, y))
    stream = BytesIO()
    figure.save(stream, format='PNG', dpi=(300, 300))
    return stream.getvalue(), dict(width=figure_width, height=figure_height,
                                   panel_width=width, panel_height=tile_height,
                                   margin=margin, columns=columns, rows=rows)


def render(recipe, preview=False, *, dm_reader=None):
    return _render(recipe, preview, dm_reader=dm_reader)[0]


def preview_result(recipe, *, width=None, dm_reader=None):
    data, layout = _render(recipe, preview=True, preview_width=width, dm_reader=dm_reader)
    return dict(image='data:image/png;base64,' + base64.b64encode(data).decode('ascii'), layout=layout)


def preview(recipe, *, dm_reader=None):
    return preview_result(recipe, dm_reader=dm_reader)['image']


def panel_preview(slot, aspect=4 / 3, metadata_overlay=None, recipe=None, width=1000, *, dm_reader=None):
    width = int(width)
    if not 420 <= width <= 2000:
        raise ValueError('Choose a panel preview width from 420 to 2000 pixels.')
    aspect = _figure_aspect(recipe) if recipe else float(aspect)
    if not recipe and aspect not in (1, 4 / 3, 16 / 9):
        raise ValueError('Choose square, 4:3 or 16:9 panels.')
    if _is_placeholder(slot):
        stream = BytesIO()
        _placeholder_panel(slot, width, aspect).save(stream, format='PNG')
        return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')
    crop_metadata = recipe.get('crop_metadata', True) if recipe else True
    scale_bar_overlay = recipe.get('scale_bar_overlay', True) if recipe else True
    scale_bar_position = recipe.get('scale_bar_position', 'left') if recipe else 'left'
    tone_target = _tone_target(recipe.get('slots', []), aspect, crop_metadata, dm_reader) if recipe and recipe.get('match_tone') else None
    panel = _panel(slot, width, aspect, strict=False, tone_target=tone_target,
                   figure_sharpness=recipe.get('sharpness', 1) if recipe else 1,
                   figure_crop_metadata=crop_metadata,
                   figure_scale_bar_overlay=scale_bar_overlay,
                   figure_scale_bar_position=scale_bar_position, dm_reader=dm_reader)
    lines = _metadata_lines(slot, metadata_overlay or [])
    reserved = _metadata_reserved(width, lines)
    if slot.get('label_visible', True):
        panel = _badge(panel, slot.get('label') or Path(slot['path']).stem,
                       slot.get('label_colour'), reserved_right=reserved)
    panel = _annotations(_metadata_badge(panel, lines), slot)
    stream = BytesIO()
    panel.save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')


def label_tag_png(label, colour=None):
    """Render a tightly cropped label tag on a transparent canvas."""
    label = str(label or '').strip()
    if not label or len(label) > 120:
        raise ValueError('Enter a label of 1–120 characters for each tag.')
    if colour is not None and (not isinstance(colour, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', colour)):
        raise ValueError('Use #RRGGBB for a tag shade.')
    width = 1000
    font = _font(round(width * 18 / 320), system_ui=True, semibold=True)
    padding = round(width * 7 / 320)
    bounds = ImageDraw.Draw(Image.new('RGBA', (1, 1))).textbbox((0, 0), label, font=font)
    tag_width = math.ceil(bounds[2] - bounds[0]) + 2 * padding
    tag_height = math.ceil(bounds[3] - bounds[1]) + 2 * padding
    tag = Image.new('RGBA', (tag_width, tag_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tag)
    draw.rounded_rectangle((0, 0, tag_width - 1, tag_height - 1),
                           radius=round(width * 4 / 320), fill=colour or (5, 10, 16, 200))
    draw.text((padding - bounds[0], padding - bounds[1]), label, font=font,
              fill=_label_ink(colour) if colour else 'white')
    stream = BytesIO()
    tag.save(stream, format='PNG')
    return stream.getvalue()


def export_label_tags(tags, recipe, sources, output_root, source_path=None):
    if not isinstance(tags, list) or not 1 <= len(tags) <= 500:
        raise ValueError('Choose 1–500 label tags to export.')
    if not isinstance(recipe, dict):
        raise ValueError('Expected a figure recipe.')
    if any(not isinstance(tag, dict) for tag in tags):
        raise ValueError('Each tag needs a label and an optional shade.')
    names = [str(tag.get('label') or '').strip() for tag in tags]
    if len({name.casefold() for name in names}) != len(names):
        raise ValueError('Remove duplicate label tags before exporting.')
    rendered = [label_tag_png(name, tag.get('colour')) for name, tag in zip(names, tags)]
    paths = [source_path] if source_path else [slot['path'] for slot in recipe.get('slots', []) if slot.get('path')]
    destinations = {output_folder(sources, output_root, path=path) for path in paths}
    parent = next(iter(destinations)) if len(destinations) == 1 else Path(output_root).resolve()
    folder = parent / f'figure_tags_{datetime.now().astimezone():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:6]}'
    folder.mkdir(parents=True, exist_ok=False)
    files = []
    for index, (name, tag, data) in enumerate(zip(names, tags, rendered), 1):
        slug = re.sub(r'[^\w.-]+', '_', name).strip('._')[:64] or 'tag'
        shade = str(tag.get('colour') or 'default').lstrip('#').lower()
        path = folder / f'{index:03d}_{slug}_{shade}.png'
        path.write_bytes(data)
        files.append(str(path))
    return {'folder': str(folder), 'files': files}


def export(recipe, sources, output_root, *, dm_reader=None):
    data = render(recipe, dm_reader=dm_reader)
    paths = [slot['path'] for slot in recipe['slots'] if slot.get('path')]
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
    return {'png': str(png), 'recipe': str(manifest), 'size_bytes': len(data)}
