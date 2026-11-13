"""Persistent content identities; filenames are locations, never identity evidence."""
from pathlib import Path
import hashlib
import json
import threading
import uuid
import time
import logging

LOG = logging.getLogger("tem_workbench")
from tem_workbench.storage.folder_paths import atomic_json

_LOCK = threading.RLock()

class ImageCatalog:
    def __init__(self, path, namespace):
        self.path = Path(path)
        self.namespace = namespace
        self.events = []
        self.revision = 0
        self.rows = []

    def scan(self, candidates):
        with _LOCK:
            data = json.loads(self.path.read_text()) if self.path.exists() else {
                'version': 1, 'namespace': self.namespace, 'records': {}, 'paths': {}}
            self.namespace = data['namespace']
            before = json.dumps(data, sort_keys=True)
            records, cache = data['records'], data['paths']
            used = {r['id'] for r in records.values()}
            groups = {}
            hashed = 0
            last_progress = time.monotonic()
            for index, (path, row) in enumerate(candidates):
                path = Path(path).resolve(); location = str(path)
                try:
                    stat = path.stat()
                    signature = [stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]
                    previous = cache.get(location, {})
                    if previous.get('stat') == signature:
                        digest = previous['digest']
                    else:
                        if not hashed:
                            LOG.info('Indexing image contents for rename tracking (%d files to check). First scan may take longer for cloud files.', len(candidates))
                        hashed += 1
                        h = hashlib.sha256()
                        with path.open('rb') as stream:
                            for block in iter(lambda: stream.read(1024*1024), b''):
                                h.update(block)
                        after = path.stat()
                        if signature != [after.st_size, after.st_mtime_ns, after.st_ctime_ns]:
                            continue  # A copying/cloud-sync writer has not finished yet.
                        digest = h.hexdigest()
                    if time.monotonic() - last_progress > 2:
                        LOG.info('Image catalogue: checked %d/%d files; read contents of %d.', index + 1, len(candidates), hashed)
                        last_progress = time.monotonic()
                    cache[location] = {'stat': signature, 'digest': digest}
                except OSError:
                    LOG.warning('Cannot index image %s; skipping this scan', path, exc_info=True)
                    continue  # Missing/offline source is retained in history.
                if digest not in records:
                    identity = row['id']
                    if identity in used:
                        identity = 'image-' + uuid.uuid4().hex
                    used.add(identity)
                    records[digest] = {'id': identity, 'locations': [], 'history': []}
                groups.setdefault(digest, []).append((location, row))
            if hashed:
                LOG.info('Image content indexing finished: %d files checked, %d hashes read.', len(candidates), hashed)
            rows, events = [], []
            for digest, record in records.items():
                present = groups.get(digest, [])
                old = record['locations']
                present.sort(key=lambda p: (not(old and p[0] == old[0]), p[0]))
                locations = [p for p, _ in present]
                if old and locations and old != locations:
                    events.append({'kind': 'path', 'id': record['id'], 'old': old, 'paths': locations})
                elif old and not locations:
                    events.append({'kind': 'missing', 'id': record['id'], 'old': old, 'paths': []})
                elif not old and locations and record['history']:
                    events.append({'kind': 'returned', 'id': record['id'], 'old': record['history'][-1:], 'paths': locations})
                record['history'] = list(dict.fromkeys(record['history'] + old + locations))
                record['locations'] = locations
                if present:
                    # Keep the previously active copy where possible. Exact duplicate
                    # files share settings; their available locations remain visible.
                    selected = next((p for p in present if old and p[0] == old[0]), present[0])
                    path, row = selected
                    rows.append({**row, 'id': record['id'], 'path': path,
                                 'content_sha256': digest, 'locations': locations})
            if json.dumps(data, sort_keys=True) != before:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                atomic_json(self.path, data)
            if rows != self.rows:
                self.revision += 1
            self.rows = json.loads(json.dumps(rows))
            self.events = (self.events + events)[-100:]
            return rows

    def save_metadata(self, entries, version):
        """Cache derived DM metadata by content, without replacing registry history."""
        if not entries:
            return
        with _LOCK:
            data = json.loads(self.path.read_text())
            for digest, metadata in entries.items():
                if digest in data['records']:
                    data['records'][digest]['metadata'] = {'version': version, 'value': metadata}
            atomic_json(self.path, data)
