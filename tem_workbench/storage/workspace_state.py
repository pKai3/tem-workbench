"""Disk-backed viewer preferences and per-project, per-mode bookmarks.

Research inputs are never written. Small key-level patches let the two viewers
save independently without replacing each other's state.
"""
import json
import logging
import threading
from pathlib import Path

from .folder_paths import atomic_json

LOG = logging.getLogger('tem_workbench')
MAX_BYTES = 16 * 1024 * 1024


class WorkspaceState:
    def __init__(self, config_path):
        self.path = Path(config_path).resolve().with_name('tem-workbench.workspace.json')
        self.lock = threading.RLock()

    def _read(self):
        if not self.path.exists():
            return {}
        if self.path.stat().st_size > MAX_BYTES:
            raise ValueError('Workspace settings file is too large.')
        data = json.loads(self.path.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or data.get('schema_version') != 1 or not isinstance(data.get('records'), dict):
            raise ValueError('Unrecognized workspace settings format; existing file was left untouched.')
        return data['records']

    def read(self):
        with self.lock:
            return {'path': str(self.path), 'records': self._read()}

    def patch(self, records, only_missing=False):
        if not isinstance(records, dict) or len(records) > 10000:
            raise ValueError('Expected a workspace settings patch.')
        for key, value in records.items():
            if not isinstance(key, str) or len(key) > 4096 or not (
                    key == 'active_project' or key.startswith(('preference:tem-', 'bookmark:'))):
                raise ValueError('Invalid workspace settings key.')
            if key.startswith('preference:') and value is not None and not isinstance(value, str):
                raise ValueError('Expected a stored preference string.')
        with self.lock:
            current = self._read()
            changes = {k: v for k, v in records.items()
                       if (not only_missing or k not in current) and (k not in current or current[k] != v)}
            if changes:
                current.update(changes)
                data = {'schema_version': 1, 'records': current}
                if len(json.dumps(data, allow_nan=False).encode('utf-8')) > MAX_BYTES:
                    raise ValueError('Workspace settings exceed the storage limit.')
                atomic_json(self.path, data)
                LOG.info('Workspace saved: %d changed settings · %s', len(changes), self.path)
            return {'path': str(self.path), 'records': current}
