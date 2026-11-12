"""Local-only TEM workbench. Start with: python server.py --open"""
import phase_support
from parallel_execution import RegionPool, worker_count, worker_limit, configure_numeric_threads
configure_numeric_threads()
from concurrent.futures import TimeoutError, CancelledError
import copy
import signal
from pathlib import Path
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from datetime import datetime
import argparse
import base64
from io import BytesIO
from PIL import Image
import errno
import json
import logging
import os
import platform
import sys
from importlib import metadata
import mimetypes
import time
import secrets
import threading
import traceback
import uuid
import webbrowser
import numpy as np
from crystal_templates import PHASES
from materials import MATERIAL_PRESETS
from engine import Engine, png, data_url, spectrum_images
import fft_reconstruction
import diffraction
import peak_evidence
import brightness_grouping
import double_diffraction
from batch_grids import BatchGrids, eligibility, safe_name
import demo_data
from demo_packs import DemoDownload
import adaptive_refinement
import overlap_maps
from window_size_probe import WindowSizeProbe
import shared_spectra
import folder_paths
from preview_files import PreviewBatch, sidecar_path
from workbench_project import Project

ROOT = Path(__file__).resolve().parent
# Capture at import: updating files must not relabel an already running backend.
APP_VERSION = (ROOT / 'VERSION').read_text(encoding='utf-8').strip() if (ROOT / 'VERSION').is_file() else 'development'
LOG = logging.getLogger('tem_workbench')
GRID_WAIT_LOG_SECONDS = 10

# Longest marker cycle: 2.4 seconds at 30 fps, rendered at 2800 × 2728.
SPECTRUM_MAX_FRAMES = 72
SPECTRUM_MAX_PIXELS = 600_000_000


def demo_config(demo_only=False):
    """Installed demos appear alongside locally chosen folders."""
    return {**folder_paths.DEFAULTS, 'default_file': demo_data.ID, 'demo_only': demo_only}


