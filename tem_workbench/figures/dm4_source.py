"""Native figure inputs, using the same ncempy reader as the TEM workspace."""
from datetime import date
import importlib
import math

import numpy as np
from PIL import Image

from tem_workbench.analysis.diffraction import reciprocal_factor
from tem_workbench.storage.acquisition_map import LENGTH_NM, acquisition_timestamp, finite

MAX_SOURCE_PIXELS = 150_000_000


def _reader(factory):
    if factory is not None:
        return factory()
    try:
        return importlib.import_module('ncempy.io.dm')
    except ImportError as error:
        raise ValueError('Install ncempy in the app Python environment to open DM4 files.') from error


def _dimensions(source):
    # getDataset(0) skips the embedded thumbnail when there is more than one object.
    index = 0 if source.numObjects == 1 else 1
    width, height = int(source.xSize[index]), int(source.ySize[index])
    if source.dataShape[index] != 2 or min(width, height) < 2:
        raise ValueError('Figures supports two-dimensional DM4 images, not spectra or stacks.')
    if width * height > MAX_SOURCE_PIXELS:
        raise ValueError('This image is too large for the figure editor.')
    return width, height


def inspect(path, reader=None):
    """Read native geometry and acquisition tags without loading the image pixels."""
    with _reader(reader).fileDM(path, on_memory=False) as source:
        width, height = _dimensions(source)
        tags = source.getMetadata(0)
    metadata = {}
    for key, tag, unit, factor in (
        ('magnification', 'Microscope Info Indicated Magnification', '×', 1),
        ('voltage_kv', 'Microscope Info Voltage', 'kV', .001),
        ('probe', 'Microscope Info Probe Current (nA)', 'nA', 1),
    ):
        value = finite(tags.get(tag))
        if value is not None and value > 0:
            metadata[key] = dict(value=value * factor, unit=unit, source='DM4 ' + tag)
            if key == 'probe':
                metadata[key]['kind'] = 'current'
    timestamp = acquisition_timestamp(tags.get('DataBar Acquisition Date'),
                                      tags.get('DataBar Acquisition Time') or '00:00:00')
    if timestamp is not None:
        metadata['acquisition_date'] = dict(value=date.fromordinal(int(timestamp // 86400)).isoformat(),
                                            source='DM4 DataBar Acquisition Date')
    scales = []
    for dimension in (1, 2):
        unit = str(tags.get(f'Calibrations Dimension {dimension} Units', '')).strip()
        scale = finite(tags.get(f'Calibrations Dimension {dimension} Scale'))
        converted = scale * LENGTH_NM[unit] if unit in LENGTH_NM and scale is not None and scale > 0 else None
        scales.append(converted if converted is not None and math.isfinite(converted) else None)
    pixel_size = scales[0] if all(scales) and math.isclose(*scales, rel_tol=1e-5) else None
    return dict(width=width, height=height, metadata=metadata, pixel_size_nm=pixel_size,
                pixel_size_source='DM4 dimension calibration' if pixel_size else None)


def image(path, reader=None):
    """Normalize full-resolution original pixels for the figure's RGB rendering."""
    with _reader(reader).fileDM(path, on_memory=False) as source:
        _dimensions(source)
        tags = source.getMetadata(0)
        pixels = np.asarray(source.getDataset(0)['data'])
    if pixels.ndim != 2 or not np.issubdtype(pixels.dtype, np.number) or np.iscomplexobj(pixels) or not np.isfinite(pixels).all():
        raise ValueError('Figures requires a finite, real-valued two-dimensional DM4 image.')
    # Match TEM's display normalization; no spatial downsampling or PNG input.
    if all(reciprocal_factor(str(tags.get(f'Calibrations Dimension {d} Units', '')).strip()) is not None for d in (1, 2)):
        pixels = np.log1p(np.maximum(pixels, 0))
    low, high = np.percentile(pixels, [.3, 99.7])
    return Image.fromarray(np.uint8(np.clip((pixels - low) / max(high - low, 1e-12), 0, 1) * 255))
