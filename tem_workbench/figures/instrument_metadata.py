"""Recorded microscope fields, decoded through TIFF tags and standard INI parsing.

Hitachi's [SemImageFile] convention and PixelSize in nm are also supported by
OME Bio-Formats' HitachiReader. No OCR or filename-derived acquisition values.
https://github.com/ome/bioformats/blob/develop/components/formats-gpl/src/loci/formats/in/HitachiReader.java
"""
from configparser import ConfigParser, Error as ConfigError
from datetime import datetime
import math
from pathlib import Path
import re


def _fields(text):
    parser = ConfigParser(interpolation=None, strict=False)
    try:
        parser.read_string(str(text or '').replace('\r\n', '\n').replace('\r', '\n'))
    except ConfigError:
        return {}
    section = next((name for name in parser.sections() if name.casefold() == 'semimagefile'), None)
    return {re.sub(r'[\s_]', '', key).casefold(): value.strip()
            for key, value in parser[section].items()} if section else {}


def _positive(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (ValueError, TypeError):
        return None


def read(description, sidecar_text, source, width, height):
    """Prefer embedded records; require matching dimensions before using geometry."""
    result = {'metadata': {}}
    for text, origin in ((description, 'TIFF ImageDescription'), (sidecar_text, 'TXT')):
        fields = _fields(text)
        if not fields:
            continue
        if origin == 'TXT':
            recorded_name = fields.get('filename') or fields.get('imagename')
            if recorded_name and recorded_name.replace('\\', '/').rsplit('/', 1)[-1].casefold() != Path(source).name.casefold():
                continue
        provenance = origin + ' [SemImageFile]'
        size = re.fullmatch(r'(\d+)\s*[x×]\s*(\d+)', fields.get('datasize', ''), re.I)
        valid_size = bool(size and int(size[1]) == width and 0 < int(size[2]) <= height)
        if origin == 'TXT' and valid_size and result.get('content_height', int(size[2])) != int(size[2]):
            continue
        if valid_size:
            result.setdefault('content_height', int(size[2]))
            result.setdefault('content_height_source', provenance + ' Data size')
            pixel_size = _positive(fields.get('pixelsize'))
            x_factor = _positive(fields.get('calibrationfactorx', '1'))
            y_factor = _positive(fields.get('calibrationfactory', '1'))
            if pixel_size and x_factor and y_factor and math.isclose(x_factor, y_factor):
                result.setdefault('pixel_size_nm', pixel_size)
                result.setdefault('pixel_size_source', provenance + ' PixelSize (nm/px)')
        elif origin == 'TXT':
            continue
        magnification = _positive(fields.get('magnification'))
        voltage = fields.get('acceleratingvoltage', '')
        voltage_match = re.fullmatch(r'([\d.eE+-]+)\s*(kV|V)?', voltage, re.I)
        voltage_kv = _positive(voltage_match[1]) if voltage_match else None
        if voltage_kv and (voltage_match[2] or 'V').lower() == 'v':
            voltage_kv /= 1000
        for key, value, unit in [('magnification', magnification, '×'), ('voltage_kv', voltage_kv, 'kV')]:
            if value:
                result['metadata'].setdefault(key, {'value': value, 'unit': unit, 'source': provenance})
        try:
            acquired = datetime.strptime(fields.get('date', ''), '%Y/%m/%d').date().isoformat()
        except ValueError:
            continue
        result['metadata'].setdefault('acquisition_date', {'value': acquired, 'source': provenance})
    return result
