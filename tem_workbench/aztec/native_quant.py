"""Bounded access to the verified version-2 native QuantMapData layout.

Only composition fields 0 (wt%) and 1 (at%) have verified meanings. Other
planes remain identified by their stored field numbers, without guessed units.
See docs/aztec-quantification.md for the evidence and remaining limitations.
"""
from pathlib import Path
import struct
import uuid

import numpy as np

from .h5oina import AztecReadError, SourceChangedError, MAX_READ_BYTES, _source

MEASURES = {'weight': (0, 'Weight percent', 'wt%'), 'atomic': (1, 'Atomic percent', 'at%')}


def layout(data, record):
    from .native import blob_payloads, native_string

    if not data.startswith(b'@\x0cQuantMapData'):
        return None
    payload = next(blob_payloads(data), b'')
    if len(payload) < 4 or struct.unpack_from('<I', payload)[0] != 2:
        return None

    def fail():
        raise AztecReadError('Invalid or unsupported native quantification map header.')

    if len(payload) < 26 or str(uuid.UUID(bytes_le=payload[4:20])) != record['id']:
        fail()
    if payload[20:25] != b'\x01\0\0\0\0':
        fail()
    try:
        label, offset = native_string(payload, 25)
    except UnicodeDecodeError as error:
        raise AztecReadError('Invalid native quantification label.') from error
    if label != record.get('Label'):
        fail()

    def integers(count):
        nonlocal offset
        if count < 0 or offset + 4 * count > len(payload):
            fail()
        values = struct.unpack_from('<' + 'I' * count, payload, offset)
        offset += 4 * count
        return values

    # Version/type/count followed by the saved quantification setup identity.
    if integers(3) != (1, 43, 1) or offset + 16 > len(payload):
        fail()
    setup_id = str(uuid.UUID(bytes_le=payload[offset:offset + 16]))
    offset += 16

    def vector(limit):
        count, = integers(1)
        if not 1 <= count <= limit:
            fail()
        return integers(count)

    elements = vector(118)
    lines = vector(118)
    fields = vector(32)
    width, height, binning = integers(3)
    if (len(set(elements)) != len(elements) or any(not 1 <= z <= 118 for z in elements)
            or len(lines) != len(elements) or any(line not in (1, 2, 3) for line in lines)
            or len(set(fields)) != len(fields) or not width or not height or not binning
            or width * height * len(fields) * 4 > MAX_READ_BYTES
            or width * height * len(elements) * 4 > MAX_READ_BYTES
            or len(payload) != offset + 16
            or str(uuid.UUID(bytes_le=payload[offset:])) != record['id']):
        fail()
    if not any(field in fields for field, _, _ in MEASURES.values()):
        return None
    return dict(elements=elements, lines=lines, fields=fields, width=width,
                height=height, binning=binning, setup_id=setup_id)


def inspect_map(reader, record, attributes):
    """Snapshot only exact UUID/atomic-number companions, without reading pixels."""
    try:
        result = layout(reader.record_blob(record), record)
    except SourceChangedError:
        raise
    except AztecReadError as error:
        attributes['Decoding error'] = str(error)
        return {'error': str(error)}
    if result is None:
        return None
    sources, errors = {}, {}
    for z in result['elements']:
        path = reader.path.parent / 'data' / f"{record['id']}_{z}.dat"
        if path.is_symlink() or path.parent.is_symlink():
            errors[z] = 'Linked quantification data files are not opened automatically.'
        elif not path.is_file():
            errors[z] = 'The native quantification data file is missing.'
        else:
            sources[z] = _source(path)
    result.update(sources=sources, errors=errors)
    attributes.update({'Preview available': True,
                       'Map dimensions': [result['height'], result['width']],
                       'Atomic numbers': list(result['elements']),
                       'Stored field IDs': list(result['fields']),
                       'Decoded units': [unit for field, _, unit in MEASURES.values() if field in result['fields']],
                       'Spatial binning': result['binning'],
                       'Quantification setup ID': result['setup_id'],
                       'Data files': [source.path for source in sources.values()]})
    return result


