"""Read-only file browsing and explicitly requested, bounded data previews."""
from collections import OrderedDict
from io import BytesIO
from pathlib import Path
import base64
import math
import logging
import threading
import uuid

import numpy as np
from PIL import Image

from tem_workbench.storage import folder_paths
from tem_workbench.runtime.diagnostics import compact
from .h5oina import H5OinaReader, AztecReadError, MAX_READ_BYTES
from .native import NativeProjectReader

LOG = logging.getLogger('tem_workbench.aztec')


class AztecBrowser:
    def __init__(self):
        self._readers = OrderedDict()
        self._lock = threading.RLock()

    def browse(self, path, root):
        listing = folder_paths.browse(path, root)
        files = []
        for child in Path(listing['path']).iterdir():
            if child.suffix.lower() not in ('.h5oina', '.oip', '.oipx'):
                continue
            try:
                if child.is_file():
                    files.append(dict(name=child.name, path=str(child.resolve()),
                                      size=child.stat().st_size,
                                      supported=child.suffix.lower() in ('.oipx', '.h5oina'),
                                      kind=child.suffix[1:].upper()))
            except OSError:
                continue
        LOG.info('AZtec folder: %s · %s files · %s subfolders', compact(listing['path']), len(files), len(listing['directories']))
        return {**listing, 'files': sorted(files, key=lambda f: (f['kind'] == 'H5OINA', f['name'].casefold()))}

    def open(self, path):
        path = Path(path).expanduser().resolve()
        LOG.info('AZtec opening read-only: %s', compact(str(path)))
        if path.suffix.lower() in ('.oip', '.oipx'):
            reader = NativeProjectReader(path)
            catalogue = reader.inspect()
        elif path.suffix.lower() == '.h5oina':
            reader = H5OinaReader(path)
            catalogue = {**reader.inspect().to_dict(), 'file_type': 'H5OINA'}
        else:
            raise AztecReadError('Choose an AZtec project or H5OINA file.')
        key = uuid.uuid4().hex
        with self._lock:
            self._readers[key] = reader
            while len(self._readers) > 4:
                self._readers.popitem(last=False)
        LOG.info('AZtec opened %s: %s sites/acquisitions · %s datasets', compact(str(path)), len(catalogue['acquisitions']), len(catalogue['datasets']))
        return {'id': key, 'catalogue': catalogue, 'folder': str(path.parent)}

    def preview(self, key, path, row=0, unsigned=False):
        with self._lock:
            reader = self._readers.get(key)
            if reader is None:
                raise AztecReadError('Reopen the file to inspect its contents.')
            self._readers.move_to_end(key)
        LOG.info('AZtec preview: %s · %s · row=%s · unsigned=%s', compact(str(reader.path)), compact(path), row, unsigned)
        if isinstance(reader, NativeProjectReader):
            result = reader.preview(path)
            if result['kind'] == 'image':
                values = result.pop('array')
                finite = values[np.isfinite(values)]
                low, high = (float(finite.min()), float(finite.max())) if finite.size else (None, None)
                scaled = np.zeros(values.shape)
                if finite.size and high > low:
                    scaled = np.nan_to_num((values.astype(float)-low)/(high-low), nan=0., posinf=1., neginf=0.)
                image = Image.fromarray(np.uint8(np.clip(scaled, 0, 1)*255))
                image.thumbnail((640, 640), Image.Resampling.NEAREST)
                output = BytesIO(); image.save(output, format='PNG')
                result.update(image='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode(),
                              grid=values.shape, minimum=low, maximum=high, sample=numeric(values[:2, :8]))
            elif result['kind'] == 'plot':
                result['y'] = numeric(result['y'])
            return result
        catalogue = reader.inspect()
        descriptor = next((d for d in catalogue.datasets if d.path == path), None)
        if descriptor is None:
            raise AztecReadError('Choose a dataset from this file.')
        layer = next((l for a in catalogue.acquisitions for l in a.layers
                      if any(d.path == path for d in l.signals)), None)
        result = {'path': path, 'shape': descriptor.shape, 'dtype': descriptor.dtype,
                  'unit': descriptor.unit, 'attributes': descriptor.attributes,
                  'kind': 'metadata', 'note': ''}
        shape = descriptor.shape
        if descriptor.value is not None:
            return {**result, 'value': descriptor.value}
        if descriptor.storage != 'local' or shape is None or np.dtype(descriptor.dtype).kind not in 'biuf':
            return {**result, 'note': 'Metadata only: no supported local numeric preview.'}
        if not math.prod(shape):
            return {**result, 'note': 'Empty dataset.'}
        if unsigned and not (layer and layer.technique == 'Electron Image' and np.dtype(descriptor.dtype).kind == 'i' and np.dtype(descriptor.dtype).itemsize == 2):
            raise AztecReadError('Unsigned display is only available for stored 16-bit electron images.')
        # Spectrum selection is in the native row grid, never in the binned map grid.
        if layer and layer.technique.startswith('EDS') and path == layer.path + '/Data/Spectrum' and len(shape) == 2:
            if shape[1] > 16384:
                return {**result, 'note': 'Spectrum exceeds the interactive channel-preview limit. Metadata remains available.'}
            if isinstance(row, bool) or not isinstance(row, int) or not 0 <= row < shape[0]:
                raise AztecReadError('Choose a spectrum row inside this dataset.')
            values = reader.read(path, (row, slice(None)))
            try:
                x, x_label = reader.energy_axis(layer.path), 'Energy, eV'
            except AztecReadError:
                x, x_label = np.arange(values.size), 'Channel'
            return {**result, 'kind': 'plot', 'x': numeric(x), 'y': numeric(values),
                    'x_label': x_label, 'y_label': descriptor.unit or 'Stored value',
                    'row': row, 'rows': shape[0],
                    'note': f'One stored spectrum: row {row + 1:,} of {shape[0]:,}. No spatial alignment or summation.'}
        grid = layer.grid_shape if layer else None
        channels = math.prod(shape[1:]) if len(shape) > 1 else 1
        is_grid = grid and shape[0] == math.prod(grid) and channels in (1, 3, 4)
        is_rgb = is_grid and channels in (3, 4) and layer.technique == 'Layered Image' and descriptor.dtype == '|u1'
        if is_grid and (channels == 1 or is_rgb) and grid[0] > 1 and grid[1] > 1:
            if math.prod(shape) * np.dtype(descriptor.dtype).itemsize > MAX_READ_BYTES:
                return {**result, 'note': 'Image preview exceeds the bounded read size. Metadata remains available.'}
            raw = reader.read(path)
            values = raw.reshape((*grid, channels) if is_rgb else grid)
            if unsigned:
                values = values.view(np.dtype(values.dtype.str.replace('i', 'u')))
            finite = values[np.isfinite(values)]
            low, high = (float(finite.min()), float(finite.max())) if finite.size else (None, None)
            if is_rgb:
                display = values
                note = 'Stored RGB composite. Colours belong to the exported image, not a newly calculated map.'
            else:
                scaled = np.zeros(values.shape, dtype=np.float64)
                if finite.size and high > low:
                    scaled = np.nan_to_num((values.astype(float) - low) / (high - low), nan=0., posinf=1., neginf=0.)
                display = np.uint8(np.clip(scaled, 0, 1) * 255)
                note = 'Linear greyscale from minimum to maximum; native row order. Display only.'
                if unsigned:
                    note += ' Signed 16-bit values explicitly viewed as unsigned for display.'
            image = Image.fromarray(display)
            image.thumbnail((640, 640), Image.Resampling.NEAREST)
            output = BytesIO(); image.save(output, format='PNG')
            return {**result, 'kind': 'image', 'image': 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode(),
                    'grid': grid, 'minimum': low, 'maximum': high, 'note': note,
                    'sample': numeric(raw[:min(8, shape[0])]),
                    'unsigned_available': layer.technique == 'Electron Image' and raw.dtype.kind == 'i' and raw.dtype.itemsize == 2}
        if len(shape) == 1:
            step = max(1, math.ceil(shape[0] / 4096))
            values = reader.read(path, slice(None, None, step))
            return {**result, 'kind': 'plot', 'x': list(range(1, shape[0] + 1, step)), 'y': numeric(values),
                    'x_label': 'Stored sample', 'y_label': descriptor.unit or 'Stored value',
                    'note': 'Stored values in acquisition order.' if step == 1 else f'Preview samples every {step} rows; source data are unchanged.'}
        if len(shape) <= 2:
            selection = tuple(slice(0, min(n, 8)) for n in shape)
            return {**result, 'kind': 'values', 'sample': numeric(reader.read(path, selection)),
                    'note': 'First eight entries along each dimension, in native storage order.'}
        return {**result, 'note': 'Metadata only: this array has no image/profile preview yet.'}

    def site(self, key, site_id, image_path=None):
        with self._lock:
            reader = self._readers.get(key)
            if reader is None:
                raise AztecReadError('Reopen the file to inspect its contents.')
        if not isinstance(reader, NativeProjectReader):
            return dict(images=[], regions=[], note='Site overlays are currently available for native OIPX projects.')
        result = reader.site(site_id, image_path)
        catalogue = reader.inspect()
        label = next(a['label'] for a in catalogue['acquisitions'] if a['index'] == site_id)
        LOG.info('AZtec site: %s · %s · %s regions · %s unplaced', compact(str(reader.path)), compact(label), len(result.get('regions', [])), len(result.get('unpositioned', [])))
        if result.get('image_path'):
            result['preview'] = self.preview(key, result['image_path'])
        return result

    def process(self, key, options):
        from .views import acquisition_views
        from time import monotonic
        with self._lock:
            reader=self._readers.get(key)
        if not isinstance(reader,NativeProjectReader):
            raise AztecReadError('Open a native OIPX project for acquisition views.')
        started=monotonic()
        structure_only=bool(options.get('structure_only',False))
        if structure_only:
            LOG.info('AZtec map spatial check started: %s · %s acquisitions · 256 paired shuffles · ten smoothing widths', compact(str(reader.path)), len(options.get('acquisitions',[])))
        export_arrays=None
        if options.get('export_data'):
            from .export import DataArchive
            if structure_only:
                raise AztecReadError('Export acquisition data separately from the spatial check.')
            export_arrays=DataArchive(reader.path,options)
        result = acquisition_views(reader,options,structure_only=structure_only,export_arrays=export_arrays)
        if structure_only:
            for row in result['rows']:
                for tile in row['tiles']:
                    check=tile['noise_check']
                    LOG.info('AZtec map spatial structure: %s · %s · %s', compact(row['label']), compact(tile['label']),
                             f"{check['structure_ratio']:.3f}× shuffled median" if check['available'] else compact(check['reason']))
            LOG.info('AZtec map spatial check complete: %.2f s',monotonic()-started)
        if result.get('comparison'):
            LOG.info('AZtec comparison: %s acquisitions · %s · shared scales=%s · normalize each=%s · smoothing unit=%s',
                     len(result['rows']), options.get('channel_table'), result['scale_scope'], result['normalisation'],
                     result.get('smoothing_unit') if options.get('channel_table')=='XrayMapImages' else 'nm FWHM')
        for row in result['rows']:
            LOG.info('AZtec processed: %s · %s · %s channels · view=%s · denominator=%s · normalize=%s · smoothing=%s',
                     compact(str(reader.path)), compact(row['label']), len(row['tiles']), result['mode'], compact(options.get('denominator')), result['normalisation'], result['smoothing'])
            if row.get('error'):
                LOG.warning('AZtec acquisition unavailable: %s · %s',compact(row['label']),compact(row['error']))
            for tile in row['tiles']:
                for field in ('error', 'ratio_error'):
                    if tile.get(field):
                        LOG.warning('AZtec channel unavailable: %s · %s · %s', compact(row['label']), compact(tile['label']), compact(tile[field]))
        if export_arrays is not None:
            result=export_arrays.finish(result)
            LOG.info('AZtec data exported: %s · %s · %.2f s',compact(str(reader.path)),result['filename'],monotonic()-started)
        return result


def numeric(values):
    """JSON-safe sampled values, retaining integers and marking missing data."""
    array = np.asarray(values)
    if array.dtype.kind == 'f':
        return np.where(np.isfinite(array), array, None).tolist()
    return array.tolist()
