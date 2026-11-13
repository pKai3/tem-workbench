"""H5OINA catalogue and bounded numeric reads. Source files are opened read-only.

Reference: https://github.com/oinanoanalysis/h5oina/blob/master/H5OINAFile.md
The initial validated format is 8.0. No automatic rebinning, image flips,
unsigned reinterpretation, phase reassignment or EBSD cleanup is performed.
"""
from contextlib import contextmanager
import logging
import math
from numbers import Integral
from pathlib import Path
import re

import h5py
import numpy as np

from .model import Acquisition, Catalogue, Dataset, Layer, Source

LOG = logging.getLogger('tem_workbench.aztec')
MAX_READ_BYTES = 64 * 1024 * 1024
MAX_OBJECTS = 20_000
ROOT_VALUES = {'Format Version', 'Software Version', 'Manufacturer', 'Index'}


class AztecReadError(ValueError):
    """Unsupported or inconsistent source data; no inferred replacements."""


class SourceChangedError(AztecReadError):
    """The catalogue no longer describes the file on disk."""


def _source(path):
    info = path.stat()
    return Source(str(path), info.st_size, info.st_mtime_ns, info.st_dev, info.st_ino)


def _json(value):
    if isinstance(value, np.ndarray):
        return _json(value.tolist())
    if isinstance(value, np.generic):
        return _json(value.item())
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace')
    if isinstance(value, (tuple, list)):
        return [_json(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)  # Preserve nan/inf explicitly; emit standards-compliant JSON.
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _scalar(value):
    while isinstance(value, list) and len(value) == 1:
        value = value[0]
    return value


def _header_value(header, name):
    item = header.get(name)
    return _scalar(item.value) if item else None


def _grid(header):
    x, y = (_header_value(header, key) for key in ('X Cells', 'Y Cells'))
    if all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in (x, y)):
        return y, x
    return None


def _storage(dataset):
    if dataset.is_virtual:
        return 'virtual'
    if dataset.external:
        return 'external'
    return 'local'


def _descriptor(dataset):
    path = dataset.name
    storage = _storage(dataset)
    value = None
    # Payload arrays, proprietary blobs and large headers are not loaded to browse.
    metadata = 'Header' in path.split('/') or path.strip('/') in ROOT_VALUES
    if metadata and dataset.shape is not None and dataset.size <= 64 and storage == 'local':
        value = _json(dataset[()])
    return Dataset(path, dataset.shape, dataset.dtype.str,
                   {str(k): _json(v) for k, v in dataset.attrs.items()}, storage, value)


def _walk(group, ancestors=frozenset()):
    address = h5py.h5o.get_info(group.id).addr
    if address in ancestors:
        raise AztecReadError('Cyclic HDF5 group links are unsupported.')
    for name in group:
        link = group.get(name, getlink=True)
        path = group.name.rstrip('/') + '/' + name
        if not isinstance(link, h5py.HardLink):
            yield path, None
            continue
        obj = group[name]
        yield path, obj
        if isinstance(obj, h5py.Group):
            yield from _walk(obj, ancestors | {address})


def _local_object(file, path):
    if not isinstance(path, str) or not path.startswith('/'):
        raise AztecReadError('Use an absolute HDF5 dataset path from the catalogue.')
    parts = path[1:].split('/')
    if any(part in ('', '.', '..') for part in parts):
        raise AztecReadError('Invalid HDF5 dataset path.')
    current = file
    for part in parts:
        if not isinstance(current, h5py.Group) or not isinstance(current.get(part, getlink=True), h5py.HardLink):
            raise AztecReadError('Missing dataset or unsupported linked data: ' + path)
        current = current[part]
    return current


def _selection(shape, selection):
    if selection is None:
        selection = ()
    elif not isinstance(selection, tuple):
        selection = (selection,)
    if len(selection) > len(shape):
        raise AztecReadError('Too many selection dimensions.')
    selection += (slice(None),) * (len(shape) - len(selection))
    resolved, count = [], 1
    for length, item in zip(shape, selection):
        if isinstance(item, Integral) and not isinstance(item, (bool, np.bool_)):
            index = int(item)
            if index < 0:
                index += length
            if not 0 <= index < length:
                raise AztecReadError('Dataset index is out of range.')
            resolved.append(index)
        elif isinstance(item, slice):
            if any(v is not None and (not isinstance(v, Integral) or isinstance(v, (bool, np.bool_)))
                   for v in (item.start, item.stop, item.step)) or (item.step is not None and item.step <= 0):
                raise AztecReadError('Use integer slices with a positive step.')
            start, stop, step = item.indices(length)
            count *= len(range(start, stop, step))
            resolved.append(slice(start, stop, step))
        else:
            raise AztecReadError('Use integer indices or slices, not masks or index arrays.')
    return tuple(resolved), count


