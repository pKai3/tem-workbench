"""Stored AZtec regions in site coordinates, registered to native electron pixels.

This generalizes the registration in Analysis/scripts/overlay_linescans.py:
image pixels = (site coordinate - image origin) / image pixel step. The prior
line-1 correction (2 * site - 0.5 in normalized image coordinates) follows
directly from the stored cropped-image origin/step, without specimen rules.
Unknown region variants are left unpositioned; no bounding-box guess for masks.
"""
import re
import struct
import uuid

import numpy as np

from .h5oina import AztecReadError
from .native import blob_payloads, native_string


def image_geometry(data, record):
    for payload in blob_payloads(data):
        if len(payload) < 60 or payload[:5] != b'\x06\0\0\0\0':
            continue
        label, offset = native_string(payload, 5)
        if label != record['Label'] or offset + 52 > len(payload):
            continue
        kind, width, height, step, x, y = struct.unpack_from('<III3d', payload, offset)
        ident = str(uuid.UUID(bytes_le=payload[offset+36:offset+52]))
        if kind != 2 or ident != record['id']:
            continue
        if not width or not height or not np.isfinite([step, x, y]).all() or step <= 0:
            break
        return dict(width=width, height=height, step=step, origin=[x, y])
    raise AztecReadError('Image coordinate calibration is not decoded for this record.')


def area_id(data):
    first = next(blob_payloads(data), b'')
    if len(first) != 36 or first[:4] != struct.pack('<I', 2):
        raise AztecReadError('Acquisition region reference is not decoded.')
    return str(uuid.UUID(bytes_le=first[4:20]))


def coordinate_frame(data):
    """Compare stored stage and scan calibration; do not align unlike frames."""
    parts = []
    for name in (b'absolutePosition', b'ScanCalibration'):
        marker = b'@' + bytes([len(name)]) + name
        start = data.find(marker)
        if start < 0:
            raise AztecReadError('Region coordinate frame is unavailable.')
        parts.append(next(blob_payloads(data[start+len(marker):]), b''))
    if len(parts[0]) != 44 or len(parts[1]) != 20:
        raise AztecReadError('Region coordinate frame differs from the validated layout.')
    return tuple(parts)


def field_width_nm(data):
    """Native scan calibration is mm at unit magnification (H5 reference checked)."""
    start = data.find(b'columnConditions')
    if start < 0:
        return None
    try:
        payload = next(blob_payloads(data[start:], marker=b'^\x04Blob'))
        version, count = struct.unpack_from('<II', payload)
        if version != 1 or not 0 < count <= 64:
            return None
        keys, offset = [], 8
        for _ in range(count):
            if payload[offset] != 0:
                return None
            key, offset = native_string(payload, offset+1); keys.append(key)
        if struct.unpack_from('<I', payload, offset)[0] != count:
            return None
        values = struct.unpack_from('<'+'d'*count, payload, offset+4)
        magnification = dict(zip(keys, values))['Magnification']
        calibration = coordinate_frame(data)[1]
        version, aspect, width_mm = struct.unpack('<I2d', calibration)
        if version == 1 and aspect == 1 and np.isfinite([width_mm, magnification]).all() and width_mm > 0 and magnification > 0:
            return width_mm * 1e6 / magnification
    except (AztecReadError, StopIteration, struct.error, IndexError, KeyError):
        pass
    return None


def region_geometry(data):
    start = data.find(b'@\x06region')
    if start < 0:
        raise AztecReadError('Stored region shape is not decoded.')
    end = data.find(b'@\x04Blob', start)
    section = data[start:end if end >= 0 else len(data)]
    match = re.search(rb'a:(\w+Region)', section[:100])
    name = match[1] if match else b''
    payloads = list(blob_payloads(section, marker=b'^\x04Blob'))
    if name in (b'FullFieldRegion', b'RectangleRegion'):
        payload = next((z for z in payloads if len(z) == 36 and z[:4] == struct.pack('<I', 1)), None)
        if payload:
            x, y, w, h = struct.unpack_from('<4d', payload, 4)
            if np.isfinite([x, y, w, h]).all() and w >= 0 and h >= 0:
                return dict(kind='point' if w == h == 0 else 'rectangle', points=[[x, y], [x+w, y+h]])
    elif name == b'LineRegion':
        payload = next((z for z in payloads if len(z) in (52, 53) and z[:4] == struct.pack('<I', 3)), None)
        if payload:
            coords = np.array(struct.unpack_from('<4d', payload, 4)).reshape(2, 2)
            if np.isfinite(coords).all() and np.linalg.norm(coords[1]-coords[0]) > 0:
                return dict(kind='line', points=coords.tolist())
    raise AztecReadError('Stored region shape is not decoded; no outline has been guessed.')


def site_geometry(reader, site_id, image_path=None):
    records = [r for r in reader._records.values() if r.get('site_id') == site_id]
    images = [r for r in records if r['table'] == 'ElectronImages']
    if not images:
        return dict(images=[], regions=[], note='No stored electron image at this site.')
    image = next((r for r in images if r['path'] == image_path), None) if image_path else images[0]
    if image is None:
        raise AztecReadError('Choose an electron image belonging to this site.')
    data = reader.record_blob(image)
    geometry = image_geometry(data, image)
    areas = {}

    def area(ident):
        if ident not in areas:
            record = reader._records.get('/AreaOfInterests/' + ident)
            if record is None:
                raise AztecReadError('Stored acquisition region is unavailable.')
            areas[ident] = reader.record_blob(record)
        return areas[ident]

    image_area = area(area_id(data))
    frame = coordinate_frame(image_area)
    geometry['field_width_nm'] = field_width_nm(image_area)
    regions, unpositioned, seen = [], [], set()
    candidates = sorted((r for r in records if r['table'] in ('SmartMaps', 'SmartLines', 'EDXSpectra')),
                        key=lambda r: (r['table'] == 'EDXSpectra', r.get('acquisition_label') or r['Label']))
    for record in candidates:
        label = record.get('acquisition_label') if record['table'] in ('SmartMaps', 'SmartLines') else record['Label']
        try:
            ident = area_id(reader.record_blob(record))
            if ident in seen:
                continue  # A sum spectrum shares its acquisition's region.
            seen.add(ident)
            # Live preview spectra belong to the image acquisition, not an extra measurement region.
            if record['table'] == 'EDXSpectra' and record['Label'].casefold() == 'preview spectrum':
                continue
            stored = area(ident)
            if coordinate_frame(stored) != frame:
                raise AztecReadError('Different stored coordinate frame; overlay withheld.')
            shape = region_geometry(stored)
            points = (np.asarray(shape['points']) - geometry['origin']) / geometry['step']
            paths = [record['path']]
            if record.get('acquisition_id') and record['table'] in ('SmartMaps', 'SmartLines'):
                paths = [r['path'] for r in records if r.get('acquisition_id') == record['acquisition_id']]
            regions.append(dict(id=ident, label=label or record['Label'], path=record['path'], paths=paths,
                                kind=shape['kind'], points=points.tolist(),
                                source='Stored region transformed by native image origin and pixel step'))
        except AztecReadError as error:
            unpositioned.append(dict(label=label, reason=str(error)))
    return dict(images=[dict(path=r['path'], label=r['Label']) for r in images],
                image_path=image['path'], geometry=geometry, regions=regions, unpositioned=unpositioned,
                note='Stored acquisition positions. Circle = line start; arrow = line end.')
