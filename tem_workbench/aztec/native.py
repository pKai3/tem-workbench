"""Native OIPX inventory and narrowly validated stored-image/profile access.

Relational metadata is read without deserializing arbitrary .NET objects.
Unknown record encodings remain visible; they are not treated as decoded arrays.
"""
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
import re
import sqlite3
import struct
import uuid

import numpy as np

from .h5oina import AztecReadError, SourceChangedError, MAX_READ_BYTES, _source

NAMES = {'ElectronImages': 'Electron images', 'EDXSpectra': 'Stored spectra',
         'SmartMaps': 'Raw map data', 'SmartLines': 'Raw line data',
         'XrayMapImages': 'Element maps', 'XrayLinescans': 'Element profiles',
         'QuantLinescans': 'Composition profiles', 'QuantMapData': 'Quantification',
         'LayerMaps': 'Saved composites', 'EdPhaseImages': 'Saved phase images',
         'TEMQuantResults': 'Quantification results'}
STRUCTURE = {'DataNodes', 'Project', 'Samples', 'Analyses', 'MapAcquires'}
MAX_RECORDS = 20_000


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def blob_payloads(data, marker=b'@\x04Blob'):
    """Bounded inline byte-text payloads in the inspected NBFX record variants."""
    position = 0
    while True:
        start = data.find(marker, position)
        if start < 0:
            return
        q = start + 6
        if q < len(data) and data[q] == 8:  # short namespace attribute
            if q + 2 > len(data):
                raise AztecReadError('Truncated native namespace.')
            q += 2 + data[q + 1]
        parts = []
        while q < len(data) and 158 <= data[q] <= 163:
            token = data[q]; width = (1, 2, 4)[(token - 158) // 2]
            if q + 1 + width > len(data):
                raise AztecReadError('Truncated native payload size.')
            count = int.from_bytes(data[q+1:q+1+width], 'little'); q += 1 + width
            if count > MAX_READ_BYTES or q + count > len(data):
                raise AztecReadError('Truncated or oversized native payload.')
            parts.append(data[q:q+count]); q += count
            if token % 2:
                break
        position = max(q, start + 6)
        if parts:
            yield b''.join(parts)


def native_string(data, offset):
    """.NET length-prefixed UTF-8 string, with bounded 7-bit length."""
    length = 0
    for shift in range(0, 35, 7):
        if offset >= len(data):
            break
        byte = data[offset]; offset += 1; length |= (byte & 127) << shift
        if not byte & 128:
            if length > 65536 or offset + length > len(data):
                break
            return data[offset:offset+length].decode('utf-8'), offset + length
    raise AztecReadError('Invalid native string.')


class NativeProjectReader:
    def __init__(self, path):
        self.path = Path(path).expanduser().resolve()
        self.source = _source(self.path)
        self._catalogue = None
        self._records = {}
        self._attachments = {}
        with self.path.open('rb') as stream:
            if stream.read(16) != b'SQLite format 3\0':
                raise AztecReadError('This legacy OIP container is not decoded yet. The newer native OIPX project can be opened directly; no H5OINA export is needed.')

    def unchanged(self):
        for suffix in ('-wal', '-journal'):
            journal = Path(str(self.path) + suffix)
            if journal.exists() and journal.stat().st_size:
                raise SourceChangedError('This project has pending database changes. Close it in AZtec before opening it here.')
        try:
            if _source(self.path) == self.source:
                return
        except OSError:
            pass
        raise SourceChangedError('Native project changed or became unavailable; reopen it.')

    @contextmanager
    def connection(self):
        self.unchanged()
        con = sqlite3.connect(self.path.as_uri() + '?mode=ro', uri=True)
        con.row_factory = sqlite3.Row
        try:
            con.execute('PRAGMA query_only=ON')
            con.execute('PRAGMA trusted_schema=OFF')
            con.execute('BEGIN')
            yield con
        finally:
            con.close()
        self.unchanged()

    def inspect(self):
        self.unchanged()
        if self._catalogue is not None:
            return self._catalogue
        tables, records, nodes, entities = {}, {}, {}, {}
        with self.connection() as con:
            names = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            if not {'Project', 'DataNodes', 'Samples', 'Analyses'} <= set(names):
                raise AztecReadError('This database does not have the supported AZtec project structure.')
            total = 0
            for table in names:
                schema = list(con.execute('PRAGMA table_info(' + quoted(table) + ')'))
                columns = [r['name'] for r in schema if r['name'] != 'ObjectBlob']
                primary = next((r['name'] for r in schema if r['pk']), columns[0])
                count = con.execute('SELECT count(*) FROM ' + quoted(table)).fetchone()[0]
                total += count
                if total > MAX_RECORDS:
                    raise AztecReadError('Project inventory exceeds the current browser record limit.')
                if not count:
                    continue
                tables[table] = count
                sql = 'SELECT ' + ','.join(map(quoted, columns))
                if any(r['name'] == 'ObjectBlob' for r in schema):
                    sql += ', length(ObjectBlob) AS blob_bytes'
                for raw in con.execute(sql + ' FROM ' + quoted(table)):
                    row = dict(raw); ident = str(row[primary]).lower()
                    if table == 'DataNodes':
                        nodes[ident] = row
                        continue
                    key = '/' + table + '/' + ident
                    row.update(table=table, id=ident, primary=primary, path=key)
                    records[key] = row; entities.setdefault(ident, row)
        by_entity = {}
        for ident, node in nodes.items():
            by_entity.setdefault(node['AssociatedId'].lower(), []).append(ident)

        def ancestry(ident):
            chain = []; matches = by_entity.get(ident, [])
            if len(matches) != 1:
                return chain
            key = matches[0]; seen = set()
            while key in nodes and key not in seen:
                seen.add(key); node = nodes[key]
                record = entities.get(node['AssociatedId'].lower())
                if record:
                    chain.append(record)
                key = node['ParentId'].lower()
            return chain

        project = next(r for r in records.values() if r['table'] == 'Project')
        groups = {r['id']: (r, []) for r in records.values() if r['table'] == 'Analyses'}
        groups['unassigned'] = ({'Label': 'Project records', 'id': 'unassigned'}, [])
        descriptors = []
        for record in records.values():
            record['chain'] = ancestry(record['id'])
            if record['table'] in STRUCTURE:
                continue
            site = next((r for r in record['chain'] if r['table'] == 'Analyses'), None)
            acquisition = next((r for r in record['chain'] if r['table'] == 'MapAcquires'), None)
            attrs = {k: v for k, v in record.items() if k not in ('chain', 'path', 'primary', 'table', 'id')}
            attrs['Record type'] = NAMES.get(record['table'], record['table'])
            if acquisition:
                attrs['Acquisition'] = acquisition['Label']
                attrs['Acquisition ID'] = acquisition['id']
            attachment = self.path.parent / 'data' / (record['id'] + '.dat')
            if attachment.is_file():
                # Only an exact UUID-named companion in the project data folder.
                uuid.UUID(record['id'])
                if attachment.is_symlink() or attachment.parent.is_symlink():
                    attrs['Data file'] = 'Linked data file not opened automatically'
                else:
                    self._attachments[record['path']] = _source(attachment)
                    attrs['Data file'] = str(attachment)
                    attrs['Data bytes'] = attachment.stat().st_size
            descriptor = dict(path=record['path'], shape=None, dtype='native record', storage='native project', attributes=attrs, value=None)
            descriptors.append(descriptor)
            record['site_id'] = site['id'] if site else 'unassigned'
            record['acquisition_id'] = acquisition['id'] if acquisition else None
            record['acquisition_label'] = acquisition['Label'] if acquisition else None
            groups[site['id'] if site else 'unassigned'][1].append((record, descriptor))
        acquisitions = []
        for ident, (site, items) in groups.items():
            if not items:
                continue
            chain = ancestry(ident); specimen = next((r['Label'] for r in chain if r['table'] == 'Samples'), None)
            layers = {}
            for record, descriptor in items:
                parent = descriptor['attributes'].get('Acquisition', '')
                category = NAMES.get(record['table'], 'Other stored records')
                name = (parent + ' / ' if parent else '') + category
                layer = layers.setdefault(name, dict(path=name, technique=name, state='stored', header={}, signals=[], grid_shape=None, geometry_header=None, notes=[]))
                layer['signals'].append(descriptor)
            priority = ['Electron images', 'Raw map data', 'Element maps', 'Raw line data', 'Element profiles',
                        'Composition profiles', 'Stored spectra', 'Saved composites', 'Saved phase images',
                        'Quantification', 'Quantification results', 'Other stored records']
            ordered = sorted(layers.values(), key=lambda l: (priority.index(l['technique'].split(' / ')[-1]), l['technique']))
            acquisitions.append(dict(index=ident, identifier=ident, label=site['Label'], project=project['Label'], specimen=specimen, site=site['Label'], layers=ordered))
        # Lists avoid recursive record chains in the public catalogue.
        for record in records.values():
            record.pop('chain', None)
        self._records = records
        self._catalogue = dict(source={**asdict(self.source), 'reader': 'native-oipx-1'},
            format_version=project.get('Version'), software_version=None, manufacturer='Oxford Instruments',
            file_type='OIPX', schema_version=1, acquisitions=acquisitions, datasets=descriptors,
            inventory=tables, warnings=[], native_tree=list(nodes.values()),
            notes=['Raw map/line spectral storage is listed. Region spectrum extraction is not decoded yet.'])
        return self._catalogue

    def site(self, site_id, image_path=None):
        """Lazy spatial context, using the same native arrays as item previews."""
        from .geometry import site_geometry
        self.inspect()
        if not any(a['index'] == site_id for a in self._catalogue['acquisitions']):
            raise AztecReadError('Choose a site in this project.')
        return site_geometry(self, site_id, image_path)

    def record_blob(self, record):
        with self.connection() as con:
            if record.get('blob_bytes', 0) > MAX_READ_BYTES:
                raise AztecReadError('Native record exceeds the preview read size.')
            row = con.execute('SELECT ObjectBlob FROM ' + quoted(record['table']) + ' WHERE ' + quoted(record['primary']) + '=?', (record['id'],)).fetchone()
            if not row or row[0] is None:
                raise AztecReadError('No native payload is available for this item.')
            return row[0]

    def preview(self, path):
        self.inspect()
        record = self._records.get(path)
        if record is None:
            raise AztecReadError('Choose an item in this project.')
        base = {'path': path, 'kind': 'metadata', 'note': 'Stored record identified. Numerical preview is not decoded for this record type yet.'}
        table = record['table']
        if table not in ('XrayLinescans', 'QuantLinescans', 'ElectronImages', 'XrayMapImages', 'EDXSpectra'):
            return base
        data = self.record_blob(record)
        for payload in blob_payloads(data):
            if table == 'EDXSpectra':
                # The spectrum's own blob is distinguished from embedded detector,
                # strobe and peak-label blobs by its UUID and saved label.
                if len(payload) < 30 or str(uuid.UUID(bytes_le=payload[4:20])) != record['id']:
                    continue
                version = struct.unpack_from('<I', payload)[0]
                if version not in (2, 3) or payload[24] != 0:
                    continue
                label, offset = native_string(payload, 25)
                if label != record['Label'] or offset + 4 > len(payload):
                    continue
                count = struct.unpack_from('<I', payload, offset)[0]
                end = offset + 4 + count * 4
                if not 1 <= count <= 16384 or len(payload) - end != {2: 20, 3: 129}[version]:
                    raise AztecReadError('Unsupported or truncated native point spectrum.')
                values = np.frombuffer(payload, '<i4', count, offset + 4).copy()
                channel_ev, offset_ev = struct.unpack_from('<dd', payload, end)
                if np.any(values < 0) or not np.isfinite([channel_ev, offset_ev]).all() or channel_ev <= 0:
                    raise AztecReadError('Invalid native spectrum counts or channel calibration.')
                return {**base, 'kind': 'plot', 'x': ((offset_ev + np.arange(count) * channel_ev) / 1000).tolist(),
                        'y': values, 'shape': [count], 'dtype': '<i4', 'unit': 'counts',
                        'x_label': 'Energy, keV', 'y_label': 'Counts', 'total_counts': int(values.sum()),
                        'channel_width_ev': channel_ev, 'energy_offset_ev': offset_ev,
                        'note': 'Stored counts and channel energy calibration. No smoothing, background subtraction or elemental identification.'}
            if table in ('XrayLinescans', 'QuantLinescans'):
                if len(payload) < 30 or str(uuid.UUID(bytes_le=payload[4:20])) != record['id']:
                    continue
                if payload[24] != 0:
                    continue
                label, offset = native_string(payload, 25)
                if label != record['Label'] or offset + 4 > len(payload):
                    continue
                count = struct.unpack_from('<I', payload, offset)[0]
                if not count or offset + 4 + count*4 > len(payload):
                    raise AztecReadError('Unsupported or truncated native profile.')
                step = max(1, (count + 16383) // 16384)
                values = np.frombuffer(payload, '<f4', count, offset + 4)[::step].copy()
                unit = 'wt%' if table == 'QuantLinescans' and 'Wt%' in label else 'cps' if table == 'XrayLinescans' else 'Stored value'
                return {**base, 'kind': 'plot', 'x': list(range(1, count+1, step)), 'y': values, 'shape': [count], 'dtype': '<f4', 'unit': unit,
                        'x_label': 'Stored sample', 'y_label': unit,
                        'note': 'Stored native profile; no smoothing or distance calibration applied.' + (f' Preview samples every {step} rows.' if step > 1 else '')}
            if len(payload) < 60 or payload[:5] != b'\x06\0\0\0\0':
                continue
            label, offset = native_string(payload, 5)
            if label != record['Label'] or offset+52 > len(payload):
                continue
            kind, width, height = struct.unpack_from('<III', payload, offset)
            ident = str(uuid.UUID(bytes_le=payload[offset+36:offset+52]))
            if ident != record['id'] or kind != (2 if table == 'ElectronImages' else 4):
                continue
            source = self._attachments.get(path)
            if source is None:
                raise AztecReadError('The original companion data file is missing or linked. Keep the project with its data folder.')
            target = Path(source.path)
            if _source(target) != source:
                raise SourceChangedError('Companion data changed; reopen the project.')
            dtype = '<u2' if kind == 2 else '<f4'
            count = width*height; itemsize = np.dtype(dtype).itemsize
            sizes = {count*itemsize}
            if width % 2 == height % 2 == 0:
                sizes.add(count*itemsize + (width//2)*(height//2)*itemsize)
            if not width or not height or count*itemsize > MAX_READ_BYTES or source.size not in sizes:
                raise AztecReadError('Native image dimensions/storage differ from the verified layouts; preview withheld.')
            with target.open('rb') as stream:
                values = np.frombuffer(stream.read(count*itemsize), dtype).reshape(height, width).copy()
            if _source(target) != source:
                raise SourceChangedError('Companion data changed during reading; reopen the project.')
            return {**base, 'kind': 'image', 'array': values, 'shape': [height, width], 'dtype': dtype, 'unit': 'cps' if kind == 4 else 'Stored intensity',
                    'note': 'Native full-resolution array; linear greyscale preview. No smoothing, rebinning or alignment.'}
        if table == 'EDXSpectra':
            return base
        raise AztecReadError('Native record differs from the validated image/profile encoding; preview withheld.')
