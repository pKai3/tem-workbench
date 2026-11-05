"""Metadata-only acquisition locations; no registration or image analysis."""
import math
import re
from collections import Counter, defaultdict

LENGTH_NM = {'nm': 1., 'µm': 1000., 'μm': 1000., 'um': 1000., 'm': 1e9, 'A': .1, 'Å': .1}


def finite(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def stage_position(meta):
    prefix = 'Microscope Info Stage Position Stage '
    return {**{key.lower(): finite(meta.get(prefix + key)) for key in ('X', 'Y', 'Alpha', 'Beta')},
            'units': None}  # These tags do not declare units. Keep raw values in exports.


def describe(meta, width, height):
    units = [str(meta.get(f'Calibrations Dimension {d} Units', '')).strip() for d in (1, 2)]
    scales = [finite(meta.get(f'Calibrations Dimension {d} Scale')) for d in (1, 2)]
    field = None
    if all(u in LENGTH_NM for u in units) and all(s is not None and s > 0 for s in scales):
        if width and height:
            field = [width * scales[0] * LENGTH_NM[units[0]], height * scales[1] * LENGTH_NM[units[1]]]
    return {'stage_position': stage_position(meta), 'field_nm': field,
            'date': str(meta.get('DataBar Acquisition Date', '')),
            'time': str(meta.get('DataBar Acquisition Time', '')),
            'width': width, 'height': height,
            'magnification': finite(meta.get('Microscope Info Indicated Magnification')),
            'image_kind': 'real_space' if all(u in LENGTH_NM for u in units) else 'diffraction_or_uncalibrated'}


def acquisition_number(row):
    name = re.sub(r'\.(?:dm[34]|tiff?|jpe?g|png)$', '', row['name'], flags=re.I)
    tagged = re.search(r'(?:^|[_\s-])(?:STA|ST)[_\s-]*(\d+)(?=$|[_\s·-])', name, re.I)
    numbers = re.findall(r'(?:^|[_\s-])(\d+)(?=$|[_\s-])', name)
    return int(tagged.group(1)) if tagged else int(numbers[-1]) if numbers else None


def acquisition_batches(rows):
    """Consecutive numbers with exactly equal, known raw alpha AND beta only.

    Folder/date boundaries keep separate acquisition sessions apart. Duplicate
    numbers and missing metadata are singleton batches, never bridges. Compute
    before UI filtering so hiding an intervening image cannot merge batches.
    """
    sessions = defaultdict(list)
    for row in rows:
        row['acquisition_number'] = acquisition_number(row)
        sessions[(row.get('folder', ''), row.get('date', ''))].append(row)
    batches = []
    for session in sorted(sessions):
        files = sorted(sessions[session], key=lambda f: (f['acquisition_number'] is None,
                       f['acquisition_number'] or 0, f['id']))
        counts = Counter(f['acquisition_number'] for f in files)
        previous, group, previous_valid = None, None, False
        for row in files:
            number = row['acquisition_number']
            tilt = tuple(finite(row.get('stage_position', {}).get(k)) for k in ('alpha', 'beta'))
            valid = number is not None and counts[number] == 1 and all(v is not None for v in tilt)
            continues = (valid and previous_valid and number == previous['acquisition_number'] + 1
                         and tilt == tuple(previous['stage_position'][k] for k in ('alpha', 'beta')))
            if not continues:
                group = {'id': row['id'], 'members': [], 'alpha': tilt[0], 'beta': tilt[1],
                         'folder': session[0], 'date': session[1], 'automatic': valid}
                batches.append(group)
            row['acquisition_batch'] = group['id']
            group['members'].append(row['id'])
            previous, previous_valid = row, valid
    # Select the widest calibrated real-space view, with deterministic ties.
    by_id = {row['id']: row for row in rows}
    for group in batches:
        candidates = [by_id[i] for i in group['members'] if by_id[i].get('field_nm')]
        group['reference_id'] = min(candidates, key=lambda f: (-math.prod(f['field_nm']),
            f['acquisition_number'] if f['acquisition_number'] is not None else math.inf, f['id']))['id'] if candidates else None
        group['first'] = by_id[group['members'][0]]['acquisition_number']
        group['last'] = by_id[group['members'][-1]]['acquisition_number']
    return batches


class MetadataIndex:
    def __init__(self):
        self.cache = {}

    def read(self, path, reader):
        stat = path.stat()
        key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
        if key not in self.cache:
            with reader.fileDM(path, on_memory=False) as source:
                meta = source.getMetadata(0)
                # Same first non-thumbnail dataset convention as ncempy.getDataset(0).
                index = 0 if source.numObjects == 1 else 1
                row = describe(meta, int(source.xSize[index]), int(source.ySize[index]))
            self.cache[key] = row
        return dict(self.cache[key])


def reference_crop(array, bounds):
    """Crop original reference pixels using normalized, axis-aligned map bounds.

    Preserve the reference's full-image display contrast. Out-of-frame areas are
    black; output dimensions are bounded even when a footprint exceeds the image.
    """
    from io import BytesIO
    import numpy as np
    from PIL import Image
    if array.ndim != 2 or min(array.shape) < 1 or not np.isfinite(array).all():
        raise ValueError('Reference must be a finite two-dimensional image.')
    x, y, w, h = [finite(bounds.get(k)) for k in ('x', 'y', 'w', 'h')]
    if any(v is None or abs(v) > 1e6 for v in (x, y, w, h)) or w <= 0 or h <= 0:
        raise ValueError('Invalid reference crop bounds.')
    ih, iw = array.shape
    lo, hi = np.percentile(array, [.3, 99.7])
    pixels = np.uint8(np.clip((array-lo)/max(hi-lo, 1e-12), 0, 1)*255)
    size = np.array([w*iw, h*ih])
    size *= min(1., 768 / max(size))
    size = tuple(max(1, int(np.ceil(v))) for v in size)
    image = Image.fromarray(pixels).transform(size, Image.Transform.EXTENT,
        (x*iw, y*ih, (x+w)*iw, (y+h)*ih), resample=Image.Resampling.NEAREST, fillcolor=0)
    output = BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()
