"""Reconnect figure locations by verified bytes, without changing panel recipes."""
from collections import OrderedDict
from pathlib import Path
import re
import threading

from .creator import EXTENSIONS, _digest
from tem_workbench.storage.mode_folders import scan_folders


def source_reference(slot):
    """Only provenance fields participate; rendering and user edits stay separate."""
    def companion(key):
        value = slot.get(key)
        return {k: value.get(k) for k in ('path', 'sha256')} if isinstance(value, dict) else None
    return dict(path=slot.get('path'), sha256=slot.get('sha256'), source_project=slot.get('source_project'),
                metadata_sidecar=companion('metadata_sidecar'), analysis=companion('analysis'))


class FigureSourceResolver:
    def __init__(self):
        self._cache = OrderedDict()
        self._lock = threading.RLock()

    def _hash(self, path):
        path = Path(path).expanduser().resolve()
        def signature():
            stat = path.stat()
            return stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_dev, stat.st_ino
        before = signature()
        cached = self._cache.get(path)
        if cached and cached[0] == before:
            self._cache.move_to_end(path)
            return cached[1]
        digest = _digest(path)
        if signature() != before:
            raise OSError(f'{path.name} is changing. Wait for copying or syncing to finish, then retry.')
        self._cache[path] = (before, digest)
        if len(self._cache) > 8192:
            self._cache.popitem(last=False)
        return digest

    def resolve(self, slots, roots):
        """Return conditional location patches; each root is (folder, exclusions).

        A missing image must have one current content match. Existing changed
        files are never redirected. All recorded companions must verify before
        a patch is offered. No research files or workspace state are written.
        """
        if not isinstance(slots, list) or len(slots) > 10000 or any(not isinstance(s, dict) for s in slots):
            raise ValueError('Expected figure source references.')
        with self._lock:
            return self._resolve(slots, roots)

    def _resolve(self, slots, roots):
        references, seen = [], set()
        for slot in slots:
            if not slot.get('path'):
                continue
            ref = source_reference(slot)
            key = repr(ref)
            if key not in seen:
                references.append(ref)
                seen.add(key)
        repairs, issues, pending = [], [], []

        def issue(ref, kind, message):
            issues.append(dict(source=ref, kind=kind, message=message))

        def companions(ref, source):
            if self._hash(source) != ref['sha256']:
                issue(ref, 'changed', f'{source.name} changed while reconnecting. Review or replace this panel.')
                return
            after = dict(path=str(source), name=source.name)
            for key, suffix, label in (('metadata_sidecar', '.txt', 'TXT metadata'),
                                       ('analysis', '.json', 'linked analysis')):
                saved = ref[key]
                if not saved:
                    continue
                # TXT provenance belongs to the exact sibling. Analysis JSON
                # may retain its original verified location (as in rendering).
                candidate = source.with_suffix(suffix)
                if key == 'analysis' and saved.get('path') and Path(saved['path']).is_file():
                    candidate = Path(saved['path']).expanduser().resolve()
                if not candidate.is_file():
                    issue(ref, 'missing_companion', f'{source.name}: {label} is missing. Move its matching {suffix} file with the image, then retry.')
                    return
                if self._hash(candidate) != saved.get('sha256'):
                    issue(ref, 'changed_companion', f'{source.name}: {label} changed. Review or replace this panel.')
                    return
                after[key] = dict(path=str(candidate), sha256=saved['sha256'])
            if (ref['path'] != after['path'] or any(ref[key] and ref[key]['path'] != after[key]['path']
                                                  for key in ('metadata_sidecar', 'analysis'))):
                repairs.append(dict(before=ref, after=after))

        for ref in references:
            try:
                if not isinstance(ref['path'], str) or not re.fullmatch(r'[0-9a-f]{64}', str(ref['sha256'])):
                    issue(ref, 'missing_hash', 'This panel has no valid saved source hash. Replace its image explicitly.')
                    continue
                source = Path(ref['path']).expanduser().resolve()
                if source.suffix.lower() not in EXTENSIONS:
                    issue(ref, 'unsupported', f'{source.name}: unsupported source type. Replace this panel.')
                elif source.is_file():
                    if self._hash(source) != ref['sha256']:
                        issue(ref, 'changed', f'{source.name} changed since this panel was saved. Replace it explicitly.')
                    else:
                        companions(ref, source)
                else:
                    pending.append(ref)
            except OSError as error:
                issue(ref, 'unavailable', str(error))

        searched = []
        if pending:
            suffixes = {Path(ref['path']).suffix.lower() for ref in pending}
            for family in ({'.tif', '.tiff'}, {'.jpg', '.jpeg'}):
                if suffixes & family:
                    suffixes |= family
            wanted = {ref['sha256'] for ref in pending}
            matches = {digest: set() for digest in wanted}
            scanned, failures = set(), []
            for entry in roots:
                root, outputs = entry[:2]
                scope = entry[2] if len(entry) > 2 else None
                root = Path(root).expanduser().resolve()
                if not root.is_dir():
                    continue
                searched.append(str(root))
                for directory, names in scan_folders(root, outputs, onerror=lambda error: failures.append(str(error)), scope=scope):
                    for name in names:
                        path = directory / name
                        # Include paired PNGs: older recipes can still use them.
                        if path.suffix.lower() not in suffixes:
                            continue
                        try:
                            path = path.resolve()
                            if not path.is_relative_to(root) or path in scanned or not path.is_file():
                                continue
                            scanned.add(path)
                            digest = self._hash(path)
                            if digest in wanted:
                                matches[digest].add(path)
                        except OSError as error:
                            failures.append(str(error))
            for ref in pending:
                candidates = sorted(matches[ref['sha256']])
                name = Path(ref['path']).name
                if failures:
                    # An unreadable candidate could be a second match.
                    issue(ref, 'incomplete_search', f'{name}: source search could not finish: {failures[0]}')
                elif not candidates:
                    issue(ref, 'missing', f'{name} is missing. Use Find moved files… to choose its new folder.')
                elif len(candidates) != 1:
                    issue(ref, 'ambiguous', f'{name}: {len(candidates)} identical files found. Use Find moved files… to choose a folder containing one copy.')
                else:
                    try:
                        companions(ref, candidates[0])
                    except OSError as error:
                        issue(ref, 'unavailable', str(error))
        return dict(repairs=repairs, issues=issues, searched_folders=list(dict.fromkeys(searched)))
