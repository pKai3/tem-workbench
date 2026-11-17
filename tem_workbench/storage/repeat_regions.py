"""Background repeated-field review, separate from image identity and fitting."""
from pathlib import Path
from collections import defaultdict
import copy
import hashlib
import json
import logging
import os
import re
import threading
import time

import numpy as np
from PIL import Image
from tem_workbench.analysis.repeat_detection import image_fingerprint, fft_fingerprint, compare_pair
from tem_workbench.storage.acquisition_map import MetadataIndex, acquisition_number
from tem_workbench.storage.folder_paths import atomic_json
from tem_workbench.storage import raster_images
from tem_workbench.storage.preview_files import sidecar_path

LOG = logging.getLogger('tem_workbench')
VERSION = 'repeat-review-v1'
EXPORT_NAME = re.compile(r'^\d{8}_\d{6}_(.+)_(?:nmf|pca)_[0-9a-f]+\.json$')
DECISIONS = {'same', 'different', 'uncertain', 'pending'}


def pair_key(a, b):
    return ':'.join(sorted((a, b)))


def confirmed_groups(pairs):
    neighbours = defaultdict(set)
    for pair in pairs.values():
        if pair.get('decision') == 'same':
            a, b = pair['digests']; neighbours[a].add(b); neighbours[b].add(a)
    groups = []; seen = set()
    for node in sorted(neighbours):
        if node in seen: continue
        group, stack = set(), [node]
        while stack:
            current = stack.pop()
            if current in group: continue
            group.add(current); stack.extend(neighbours[current]-group)
        seen.update(group); groups.append(sorted(group))
    return groups