def preview_map(reader, record, saved, measure=None, *, element=None):
    if saved.get('error'):
        raise AztecReadError(saved['error'])
    available = [key for key, (field, _, _) in MEASURES.items() if field in saved['fields']]
    measure = available[0] if measure is None else measure
    if measure not in available:
        raise AztecReadError('Choose a stored weight-percent or atomic-percent result.')
    field, label, unit = MEASURES[measure]
    shape = (saved['height'], saved['width'])
    plane_bytes = shape[0] * shape[1] * 4
    channels = []
    import xraylib
    for z, line in zip(saved['elements'], saved['lines']):
        if element is not None and z != element:
            continue
        # xraylib's element table ends at 107; retain the atomic number beyond it.
        symbol = xraylib.AtomicNumberToSymbol(z) if z <= 107 else f'Z={z}'
        channel = dict(element=symbol, atomic_number=z, xray_line={1: 'K', 2: 'L', 3: 'M'}[line] + ' series')
        channels.append(channel)
        if z in saved['errors']:
            channel['error'] = saved['errors'][z]
            continue
        source = saved['sources'][z]
        path = Path(source.path)
        try:
            if path.is_symlink() or path.parent.is_symlink() or _source(path) != source:
                raise SourceChangedError('Quantification data changed; reopen the project.')
            if source.size != plane_bytes * len(saved['fields']):
                raise AztecReadError('Quantification data size does not match its saved dimensions and fields.')
            with path.open('rb') as stream:
                stream.seek(saved['fields'].index(field) * plane_bytes)
                data = stream.read(plane_bytes)
            if _source(path) != source or len(data) != plane_bytes:
                raise SourceChangedError('Quantification data changed during reading; reopen the project.')
            channel['array'] = np.frombuffer(data, '<f4').reshape(shape)
        except SourceChangedError:
            raise
        except (OSError, AztecReadError) as error:
            channel['error'] = str(error)
    reader.unchanged()
    return dict(path=record['path'], kind='quantification', shape=list(shape), dtype='<f4',
                unit=unit, measure=measure, label=label, channels=channels,
                measures=[dict(value=key, label=MEASURES[key][1]) for key in available],
                undecoded_fields=[field for field in saved['fields'] if field not in (0, 1)],
                note='Stored quantified composition. No smoothing or recalculation applied.')


def map_channels(record, saved):
    """Expose stored planes as separate comparison families, never as intensity."""
    if not saved or saved.get('error') or saved['height'] <= 1 or not record.get('acquisition_id'):
        return
    import xraylib
    for measure, table in (('weight', 'QuantMapImages'), ('atomic', 'AtomicMapImages')):
        field, _, unit = MEASURES[measure]
        if field not in saved['fields']:
            continue
        for z in saved['elements']:
            symbol = xraylib.AtomicNumberToSymbol(z) if z <= 107 else f'Z={z}'
            path = f"/{table}/{record['id']}/{z}"
            channel = dict(table=table, id=str(uuid.uuid5(uuid.UUID(record['id']), f'{measure}/{z}')),
                           path=path, Label=f'{symbol} {unit}', source_path=record['path'],
                           decoded='quant', measure=measure, element=z,
                           acquisition_id=record['acquisition_id'],
                           acquisition_label=record['acquisition_label'], site_id=record['site_id'])
            attributes = {'Label': channel['Label'], 'Record type': 'Decoded composition map',
                          'Preview available': True, 'Unit': unit, 'Atomic number': z,
                          'Source record': record['path'], 'Stored field ID': field,
                          'Acquisition': record['acquisition_label'], 'Acquisition ID': record['acquisition_id']}
            descriptor = dict(path=path, shape=[saved['height'], saved['width']], dtype='<f4',
                              storage='decoded from native OIPX data', attributes=attributes, value=None)
            yield channel, descriptor
