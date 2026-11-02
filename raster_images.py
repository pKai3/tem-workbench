"""Ordinary image input and explicit, source-bound scale-bar calibration."""
from pathlib import Path
import hashlib
import json
import math
import os
import tempfile
import numpy as np
from PIL import Image, ImageOps

EXTENSIONS = {'.jpg', '.jpeg', '.png', '.tif', '.tiff'}
UNITS = {'nm': ('real_space', 1.), 'µm': ('real_space', 1000.),
         'Å': ('real_space', .1), 'nm^-1': ('diffraction', 1.),
         'Å^-1': ('diffraction', 10.)}


def read(path):
    with Image.open(path) as original:
        if getattr(original, 'n_frames', 1) != 1:
            raise ValueError('Choose a single-frame image; export the required TIFF frame first.')
        image = ImageOps.exif_transpose(original)
        if image.mode not in ('L', 'I', 'F', 'I;16', 'I;16B', 'I;16L'):
            image = image.convert('RGB')
            rgb = np.asarray(image, dtype=np.float32)
            array = rgb @ np.array([.299, .587, .114], dtype=np.float32)
        else:
            array = np.asarray(image, dtype=np.float32)
    if array.ndim != 2 or min(array.shape) < 32 or not np.isfinite(array).all():
        raise ValueError('Choose a finite single-frame image at least 32 pixels per side.')
    return np.ascontiguousarray(array)


def identity(array):
    return hashlib.sha256(array.tobytes()).hexdigest()


def validate(array, request):
    units = request.get('units')
    if units not in UNITS:
        raise ValueError('Choose nm, µm, Å, nm^-1 or Å^-1.')
    kind, factor = UNITS[units]
    if request.get('image_kind') != kind:
        raise ValueError('Use length units for real space and reciprocal-length units for diffraction.')
    points = np.asarray(request.get('points'), dtype=float)
    h, w = array.shape
    if points.shape != (2, 2) or not np.isfinite(points).all() or np.any(points < 0) or np.any(points[:,0] > w-1) or np.any(points[:,1] > h-1):
        raise ValueError('Draw both scale-bar endpoints inside the image.')
    length = float(np.linalg.norm(points[1]-points[0]))
    value = float(request.get('value', 0))
    if length < 1 or not math.isfinite(value) or value <= 0:
        raise ValueError('Draw a bar at least one pixel long and enter a positive finite value.')
    scale = value*factor/length
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError('The scale-bar calibration is invalid.')
    return dict(image_kind=kind, units=units, value=value, points=points.tolist(),
                bar_pixels=length, scale=scale, sha256_pixels=identity(array),
                width=w, height=h, method='manual_scale_bar', isotropic=True)


def stored(store, source, array):
    if not Path(store).exists():
        return None
    data = json.loads(Path(store).read_text())
    entry = data.get(str(Path(source).resolve()))
    if entry and entry.get('sha256_pixels') == identity(array):
        return validate(array, entry)
    return None


def catalog_calibrated(source, calibrations):
    entry = calibrations.get(str(Path(source).resolve()))
    if not entry:
        return False
    try:
        stat = Path(source).stat()
        if entry.get('source_stat') == [stat.st_size, stat.st_mtime_ns]:
            return True
        array = read(source)
        return entry.get('sha256_pixels') == identity(array) and bool(validate(array, entry))
    except (OSError, ValueError, TypeError, KeyError):
        return False


def save(store, source, array, request):
    entry = validate(array, request)
    stat = Path(source).stat()
    entry['source_stat'] = [stat.st_size, stat.st_mtime_ns]
    store = Path(store)
    data = json.loads(store.read_text()) if store.exists() else {}
    data[str(Path(source).resolve())] = entry
    store.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.calibration-', suffix='.tmp', dir=store.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(data, stream, indent=2, allow_nan=False)
        os.replace(temporary, store)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return entry
