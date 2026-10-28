"""Load the bundled, lossless ST1221 demonstration image without a DM4 reader."""
from pathlib import Path
import hashlib
import json
import numpy as np

ID = 'demo/st1221'
NAME = 'ST1221 · bundled demo'
DIRECTORY = Path(__file__).resolve().parent / 'demo'


def catalog_entry():
    return {'id': ID, 'name': NAME, 'sample': 'Demo'}


def load():
    manifest = json.loads((DIRECTORY / 'st1221.json').read_text())
    if manifest.get('schema_version') != 1 or manifest.get('encoding') != 'float32-le-byte-planes-v1':
        raise ValueError('The bundled demo format is unsupported.')
    shape = (manifest['height'], manifest['width'])
    with np.load(DIRECTORY / 'st1221.npz', allow_pickle=False) as archive:
        planes = archive['byte_planes']
        if planes.dtype != np.uint8 or planes.shape != (4, *shape):
            raise ValueError('The bundled demo image is incomplete.')
        # Shuffle byte positions back together; this preserves every float bit.
        array = np.ascontiguousarray(planes.transpose(1, 2, 0)).view('<f4').reshape(shape)
    if hashlib.sha256(array.tobytes()).hexdigest() != manifest['sha256_pixels']:
        raise ValueError('The bundled demo pixel checksum does not match.')
    metadata = {
        'Calibrations Dimension 1 Units': 'nm',
        'Calibrations Dimension 2 Units': 'nm',
        'Calibrations Dimension 1 Scale': manifest['pixel_x_nm'],
        'Calibrations Dimension 2 Scale': manifest['pixel_y_nm'],
        'DataBar Acquisition Date': manifest.get('date', ''),
        'DataBar Acquisition Time': manifest.get('time', ''),
        'Acquisition Device Name': manifest.get('device', ''),
    }
    return array, metadata