class RepeatRegions:
    def __init__(self, path):
        self.path = Path(path)
        self.cache = self.path.with_suffix('.cache')
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.thread = None
        self.job = dict(state='idle', stage='', completed=0, total=0, errors=[])

    def _read(self):
        if not self.path.exists(): return dict(version=1, pairs={})
        data = json.loads(self.path.read_text())
        if data.get('version') != 1 or not isinstance(data.get('pairs'), dict):
            raise ValueError('Unrecognized duplicate-review file; existing decisions were left untouched.')
        return data

    def running(self):
        return self.thread is not None and self.thread.is_alive()

    def status(self, rows):
        with self.lock:
            data = self._read(); by_hash = {r['content_sha256']: r for r in rows if r.get('content_sha256')}
            pairs = []
            for key, stored in data['pairs'].items():
                if not all(h in by_hash for h in stored['digests']): continue
                pair = copy.deepcopy(stored)
                pair['key'] = key
                pair['images'] = [{k: by_hash[h].get(k) for k in
                                  ('id','name','sample','folder','source_id','content_sha256','has_preview','image_kind')}
                                  for h in stored['digests']]
                pairs.append(pair)
            pairs.sort(key=lambda p: (p.get('decision', 'pending') != 'pending',
                                     -(p.get('image_ncc') or 0), -(p.get('fft_cosine') or 0), p['key']))
            groups = [[by_hash[h]['id'] for h in group if h in by_hash]
                      for group in confirmed_groups(data['pairs'])]
            return dict(job=copy.deepcopy(self.job), pairs=pairs, groups=[g for g in groups if len(g)>1],
                        path=str(self.path), last_scan=data.get('last_scan'))

    def decide(self, key, decision, rows):
        if decision not in DECISIONS: raise ValueError('Choose Same region, Different, Unsure or Reset.')
        with self.lock:
            data = self._read()
            pair = data['pairs'].get(key)
            available = {r.get('content_sha256') for r in rows}
            if not pair or not all(h in available for h in pair['digests']):
                raise ValueError('This pair is no longer in the current image catalogue. Refresh the review.')
            pair['decision'] = decision
            groups = confirmed_groups(data['pairs'])
            for other in data['pairs'].values():
                if other.get('decision') == 'different' and any(set(other['digests']) <= set(g) for g in groups):
                    raise ValueError('This conflicts with a confirmed group. Reset the conflicting pair before changing the group.')
            pair['reviewed_at'] = time.time()
            atomic_json(self.path, data)
            LOG.info('Duplicate review saved: %s · %s', key[:16], decision)
        return self.status(rows)

    def start(self, engine, ids, search_all=False):
        if not isinstance(ids, list) or not ids or len(ids)>2000 or any(not isinstance(i,str) for i in ids):
            raise ValueError('Choose up to 2,000 images in the current project or folder.')
        if len(ids)!=len(set(ids)): raise ValueError('Duplicate image identifiers in request.')
        with self.lock:
            if self.running(): raise ValueError('A duplicate search is already running.')
            registry = getattr(getattr(engine, 'catalogue', None), 'path', None)
            histories = json.loads(Path(registry).read_text()).get('records', {}) if registry and Path(registry).is_file() else {}
            rows = []
            for identity in ids:
                row = engine.file_rows.get(identity)
                if not row: raise ValueError('An image is no longer available. Refresh the catalogue.')
                if row.get('image_kind') == 'diffraction': continue
                names = {row['name']} | {Path(p).stem for p in histories.get(row['content_sha256'], {}).get('history', [])}
                rows.append(dict(row, path=str(engine.files[identity]), export_names=sorted(names)))
            if len(rows)<2: raise ValueError('Choose at least two real-space images.')
            if search_all and len(rows)>300:
                raise ValueError('All-pairs search supports 300 images at a time. Narrow the browser folder/search, or use Nearby acquisitions.')
            # Snapshots and a private reader/cache never replace the live analysis image.
            reader = engine.dm_reader() if any(not r.get('raster') for r in rows) else None
            outputs = sorted({str(engine.output_for(r['id'])) for r in rows})
            raster_store = engine.raster_store
            self.cancel.clear()
            self.job = dict(state='running', stage='Preparing images', completed=0, total=len(rows), errors=[])
            self.thread = threading.Thread(target=self._run, args=(rows,reader,outputs,raster_store,search_all),
                                           name='repeat-region-review', daemon=True)
            self.thread.start()
            LOG.info('Duplicate search started: %d images · %s',len(rows),'all pairs' if search_all else 'nearby acquisitions')

    def _progress(self, stage, completed, total):
        with self.lock: self.job.update(stage=stage, completed=completed, total=total)

    def _error(self, name, error):
        with self.lock: self.job['errors'].append(dict(name=name, error=str(error)))
        LOG.warning('Duplicate search: %s · %s', name, error)

    def _exports(self, roots, names):
        exports = defaultdict(list)
        for root in roots:
            for directory, folders, files in os.walk(root):
                if self.cancel.is_set(): return exports
                folders[:] = [f for f in folders if not f.startswith('.') and f not in ('cache','node_modules')]
                for filename in files:
                    match = EXPORT_NAME.match(filename)
                    if match and match[1] in names:
                        exports[match[1]].append(Path(directory)/filename)
        return exports

    def _fingerprint(self, row, index, reader, raster_store, exports):
        path = Path(row['path']); stat = path.stat()
        signature = (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        info = {}
        if not row.get('raster'):
            info = index.read(path, reader)
            if info.get('image_kind') != 'real_space': return None
        preview = path if row.get('raster') else sidecar_path(path)
        preview_signature = [str(preview), preview.stat().st_size, preview.stat().st_mtime_ns] if preview.is_file() else None
        candidates = sorted({p for name in row.get('export_names', [row['name']]) for p in exports.get(name, [])},
                            key=lambda p:p.name, reverse=True)
        export_signature = [[str(p),p.stat().st_size,p.stat().st_mtime_ns] for p in candidates]
        calibration_signature = raster_store.stat().st_mtime_ns if raster_store.exists() else None
        cache_key = hashlib.sha256(json.dumps([VERSION,row['content_sha256'],signature,preview_signature,
                                             export_signature,calibration_signature]).encode()).hexdigest()
        target = self.cache/(cache_key+'.npz')
        if target.is_file():
            with np.load(target, allow_pickle=False) as saved:
                metadata = json.loads(str(saved['metadata']))
                image = saved['image']; fft = saved['fft'] if saved['fft'].size else None
        else:
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for block in iter(lambda: source.read(1024*1024), b''):
                    if self.cancel.is_set(): return None
                    digest.update(block)
            if digest.hexdigest() != row['content_sha256']:
                raise ValueError('Image changed since the catalogue was read; refresh and scan again.')
            if preview.is_file():
                with Image.open(preview) as original: im = original.convert('L'); im.thumbnail((256,256))
            else:
                with reader.fileDM(path, on_memory=False) as original: array = np.asarray(original.getDataset(0)['data'])
                if array.ndim!=2 or not np.isfinite(array).all(): raise ValueError('Image is not a finite two-dimensional array.')
                lo,hi=np.percentile(array,[.3,99.7]);im=Image.fromarray(np.uint8(np.clip((array-lo)/max(hi-lo,1e-12),0,1)*255));im.thumbnail((256,256))
            image = image_fingerprint(im)
            if row.get('raster'):
                array = raster_images.read(path)
                calibration = raster_images.stored(raster_store,path,array,'sha256:'+row['content_sha256'])
                info = dict(width=array.shape[1],height=array.shape[0],field_nm=None)
                if calibration and calibration['image_kind']=='real_space':
                    info['field_nm']=[array.shape[1]*calibration['scale'],array.shape[0]*calibration['scale']]
            metadata = dict(field_nm=info.get('field_nm'),dimensions=[info['width'],info['height']],
                            stage=info.get('stage_position'),date=info.get('date'),fft_source=None,fft_windows=0)
            fft = None
            for candidate in candidates:
                if self.cancel.is_set(): return None
                try:
                    exported = json.loads(candidate.read_text())
                    if exported.get('source',{}).get('content_sha256') != row['content_sha256']: continue
                    support = exported.get('phase_support') or {}
                    if (not support.get('windows') or support.get('completed')!=support.get('total')
                            or not str(support.get('scoring_version','')).startswith('native-fft-window-')): continue
                    fingerprint = fft_fingerprint(support['windows'])
                    if not np.any(fingerprint): continue
                    fft = fingerprint; metadata.update(fft_source=str(candidate),fft_windows=len(support['windows']));break
                except (OSError,ValueError,KeyError,TypeError):
                    continue  # A partially written/newer export cannot replace a usable one.
            after=path.stat()
            if signature!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns): raise ValueError('Image changed during matching; refresh and scan again.')
            self.cache.mkdir(parents=True,exist_ok=True)
            np.savez_compressed(target,image=image,fft=fft if fft is not None else np.array([]),metadata=json.dumps(metadata))
        # Project/folder/date constrain suggestions; filenames are not identities.
        sample = '\0'.join(str(v or '') for v in (row.get('source_id'),row.get('folder',row.get('sample')),metadata.get('date')))
        return dict(id=row['id'],sample=sample,number=acquisition_number(row),image=image,fft=fft,**metadata,row=row)

    def _run(self, rows, reader, outputs, raster_store, search_all):
        try:
            exports=self._exports(outputs,{name for r in rows for name in r.get('export_names',[r['name']])});index=MetadataIndex();entries=[]
            for i,row in enumerate(rows):
                if self.cancel.is_set(): break
                try:
                    entry=self._fingerprint(row,index,reader,raster_store,exports)
                    if entry: entries.append(entry)
                except Exception as exc: self._error(row['name'],exc)
                self._progress('Preparing images',i+1,len(rows))
            found={};total=len(entries)*(len(entries)-1)//2;done=0;checked=0
            self._progress('Comparing images',0,total)
            for i,a in enumerate(entries):
                if self.cancel.is_set(): break
                for b in entries[i+1:]:
                    if self.cancel.is_set(): break
                    # Unnumbered images can still be compared within their folder.
                    unnumbered=(a['number'] is None and b['number'] is None and a['row'].get('folder')==b['row'].get('folder'))
                    result=compare_pair(a,b,search_all=search_all or unnumbered,image_only=True)
                    done+=1
                    if result is not None:
                        checked+=1
                        if result['proposed']:
                            digests=[a['row']['content_sha256'],b['row']['content_sha256']]
                            key=pair_key(*digests)
                            found[key]={**result,'digests':digests,'decision':'pending', 'scanned_at':time.time(),
                                        'fields_nm':[a['field_nm'],b['field_nm']],
                                        'fft_sources':[a['fft_source'],b['fft_source']],
                                        'fft_windows':[a['fft_windows'],b['fft_windows']]}
                    if done%25==0:self._progress('Comparing images',done,total)
            with self.lock:
                data=self._read()
                # Incomplete scans do not erase earlier candidates or decisions.
                if not self.cancel.is_set():
                    scope={e['row']['content_sha256'] for e in entries}
                    for key,pair in list(data['pairs'].items()):
                        if set(pair['digests'])<=scope and pair.get('decision','pending')=='pending' and key not in found:
                            del data['pairs'][key]
                for key,pair in found.items():
                    previous=data['pairs'].get(key,{})
                    pair.update({k:previous[k] for k in ('decision','reviewed_at') if k in previous})
                    data['pairs'][key]=pair
                state='cancelled' if self.cancel.is_set() else 'complete'
                data['last_scan']=dict(state=state,images=len(entries),pairs_compared=checked,candidates=len(found),
                                       fft_images=sum(e['fft'] is not None for e in entries),search_all=search_all,time=time.time())
                atomic_json(self.path,data)
                self.job.update(state=state,stage='Search cancelled' if self.cancel.is_set() else 'Search complete',
                                completed=done,total=total,candidates=len(found))
                LOG.info('Duplicate search %s: %d pairs checked · %d candidates · %d images with saved FFT evidence',
                         state,checked,len(found),data['last_scan']['fft_images'])
        except Exception as exc:
            LOG.exception('Duplicate search failed')
            with self.lock:self.job.update(state='failed',stage=str(exc))