class H5OinaReader:
    def __init__(self, path):
        self.path = Path(path).expanduser().resolve()
        self.source = _source(self.path)
        self._catalogue = None

    def _unchanged(self):
        try:
            unchanged = _source(self.path) == self.source
        except OSError as error:
            raise SourceChangedError('Source is no longer available; reopen it.') from error
        if not unchanged:
            raise SourceChangedError('Source changed since opening; reopen it before reading.')

    @contextmanager
    def _open(self):
        self._unchanged()
        try:
            with h5py.File(self.path, 'r') as file:
                yield file
        except OSError as error:
            raise AztecReadError(f'Could not read H5OINA source: {error}') from error
        self._unchanged()

    def inspect(self):
        self._unchanged()
        if self._catalogue is not None:
            return self._catalogue
        with self._open() as file:
            descriptors, groups, warnings = {}, set(), []
            for count, (path, obj) in enumerate(_walk(file), 1):
                if count > MAX_OBJECTS:
                    raise AztecReadError('Too many objects in this H5OINA catalogue.')
                if obj is None:
                    warnings.append('Linked object not followed: ' + path)
                elif isinstance(obj, h5py.Group):
                    groups.add(path)
                elif isinstance(obj, h5py.Dataset):
                    descriptors[path] = _descriptor(obj)
            def root_value(name):
                entry = descriptors.get('/' + name)
                return _scalar(entry.value) if entry else None
            version = root_value('Format Version')
            if version != '8.0':
                raise AztecReadError(f'Expected H5OINA format 8.0; found {version!r}.')
            index = descriptors.get('/Index')
            if index is None or index.storage != 'local' or index.shape is None:
                raise AztecReadError('Missing H5OINA acquisition Index.')
            index_dataset = _local_object(file, '/Index')
            if index_dataset.size > MAX_OBJECTS:
                raise AztecReadError('Too many acquisitions in this H5OINA file.')
            indices = np.asarray(index_dataset[()]).reshape(-1)
            acquisitions = []
            for raw_index in indices:
                name = str(_json(raw_index))
                if '/' in name or name in ('', '.', '..') or '/' + name not in groups:
                    raise AztecReadError('Invalid acquisition index: ' + name)
                layers = []
                prefix = '/' + name + '/'
                for path in sorted(groups):
                    if not path.startswith(prefix) or path + '/Data' not in groups or path + '/Header' not in groups:
                        continue
                    relative = path[len(prefix):]
                    kind = relative.split('/')[0]
                    if re.fullmatch(r'EDS\d*', kind):
                        technique, state = 'EDS', 'acquired'
                    elif kind == 'EBSD':
                        technique, state = 'EBSD', 'acquired'
                    elif kind == 'Data Processing':
                        technique = 'EBSD' if relative == kind else 'Analysis'
                        state = 'processed' if relative == kind else 'derived'
                    else:
                        technique, state = kind, 'display' if kind == 'Layered Image' else 'acquired'
                    header_prefix = path + '/Header/'
                    header = {p[len(header_prefix):]: v for p, v in descriptors.items() if p.startswith(header_prefix)}
                    signals = tuple(v for p, v in descriptors.items() if p.startswith(path + '/Data/'))
                    shape, geometry_header = _grid(header), path + '/Header'
                    if shape is None and relative == 'Data Processing':
                        inherited_prefix = prefix + 'EBSD/Header/'
                        inherited = {p[len(inherited_prefix):]: v for p, v in descriptors.items() if p.startswith(inherited_prefix)}
                        shape = _grid(inherited)
                        geometry_header = prefix + 'EBSD/Header' if shape else None
                    if shape is None:
                        geometry_header = None
                    notes = []
                    if technique == 'EDS' and shape:
                        spectrum = next((s for s in signals if s.path == path + '/Data/Spectrum'), None)
                        if spectrum and spectrum.shape and spectrum.shape[0] != math.prod(shape):
                            notes.append('Spectrum rows differ from the exported map/profile grid; raw spectra are not automatically rebinned or aligned.')
                    layers.append(Layer(path, technique, state, header, signals, shape, geometry_header, tuple(notes)))
                # Prefer acquisition headers over associated electron-image headers.
                ordered = sorted(layers, key=lambda v: (v.state != 'acquired', v.technique not in ('EDS', 'EBSD'), v.path))
                def label(key):
                    return next((_header_value(layer.header, key) for layer in ordered
                                 if _header_value(layer.header, key) is not None), None)
                acquisitions.append(Acquisition(name, label('Analysis Unique Identifier'),
                    label('Analysis Label') or name, label('Project Label'), label('Specimen Label'),
                    label('Site Label'), tuple(layers)))
            catalogue = Catalogue(self.source, version, root_value('Software Version'), root_value('Manufacturer'),
                _scalar(index.attributes.get('Type')), tuple(acquisitions), tuple(descriptors.values()), tuple(warnings))
        self._catalogue = catalogue
        LOG.info('AZtec catalogue: %s; %d acquisitions; %d datasets', self.path.name, len(acquisitions), len(descriptors))
        return catalogue

    def read(self, dataset_path, selection=None, *, max_bytes=MAX_READ_BYTES):
        """Read native numeric values. Selection is applied before allocation."""
        catalogue = self.inspect()
        known = {d.path for d in catalogue.datasets}
        if dataset_path not in known:
            raise AztecReadError('Dataset is not in this catalogue: ' + str(dataset_path))
        if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes <= 0:
            raise AztecReadError('max_bytes must be a positive integer.')
        with self._open() as file:
            dataset = _local_object(file, dataset_path)
            if _storage(dataset) != 'local' or dataset.shape is None or dataset.dtype.kind not in 'biuf':
                raise AztecReadError('Only local, fixed-size numeric datasets can be read.')
            selected, count = _selection(dataset.shape, selection)
            if count * dataset.dtype.itemsize > max_bytes:
                raise AztecReadError('Selection exceeds the read limit; select fewer rows or channels.')
            values = np.asarray(dataset[selected])
        values.setflags(write=False)
        return values

    def layer(self, layer_path):
        return next((layer for acquisition in self.inspect().acquisitions for layer in acquisition.layers
                     if layer.path == layer_path), None)

    def iter_rows(self, dataset_path, *, rows=1024, max_bytes=MAX_READ_BYTES):
        """Yield (start_row, values) blocks for processing an entire large dataset."""
        if not isinstance(rows, int) or isinstance(rows, bool) or rows <= 0:
            raise AztecReadError('rows must be a positive integer.')
        if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes <= 0:
            raise AztecReadError('max_bytes must be a positive integer.')
        descriptor = next((d for d in self.inspect().datasets if d.path == dataset_path), None)
        if descriptor is None or not descriptor.shape or np.dtype(descriptor.dtype).kind not in 'biuf':
            raise AztecReadError('Select a numeric dataset with rows.')
        row_bytes = math.prod(descriptor.shape[1:]) * np.dtype(descriptor.dtype).itemsize
        if row_bytes > max_bytes:
            raise AztecReadError('One row exceeds the read limit; use explicit channel slices.')
        block_rows = min(rows, max_bytes // max(row_bytes, 1))
        for start in range(0, descriptor.shape[0], block_rows):
            yield start, self.read(dataset_path, slice(start, start + block_rows), max_bytes=max_bytes)

    def read_grid(self, layer_path, signal, *, max_bytes=MAX_READ_BYTES):
        """Reshape a native map only when its row count matches declared geometry."""
        layer = self.layer(layer_path)
        if layer is None or layer.grid_shape is None:
            raise AztecReadError('This layer has no declared grid geometry.')
        path = layer.path + '/Data/' + signal
        descriptor = next((s for s in layer.signals if s.path == path), None)
        if descriptor is None or not descriptor.shape or descriptor.shape[0] != math.prod(layer.grid_shape):
            raise AztecReadError('Signal rows do not match the layer grid; use explicit dataset slices.')
        values = self.read(path, max_bytes=max_bytes)
        return values.reshape(*layer.grid_shape, *values.shape[1:])

    def energy_axis(self, layer_path):
        """EDS channel energies in eV, keeping the export's zero-channel offset."""
        layer = self.layer(layer_path)
        if layer is None or layer.technique != 'EDS':
            raise AztecReadError('Select an EDS layer with energy calibration.')
        offset, width = (layer.header.get(key) for key in ('Start Channel', 'Channel Width'))
        if offset is None or width is None or offset.unit != 'eV' or width.unit != 'eV':
            raise AztecReadError('Missing supported energy calibration in eV.')
        start, step = _scalar(offset.value), _scalar(width.value)
        spectrum = next((s for s in layer.signals if s.path == layer.path + '/Data/Spectrum'), None)
        if (not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (start, step))
                or step <= 0 or spectrum is None or spectrum.shape is None or len(spectrum.shape) != 2):
            raise AztecReadError('Invalid EDS spectrum calibration or dimensions.')
        channels = spectrum.shape[1]
        if channels * 8 > MAX_READ_BYTES:
            raise AztecReadError('Energy axis exceeds the read limit.')
        declared = _header_value(layer.header, 'Number Channels')
        if declared is not None and declared != channels:
            raise AztecReadError('Channel count disagrees with the spectrum dataset.')
        result = start + step * np.arange(channels, dtype=np.float64)
        result.setflags(write=False)
        return result
