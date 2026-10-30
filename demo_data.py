"""Catalog optional original-DM4 examples and retain compatibility with legacy demos."""
from pathlib import Path
import hashlib
import json
import numpy as np

ID = 'demo/st1221'
NAME = 'ST1221 · demo'
DIRECTORY = Path(__file__).resolve().parent / 'demo'
DIFFRACTION_ID = 'demo/st1144'
DEMOS = {}


def refresh():
    """Only advertise installed images; keep stable IDs for saved regions."""
    demos = {}
    manifests = list(DIRECTORY.glob('*.json')) + sorted(DIRECTORY.glob('packs/*/*.json'), key=lambda p: p.parent.stat().st_mtime_ns)
    for path in manifests:
        if path.name == 'pack.json':
            continue
        try:
            manifest = json.loads(path.read_text())
            if manifest.get('encoding') != 'float32-le-byte-planes-v1' or not path.with_suffix('.npz').is_file():
                continue
            stem = path.stem
            demos['demo/'+stem] = {'name': manifest.get('name', stem)+' · demo',
                                   'stem': stem, 'directory': path.parent}
        except (OSError, ValueError):
            continue
    # Downloaded packs keep the original source filenames and stable demo IDs.
    from demo_packs import validate_manifest
    for path in sorted(DIRECTORY.glob('packs/*/pack.json'), key=lambda p: p.parent.stat().st_mtime_ns):
        try:
            manifest = json.loads(path.read_text())
            validate_manifest(manifest)
            for item in manifest['images']:
                source = path.parent/item['file']
                if source.is_file():
                    demos[item['id']] = {'name': item['name']+' · demo', 'source': source,
                                         'preview': path.parent/item['preview']}
        except (OSError, ValueError, KeyError, TypeError):
            continue
    DEMOS.clear()
    DEMOS.update(demos)


def preview_path(file_id):
    if file_id not in DEMOS:
        raise ValueError('Unknown installed demo.')
    if 'preview' in DEMOS[file_id]:
        return DEMOS[file_id]['preview']
    return DEMOS[file_id]['directory'] / (DEMOS[file_id]['stem']+'.png')


def catalog_entry(file_id=ID):
    return {'id': file_id, 'name': DEMOS[file_id]['name'], 'sample': 'Demo',
            'has_preview': preview_path(file_id).is_file()}


def catalog_entries():
    refresh()
    return [catalog_entry(file_id) for file_id in DEMOS]


def load(file_id=ID, reader=None):
    if file_id not in DEMOS:
        raise ValueError('Unknown installed demo.')
    if 'source' in DEMOS[file_id]:
        if reader is None:
            from engine import Engine
            reader = Engine({}).read_dm4
        return reader(DEMOS[file_id]['source'])
    stem = DEMOS[file_id]['stem']
    directory = DEMOS[file_id]['directory']
    manifest = json.loads((directory / (stem+'.json')).read_text())
    if manifest.get('schema_version') != 1 or manifest.get('encoding') != 'float32-le-byte-planes-v1':
        raise ValueError('The installed demo format is unsupported.')
    shape = (manifest['height'], manifest['width'])
    with np.load(directory / (stem+'.npz'), allow_pickle=False) as archive:
        planes = archive['byte_planes']
        if planes.dtype != np.uint8 or planes.shape != (4, *shape):
            raise ValueError('The installed demo image is incomplete.')
        # Shuffle byte positions back together; this preserves every float bit.
        array = np.ascontiguousarray(planes.transpose(1, 2, 0)).view('<f4').reshape(shape)
    if hashlib.sha256(array.tobytes()).hexdigest() != manifest['sha256_pixels']:
        raise ValueError('The installed demo pixel checksum does not match.')
    direct = manifest.get('image_kind') == 'diffraction'
    unit = '1/nm' if direct else 'nm'
    metadata = {
        'Calibrations Dimension 1 Units': unit,
        'Calibrations Dimension 2 Units': unit,
        'Calibrations Dimension 1 Scale': manifest['pixel_x_nm_inv' if direct else 'pixel_x_nm'],
        'Calibrations Dimension 2 Scale': manifest['pixel_y_nm_inv' if direct else 'pixel_y_nm'],
        'DataBar Acquisition Date': manifest.get('date', ''),
        'DataBar Acquisition Time': manifest.get('time', ''),
        'Acquisition Device Name': manifest.get('device', ''),
    }
    return array, metadata


refresh()
