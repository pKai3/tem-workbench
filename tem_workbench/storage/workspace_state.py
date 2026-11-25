"""Disk-backed viewer preferences and per-project, per-mode bookmarks.

Research inputs are never written. Small key-level patches let the two viewers
save independently without replacing each other's state.
"""
import json
import logging
import threading
from pathlib import Path

from .folder_paths import atomic_json, source_roots

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

    def reconcile_sources(self, previous, current):
        """Retain project selections when child projects are merged into a parent.

        Old bookmark keys remain as history. File paths, content identities and
        named analysis/comparison records are not renamed or recomputed.
        """
        redirects = {}
        current_ids = {source['id'] for source in current}
        for old in previous:
            if old['id'] in current_ids:
                continue
            matches = [source for source in current
                       if all(any(Path(folder['path']).resolve().is_relative_to(Path(candidate['path']).resolve())
                                  for candidate in source_roots([source])) for folder in source_roots([old]))]
            if len(matches) == 1:
                redirects[old['id']] = matches[0]['id']
        if not redirects:
            return {'redirects': {}, 'records': {}}
        with self.lock:
            records = self._read()
            changes = {}
            active = records.get('active_project')
            if active in redirects:
                changes['active_project'] = redirects[active]
            for key, value in records.items():
                if key.startswith('bookmark:'):
                    _, identity, mode = key.split(':', 2)
                    if identity in redirects:
                        destination = f'bookmark:{redirects[identity]}:{mode}'
                        if identity == active or destination not in records and destination not in changes:
                            changes[destination] = value
                if key in ('preference:tem-figures-project', 'preference:tem-figures-scope-v2') or key.startswith('preference:tem-source-filter:'):
                    if value in redirects:
                        changes[key] = redirects[value]
                if key == 'preference:tem-aztec-project-filter' and isinstance(value, str):
                    try:
                        ids = json.loads(value)
                        if isinstance(ids, list) and any(identity in redirects for identity in ids):
                            changes[key] = json.dumps(list(dict.fromkeys(redirects.get(identity, identity) for identity in ids)))
                    except (ValueError, TypeError):
                        pass
                if key in ('preference:tem-figures-saved-v1', 'preference:tem-figures-draft-v1') and isinstance(value, str):
                    try:
                        figures = json.loads(value)
                        recipes = [figures] if key.endswith('draft-v1') else figures.values()
                        changed = False
                        for recipe in recipes:
                            for slot in recipe.get('slots', []):
                                if slot.get('source_project') in redirects:
                                    slot['source_project'] = redirects[slot['source_project']]
                                    changed = True
                        if changed:
                            changes[key] = json.dumps(figures)
                    except (ValueError, TypeError, AttributeError):
                        pass
            self.patch(changes)
            return {'redirects': redirects, 'records': changes}

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
