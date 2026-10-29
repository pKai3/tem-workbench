"""Small reusable region library, separate from exported numerical results."""
from pathlib import Path
from datetime import datetime
import json
import threading
import uuid
from folder_paths import atomic_json


class Project:
    def __init__(self, root):
        self.path = Path(root)/'tem_workbench.project.json'
        self.lock = threading.RLock()

    def read(self):
        if not self.path.exists():
            return {'schema_version': 1, 'revision': 0, 'regions': []}
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
            if data.get('schema_version') != 1 or not isinstance(data.get('revision'), int) or not isinstance(data.get('regions'), list):
                raise ValueError()
            for region in data['regions']:
                if not isinstance(region, dict) or not all(k in region for k in ('id', 'source', 'roi', 'settings', 'name', 'tags', 'notes')):
                    raise ValueError()
            return data
        except (ValueError, TypeError, AttributeError):
            raise ValueError('The saved region project cannot be read. Its file has been left untouched.')

    def save_region(self, body, source, roi, settings):
        name, notes = body.get('name', ''), body.get('notes', '')
        if not isinstance(name, str) or not isinstance(notes, str):
            raise ValueError('Region name and notes must be text.')
        name, notes = name.strip(), notes.strip()
        tags = body.get('tags', [])
        if not name or len(name) > 160 or len(notes) > 4000 or not isinstance(tags, list) or len(tags) > 30 or any(not isinstance(t, str) or len(t) > 80 for t in tags):
            raise ValueError('Give the region a short name, up to 30 short tags and an optional note.')
        tags = list(dict.fromkeys(t.strip() for t in tags if t.strip()))
        with self.lock:
            data = self.read()
            if body.get('revision') != data['revision']:
                raise ValueError('Saved regions changed in another session. Refresh the region list before saving.')
            previous = next((r for r in data['regions'] if r['id'] == body.get('id')), None)
            if body.get('id') and previous is None:
                raise ValueError('That saved region no longer exists. Refresh the region list.')
            if previous and previous['source']['sha256_pixels'] != source['sha256_pixels']:
                raise ValueError('Update a region on its original image, or save this as a new region.')
            now = datetime.now().astimezone().isoformat()
            region = {'id': previous['id'] if previous else uuid.uuid4().hex,
                      'name': name, 'tags': tags, 'notes': notes, 'source': source,
                      'roi': roi, 'settings': settings,
                      'created_at': previous['created_at'] if previous else now, 'updated_at': now}
            data['regions'] = [r for r in data['regions'] if r['id'] != region['id']]+[region]
            data['revision'] += 1
            atomic_json(self.path, data)
            return {'project': data, 'region': region}

    def delete_region(self, body):
        with self.lock:
            data = self.read()
            if body.get('revision') != data['revision']:
                raise ValueError('Saved regions changed in another session. Refresh the region list before deleting.')
            region = next((r for r in data['regions'] if r['id'] == body.get('id')), None)
            if region is None:
                raise ValueError('That saved region no longer exists. Refresh the region list.')
            data['regions'] = [r for r in data['regions'] if r['id'] != region['id']]
            data['revision'] += 1
            atomic_json(self.path, data)
            return {'project': data, 'region': region}
