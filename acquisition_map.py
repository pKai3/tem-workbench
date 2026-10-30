"""Metadata-only acquisition locations; no registration or image analysis."""
import math

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
