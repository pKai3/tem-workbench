"""Bounded decoder for the verified native AZtec spectrum tile group variant."""
import struct

import numpy as np

from .h5oina import AztecReadError, MAX_READ_BYTES


MAGIC = b'OINA.Ed.MapTileGroup\0'
HEADER = struct.Struct('<IIIIIIBI')
MAX_CHANNELS = 16_384


def decode_spectra(data, samples, *, max_bytes=MAX_READ_BYTES):
    """Return scan-position × energy-channel counts from a one-tile LZO group.

    This variant was checked byte for byte against the independent H5OINA
    spectrum export for a native 1,500 × 2,048 SmartLines acquisition.
    """
    if not isinstance(samples, int) or isinstance(samples, bool) or samples <= 0:
        raise AztecReadError('The raw line has no valid position count.')
    if (len(data) < 33 or data[:21] != MAGIC or data[21] != 3
            or data[22:25] != b'LZO'):
        raise AztecReadError('Unsupported native spectrum tile encoding.')
    expanded, compressed = struct.unpack_from('<II', data, 25)
    if (not 0 < expanded <= max_bytes or compressed != len(data)-33
            or compressed > max_bytes):
        raise AztecReadError('Native spectrum tile exceeds the read limit or is truncated.')
    try:
        import lzokay
        payload = lzokay.decompress(data[33:], expanded)
    except ImportError as error:
        raise AztecReadError('Native spectrum decoding requires the Workbench LZO dependency.') from error
    except Exception as error:
        raise AztecReadError('Could not decompress the native spectrum tile.') from error
    if len(payload) != expanded:
        raise AztecReadError('Native spectrum tile length does not match its header.')
    channels = []
    offset = 0
    while offset < len(payload):
        if len(channels) >= MAX_CHANNELS or offset + HEADER.size > len(payload):
            raise AztecReadError('Invalid native spectrum channel header.')
        group, index, tile_count, bits, mask, total, flag, words = HEADER.unpack_from(payload, offset)
        offset += HEADER.size
        if (group != 1 or index != len(channels) or tile_count != 1 or flag != 1
                or bits not in (0, 1, 2, 4, 8, 16) or mask != (1 << bits)-1
                or words != (samples*bits//32+1 if bits else 0)
                or words*4 > len(payload)-offset
                or samples*(len(channels)+1)*4 > max_bytes):
            raise AztecReadError('Unsupported native spectrum channel layout.')
        block = np.frombuffer(payload, dtype=np.uint8, count=words*4, offset=offset)
        offset += words*4
        if bits:
            digits = np.unpackbits(block, bitorder='little')[:samples*bits].reshape(samples, bits)
            values = digits @ (1 << np.arange(bits, dtype=np.uint32))
        else:
            values = np.zeros(samples, dtype=np.uint32)
        if int(values.sum(dtype=np.uint64)) != total:
            raise AztecReadError('Native spectrum channel count does not match its header.')
        channels.append(values.astype(np.int32, copy=False))
    if not channels:
        raise AztecReadError('Native spectrum tile has no channels.')
    return np.stack(channels, axis=1)
