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
