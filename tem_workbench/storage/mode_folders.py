"""Identify AZtec folders from filenames, without decoding research data."""
import os
from pathlib import Path
import threading
import time

AZTEC_SUFFIXES = frozenset({'.oip', '.oipx', '.h5oina'})
_cache = {}
_lock = threading.RLock()


def scan_folders(root, outputs=(), *, onerror=None):
    """Walk source directories without entering configured output trees."""
    root = Path(root).expanduser().resolve()
    outputs = frozenset(Path(p).expanduser().resolve() for p in outputs)

    def excluded(path):
        return any(path.is_relative_to(output) for output in outputs)

    if excluded(root):
        return
    for directory, folders, names in os.walk(root, followlinks=False, onerror=onerror):
        directory = Path(directory)
        folders[:] = sorted(n for n in folders if not n.startswith('.')
                            and not (directory/n).is_symlink()
                            and not excluded((directory/n).resolve()))
        # File aliases into an output tree must not reintroduce exported images.
        yield directory, [n for n in names if not (directory/n).is_symlink()
                          or not excluded((directory/n).resolve())]


def aztec_folders(root, outputs=()):
    """Return acquisition folders and ancestors; brief cache for navigation."""
    root = Path(root).resolve()
    outputs = frozenset(Path(p).expanduser().resolve() for p in outputs)
    key = (root, outputs)
    now = time.monotonic()
    with _lock:
        previous = _cache.get(key)
        if previous and now - previous[0] < 15:
            return previous[1]
    found = set()
    for directory, names in scan_folders(root, outputs):
        if any(Path(name).suffix.lower() in AZTEC_SUFFIXES and (Path(directory)/name).is_file() for name in names):
            path = Path(directory)
            found.add(path)
            found.update(p for p in path.parents if p.is_relative_to(root))
    result = frozenset(found)
    with _lock:
        if len(_cache) >= 64:
            _cache.clear()
        _cache[key] = (now, result)
    return result


def diffraction_files(root, outputs=()):
    """Skip AZtec folders and their raster exports, retaining native DM files.

    A mixed project can still contain original diffraction acquisitions. Their
    DM4 files remain available; AZtec report screenshots do not enter fitting.
    """
    root = Path(root).resolve()
    aztec_roots = set()
    for directory, names in scan_folders(root, outputs):
        if any(Path(n).suffix.lower() in AZTEC_SUFFIXES for n in names):
            aztec_roots.add(directory)
        in_aztec = any(directory.is_relative_to(p) for p in aztec_roots)
        yield directory, [n for n in names if not in_aztec or Path(n).suffix.lower() == '.dm4']
