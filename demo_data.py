"""Load bundled, lossless TEM demonstration images without a DM4 reader."""
from pathlib import Path
import hashlib
import json
import numpy as np

ID = 'demo/st1221'
NAME = 'ST1221 · bundled demo'
DIRECTORY = Path(__file__).resolve().parent / 'demo'
DIFFRACTION_ID = 'demo/st1144'
DEMOS = {ID: {'name': NAME, 'stem': 'st1221'},
         DIFFRACTION_ID: {'name': 'ST1144 diffraction · bundled demo', 'stem': 'st1144'}}


def catalog_entry(file_id=ID):
    return {'id': file_id, 'name': DEMOS[file_id]['name'], 'sample': 'Demo'}


def catalog_entries():
    return [catalog_entry(file_id) for file_id in DEMOS]


def load(file_id=ID):
    if file_id not in DEMOS:
        raise ValueError('Unknown bundled demo.')
    stem = DEMOS[file_id]['stem']
    manifest = json.loads((DIRECTORY / (stem+'.json')).read_text())
    if manifest.get('schema_version') != 1 or manifest.get('encoding') != 'float32-le-byte-planes-v1':
        raise ValueError('The bundled demo format is unsupported.')
    shape = (manifest['height'], manifest['width'])
    with np.load(DIRECTORY / (stem+'.npz'), allow_pickle=False) as archive:
        planes = archive['byte_planes']
        if planes.dtype != np.uint8 or planes.shape != (4, *shape):
            raise ValueError('The bundled demo image is incomplete.')
        # Shuffle byte positions back together; this preserves every float bit.
        array = np.ascontiguousarray(planes.transpose(1, 2, 0)).view('<f4').reshape(shape)
    if hashlib.sha256(array.tobytes()).hexdigest() != manifest['sha256_pixels']:
        raise ValueError('The bundled demo pixel checksum does not match.')
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
