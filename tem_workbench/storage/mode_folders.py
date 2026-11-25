"""Identify AZtec folders from filenames, without decoding research data."""
import os
from pathlib import Path
import threading
import time

AZTEC_SUFFIXES = frozenset({'.oip', '.oipx', '.h5oina'})
_cache = {}
_lock = threading.RLock()


def scope_allows(path, scope=None, *, traverse=False):
    path = Path(path).resolve()
    scope = scope or {}
    if any(path.is_relative_to(ignored) for ignored in scope.get('ignored', ())):
        return False
    rules = scope.get('mode_rules', ())
    matching = [(folder, enabled) for folder, enabled in rules if path.is_relative_to(folder)]
    enabled = max(matching, key=lambda item: len(item[0].parts))[1] if matching else True
    if not enabled and not (traverse and any(value and folder.is_relative_to(path) for folder, value in rules)):
        return False
    return all(any(path.is_relative_to(included) or traverse and included.is_relative_to(path)
                   for included in group) for group in scope.get('include_groups', ()))


def output_scope_allows(path, outputs=(), scope=None, *, traverse=False):
    """Exports require an explicit inclusion at or below their own folder."""
    rules = (scope or {}).get('mode_rules', ())
    return all(any(enabled and folder.is_relative_to(output) and
                   (path.is_relative_to(folder) or traverse and folder.is_relative_to(path))
                   for folder, enabled in rules)
               for output in outputs if path.is_relative_to(output))


def scan_folders(root, outputs=(), *, onerror=None, scope=None):
    """Walk selected sources; export trees remain excluded unless opted in."""
    root = Path(root).expanduser().resolve()
    outputs = frozenset(Path(p).expanduser().resolve() for p in outputs)

    def excluded(path):
        return not output_scope_allows(path, outputs, scope, traverse=True) or not scope_allows(path, scope, traverse=True)

    if excluded(root):
        return
    for directory, folders, names in os.walk(root, followlinks=False, onerror=onerror):
        directory = Path(directory)
        folders[:] = sorted(n for n in folders if not n.startswith('.')
                            and not (directory/n).is_symlink()
                            and not excluded((directory/n).resolve()))
        # Only explicitly selected exports may re-enter through file aliases.
        yield directory, [n for n in names if scope_allows(directory/n, scope)
                          and output_scope_allows(directory/n, outputs, scope)
                          and (not (directory/n).is_symlink() or not excluded((directory/n).resolve()))]


def aztec_folders(root, outputs=(), scope=None):
    """Return acquisition folders and ancestors; brief cache for navigation."""
    root = Path(root).resolve()
    outputs = frozenset(Path(p).expanduser().resolve() for p in outputs)
    scope = scope or {}
    key = (root, outputs, tuple(scope.get('include_groups', ())), scope.get('ignored', frozenset()), scope.get('mode_rules', ()))
    now = time.monotonic()
    with _lock:
        previous = _cache.get(key)
        if previous and now - previous[0] < 15:
            return previous[1]
    found = set()
    for directory, names in scan_folders(root, outputs, scope=scope):
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


def diffraction_files(root, outputs=(), scope=None):
    """Skip AZtec folders and their raster exports, retaining native DM files.

    A mixed project can still contain original diffraction acquisitions. Their
    DM4 files remain available; AZtec report screenshots do not enter fitting.
    """
    root = Path(root).resolve()
    aztec_roots = set()
    for directory, names in scan_folders(root, outputs, scope=scope):
        if any(Path(n).suffix.lower() in AZTEC_SUFFIXES for n in names):
            aztec_roots.add(directory)
        in_aztec = any(directory.is_relative_to(p) for p in aztec_roots)
        yield directory, [n for n in names if not in_aztec or Path(n).suffix.lower() == '.dm4']
