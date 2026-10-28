"""Local-only TEM workbench. Start with: python server.py --open"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from datetime import datetime
from zoneinfo import ZoneInfo
import argparse
import errno
import json
import mimetypes
import secrets
import threading
import traceback
import uuid
import webbrowser
import numpy as np
from engine import Engine

ROOT = Path(__file__).resolve().parent


class Workbench:
    def __init__(self, config):
        self.config = config
        self.engine = Engine(config)
        self.token = secrets.token_urlsafe(24)
        self.lock = threading.Lock()
        self.jobs = {}
        self.engine.catalog()

    def grid(self, item, settings, count, adaptive, minimum):
        if not item['info']['can_index']:
            raise ValueError('This image does not sample the full phase-fitting band.')
        if item['info']['width'] != item['info']['height']:
            raise ValueError('Automatic grids currently require a square source image.')
        if count not in range(2, 25) or not np.isfinite(minimum) or minimum <= 0:
            raise ValueError('Use a grid of 2–24 per side and a positive stopping limit in nm.')
        if any(j['state'] == 'running' for j in self.jobs.values()):
            raise ValueError('Cancel or finish the current grid first.')
        bounds = np.round(np.linspace(0, item['info']['width'], count+1)).astype(int)
        if np.diff(bounds).min() < 32:
            raise ValueError('Grid regions would be smaller than 32 pixels.')
        job = {'id': uuid.uuid4().hex, 'state': 'running', 'source': item['info'],
               'settings': settings, 'grid': {'count': count, 'adaptive': adaptive, 'minimum_nm': minimum,
                                             'refinement_policy': 'unresolved_or_multiple_patterns' if adaptive else 'uniform'},
               'regions': [], 'processed': 0, 'pending': count*count, 'error': None, 'cancel': False}
        self.jobs = {job['id']: job}

        def work():
            queue = [({'x': int(bounds[c]), 'y': int(bounds[r]), 'w': int(bounds[c+1]-bounds[c]), 'h': int(bounds[r+1]-bounds[r])}, 0, None) for r in range(count) for c in range(count)]
            try:
                while queue and not job['cancel']:
                    roi, depth, parent = queue.pop(0)
                    with self.lock:
                        result = self.engine.analyze(item, roi, settings, images=False)
                    result.update({'id': str(len(job['regions'])), 'depth': depth, 'parent': parent, 'leaf': True})
                    halfx, halfy = roi['w']//2, roi['h']//2
                    can_split = min(halfx, halfy) >= 32 and min(halfx*item['info']['pixel_x_nm'], halfy*item['info']['pixel_y_nm']) >= minimum
                    mixed = result['periodicity'].get('substantial_second_pattern', False)
                    unresolved = result['classification']['label'] in {'unresolved', 'insufficient', 'ambiguous'}
                    two_candidates = result['classification']['label'] == 'coexisting_candidates'
                    needs_split = mixed or unresolved or two_candidates
                    if adaptive and needs_split and can_split:
                        result['leaf'] = False
                        reasons = []
                        if unresolved:
                            reasons.append('no resolved phase assignment')
                        if two_candidates:
                            reasons.append('two candidate structures')
                        if mixed:
                            reasons.append('substantial second periodic pattern')
                        result['stop_reason'] = 'Subdivided: ' + '; '.join(reasons) + '.'
                        for dy, hh in [(0, halfy), (halfy, roi['h']-halfy)]:
                            for dx, ww in [(0, halfx), (halfx, roi['w']-halfx)]:
                                queue.append(({'x': roi['x']+dx, 'y': roi['y']+dy, 'w': ww, 'h': hh}, depth+1, result['id']))
                    else:
                        result['stop_reason'] = ('Uniform grid.' if not adaptive else 'Further subdivision would fall below the stopping size or 32 pixels.' if needs_split and not can_split else 'Supported phase candidate with no substantial second periodic pattern.')
                    job['regions'].append(result)
                    job['processed'] += 1
                    job['pending'] = len(queue)
                job['state'] = 'cancelled' if job['cancel'] else 'complete'
            except Exception as exc:
                job['error'] = str(exc)
                job['state'] = 'error'
                traceback.print_exc()
        threading.Thread(target=work, daemon=True).start()
        return {'id': job['id']}

    def status(self, job_id, full=False):
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError('This grid is no longer in memory.')
        result = {k: v for k, v in job.items() if k not in ['cancel', 'regions']}
        regions = list(job['regions'])
        result['regions'] = regions if full else [{'id': r['id'], 'roi': r['roi'], 'label': r['classification']['label'], 'leaf': r['leaf'], 'depth': r['depth'], 'elapsed_ms': r['elapsed_ms']} for r in regions]
        return result

    def save(self, body):
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
        if not output.is_relative_to(self.engine.data_root):
            raise ValueError('Set output_root inside the TEM data folder.')
        output.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(ZoneInfo('Australia/Brisbane')).strftime('%Y%m%d_%H%M%S')
        target = output/f'{stamp}_{kind}_{uuid.uuid4().hex[:6]}.json'
        result['saved_at'] = datetime.now(ZoneInfo('Australia/Brisbane')).isoformat()
        result['engine_sha256'] = self.engine.version
        result['limits'] = json.loads((ROOT/'engine_provenance.json').read_text())['limits']
        with target.open('x') as f:
            json.dump(result, f, indent=2, allow_nan=False)
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
                    self.send({'token': app.token, 'data_root': str(app.engine.data_root), 'output_root': app.config['output_root'], 'files': app.engine.catalog(), 'default_file': app.config.get('default_file'), 'engine': app.engine.version[:12], 'scale_modes': ['fixed', 'auto_uniform', 'auto_hcp_ac'], 'fft_log16': True})
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
                if self.path == '/api/open':
                    with app.lock:
                        item=app.engine.load(body['file_id'])
                    self.send(item['info'])
                elif self.path == '/api/analyze':
                    with app.lock:
                        item=app.engine.load(body['file_id'])
                        result=app.engine.analyze(item, body['roi'], body.get('settings', {}))
                    self.send(result)
                elif self.path == '/api/grid':
                    with app.lock:
                        item=app.engine.load(body['file_id'])
                        _, settings=app.engine.validate(item, body['roi'], body.get('settings', {}))
                    self.send(app.grid(item, settings, int(body.get('count', 20)), bool(body.get('adaptive', True)), float(body.get('minimum_nm', 5))))
                elif self.path == '/api/cancel':
                    app.jobs[body['job_id']]['cancel']=True
                    self.send({'ok':True})
                elif self.path == '/api/save':
                    self.send(app.save(body))
                else:
                    self.send({'error':'Not found'}, status=404)
            except (ValueError, KeyError, TypeError) as exc:
                self.send({'error': str(exc)}, status=400)
            except Exception as exc:
                traceback.print_exc()
                self.send({'error': str(exc)}, status=500)
    return Handler


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT/'.tem-paths.json')
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--fallback-port', action='store_true', help='Use the next free local port if the default is occupied')
    args=parser.parse_args()
    if not args.config.exists():
        parser.error('Create .tem-paths.json using tem-paths.example.json.')
    app=Workbench(json.loads(args.config.read_text()))
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
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
