"""Persistent, read-only source-image metadata preprocessing for Figures."""
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import json
from pathlib import Path
import threading

from tem_workbench.figures import creator
from tem_workbench.storage.folder_paths import atomic_json


class FigureMetadataIndex:
    def __init__(self, path, dm_reader=None):
        self.path = Path(path)
        self.dm_reader = dm_reader
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.thread = None
        self.job = dict(state='idle', folder='', done=0, total=0, reused=0, failed=0,
                        workers=0, current='', errors=[])
        try:
            saved = json.loads(self.path.read_text(encoding='utf-8')) if self.path.is_file() else {}
        except (OSError, ValueError):
            saved = {}
        self.records = saved.get('records', {}) if isinstance(saved, dict) and saved.get('schema_version') in (1, 2, 3) else {}
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
        sidecar_stat = sidecar.stat() if source.suffix.lower() != '.dm4' and sidecar.is_file() else None
        return [stat.st_size, stat.st_mtime_ns,
                sidecar_stat.st_size if sidecar_stat else None,
                sidecar_stat.st_mtime_ns if sidecar_stat else None]

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(self.path, dict(schema_version=3, records=self.records))

    def status(self, folder=None, *, folders=None, source_scopes=None, outputs=()):
        from tem_workbench.storage.mode_folders import scope_allows
        with self.lock:
            job = {**self.job, 'errors': list(self.job['errors']), 'index_path': str(self.path)}
            if folder or folders is not None:
                roots = [Path(path).expanduser().resolve() for path in (folders if folders is not None else [folder])]
                job['records'] = {path: {key: value for key, value in record.items()
                                         if key in ('sha256', 'metadata', 'metadata_sidecar', 'footer_ocr_text',
                                                    'footer_ocr_raw_text',
                                                    'scale_ocr_text',
                                                    'content_height', 'content_height_source', 'pixel_size_nm',
                                                    'pixel_size_source', 'scale_nm', 'inspection_version', 'error')}
                                  for path, record in self.records.items()
                                  if any(Path(path).is_relative_to(root) for root in roots)
                                  and not any(Path(path).is_relative_to(output) for output in outputs)
                                  and (source_scopes is None or any(Path(path).is_relative_to(root) and scope_allows(path, scope)
                                                                 for root, scope in source_scopes))}
            return job

    def start(self, folder, force=False, workers=4, outputs=(), image_loader=None):
        root = Path(folder).expanduser().resolve() if folder else None
        if image_loader is None and (root is None or not root.is_dir()):
            raise ValueError('Choose an available image folder.')
        try:
            count = int(workers)
            if count < 1 or float(workers) != count:
                raise ValueError
        except (TypeError, ValueError, OverflowError):
            raise ValueError('Choose a positive whole number of OCR workers.') from None
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise ValueError('Finish or cancel the current image preprocessing first.')
            self.cancel.clear()
            self.job = dict(state='running', folder=str(root) if root else '', force=bool(force), workers=count,
                            done=0, total=0, reused=0, failed=0, current='', errors=[])
            self.thread = threading.Thread(target=self._work, args=(root, bool(force), count, tuple(outputs), image_loader), daemon=True,
                                           name='figure-metadata-index')
            self.thread.start()
            return self.status(str(root) if root else None)

    def stop(self):
        self.cancel.set()
        return self.status()

    def _work(self, root, force, workers, outputs=(), image_loader=None):
        try:
            images = image_loader() if image_loader else creator.list_images(root, outputs=outputs)['images']
            with self.lock:
                self.job['total'] = len(images)
            changed = False
            def inspect(item):
                path = item['path']
                fingerprint = self._fingerprint(path)
                with self.lock:
                    cached = self.records.get(path)
                if (not force and cached and cached.get('fingerprint') == fingerprint
                        and not cached.get('error') and cached.get('inspection_version') == creator.INSPECTION_VERSION):
                    return None
                found = creator.inspect_image(path, dm_reader=self.dm_reader)
                return dict(path=path, name=item['name'], sha256=found['sha256'],
                            metadata=found['metadata'], metadata_sidecar=found['metadata_sidecar'],
                            footer_ocr_text=found['footer_ocr_text'],
                            footer_ocr_raw_text=found['footer_ocr_raw_text'],
                            scale_ocr_text=found['scale_ocr_text'], inspection_version=creator.INSPECTION_VERSION,
                            content_height=found['content_height'], scale_nm=found['scale_nm'],
                            content_height_source=found['content_height_source'],
                            pixel_size_nm=found['pixel_size_nm'], pixel_size_source=found['pixel_size_source'],
                            fingerprint=fingerprint)

            pending = {}
            next_index = 0
            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix='figure-ocr') as pool:
                def fill():
                    nonlocal next_index
                    while len(pending) < workers and next_index < len(images) and not self.cancel.is_set():
                        item = images[next_index]
                        next_index += 1
                        pending[pool.submit(inspect, item)] = item
                    with self.lock:
                        first = next(iter(pending.values()), None)
                        self.job['current'] = (first['relative_path'] if first else '')

                fill()
                while pending:
                    completed, _ = wait(tuple(pending), timeout=.2, return_when=FIRST_COMPLETED)
                    for future in completed:
                        item = pending.pop(future)
                        try:
                            record = future.result()
                            with self.lock:
                                if record is None:
                                    self.job['reused'] += 1
                                else:
                                    self.records[item['path']] = record
                                    changed = True
                        except Exception as error:
                            with self.lock:
                                self.job['failed'] += 1
                                if len(self.job['errors']) < 20:
                                    self.job['errors'].append(f'{item["relative_path"]}: {error}')
                        with self.lock:
                            self.job['done'] += 1
                            if changed and self.job['done'] % 10 == 0:
                                self._save()
                                changed = False
                    fill()
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