class Workbench:
    def __init__(self, config, root=ROOT, config_path=None):
        self.root = Path(root).resolve()
        self.config_path = Path(config_path or self.root/'.tem-paths.json')
        self.config = folder_paths.resolve_config(config, self.root)
        self.engine = Engine(self.config)
        self.project = Project(self.root)
        self.last_preview_log = 0.
        self.token = secrets.token_urlsafe(24)
        self.lock = threading.RLock()
        self.ifft_lock = threading.Lock()
        self.ifft_cache = None
        self.preview_batch = None
        self.demo_download = DemoDownload(demo_data.DIRECTORY/'packs')
        self.jobs = {}
        self.grid_thread = None
        self.closing = False
        self.job_lock = threading.RLock()
        LOG.info('Scanning image source folders…')
        self.engine.catalog()
        LOG.info('Image catalogue ready: %d images.', len(self.engine.files))
        self.batch = BatchGrids(self)
        self.window_probe = WindowSizeProbe()
        self.pca = shared_spectra.SharedSpectra()
        self.watch_stop = threading.Event()
        self.watch_thread = None


    def catalogue_status(self):
        return dict(files=self.engine.demo_rows + list(self.engine.file_rows.values()),
                    revision=self.engine.catalogue.revision, events=self.engine.catalogue.events,
                    namespace=self.engine.catalogue.namespace)

    def watch_sources(self):
        if self.watch_thread:
            return
        def watch():
            while not self.watch_stop.wait(15):
                try:
                    # Never mutate an active grid's source or interrupt a batch.
                    if self.batch.running() or (self.grid_thread and self.grid_thread.is_alive()) or self.window_probe.running() or self.pca.running():
                        continue
                    with self.lock:
                        self.engine.catalog()
                except Exception:
                    LOG.exception('Source folder refresh failed')
        self.watch_thread = threading.Thread(target=watch, name='image-folder-watch', daemon=True)
        self.watch_thread.start()

    def set_sources(self, sources, output):
        with self.lock, self.job_lock:
            if self.batch.running() or (self.grid_thread and self.grid_thread.is_alive()) or self.window_probe.running() or self.pca.running():
                raise ValueError('Finish or cancel the current analysis job before changing sources.')
            if self.preview_batch and self.preview_status()['state']=='running':
                raise ValueError('Finish PNG preview generation before changing sources.')
            saved = folder_paths.save_sources(self.config_path, self.root, self.config, sources, output)
            self.config = folder_paths.resolve_config(saved, self.root)
            self.engine = Engine(self.config)
            self.engine.catalog()
            self.jobs.clear()
            return self.config_info()

    def rename_source(self, source_id, name):
        with self.lock:
            saved = folder_paths.rename_source(self.config_path, self.config, self.engine.sources, source_id, name)
            self.config = saved
            self.engine.settings = saved
            self.engine.sources = saved['sources']
            self.engine.catalog()
            status = self.catalogue_status()
            return {**status, 'sources': self.engine.sources}

    def analyze_interactive(self, body):
        # Snapshot mutable caches while retaining immutable source arrays. Matching
        # must not hold the catalogue lock and block opening a different image.
        with self.lock:
            original_engine = self.engine
            engine = copy.copy(original_engine)
            engine._template_cache = dict(self.engine._template_cache)
            source = self.engine.load(body['file_id'])
            item = dict(source)
            item['_diffraction_cache'] = {
                'entries': list(source.get('_diffraction_cache', {}).get('entries', []))}
        result = engine.analyze(item, body['roi'], body.get('settings', {}))
        with self.lock:
            if self.engine is original_engine:
                self.engine._template_cache.update(engine._template_cache)
                while len(self.engine._template_cache) > 4:
                    self.engine._template_cache.pop(next(iter(self.engine._template_cache)))
            if self.engine.loaded.get(body['file_id']) is source:
                source['_diffraction_cache'] = item['_diffraction_cache']
        return item, result

    def config_info(self):
        files = self.engine.catalog()
        return {'sources': self.engine.sources, 'file_tracking': True, 'state_namespace': self.engine.catalogue.namespace, 'catalogue_revision': self.engine.catalogue.revision, 'file_events': self.engine.catalogue.events, 'app_version': APP_VERSION, 'window_size_probe': True, 'shared_spectra_pca': True, 'component_workers': True, 'reciprocal_peak_edit_radii': True, 'overlap_maps': True, 'overlap_preview': True, 'image_relative_overlap': True, 'independent_overlap_spacing': True, 'batch_png_views': True, 'overlap_max_windows': overlap_maps.MAX_WINDOWS, 'manual_diffraction_peaks': True, 'batch_grids': True, 'batch_overlap_maps': True, 'batch_folder_summaries': True, 'fft_auto_geometry': True, 'diffraction_workers': True, 'diffraction_workers_default': min(2, worker_limit()), 'diffraction_workers_max': min(16, os.cpu_count() or 1), 'parallel_grid': True, 'grid_workers_default': worker_count(), 'grid_workers_max': worker_limit(), 'acquisition_map': True, 'acquisition_comparison': True, 'demo_download': True, 'demo_job': self.demo_download.status(), 'token': self.token, 'data_root': str(self.engine.data_root),
                'output_root': self.config['output_root'], 'app_root': str(self.root),
                'project_path': str(self.project.path), 'folder_picker': True, 'source_name_autosave': True, 'saved_regions': True,
                'delete_regions': True, 'fft_detection_controls': True, 'fft_auto_strength': True, 'fft_detector_view': True, 'diffraction_processed_view': True, 'sidecar_previews': True, 'preview_job': self.preview_status(),
                'files': files, 'default_file': self.config.get('default_file'),
                'engine': self.engine.version[:12], 'phases': list(PHASES), 'phase_selection': True, 'adjustable_fitting_band': True, 'adjustable_inner_limit': True,
                'material_presets': MATERIAL_PRESETS,
                'template_count': len(self.engine.templates), 'fcc_reference': True, 'scale_modes': ['fixed', 'auto_uniform', 'auto_hcp_ac', 'auto_hcp_ratio'],
                'fft_reconstruction': True, 'crop_exports': True, 'spectrum_exports': True, 'map_exports': True, 'spectrum_export_fps': 30, 'spectrum_export_max_frames': SPECTRUM_MAX_FRAMES, 'region_previews': True, 'live_spectrum_previews': True, 'fft_log16': True, 'fft_processing': True, 'fft_tukey': True, 'direct_diffraction': 'direct-spots-v2', 'diffraction_translation': 'shared-center-v1', 'phase_comparison': 'shared-evidence-v1',
                'scale_penalty': True, 'grid_rescore': True, 'grid_zones': True, 'grid_job': self.grid_summary(), 'overlap_rim_sampling': True, 'overlap_passing_strength': True,
                'peak_evidence': peak_evidence.VERSION, 'separate_peak_penalties': True, 'double_diffraction_scoring': True, 'brightness_grouping': True, 'fft_brightness_grouping': True, 'omega_positional_falloff': True, 'peak_evidence_falloff': True, 'check_passing': True, 'refinement_policy': adaptive_refinement.VERSION, 'bundled_demo': demo_data.ID}

    def set_folders(self, data, output):
        with self.lock, self.job_lock:
            if self.batch.running():
                raise ValueError('Finish or cancel batch grids before changing folders.')
            if self.preview_batch and self.preview_status()['state'] == 'running':
                raise ValueError('Finish or cancel PNG preview generation before changing folders.')
            if any(j['state'] == 'running' for j in self.jobs.values()):
                raise ValueError('Finish or cancel the running grid before changing folders.')
            saved = folder_paths.save_locations(self.config_path, self.root, self.config, data, output)
            self.config = folder_paths.resolve_config(saved, self.root)
            self.engine = Engine(self.config)
            self.jobs.clear()
            self.preview_batch = None
            LOG.info('Folders changed: data=%s; output=%s', self.config['data_root'], self.config['output_root'])
            return self.config_info()

    def start_window_probe(self, body):
        with self.lock, self.job_lock:
            if self.closing or self.batch.running() or (self.grid_thread and self.grid_thread.is_alive()):
                raise ValueError('Finish or cancel the grid or batch before checking window size.')
            if self.pca.running():
                raise ValueError('Finish or cancel PCA first.')
            if self.window_probe.running():
                raise ValueError('Finish or cancel the current window size check first.')
            item = self.engine.load(body['file_id'])
            _, settings = self.engine.validate(item, body['roi'], body.get('settings', {}))
            # Separate template/cache state; source pixels are read-only during analysis.
            engine = Engine(copy.deepcopy(self.config))
            snapshot = {**item, 'info': copy.deepcopy(item['info'])}
            return self.window_probe.start(engine, snapshot, settings, body['anchor_nm'], body['file_id'], body.get('smoothing_mode', 'physical'))

    def start_pca(self, body):
        with self.lock, self.job_lock:
            if self.closing or self.batch.running() or (self.grid_thread and self.grid_thread.is_alive()) or self.window_probe.running():
                raise ValueError('Finish or cancel the grid, batch or size check before PCA.')
            item = self.engine.load(body['file_id'])
            _, settings = self.engine.validate(item, body['roi'], body.get('settings', {}))
            snapshot = {**item, 'info': copy.deepcopy(item['info'])}
            options=body.get('options', {})
            fit_options=body.get('fit_options', {})
            viewer=dict(file_id=body['file_id'],roi=body['roi'],settings=settings,options=options,fit_options=fit_options)
            pipeline=dict(templates=self.engine.templates_for(settings),options=fit_options) if body.get('automatic') else None
            return self.pca.start(snapshot, settings, options, self.engine.output_for(body['file_id']),viewer,pipeline)

    def fit_nmf(self, body, support=False):
        with self.lock, self.job_lock:
            if self.closing or self.batch.running() or (self.grid_thread and self.grid_thread.is_alive()) or self.window_probe.running():
                raise ValueError('Finish or cancel other analysis before fitting components.')
            result=self.pca.completed(body['id'])
            templates=copy.deepcopy(self.engine.templates_for(result['settings']))
            return self.pca.support(body['id'],templates,workers=body.get('workers')) if support else self.pca.fit(body['id'],templates,body.get('options',{}))

    def preview_status(self):
        return self.preview_batch.status() if self.preview_batch else None

    def generate_previews(self):
        with self.lock:
            if self.preview_batch and self.preview_status()['state'] == 'running':
                return self.preview_status()
            engine = self.engine
            engine.catalog()
            def render(file_id):
                with self.lock:
                    return engine.file_preview(file_id)
            self.preview_batch = PreviewBatch({k:v for k,v in engine.files.items() if v.suffix.lower()=='.dm4'}, render, engine.data_root)
            self.preview_batch.start()
            return self.preview_status()

    def file_preview(self, file_id):
        with self.lock:
            if file_id in demo_data.DEMOS:
                return demo_data.preview_path(file_id).read_bytes()
            path = self.engine.files.get(file_id)
            if not path or not self.engine.allowed_path(path):
                raise ValueError('That image has no sidecar preview.')
            if path.suffix.lower() != '.dm4':
                return self.engine.file_preview(file_id)
            preview = sidecar_path(path)
            if not self.engine.allowed_path(preview):
                raise ValueError('Preview must be inside the data folder.')
            return preview.read_bytes()

    def saved_region(self, region_id):
        region = next((r for r in self.project.read()['regions'] if r['id'] == region_id), None)
        if region is None:
            raise ValueError('That saved region is unavailable.')
        with self.lock:
            item = self.engine.load(region['source']['id'])
            source = region['source']
            current = item['info']
            identity = ('sha256_pixels', 'width', 'height', 'pixel_x_nm', 'pixel_y_nm', 'pixel_x_nm_inv', 'pixel_y_nm_inv')
            if source.get('image_kind', 'real_space') != current.get('image_kind', 'real_space'):
                raise ValueError('The image type differs from the saved analysis.')
            if any(source.get(k) != current.get(k) for k in identity):
                raise ValueError('This image or its calibration differs from the saved region. The saved coordinates have not been applied.')
            self.engine.validate(item, region['roi'], region['settings'])
        LOG.info('Reopened saved region %s on %s', region['name'], source['name'])
        return {**region, 'source': {**source, **current}}

    def store_region(self, body):
        with self.lock:
            item = self.engine.load(body['file_id'])
            if body.get('source_hash') != item['info']['sha256_pixels']:
                raise ValueError('The source image changed. Reopen it before saving this region.')
            roi, settings = self.engine.validate(item, body['roi'], body.get('settings', {}))
            saved = self.project.save_region(body, item['info'], roi, settings)
        LOG.info('Saved region %s on %s', saved['region']['name'], item['info']['name'])
        return saved

    def delete_region(self, body):
        deleted = self.project.delete_region(body)
        LOG.info('Saved region deleted: %s (%s)', deleted['region']['name'], deleted['region']['id'])
        return deleted

    def grid(self, item, settings, count, adaptive, minimum, check_passing=False, workers=0, batch=False, engine=None, overlap=None):
        requested_workers = workers
        workers = worker_count(workers)
        settings = copy.deepcopy(settings)
        engine = engine or self.engine  # Snapshot even if the open image changes.
        if getattr(self, 'pca', None) and self.pca.running():
            raise ValueError('Finish or cancel PCA first.')
        if getattr(self, 'window_probe', None) and self.window_probe.running():
            raise ValueError('Finish or cancel the window size check first.')
        if not batch and getattr(self, 'batch', None) and self.batch.running():
            raise ValueError('Finish or cancel batch grids first.')
        if item['info'].get('image_kind') == 'diffraction':
            raise ValueError('A detector diffraction pattern is not a real-space phase map. Use whole-pattern analysis with exclusions.')
        if min(.5/item['info']['pixel_x_nm'], .5/item['info']['pixel_y_nm']) < settings.get('g_max', 10.):
            raise ValueError('This image does not sample the full phase-fitting band.')
        samples, overlap_options = overlap_maps.sampling(item['info'], overlap) if overlap is not None else (None, None)
        if samples is not None:
            adaptive = check_passing = False
        if samples is None and item['info']['width'] != item['info']['height']:
            raise ValueError('Automatic grids currently require a square source image.')
        if count not in range(2, 25) or not np.isfinite(minimum) or minimum <= 0:
            raise ValueError('Use a grid of 2–24 per side and a positive stopping limit in nm.')
        bounds = np.round(np.linspace(0, item['info']['width'], count+1)).astype(int)
        if samples is None and np.diff(bounds).min() < 32:
            raise ValueError('Grid regions would be smaller than 32 pixels.')
        check_passing = bool(adaptive and check_passing)
        job = {'id': uuid.uuid4().hex, 'state': 'running', 'source': item['info'], '_batch': batch,
               'settings': settings.copy(), 'initial_settings': settings.copy(), 'grid': {'count': count, 'adaptive': adaptive, 'minimum_nm': minimum,
                                             'check_passing': check_passing,
                                             'refinement_policy': adaptive_refinement.VERSION if check_passing else 'unresolved_or_multiple_patterns' if adaptive else 'uniform'},
               'lookahead': {'checked': 0, 'refined': 0, 'retained': 0},
               'regions': [], 'active_windows': [], 'processed': 0, 'pending': count*count, 'error': None, 'cancel': False,
               'execution': {'backend': 'processes', 'workers': workers, 'requested_workers': requested_workers, 'elapsed_seconds': 0.}}
        if samples is not None:
            job['grid'] = overlap_options
            job['pending'] = len(samples)
        with self.job_lock:
            if self.closing or any(j['state'] == 'running' for j in self.jobs.values()) or (self.grid_thread is not None and self.grid_thread.is_alive()):
                raise ValueError('Cancel or finish the current grid first.')
            self.jobs = {job['id']: job}

        if samples is not None:
            LOG.info('Overlapping map: %s windows; %s centres; %s passes; window %.3g nm, spacing %.3g nm', len(samples), overlap_options['layout'], overlap_options['passes'], overlap_options['window_nm'], overlap_options['spacing_nm'])
        LOG.info("Grid %s started: %s; %s×%s; adaptive=%s; stop=%.3g nm; workers=%s", job["id"][:8], item["info"].get("name", "image"), count, count, adaptive, minimum, workers)

        def work():
            started = progress_at = waiting_at = time.monotonic()
            pool = None
            in_flight = deque()
            queue = deque(({'x': int(bounds[c]), 'y': int(bounds[r]), 'w': int(bounds[c+1]-bounds[c]), 'h': int(bounds[r+1]-bounds[r])}, 0, None, None) for r in range(count) for c in range(count))
            if samples is not None:
                queue = deque((s['roi'], 0, None, None) for s in samples)
            probes = {}

            def plan(region):
                roi = region['roi']; halfx, halfy = roi['w']//2, roi['h']//2
                can_split = min(halfx, halfy) >= 32 and min(halfx*item['info']['pixel_x_nm'], halfy*item['info']['pixel_y_nm']) >= minimum
                mixed = region['periodicity'].get('substantial_second_pattern', False)
                label = region['classification']['label']
                unresolved = label in {'unresolved', 'insufficient', 'ambiguous'}
                multiple = label in {'coexisting_candidates', 'multiple_orientations'}
                needs_split = mixed or unresolved or multiple
                review_pass = check_passing and label in adaptive_refinement.PASSING and not needs_split
                if not adaptive:
                    region['stop_reason'] = 'Fixed overlapping window.' if samples is not None else 'Uniform grid.'
                    return
                if not can_split:
                    region['stop_reason'] = 'Further subdivision would fall below the stopping size or 32 pixels.'
                    return
                if not (needs_split or review_pass):
                    region['stop_reason'] = 'Supported phase candidate with no substantial second periodic pattern.'
                    return
                probe_id = region['id']
                probes[probe_id] = {'parent': region, 'children': [], 'review': review_pass}
                if review_pass:
                    region['lookahead'] = {'state': 'checking', 'version': adaptive_refinement.VERSION}
                    region['stop_reason'] = 'Checking four children; parent remains on the map.'
                else:
                    region['stop_reason'] = 'Preparing subdivision: ' + ('no resolved phase assignment.' if unresolved else 'two candidate structures or orientations.' if multiple else 'substantial second periodic pattern.')
                for dy, hh in [(0, halfy), (halfy, roi['h']-halfy)]:
                    for dx, ww in [(0, halfx), (halfx, roi['w']-halfx)]:
                        queue.append(({'x': roi['x']+dx, 'y': roi['y']+dy, 'w': ww, 'h': hh}, region['depth']+1, region['id'], probe_id))

            try:
                LOG.info('Grid analysis settings: %s', settings)
                pool = RegionPool(item, settings, engine.settings, engine.version, workers)
                while (queue or in_flight) and not job['cancel']:
                    # Submit only a bounded window; commit in submission order.
                    # This preserves serial breadth-first IDs, tie order and splits.
                    while queue and len(in_flight) < workers and not job['cancel']:
                        task = queue.popleft()
                        if not in_flight and not job['processed']:
                            LOG.info('Grid: submitting first region %s', task[0])
                        in_flight.append((task, pool.submit(task[0])))
                    if job['cancel']:
                        break
                    states = pool.diagnostics() if hasattr(pool, 'diagnostics') else []
                    # Only workers actually analysing, not queued work or completed
                    # futures awaiting their deterministic commit order.
                    unfinished = [task[0] for task, f in in_flight if not f.done()]
                    active = [dict(s['detail']) for s in states
                              if s['stage'] == 'analyzing' and s['detail'] in unfinished]
                    with self.job_lock:
                        job['active_windows'] = active
                        job['pending'] = len(queue) + len(in_flight)
                        job['execution']['elapsed_seconds'] = round(time.monotonic()-started, 2)
                    (roi, depth, parent, probe_id), future = in_flight[0]
                    try:
                        result = future.result(timeout=.1)
                    except TimeoutError:
                        states = pool.diagnostics() if hasattr(pool, 'diagnostics') else []
                        with self.job_lock:
                            job['execution']['worker_states'] = states
                            job['execution']['status'] = ('Analyzing regions' if any(s['stage'] in {'analyzing','completed'} for s in states) else 'Starting workers')
                        if time.monotonic()-waiting_at >= GRID_WAIT_LOG_SECONDS:
                            logging.getLogger('tem_workbench.grid_diagnostics').warning(
                                'Grid waiting: %.1f s elapsed; %s regions committed; %s later results ready; workers=%s',
                                time.monotonic()-started, job['processed'], sum(f.done() for _, f in list(in_flight)[1:]), states or 'no worker initialization received')
                            waiting_at = time.monotonic()
                        continue
                    if hasattr(pool, "diagnostics"):
                        pool.diagnostics()
                    in_flight.popleft()
                    if job['cancel']:
                        break
                    with self.job_lock:
                        result.update({'id': str(len(job['regions'])), 'depth': depth, 'parent': parent,
                                       'leaf': probe_id is None, 'trial_only': probe_id is not None})
                        if samples is not None:
                            result['pass_id'] = samples[len(job['regions'])]['pass_id']
                            if samples[len(job['regions'])].get('rim'):
                                result['rim'] = True
                        job['regions'].append(result)
                        job['processed'] += 1
                        if probe_id is not None:
                            group = probes[probe_id]; group['children'].append(result)
                            result['stop_reason'] = 'Trial child; parent retained pending comparison.'
                            if len(group['children']) == 4 and not job['cancel']:
                                decision = (adaptive_refinement.review(group['parent'], group['children'], engine)
                                            if group['review'] else {'retain_children': True, 'reason': 'Unresolved or multiple-pattern parent.', 'state': 'complete'})
                                owner = group['parent']
                                retain = decision['retain_children']
                                if group['review']:
                                    owner['lookahead'] = decision
                                    job['lookahead']['checked'] += 1
                                    job['lookahead']['refined' if retain else 'retained'] += 1
                                owner['leaf'] = not retain
                                owner['stop_reason'] = ('Subdivided: ' if retain else 'Parent retained: ') + decision['reason']
                                for child in group['children']:
                                    child.update(leaf=retain, trial_only=not retain)
                                    if retain:
                                        plan(child)
                                    else:
                                        child['stop_reason'] = 'Trial only; parent retained after child comparison.'
                                del probes[probe_id]
                        elif not job['cancel']:
                            plan(result)
                        else:
                            result['stop_reason'] = 'Cancelled after this region; no further refinement.'
                        job['pending'] = len(queue) + len(in_flight)
                    if time.monotonic()-progress_at >= 5:
                        LOG.info('Grid %s: %s regions analysed; %s pending', job['id'][:8], job['processed'], job['pending'])
                        progress_at = time.monotonic()
            except CancelledError:
                job['cancel'] = True
            except Exception as exc:
                with self.job_lock:
                    job['error'] = str(exc)
                LOG.exception('Grid analysis failed')
            finally:
                with self.job_lock:
                    job['active_windows'] = []
                if pool is not None:
                    try:
                        pool.close()
                    except Exception as exc:
                        job['error'] = job['error'] or str(exc)
                        LOG.exception('Grid worker cleanup failed')
                with self.job_lock:
                    for group in probes.values():
                        if group['review']:
                            group['parent']['lookahead'].update(state='incomplete', children_checked=len(group['children']))
                        group['parent']['stop_reason'] = 'Parent retained: child checks were interrupted.'
                        for child in group['children']:
                            child['stop_reason'] = 'Trial only; incomplete child checks.'
                    if samples is not None:
                        try:
                            job['aggregation'] = overlap_maps.aggregate(job)
                        except Exception as exc:
                            job['error'] = str(exc)
                            LOG.exception('Overlap map aggregation failed')
                    job['execution']['status'] = ''
                    job['execution']['elapsed_seconds'] = round(time.monotonic()-started, 2)
                    job['state'] = 'error' if job['error'] else 'cancelled' if job['cancel'] else 'complete'
                    LOG.info('Grid %s %s: %s analysed; %s map regions', job['id'][:8], job['state'], job['processed'], sum(r['leaf'] for r in job['regions']))
        with self.job_lock:
            self.grid_thread = threading.Thread(target=work, daemon=True, name='tem-grid')
            self.grid_thread.start()
        return {'id': job['id']}

    def cancel_grid(self, job_id):
        with self.job_lock:
            if job_id not in self.jobs:
                raise ValueError('This grid is no longer in memory.')
            self.jobs[job_id]['cancel'] = True

    def close(self):
        if getattr(self, 'pca', None):
            self.pca.cancel.set()
        if getattr(self, 'watch_stop', None):
            self.watch_stop.set()
        if getattr(self, 'window_probe', None):
            self.window_probe.cancel.set()
        if getattr(self, 'batch', None):
            self.batch.cancel_run()
        with self.job_lock:
            self.closing = True
            for job in self.jobs.values():
                job['cancel'] = True
        if self.grid_thread is not None:
            self.grid_thread.join()
        if getattr(self, 'pca', None) and self.pca.thread:
            self.pca.thread.join()
        if getattr(self, 'batch', None) and self.batch.thread:
            self.batch.thread.join()

    @staticmethod
    def best_zones(region):
        return phase_support.best_zones(region, PHASES)

    def grid_summary(self):
        """Reconnect a page to the latest interactive job without copying its fits."""
        with self.job_lock:
            job = next((j for j in self.jobs.values() if not j.get('_batch')), None)
            if job is None:
                return None
            return copy.deepcopy({key: job[key] for key in
                                  ('id', 'state', 'source', 'settings', 'grid', 'execution')})

    def status(self, job_id, full=False):
        with self.job_lock:
            job = self.jobs.get(job_id)
            if not job:
                raise ValueError('This grid is no longer in memory.')
            result = {k: v for k, v in job.items() if k not in ['cancel', 'regions'] and not k.startswith('_')}
            result['cancelling'] = bool(job['cancel'] and job['state'] == 'running')
            regions = list(job['regions'])
            result['can_rescore'] = (job['state'] != 'running' and
                                     all('_fit_cache' in r for r in regions))
            result['regions'] = ([{k: v for k, v in r.items() if not k.startswith('_')} for r in regions] if full else
                                 [{'id': r['id'], 'roi': r['roi'], 'label': r['classification']['label'],
                                   'leaf': r['leaf'], 'depth': r['depth'], 'elapsed_ms': r['elapsed_ms'],
                                   'best_zones': self.best_zones(r), 'linked_support': phase_support.linked_summary(r), 'pass_id': r.get('pass_id'), 'rim': r.get('rim', False)} for r in regions])
            return result

    def rescore(self, job_id, strength, evidence_weight=None, ca_penalty_strength=None, half_weight_nm_inv=None, missing_weight=None, brightness_weight=None, dd_weight=None):
        strength = float(strength)
        if not np.isfinite(strength) or not 0 <= strength <= .5:
            raise ValueError('Scale penalty must be between 0 and 0.5.')
        with self.job_lock:
            job = self.jobs.get(job_id)
            if not job:
                raise ValueError('This grid is no longer in memory.')
            if job['state'] == 'running':
                raise ValueError('Finish or cancel the grid before adjusting its penalty.')
            if job['settings'].get('material') == 'unknown':
                strength = 0.
            missing_weight = peak_evidence.missing_weight(job['settings']) if missing_weight is None else peak_evidence.validate_missing_weight(missing_weight)
            dd_weight = double_diffraction.validate_weight(job['settings'].get('double_diffraction_weight', 0.) if dd_weight is None else dd_weight)
            brightness_weight = brightness_grouping.validate_weight(job['settings'].get('brightness_grouping_weight', brightness_grouping.DEFAULT_WEIGHT) if brightness_weight is None else brightness_weight)
            evidence_weight = float(job['settings'].get('peak_evidence_weight', .10) if evidence_weight is None else evidence_weight)
            if not np.isfinite(evidence_weight) or not 0 <= evidence_weight <= .5:
                raise ValueError('Weak-peak bonus weight must be between 0 and 0.5.')
            ca_penalty_strength = float(job['settings'].get('ca_penalty_strength', .10) if ca_penalty_strength is None else ca_penalty_strength)
            if not np.isfinite(ca_penalty_strength) or not 0 <= ca_penalty_strength <= .5:
                raise ValueError('c/a penalty must be between 0 and 0.5.')
            half_weight_nm_inv = float(job['settings'].get('peak_evidence_half_weight_nm_inv', 0.) if half_weight_nm_inv is None else half_weight_nm_inv)
            if not np.isfinite(half_weight_nm_inv) or not 0 <= half_weight_nm_inv <= 30:
                raise ValueError('Missing-peak half-weight radius must be between 0 and 30 nm⁻¹.')
            token = job['_rescore_token'] = object()
            snapshot, engine = dict(job), self.engine

        def check_current():
            # Also called before publishing: a source change or newer request
            # must not restore a discarded job or overwrite newer weights.
            with self.job_lock:
                if self.jobs.get(job_id) is not job:
                    raise ValueError('This grid is no longer in memory.')
                if job.get('_rescore_token') is not token:
                    raise ValueError('A newer map update has replaced this request.')

        started = time.perf_counter()
        try:
            # Do the expensive work outside the shared job lock so navigation,
            # progress/status and another grid remain responsive during updates.
            # Build a replacement before publishing, so a failure cannot leave
            # half the map at the new penalty. Parent/child boundaries stay fixed.
            regions = []
            for region in snapshot['regions']:
                check_current()
                regions.append(engine.rescore(region, strength, evidence_weight, ca_penalty_strength, half_weight_nm_inv, missing_weight, brightness_weight, dd_weight))
            updated = dict(regions=regions, settings={**snapshot['settings'], 'scale_penalty_strength': strength, 'peak_evidence_weight': evidence_weight, 'missing_peak_weight': missing_weight, 'double_diffraction_weight': dd_weight, 'brightness_grouping_weight': brightness_weight, 'ca_penalty_strength': ca_penalty_strength, 'peak_evidence_half_weight_nm_inv': half_weight_nm_inv})
            check_current()
            if snapshot['grid'].get('mode') == 'overlap':
                updated['aggregation'] = overlap_maps.aggregate({**snapshot, **updated})
            updated['rescore'] = dict(strength=strength, ca_penalty_strength=ca_penalty_strength,
                peak_evidence_weight=evidence_weight, missing_peak_weight=missing_weight, double_diffraction_weight=dd_weight,
                brightness_grouping_weight=brightness_weight, peak_evidence_half_weight_nm_inv=half_weight_nm_inv,
                elapsed_ms=round((time.perf_counter()-started)*1000, 1), region_count=len(regions),
                reused_fits=True, boundaries_unchanged=True, at=datetime.now().astimezone().isoformat())
            with self.job_lock:
                check_current()
                job.update(updated)
                LOG.info('Grid %s reweighted: scale penalty %.3f; weak bonus %.3f; missing penalty %.3f', job_id[:8], strength, evidence_weight, missing_weight)
                return self.status(job_id)
        finally:
            with self.job_lock:
                if job.get('_rescore_token') is token:
                    job.pop('_rescore_token')

    def reconstruct_fft(self, body):
        with self.lock:
            item = self.engine.load(body['file_id'])
            roi, settings = self.engine.validate(item, body['roi'], body.get('settings', {}))
            output = self.engine.output_for(body['file_id'])
        info = item['info']
        processing = {k: settings[k] for k in ('fft_window', 'fft_tukey_alpha', 'remove_mean')}
        masks = fft_reconstruction.validate_masks(body.get('masks', {}))
        # One full-resolution complex FFT is cached; serialize large temporary arrays.
        key = (id(item['array']), json.dumps(roi,sort_keys=True), json.dumps(processing,sort_keys=True), info.get('pixel_x_nm'), info.get('pixel_y_nm'))
        with self.ifft_lock:
            if self.ifft_cache is None or self.ifft_cache[0] != key:
                z, coefficients = fft_reconstruction.prepare(item['array'], roi, info, processing)
                self.ifft_cache = (key, item['array'], z, coefficients, {})
            _, _, z, coefficients, display_cache = self.ifft_cache
            sx,sy=info['pixel_x_nm'],info['pixel_y_nm']
            if body.get('export') is not True:
                display_key=(settings['g_max'],settings['fft_smoothing_sigma'])
                if display_cache.get('key') != display_key:
                    power,signal,extent=fft_reconstruction.spectrum_view(coefficients,sx,sy,*display_key)
                    display_cache.clear()
                    display_cache.update(key=display_key,images=spectrum_images(power,signal),extent=extent)
                images,extent=display_cache['images'],display_cache['extent']
                if body.get('preview_only') is True:
                    return dict(input=data_url(png(z,max_size=720)),fft=images['fft'],images=images,extent=extent)
            filtered, transfer, imaginary = fft_reconstruction.reconstruct(coefficients,sx,sy,masks)
            limits = [float(v) for v in np.percentile(filtered,[.3,99.7])]
            recipe = dict(schema='tem-workbench-ifft',version=fft_reconstruction.VERSION,app_version=APP_VERSION,
                          engine_version=getattr(self.engine,'version',None),source=info,roi=roi,
                          processing=processing,masks=masks,pixel_size_nm=[sx,sy],
                          display_limits=limits,imaginary_residual_max=imaginary,
                          note='Real part of inverse FFT of masked complex coefficients. Input window/fade retained; no dewindowing. Not a phase identification.')
            if body.get('export') is True:
                output.mkdir(parents=True,exist_ok=True)
                stem=datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')+'_'+safe_name(info['name'])+'_ifft_'+uuid.uuid4().hex[:6]
                target=output/stem
                with Path(str(target)+'.png').open('xb') as f: f.write(png(filtered,limits))
                with Path(str(target)+'.npz').open('xb') as f:
                    np.savez_compressed(f,reconstruction=filtered,transfer_mask=transfer,recipe_json=json.dumps(recipe))
                with Path(str(target)+'.json').open('x') as f: json.dump(recipe,f,indent=2)
                LOG.info('Exported inverse FFT: %s',target)
                return dict(path=str(Path(str(target)+'.png')),paths=[str(Path(str(target)+ext)) for ext in ('.png','.npz','.json')])
            return dict(input=data_url(png(z,max_size=720)),image=data_url(png(filtered,limits,max_size=720)),
                        fft=images['fft'],images=images,extent=extent,recipe=recipe,
                        rms=float(np.sqrt(np.mean(filtered.astype('float64')**2))))

    def export_crop(self, body):
        with self.lock:
            item = self.engine.load(body['file_id'])
            roi = dict(body['roi'])
            raw = self.engine.region_preview(item, roi, max_size=None)
            name = safe_name(item['info']['name'])
            output = self.engine.output_for(body['file_id'])
        stamp = datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')
        location = f"x{roi['x']}_y{roi['y']}_{roi['w']}x{roi['h']}"
        output.mkdir(parents=True, exist_ok=True)
        target = output / f'{stamp}_{name}_real_space_{location}_{uuid.uuid4().hex[:6]}.png'
        with target.open('xb') as destination:
            destination.write(raw)
        LOG.info('Exported real-space crop: %s', target)
        return {'path': str(target)}

    def export_spectrum(self, body):
        format_name = body.get('format')
        frames = body.get('frames')
        if format_name not in ('png', 'gif') or not isinstance(frames, list) or not frames or len(frames) > SPECTRUM_MAX_FRAMES:
            raise ValueError(f'Choose PNG or GIF with at most {SPECTRUM_MAX_FRAMES} frames.')
        if format_name == 'png' and len(frames) != 1:
            raise ValueError('PNG exports contain one frame.')
        duration = body.get('duration_ms', 60)
        if isinstance(duration, list):
            if len(duration) != len(frames):
                raise ValueError('Provide one duration for each frame.')
            duration = [int(value) for value in duration]
        else:
            duration = int(duration)
        if any(not 20 <= value <= 1000 for value in (duration if isinstance(duration, list) else [duration])):
            raise ValueError('Frame duration is outside the supported range.')
        with self.lock:
            file_id = body['file_id']
            if file_id in demo_data.DEMOS:
                name = demo_data.DEMOS[file_id]['name']
            elif file_id in self.engine.files:
                name = self.engine.files[file_id].stem
            else:
                raise ValueError('The exported image is no longer in the current collection.')
            output = self.engine.output_for(body['file_id'])
        images = []
        gif_palette = None
        previous_pixels = None
        total_pixels = 0
        for frame in frames:
            if not isinstance(frame, str) or not frame.startswith('data:image/png;base64,'):
                raise ValueError('Expected PNG image frames.')
            raw = base64.b64decode(frame.split(',', 1)[1], validate=True)
            with Image.open(BytesIO(raw)) as image:
                if image.format != 'PNG' or max(image.size) > 3200 or min(image.size) < 1:
                    raise ValueError('Export frames must be PNG images up to 3200 pixels per side.')
                total_pixels += image.width * image.height
                if total_pixels > SPECTRUM_MAX_PIXELS or (images and image.size != images[0].size):
                    raise ValueError('Export frames must have matching dimensions within the size limit.')
                rgb = image.convert('RGB')
                if format_name == 'gif':
                    if gif_palette is None:
                        # Reserve index 255 for unchanged pixels. Duplicate colour
                        # zero there so palette quantization cannot add a new colour.
                        colours = rgb.quantize(colors=255, method=Image.Quantize.FASTOCTREE).getpalette()[:765]
                        gif_palette = Image.new('P', (1, 1))
                        gif_palette.putpalette(colours + colours[:3])
                    # Quantize every frame the same way, including the first, so
                    # identical background pixels remain identical palette indices.
                    pixels = np.array(rgb.quantize(palette=gif_palette, dither=Image.Dither.NONE))
                    pixels[pixels == 255] = 0
                    delta = pixels.copy()
                    if previous_pixels is not None:
                        delta[pixels == previous_pixels] = 255
                    indexed = Image.fromarray(delta)
                    indexed.putpalette(gif_palette.getpalette())
                    images.append(indexed)
                    previous_pixels = pixels
                else:
                    images.append(rgb)
        safe_name = ''.join(c if c.isalnum() or c in '-_.' else '_' for c in name)[:120]
        kind = {'diffraction': 'diffraction', 'real_space_map': 'map'}.get(body.get('image_kind'), 'fft')
        stamp = datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')
        output.mkdir(parents=True, exist_ok=True)
        target = output / f'{stamp}_{safe_name}_{kind}_{uuid.uuid4().hex[:6]}.{format_name}'
        with target.open('xb') as destination:
            if format_name == 'gif':
                images[0].save(destination, format='GIF', save_all=True, append_images=images[1:],
                               duration=duration, loop=0, disposal=1, transparency=255, optimize=False)
            else:
                images[0].save(destination, format='PNG')
        LOG.info('Exported %s view: %s', kind, target)
        return {'path': str(target)}

    def save(self, body):
        # A folder change must not redirect an export partway through analysis.
        with self.lock:
            return self._save(body)

    def _save(self, body):
        if body.get('job_id'):
            if self.jobs.get(body['job_id'], {}).get('state') == 'running':
                raise ValueError('Finish or cancel the grid before saving.')
            result = self.status(body['job_id'], full=True)
            kind = 'overlap_map' if result['grid'].get('mode') == 'overlap' else 'grid'
        else:
            with self.lock:
                item = self.engine.load(body['file_id'])
                result = {'source': item['info'], 'result': self.engine.analyze(item, body['roi'], body.get('settings', {}), images=False)}
            kind = 'diffraction' if item['info'].get('image_kind') == 'diffraction' else 'region'
        output = self.engine.output_for(result['source']['id'])
        output.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')
        target = output/f"{stamp}_{safe_name(result['source']['name'])}_{kind}_{uuid.uuid4().hex[:6]}.json"
        result['saved_at'] = datetime.now().astimezone().isoformat()
        result['engine_sha256'] = self.engine.version
        result['limits'] = json.loads((ROOT/'engine_provenance.json').read_text())['limits']
        with target.open('x') as f:
            json.dump(result, f, indent=2, allow_nan=False)
        LOG.info('Exported %s results: %s', kind, target)
        return {'path': str(target)}


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, content, mime='application/json', status=200):
            if not isinstance(content, bytes):
                content = json.dumps(content, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def check_origin(self):
            hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            if self.headers.get('Host') not in hosts:
                raise ValueError('Local requests only.')
            origin = self.headers.get('Origin')
            if origin and origin not in {f'http://{h}' for h in hosts}:
                raise ValueError('Open the workbench from its local address.')

        def do_GET(self):
            try:
                self.check_origin()
                url=urlparse(self.path); query=parse_qs(url.query)
                if url.path == '/api/config':
                    with app.lock:
                        self.send(app.config_info())
                elif url.path == '/api/catalogue':
                    with app.lock:
                        self.send(app.catalogue_status())
                elif url.path == '/api/raster-preview':
                    with app.lock:
                        preview = app.engine.raster_preview(query['id'][0])
                    self.send(preview, 'image/png')
                elif url.path == '/api/raster-info':
                    with app.lock:
                        self.send(app.engine.raster_info(query['id'][0]))
                elif url.path == '/api/regions':
                    self.send(app.project.read())
                elif url.path == '/api/demo-pack':
                    self.send(app.demo_download.status())
                elif url.path == '/api/batch-image':
                    self.send(app.batch.preview(query['id'][0]), 'image/png')
                elif url.path == '/api/previews':
                    self.send(app.preview_status())
                elif url.path == '/api/acquisition-map':
                    with app.lock:
                        data = app.engine.acquisition_locations(query['id'][0])
                    self.send(data)
                elif url.path == '/api/acquisition-crop':
                    with app.lock:
                        preview = app.engine.acquisition_reference_crop(query['id'][0], {k: query[k][0] for k in ('x', 'y', 'w', 'h')})
                    self.send(preview, 'image/png')
                elif url.path == '/api/acquisition-preview':
                    with app.lock:
                        file_id = query['id'][0]
                        if file_id in demo_data.DEMOS:
                            preview = app.file_preview(file_id)
                        else:
                            preview = app.engine.file_preview(file_id)
                    self.send(preview, 'image/png')
                elif url.path == '/api/file-preview':
                    self.send(app.file_preview(query['id'][0]), 'image/png')
                elif url.path == '/api/batch':
                    self.send(app.batch.status())
                elif url.path == '/api/pca':
                    self.send(app.pca.status(query['id'][0]))
                elif url.path == '/api/pca/current':
                    self.send(app.pca.current())
                elif url.path == '/api/pca/live':
                    self.send(app.pca.live(query['id'][0],int(query.get('revision',[-1])[0]),int(query.get('windows',[0])[0]),query.get('generation',[''])[0]))
                elif url.path == '/api/pca/result':
                    self.send(shared_spectra.summary(app.pca.inspectable(query['id'][0])))
                elif url.path == '/api/window-size':
                    self.send(app.window_probe.status(query['id'][0]))
                elif url.path == '/api/job':
                    self.send(app.status(query['id'][0]))
                elif url.path == '/api/region-preview':
                    with app.lock:
                        item=app.engine.loaded.get(query['id'][0])
                        if item is None:
                            raise ValueError('That source is no longer open.')
                        preview=app.engine.region_preview(item, {k:query[k][0] for k in ('x','y','w','h')})
                    self.send(preview, 'image/png')
                elif url.path == '/api/preview':
                    with app.lock:
                        item=app.engine.load(query['id'][0])
                        preview=app.engine.native_preview(item) if query.get('native') == ['1'] else item['preview']
                    self.send(preview, 'image/png')
                else:
                    path = {'/': ROOT/'web/index.html', '/app.js': ROOT/'web/app.js', '/region-selection.js': ROOT/'web/region-selection.js', '/fft-masking.js': ROOT/'web/fft-masking.js', '/live-preview.js': ROOT/'web/live-preview.js', '/style.css': ROOT/'web/style.css', '/acquisition-map.js': ROOT/'web/acquisition-map.js', '/window-size.js': ROOT/'web/window-size.js', '/shared-spectra.js': ROOT/'web/shared-spectra.js', '/phase-blend.js': ROOT/'web/phase-blend.js', '/beta-omega.js': ROOT/'web/beta-omega.js', '/double-diffraction.js': ROOT/'web/double-diffraction.js'}.get(url.path)
                    if not path:
                        self.send({'error':'Not found'}, status=404); return
                    self.send(path.read_bytes(), mimetypes.guess_type(path.name)[0] or 'text/plain')
            except Exception as exc:
                LOG.warning('Request %s failed: %s', self.path.split('?')[0], exc,
                            exc_info=isinstance(exc, OSError))
                self.send({'error': str(exc)}, status=400)

        def do_POST(self):
            try:
                self.check_origin()
                if self.headers.get('X-TEM-Token') != app.token:
                    self.send({'error': 'Reload the workbench to reconnect.'}, status=403); return
                size=int(self.headers.get('Content-Length', 0))
                limit = 256*1024*1024 if self.path == '/api/export-spectrum' else 65536
                if size <= 0 or size > limit or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Expected a small JSON request.')
                body=json.loads(self.rfile.read(size))
                if self.path == '/api/browse-folders':
                    self.send(folder_paths.browse(body.get('path'), app.root))
                elif self.path == '/api/sources':
                    self.send(app.set_sources(body['sources'], body['output_root']))
                elif self.path == '/api/sources/rename':
                    self.send(app.rename_source(body['source_id'], body['name']))
                elif self.path == '/api/refresh-files':
                    with app.lock:
                        if app.batch.running() or (app.grid_thread and app.grid_thread.is_alive()) or app.window_probe.running() or app.pca.running():
                            raise ValueError('Finish or cancel analysis before refreshing sources.')
                        app.engine.catalog()
                        self.send(app.catalogue_status())
                elif self.path == '/api/folders':
                    self.send(app.set_folders(body['data_root'], body['output_root']))
                elif self.path == '/api/demo-pack':
                    self.send(app.demo_download.start(body['url']))
                elif self.path == '/api/demo-pack/cancel':
                    app.demo_download.cancel.set()
                    self.send(app.demo_download.status())
                elif self.path == '/api/previews':
                    self.send(app.generate_previews())
                elif self.path == '/api/previews/cancel':
                    if app.preview_batch:
                        app.preview_batch.cancel.set()
                    self.send(app.preview_status())
                elif self.path == '/api/regions/save':
                    self.send(app.store_region(body))
                elif self.path == '/api/regions/delete':
                    self.send(app.delete_region(body))
                elif self.path == '/api/regions/open':
                    self.send(app.saved_region(body['id']))
                elif self.path == '/api/raster-calibration':
                    with app.lock:
                        self.send(app.engine.calibrate_raster(body['file_id'], body))
                elif self.path == '/api/pca':
                    self.send(app.start_pca(body))
                elif self.path == '/api/pca/fit':
                    self.send(app.fit_nmf(body))
                elif self.path == '/api/pca/support':
                    self.send(app.fit_nmf(body,support=True))
                elif self.path == '/api/pca/map':
                    self.send(app.pca.stability_map(body['id'],body.get('options',{})))
                elif self.path == '/api/pca/group-preview':
                    from nmf_fitting import group_preview
                    self.send(group_preview(app.pca.inspectable(body['id']), body['components']))
                elif self.path == '/api/pca/group':
                    from nmf_fitting import group_detail
                    result=app.pca.inspectable(body['id'])
                    with app.lock:
                        templates=copy.deepcopy(app.engine.templates_for(result['settings']))
                    self.send(group_detail(result,body['components'],templates,body.get('options',{})))
                elif self.path == '/api/pca/lobe':
                    from pca_fitting import lobe_detail
                    result=app.pca.inspectable(body['id'])
                    with app.lock:
                        templates=copy.deepcopy(app.engine.templates_for(result['settings']))
                    self.send(lobe_detail(result,body['component'],body['side'],templates,body.get('options',{})))
                elif self.path == '/api/pca/window-fit':
                    from pca_fitting import window_detail
                    self.send(window_detail(app.pca.inspectable(body['id']),body['index'],body['model']))
                elif self.path == '/api/pca/combination':
                    from pca_fitting import combination_detail
                    result=app.pca.inspectable(body['id'])
                    with app.lock:
                        templates=copy.deepcopy(app.engine.templates_for(result['settings']))
                    self.send(combination_detail(result,body['components'],body['index'],templates,body.get('options',{})))
                elif self.path == '/api/pca/cancel':
                    with app.pca.lock:
                        app.pca.status(body['id'])
                        app.pca.cancel.set()
                    self.send({'cancelled': True})
                elif self.path == '/api/pca/sample':
                    self.send(shared_spectra.sample(app.pca.inspectable(body['id']), body['index'], body['components']))
                elif self.path == '/api/pca/export':
                    with app.pca.lock:
                        result = app.pca.completed(body['id'])
                        folder = app.pca.folder
                    self.send(shared_spectra.export(result, folder))
                elif self.path == '/api/window-size':
                    self.send(app.start_window_probe(body))
                elif self.path == '/api/window-size/cancel':
                    app.window_probe.status(body['id'])
                    app.window_probe.cancel.set()
                    self.send({'cancelled': True})
                elif self.path == '/api/open':
                    with app.lock:
                        item=app.engine.load(body['file_id'])
                    LOG.info('Opened image: %s (%s×%s)', item['info']['name'], item['info']['width'], item['info']['height'])
                    self.send(item['info'])
                elif self.path == '/api/spectrum-preview':
                    with app.lock:
                        engine = app.engine
                        item = engine.loaded.get(body['file_id'])
                        if item is None:
                            raise ValueError('That source is no longer open.')
                    self.send(engine.spectrum_preview(item, body['roi'], body.get('settings', {})))
                elif self.path == '/api/analyze':
                    item, result = app.analyze_interactive(body)
                    if time.monotonic()-app.last_preview_log >= 1:
                        app.last_preview_log = time.monotonic()
                        if result.get('image_kind') == 'diffraction':
                            d=result['settings']['diffraction']
                            cx, cy = result['spectrum']['beam_center_px']
                            shift = result['spectrum']['center_refinement']
                            LOG.info('Diffraction %s: centre %.2f,%.2f px; translation %s (%+.2f,%+.2f px); %s profiles; %s exclusions; %s; %.0f ms', item['info']['name'], cx, cy, shift['status'], *shift['shift_px'], len(result['spectrum']['peaks']), len(d['masks']), result['classification']['label'], result['elapsed_ms'])
                        else:
                            LOG.info('Region %s at %s,%s (%s px): %s; %.0f ms', item['info']['name'], result['roi']['x'], result['roi']['y'], result['roi']['w'], result['classification']['label'], result['elapsed_ms'])
                    self.send(result)
                elif self.path == '/api/diffraction/snap':
                    # Loaded detector arrays are immutable. Retain a local reference so a
                    # small snap search need not wait for the long analysis lock. A cache
                    # miss still uses the lock; switching sources cannot invalidate item.
                    item = app.engine.loaded.get(body['file_id'])
                    if item is None:
                        with app.lock:
                            item = app.engine.load(body['file_id'])
                    if item['info']['image_kind'] != 'diffraction':
                        raise ValueError('Peak editing currently applies to diffraction only.')
                    d=diffraction.validate(item['info'], body.get('diffraction', {}))
                    gmax=float(body.get('g_max',10))
                    if not 4<=gmax<=30:raise ValueError('Invalid fitting limit.')
                    d['g_max']=gmax
                    self.send(diffraction.snap_peak(item['array'],d,float(body['x']),float(body['y']),float(body.get('radius_px',50)),radius_nm_inv=body.get('radius_nm_inv')))
                elif self.path == '/api/batch/preview':
                    cutoff=float(body.get('cutoff',400000))
                    if not 0<=cutoff<=100000000:raise ValueError('Invalid magnification cutoff.')
                    with app.lock:
                        self.send({'files':[eligibility(row,cutoff,body.get('inclusive',True)) for row in app.engine.catalog()]})
                elif self.path == '/api/batch/start':
                    self.send(app.batch.start(body))
                elif self.path == '/api/batch/cancel':
                    app.batch.cancel_run()
                    self.send(app.batch.status())
                elif self.path == '/api/overlap-preview':
                    with app.lock:
                        item = app.engine.load(body['file_id'])
                        if item['info']['image_kind'] == 'diffraction':
                            raise ValueError('Overlapping maps require a real-space image.')
                        samples, options = overlap_maps.sampling(item['info'], body.get('overlap'))
                    self.send({'samples': samples, 'grid': options})
                elif self.path == '/api/grid':
                    with app.lock:
                        item=app.engine.load(body['file_id'])
                        _, settings=app.engine.validate(item, body['roi'], body.get('settings', {}))
                        started = app.grid(item, settings, int(body.get('count', 20)), bool(body.get('adaptive', True)), float(body.get('minimum_nm', 5)), bool(body.get('check_passing', False)), body.get('workers', 0), overlap=body.get('overlap'))
                    self.send(started)
                elif self.path == '/api/rescore-grid':
                    self.send(app.rescore(body['job_id'], body['scale_penalty_strength'], body.get('peak_evidence_weight'), body.get('ca_penalty_strength'), body.get('peak_evidence_half_weight_nm_inv'), body.get('missing_peak_weight'), body.get('brightness_grouping_weight'), body.get('double_diffraction_weight')))
                elif self.path == '/api/cancel':
                    app.cancel_grid(body['job_id'])
                    LOG.info('Grid %s cancellation requested', body['job_id'][:8])
                    self.send({'ok':True})
                elif self.path == '/api/ifft':
                    self.send(app.reconstruct_fft(body))
                elif self.path == '/api/export-crop':
                    self.send(app.export_crop(body))
                elif self.path == '/api/export-spectrum':
                    self.send(app.export_spectrum(body))
                elif self.path == '/api/save':
                    self.send(app.save(body))
                else:
                    self.send({'error':'Not found'}, status=404)
            except (ValueError, KeyError, TypeError) as exc:
                LOG.warning('Request %s failed: %s', self.path, exc)
                self.send({'error': str(exc)}, status=400)
            except Exception as exc:
                LOG.exception('Request %s failed: %s', self.path.split('?')[0], exc)
                self.send({'error': str(exc)}, status=500)
    return Handler


def log_runtime_info():
    """Startup diagnostics without importing optional readers or dumping config secrets."""
    LOG.info('Starting TEM Workbench')
    LOG.info('Python: %s (%s)', platform.python_version(), platform.python_implementation())
    LOG.info('Python executable: %s', sys.executable)
    LOG.info('Environment: %s; base: %s; virtual environment: %s',
             sys.prefix, sys.base_prefix, sys.prefix != sys.base_prefix)
    LOG.info('Platform: %s %s; architecture: %s; logical CPUs: %s; PID: %s',
             platform.system(), platform.release(), platform.machine(), os.cpu_count(), os.getpid())
    versions = []
    for package in ('numpy', 'scipy', 'Pillow', 'h5py', 'ncempy'):
        try:
            version = metadata.version(package)
        except metadata.PackageNotFoundError:
            version = 'not installed'
        versions.append(f'{package} {version}')
    LOG.info('Dependencies: %s', '; '.join(versions))
    LOG.info('Application folder: %s', ROOT)
    LOG.info('Parallel defaults: grid %s workers; diffraction smoothing %s threads; '
             'maximum %s workers; numeric-library thread limit 1 per process',
             worker_count(), min(2, worker_limit()), worker_limit())


def main(argv=None, desktop_ready=None):
    logging.basicConfig(level=logging.INFO, format='%(asctime)s · %(levelname)s · %(message)s', datefmt='%H:%M:%S')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, help='Optional settings for external TEM data')
    parser.add_argument('--demo', action='store_true', help='Use only installed demo images, without local data settings')
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--fallback-port', action='store_true', help='Use the next free local port if the default is occupied')
    args=parser.parse_args(argv)
    started = time.perf_counter()
    log_runtime_info()
    LOG.info('Application version: %s', APP_VERSION)
    # Native launchers use terminate; allow orderly worker/mmap cleanup on POSIX.
    if hasattr(signal, 'SIGTERM'):
        def stop_backend(*_):
            raise SystemExit(0)
        signal.signal(signal.SIGTERM, stop_backend)
    config_path = args.config or ROOT/'.tem-paths.json'
    if args.config and not config_path.is_file() and not args.demo:
        parser.error('The specified configuration file does not exist.')
    config = demo_config(demo_only=args.demo) if args.demo or not config_path.is_file() else json.loads(config_path.read_text())
    LOG.info('Configuration: %s', 'demo-only defaults' if args.demo else
             str(config_path) if config_path.is_file() else f'defaults ({config_path} absent)')
    app=Workbench(config, config_path=config_path)
    LOG.info('Data folder: %s', app.engine.data_root)
    LOG.info('Output folder: %s', app.config['output_root'])
    LOG.info('Project state: %s', app.project.path)
    LOG.info('Analysis engine: %s; templates: %s; catalogued images: %s',
             app.engine.version[:12], len(app.engine.templates), len(app.engine.catalog()))
    ports = range(args.port, min(args.port+20, 65536)) if args.fallback_port and args.port else [args.port]
    server = None
    for port in ports:
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), make_handler(app))
            break
        except OSError as exc:
            if exc.errno != errno.EADDRINUSE or not args.fallback_port:
                raise
    if server is None:
        parser.error('No free local port in the supported range.')
    url=f'http://127.0.0.1:{server.server_port}/'
    print(f'TEM Workbench: {url}', flush=True)
    print(f'Data: {app.engine.data_root}', flush=True)
    if desktop_ready:
        desktop_ready(server, url)
    if os.environ.get('TEM_DESKTOP_READY_FILE') and os.environ.get('TEM_DESKTOP_NONCE'):
        from workbench_updates import write_json
        write_json(Path(os.environ['TEM_DESKTOP_READY_FILE']),
                   {'nonce': os.environ['TEM_DESKTOP_NONCE'], 'url': url, 'pid': os.getpid()})
    LOG.info('Ready: %s (startup %.2f s)', url, time.perf_counter() - started)
    app.watch_sources()
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.close()
        LOG.info('TEM Workbench stopped')
        server.server_close()


if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    main()
