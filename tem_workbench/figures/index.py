"""Persistent, read-only source-image metadata preprocessing for Figures."""
import json
from pathlib import Path
import threading

from tem_workbench.figures import creator
from tem_workbench.storage.folder_paths import atomic_json


class FigureMetadataIndex:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.thread = None
        self.job = dict(state='idle', folder='', done=0, total=0, reused=0, failed=0, current='', errors=[])
        try:
            saved = json.loads(self.path.read_text(encoding='utf-8')) if self.path.is_file() else {}
        except (OSError, ValueError):
            saved = {}
        self.records = saved.get('records', {}) if isinstance(saved, dict) and saved.get('schema_version') in (1, 2) else {}
        if not isinstance(self.records, dict):
            self.records = {}
        for record in self.records.values():
            metadata = record.get('metadata') if isinstance(record, dict) else None
            if isinstance(metadata, dict):
                record['metadata'] = {key: value for key, value in metadata.items()
                                      if not isinstance(value, dict) or value.get('source') != 'Filename'}

    @staticmethod
    def _fingerprint(path):
        source = Path(path)
        stat = source.stat()
        sidecar = source.with_suffix('.txt')
        sidecar_stat = sidecar.stat() if sidecar.is_file() else None
        return [stat.st_size, stat.st_mtime_ns,
                sidecar_stat.st_size if sidecar_stat else None,
                sidecar_stat.st_mtime_ns if sidecar_stat else None]

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(self.path, dict(schema_version=2, records=self.records))

    def status(self, folder=None):
        with self.lock:
            job = {**self.job, 'errors': list(self.job['errors']), 'index_path': str(self.path)}
            if folder:
                root = Path(folder).expanduser().resolve()
                job['records'] = {path: {key: value for key, value in record.items()
                                         if key in ('sha256', 'metadata', 'metadata_sidecar', 'footer_ocr_text',
                                                    'content_height', 'scale_nm', 'error')}
                                  for path, record in self.records.items()
                                  if Path(path).is_relative_to(root)}
            return job

    def start(self, folder):
        root = Path(folder).expanduser().resolve()
        if not root.is_dir():
            raise ValueError('Choose an available image folder.')
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise ValueError('Finish or cancel the current image preprocessing first.')
            self.cancel.clear()
            self.job = dict(state='running', folder=str(root), done=0, total=0, reused=0,
                            failed=0, current='', errors=[])
            self.thread = threading.Thread(target=self._work, args=(root,), daemon=True, name='figure-metadata-index')
            self.thread.start()
            return self.status(str(root))

    def stop(self):
        self.cancel.set()
        return self.status()

    def _work(self, root):
        try:
            images = creator.list_images(root)['images']
            with self.lock:
                self.job['total'] = len(images)
            changed = False
            for item in images:
                if self.cancel.is_set():
                    break
                path = item['path']
                with self.lock:
                    self.job['current'] = item['relative_path']
                try:
                    fingerprint = self._fingerprint(path)
                    with self.lock:
                        cached = self.records.get(path)
                    if cached and cached.get('fingerprint') == fingerprint and not cached.get('error'):
                        with self.lock:
                            self.job['reused'] += 1
                    else:
                        inspected = creator.inspect_image(path)
                        record = dict(path=path, name=item['name'], sha256=inspected['sha256'],
                                      metadata=inspected['metadata'], metadata_sidecar=inspected['metadata_sidecar'],
                                      footer_ocr_text=inspected['footer_ocr_text'],
                                      content_height=inspected['content_height'], scale_nm=inspected['scale_nm'],
                                      fingerprint=fingerprint)
                        with self.lock:
                            self.records[path] = record
                            changed = True
                except (OSError, ValueError, TypeError) as error:
                    with self.lock:
                        self.job['failed'] += 1
                        if len(self.job['errors']) < 20:
                            self.job['errors'].append(f'{item["relative_path"]}: {error}')
                with self.lock:
                    self.job['done'] += 1
                    if changed and self.job['done'] % 10 == 0:
                        self._save()
                        changed = False
            with self.lock:
                if changed:
                    self._save()
                self.job['state'] = 'cancelled' if self.cancel.is_set() else 'complete'
                self.job['current'] = ''
        except Exception as error:
            with self.lock:
                self.job['state'] = 'error'
                self.job['current'] = ''
                self.job['errors'].append(str(error))
