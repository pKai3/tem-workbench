"""Local-only TEM workbench. Start with: python server.py --open"""
from pathlib import Path
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from datetime import datetime
import argparse
import errno
import json
import logging
import mimetypes
import time
import secrets
import threading
import traceback
import uuid
import webbrowser
import numpy as np
from engine import Engine
import demo_data
import adaptive_refinement
import folder_paths
from workbench_project import Project

ROOT = Path(__file__).resolve().parent
LOG = logging.getLogger('tem_workbench')


def demo_config(demo_only=False):
    """The bundled demo is always available alongside locally chosen folders."""
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
        self.jobs = {}
        self.job_lock = threading.RLock()
        self.engine.catalog()


    def config_info(self):
        return {'token': self.token, 'data_root': str(self.engine.data_root),
                'output_root': self.config['output_root'], 'app_root': str(self.root),
                'project_path': str(self.project.path), 'folder_picker': True, 'saved_regions': True,
                'files': self.engine.catalog(), 'default_file': self.config.get('default_file'),
                'engine': self.engine.version[:12], 'scale_modes': ['fixed', 'auto_uniform', 'auto_hcp_ac'],
                'fft_log16': True, 'fft_processing': True, 'phase_comparison': 'shared-evidence-v1',
                'scale_penalty': True, 'grid_rescore': True, 'grid_zones': True,
                'peak_evidence': 'local-maxima-v1', 'check_passing': True, 'refinement_policy': adaptive_refinement.VERSION, 'bundled_demo': demo_data.ID}

    def set_folders(self, data, output):
        with self.lock, self.job_lock:
            if any(j['state'] == 'running' for j in self.jobs.values()):
                raise ValueError('Finish or cancel the running grid before changing folders.')
            saved = folder_paths.save_locations(self.config_path, self.root, self.config, data, output)
            self.config = folder_paths.resolve_config(saved, self.root)
            self.engine = Engine(self.config)
            self.jobs.clear()
            LOG.info('Folders changed: data=%s; output=%s', self.config['data_root'], self.config['output_root'])
            return self.config_info()

    def saved_region(self, region_id):
        region = next((r for r in self.project.read()['regions'] if r['id'] == region_id), None)
        if region is None:
            raise ValueError('That saved region is unavailable.')
        with self.lock:
            item = self.engine.load(region['source']['id'])
            source = region['source']
            current = item['info']
            identity = ('sha256_pixels', 'width', 'height', 'pixel_x_nm', 'pixel_y_nm')
            if any(source.get(k) != current.get(k) for k in identity):
                raise ValueError('This image or its calibration differs from the saved region. The saved coordinates have not been applied.')
            self.engine.validate(item, region['roi'], region['settings'])
        LOG.info('Reopened saved region %s on %s', region['name'], source['name'])
        return region

    def store_region(self, body):
        with self.lock:
            item = self.engine.load(body['file_id'])
            if body.get('source_hash') != item['info']['sha256_pixels']:
                raise ValueError('The source image changed. Reopen it before saving this region.')
            roi, settings = self.engine.validate(item, body['roi'], body.get('settings', {}))
            saved = self.project.save_region(body, item['info'], roi, settings)
        LOG.info('Saved region %s on %s', saved['region']['name'], item['info']['name'])
        return saved

    def grid(self, item, settings, count, adaptive, minimum, check_passing=False):
        if not item['info']['can_index']:
            raise ValueError('This image does not sample the full phase-fitting band.')
        if item['info']['width'] != item['info']['height']:
            raise ValueError('Automatic grids currently require a square source image.')
        if count not in range(2, 25) or not np.isfinite(minimum) or minimum <= 0:
            raise ValueError('Use a grid of 2–24 per side and a positive stopping limit in nm.')
        bounds = np.round(np.linspace(0, item['info']['width'], count+1)).astype(int)
        if np.diff(bounds).min() < 32:
            raise ValueError('Grid regions would be smaller than 32 pixels.')
        check_passing = bool(adaptive and check_passing)
        job = {'id': uuid.uuid4().hex, 'state': 'running', 'source': item['info'],
               'settings': settings.copy(), 'initial_settings': settings.copy(), 'grid': {'count': count, 'adaptive': adaptive, 'minimum_nm': minimum,
                                             'check_passing': check_passing,
                                             'refinement_policy': adaptive_refinement.VERSION if check_passing else 'unresolved_or_multiple_patterns' if adaptive else 'uniform'},
               'lookahead': {'checked': 0, 'refined': 0, 'retained': 0},
               'regions': [], 'processed': 0, 'pending': count*count, 'error': None, 'cancel': False}
        with self.job_lock:
            if any(j['state'] == 'running' and not j['cancel'] for j in self.jobs.values()):
                raise ValueError('Cancel or finish the current grid first.')
            self.jobs = {job['id']: job}

        LOG.info("Grid %s started: %s; %s×%s; adaptive=%s; stop=%.3g nm", job["id"][:8], item["info"].get("name", "image"), count, count, adaptive, minimum)

        def work():
            progress_at = time.monotonic()
            queue = deque(({'x': int(bounds[c]), 'y': int(bounds[r]), 'w': int(bounds[c+1]-bounds[c]), 'h': int(bounds[r+1]-bounds[r])}, 0, None, None) for r in range(count) for c in range(count))
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
                    region['stop_reason'] = 'Uniform grid.'
                    return
                if not can_split:
                    region['stop_reason'] = 'Further subdivision would fall below the stopping size or 32 pixels.'
                    return
                if not (needs_split or review_pass):
                    region['stop_reason'] = 'Supported phase candidate with no substantial second periodic pattern.'
                    return
                probe_id = region['id'] if review_pass else None
                if review_pass:
                    probes[probe_id] = {'parent': region, 'children': []}
                    region['lookahead'] = {'state': 'checking', 'version': adaptive_refinement.VERSION}
                    region['stop_reason'] = 'Checking four children; parent remains on the map.'
                else:
                    region['leaf'] = False
                    region['stop_reason'] = 'Subdivided: ' + ('no resolved phase assignment.' if unresolved else 'two candidate structures or orientations.' if multiple else 'substantial second periodic pattern.')
                for dy, hh in [(0, halfy), (halfy, roi['h']-halfy)]:
                    for dx, ww in [(0, halfx), (halfx, roi['w']-halfx)]:
                        queue.append(({'x': roi['x']+dx, 'y': roi['y']+dy, 'w': ww, 'h': hh}, region['depth']+1, region['id'], probe_id))

            try:
                while queue and not job['cancel']:
                    roi, depth, parent, probe_id = queue.popleft()
                    with self.lock:
                        result = self.engine.analyze(item, roi, settings, images=False, cache_candidates=True)
                    with self.job_lock:
                        result.update({'id': str(len(job['regions'])), 'depth': depth, 'parent': parent,
                                       'leaf': probe_id is None, 'trial_only': probe_id is not None})
                        job['regions'].append(result)
                        job['processed'] += 1
                        if probe_id is not None:
                            group = probes[probe_id]; group['children'].append(result)
                            result['stop_reason'] = 'Trial child; parent retained pending comparison.'
                            if len(group['children']) == 4 and not job['cancel']:
                                decision = adaptive_refinement.review(group['parent'], group['children'], self.engine)
                                owner = group['parent']; owner['lookahead'] = decision
                                job['lookahead']['checked'] += 1
                                retain = decision['retain_children']
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
                        job['pending'] = len(queue)
                    if time.monotonic()-progress_at >= 5:
                        LOG.info('Grid %s: %s regions analysed; %s pending', job['id'][:8], job['processed'], job['pending'])
                        progress_at = time.monotonic()
            except Exception as exc:
                with self.job_lock:
                    job['error'] = str(exc)
                traceback.print_exc()
            finally:
                with self.job_lock:
                    for group in probes.values():
                        group['parent']['lookahead'].update(state='incomplete', children_checked=len(group['children']))
                        group['parent']['stop_reason'] = 'Parent retained: child checks were interrupted.'
                        for child in group['children']:
                            child['stop_reason'] = 'Trial only; incomplete child checks.'
                    job['state'] = 'error' if job['error'] else 'cancelled' if job['cancel'] else 'complete'
                    LOG.info('Grid %s %s: %s analysed; %s map regions', job['id'][:8], job['state'], job['processed'], sum(r['leaf'] for r in job['regions']))
        threading.Thread(target=work, daemon=True).start()
        return {'id': job['id']}

    @staticmethod
    def best_zones(region):
        zones = {}
        for phase in ('HCP', 'BCC'):
            options = [m for m in region['models'] if m['phase'] == phase]
            model = next((m for m in options if m['valid']), options[0] if options else None)
            if model:
                zones[phase] = {key: model[key] for key in ('phase', 'zone_3index', 'valid', 'score', 'coverage')}
        return zones

    def status(self, job_id, full=False):
        with self.job_lock:
            job = self.jobs.get(job_id)
            if not job:
                raise ValueError('This grid is no longer in memory.')
            result = {k: v for k, v in job.items() if k not in ['cancel', 'regions']}
            regions = list(job['regions'])
            result['can_rescore'] = (job['state'] != 'running' and
                                     all('_fit_cache' in r for r in regions))
            result['regions'] = ([{k: v for k, v in r.items() if not k.startswith('_')} for r in regions] if full else
                                 [{'id': r['id'], 'roi': r['roi'], 'label': r['classification']['label'],
                                   'leaf': r['leaf'], 'depth': r['depth'], 'elapsed_ms': r['elapsed_ms'],
                                   'best_zones': self.best_zones(r)} for r in regions])
            return result

    def rescore(self, job_id, strength, evidence_weight=None):
        strength = float(strength)
        if not np.isfinite(strength) or not 0 <= strength <= .5:
            raise ValueError('Scale penalty must be between 0 and 0.5.')
        with self.job_lock:
            job = self.jobs.get(job_id)
            if not job:
                raise ValueError('This grid is no longer in memory.')
            if job['state'] == 'running':
                raise ValueError('Finish or cancel the grid before adjusting its penalty.')
            evidence_weight = float(job['settings'].get('peak_evidence_weight', .10) if evidence_weight is None else evidence_weight)
            if not np.isfinite(evidence_weight) or not 0 <= evidence_weight <= .5:
                raise ValueError('Peak evidence weight must be between 0 and 0.5.')
            started = time.perf_counter()
            # Build a replacement before publishing, so a failure cannot leave
            # half the map at the new penalty. Parent/child boundaries stay fixed.
            regions = [self.engine.rescore(region, strength, evidence_weight) for region in job['regions']]
            job.update(regions=regions, settings={**job['settings'], 'scale_penalty_strength': strength, 'peak_evidence_weight': evidence_weight},
                       rescore={'strength': strength, 'peak_evidence_weight': evidence_weight, 'elapsed_ms': round((time.perf_counter()-started)*1000, 1),
                                'region_count': len(regions), 'reused_fits': True, 'boundaries_unchanged': True,
                                'at': datetime.now().astimezone().isoformat()})
            LOG.info('Grid %s reweighted: scale penalty %.3f; peak evidence %.3f', job_id[:8], strength, evidence_weight)
            return self.status(job_id)

    def save(self, body):
        # A folder change must not redirect an export partway through analysis.
        with self.lock:
            return self._save(body)

    def _save(self, body):
        if body.get('job_id'):
            if self.jobs.get(body['job_id'], {}).get('state') == 'running':
                raise ValueError('Finish or cancel the grid before saving.')
            result = self.status(body['job_id'], full=True)
            kind = 'grid'
        else:
            with self.lock:
                item = self.engine.load(body['file_id'])
                result = {'source': item['info'], 'result': self.engine.analyze(item, body['roi'], body.get('settings', {}), images=False)}
            kind = 'region'
        output = Path(self.config['output_root']).expanduser().resolve()
        output.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')
        target = output/f'{stamp}_{kind}_{uuid.uuid4().hex[:6]}.json'
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
                elif url.path == '/api/regions':
                    self.send(app.project.read())
                elif url.path == '/api/job':
                    self.send(app.status(query['id'][0]))
                elif url.path == '/api/preview':
                    with app.lock:
                        item=app.engine.load(query['id'][0])
                    self.send(item['preview'], 'image/png')
                else:
                    path = {'/': ROOT/'web/index.html', '/app.js': ROOT/'web/app.js', '/style.css': ROOT/'web/style.css'}.get(url.path)
                    if not path:
                        self.send({'error':'Not found'}, status=404); return
                    self.send(path.read_bytes(), mimetypes.guess_type(path.name)[0] or 'text/plain')
            except Exception as exc:
                LOG.warning('Request %s failed: %s', self.path.split('?')[0], exc)
                self.send({'error': str(exc)}, status=400)

        def do_POST(self):
            try:
                self.check_origin()
                if self.headers.get('X-TEM-Token') != app.token:
                    self.send({'error': 'Reload the workbench to reconnect.'}, status=403); return
                size=int(self.headers.get('Content-Length', 0))
                if size <= 0 or size > 65536 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Expected a small JSON request.')
                body=json.loads(self.rfile.read(size))
                if self.path == '/api/browse-folders':
                    self.send(folder_paths.browse(body.get('path'), app.root))
                elif self.path == '/api/folders':
                    self.send(app.set_folders(body['data_root'], body['output_root']))
                elif self.path == '/api/regions/save':
                    self.send(app.store_region(body))
                elif self.path == '/api/regions/open':
                    self.send(app.saved_region(body['id']))
                elif self.path == '/api/open':
                    with app.lock:
                        item=app.engine.load(body['file_id'])
                    LOG.info('Opened image: %s (%s×%s)', item['info']['name'], item['info']['width'], item['info']['height'])
                    self.send(item['info'])
                elif self.path == '/api/analyze':
                    with app.lock:
                        item=app.engine.load(body['file_id'])
                        result=app.engine.analyze(item, body['roi'], body.get('settings', {}))
                    if time.monotonic()-app.last_preview_log >= 1:
                        app.last_preview_log = time.monotonic()
                        LOG.info('Region %s at %s,%s (%s px): %s; %.0f ms', item['info']['name'], result['roi']['x'], result['roi']['y'], result['roi']['w'], result['classification']['label'], result['elapsed_ms'])
                    self.send(result)
                elif self.path == '/api/grid':
                    with app.lock:
                        item=app.engine.load(body['file_id'])
                        _, settings=app.engine.validate(item, body['roi'], body.get('settings', {}))
                        started = app.grid(item, settings, int(body.get('count', 20)), bool(body.get('adaptive', True)), float(body.get('minimum_nm', 5)), bool(body.get('check_passing', False)))
                    self.send(started)
                elif self.path == '/api/rescore-grid':
                    self.send(app.rescore(body['job_id'], body['scale_penalty_strength'], body.get('peak_evidence_weight')))
                elif self.path == '/api/cancel':
                    app.jobs[body['job_id']]['cancel']=True
                    LOG.info('Grid %s cancellation requested', body['job_id'][:8])
                    self.send({'ok':True})
                elif self.path == '/api/save':
                    self.send(app.save(body))
                else:
                    self.send({'error':'Not found'}, status=404)
            except (ValueError, KeyError, TypeError) as exc:
                LOG.warning('Request %s failed: %s', self.path, exc)
                self.send({'error': str(exc)}, status=400)
            except Exception as exc:
                traceback.print_exc()
                self.send({'error': str(exc)}, status=500)
    return Handler


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s · %(levelname)s · %(message)s', datefmt='%H:%M:%S')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, help='Optional settings for external TEM data')
    parser.add_argument('--demo', action='store_true', help='Use only the bundled ST1221 demo, without local data settings')
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--fallback-port', action='store_true', help='Use the next free local port if the default is occupied')
    args=parser.parse_args()
    config_path = args.config or ROOT/'.tem-paths.json'
    if args.config and not config_path.is_file() and not args.demo:
        parser.error('The specified configuration file does not exist.')
    config = demo_config(demo_only=args.demo) if args.demo or not config_path.is_file() else json.loads(config_path.read_text())
    app=Workbench(config, config_path=config_path)
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
    LOG.info('Output: %s; engine %s', app.config['output_root'], app.engine.version[:12])
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        LOG.info('TEM Workbench stopped')
        server.server_close()


if __name__ == '__main__':
    main()
