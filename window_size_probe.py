"""Bounded, advisory window-size check; never starts a map or changes settings."""
import copy
import logging
import math
import statistics
import threading
import time
import uuid
from concurrent.futures import CancelledError

LOG = logging.getLogger('tem_workbench')
PERCENTAGES = (5., 7.5, 10., 15.)
SITES = ((.25, .25), (.75, .25), (.5, .5), (.25, .75), (.75, .75))
VERSION = 'window-size-v1'


def plan(info, settings, anchor_nm, smoothing_mode='physical'):
    if smoothing_mode not in ('physical', 'bins'):
        raise ValueError('Choose fixed reciprocal-width or fixed-bin smoothing.')
    if info.get('image_kind') == 'diffraction':
        raise ValueError('Window size checks are for real-space images.')
    w, h = info['width'], info['height']
    sx, sy = info['pixel_x_nm'], info['pixel_y_nm']
    if abs(sx / sy - 1) > 1e-4:
        raise ValueError('Window size checks currently require equal X/Y pixel calibration.')
    anchor_nm = float(anchor_nm)
    if not math.isfinite(anchor_nm) or anchor_nm <= 0:
        raise ValueError('Choose a positive starting window width.')
    if min(.5 / sx, .5 / sy) < settings['g_max']:
        raise ValueError('This image does not sample the full fitting band.')
    # Anchor the physical smoothing width to the current grid window (or ROI).
    anchor_px = max(32, min(min(w, h), round(anchor_nm / sx)))
    sigma_q = settings['fft_smoothing_sigma'] / (anchor_px * min(sx, sy))
    rows, seen = [], set()
    for percent in PERCENTAGES:
        n = round(min(w, h) * percent / 100)
        sigma = sigma_q * n * min(sx, sy) if smoothing_mode == 'physical' else settings['fft_smoothing_sigma']
        reason = 'Below 32 pixels' if n < 32 else 'Smoothing would exceed 3 bins' if sigma > 3 + 1e-9 else 'Same pixel size as another trial' if n in seen else None
        seen.add(n)
        rows.append(dict(percent=percent, pixels=n, width_nm=n*sx, sigma_bins=min(3., sigma),
                         skip=reason, samples=[], rois=[dict(x=round(fx*w-n/2), y=round(fy*h-n/2), w=n, h=n) for fx, fy in SITES]))
    if sum(r['skip'] is None for r in rows) < 2:
        raise ValueError('Fewer than two test sizes are usable. Reduce smoothing or use a larger source image.')
    return rows, sigma_q, anchor_px*sx


def compact(result):
    models = [dict(phase=m['phase'], zone=m['zone_3index'], mirror=m.get('mirror'),
                   rotation=m['rotation_deg'], rank=m['score'], rms=m['rms_nm_inv'])
              for m in result['models'] if m['valid']]
    models.sort(key=lambda m: -m['rank'])
    return dict(models=models, dual=bool(result['periodicity'].get('substantial_second_pattern')),
                label=result['classification']['label'], profiles=len(result['spectrum']['peaks']))


def same_fit(a, b):
    return (a['phase'] == b['phase'] and a['zone'] == b['zone'] and a['mirror'] == b['mirror']
            and abs((a['rotation']-b['rotation']+90) % 180-90) <= 5)


def summarize(rows):
    """Paired spatial comparisons: no requirement that different sites agree.

    Four of five sites must retain a passing winner at adjacent sizes. Losing
    secondary geometry only counts as resolution when the smaller winner also
    matches a passing larger-window candidate. These are explicit heuristics,
    not calibrated confidence limits or proof of single-phase material.
    """
    edges, resolved = [], []
    for r in rows:
        samples = r['samples']
        leaders = [s['models'][0] for s in samples if s['models']]
        r.update(passing=len(leaders), dual=sum(s['dual'] for s in samples),
                 median_rank=statistics.median(m['rank'] for m in leaders) if leaders else None,
                 median_rms=statistics.median(m['rms'] for m in leaders) if leaders else None,
                 stable_sites=None, resolved_sites=0)
    for i in range(len(rows)-1):
        small, large = rows[i:i+2]
        if small['skip'] or large['skip'] or len(small['samples']) != 5 or len(large['samples']) != 5:
            continue
        stable = 0
        resolved_here = 0
        new_dual = False
        for a, b in zip(small['samples'], large['samples']):
            compatible = bool(a['models'] and b['models'] and same_fit(a['models'][0], b['models'][0]))
            resolves = bool(b['dual'] and not a['dual'] and a['models'] and any(same_fit(a['models'][0], m) for m in b['models']))
            stable += compatible or resolves
            resolved_here += resolves
            new_dual |= a['dual'] and not b['dual']
        small['stable_sites'] = stable
        small['resolved_sites'] = resolved_here
        if stable >= 4:
            edges.append(i)
            if resolved_here and not new_dual and small['dual'] < large['dual']:
                resolved.append(i)
    if not edges:
        return dict(small=None, large=None, message='No stable size range found. Inspect the trial results; no size was applied.')
    # Prefer a contiguous stable range whose upper edge resolves mixed geometry.
    # Do not recommend larger mixing windows as the measurement alternative.
    if resolved:
        upper = min(resolved)
        lower = upper
        while lower-1 in edges:
            lower -= 1
        return dict(small=lower, large=upper,
                    message='Smaller windows reduce supported dual geometry while retaining a consistent passing fit. Inspect the boundaries before mapping.')
    # Longest stable run, ties favour the smaller mapping range.
    runs = []
    for i in edges:
        if not runs or i != runs[-1][-1]+1:
            runs.append([i])
        else:
            runs[-1].append(i)
    run = max(runs, key=len)
    lower, upper = run[0], run[-1]+1
    message = 'Stable tested range: use the smaller size for localisation, larger for reciprocal-space resolution.'
    if any(rows[i]['dual'] for i in range(lower, upper+1)):
        message += ' Dual geometry persists; a single global size may not separate the patterns.'
    return dict(small=lower, large=upper, message=message)


class WindowSizeProbe:
    def __init__(self):
        self.lock = threading.RLock()
        self.thread = None
        self.cancel = threading.Event()
        self.job = None

    def running(self):
        return bool(self.thread and self.thread.is_alive())

    def status(self, job_id):
        with self.lock:
            if not self.job or self.job['id'] != job_id:
                raise ValueError('This size check is no longer in memory.')
            result = copy.deepcopy(self.job)
            started = result.pop('_started')
            result['elapsed_seconds'] = result.pop('_elapsed', round(time.monotonic()-started, 1))
            return result

    def start(self, engine, item, settings, anchor_nm, file_id, smoothing_mode='physical'):
        with self.lock:
            if self.running():
                raise ValueError('Finish or cancel the current window size check first.')
            rows, sigma_q, anchor_nm = plan(item['info'], settings, anchor_nm, smoothing_mode)
            self.cancel = threading.Event()
            self.job = dict(id=uuid.uuid4().hex, version=VERSION, file_id=file_id,
                            state='running', completed=0, total=5*sum(r['skip'] is None for r in rows),
                            rows=rows, settings=copy.deepcopy(settings), anchor_nm=anchor_nm,
                            sigma_nm_inv=sigma_q, smoothing_mode=smoothing_mode, recommendation=None, error=None, _started=time.monotonic())
            self.thread = threading.Thread(target=self._run, args=(engine, item), daemon=True, name='tem-window-size')
            self.thread.start()
            return self.status(self.job['id'])

    def _run(self, engine, item):
        job = self.job
        LOG.info('Window size check %s: %s; %s trials', job['id'][:8], job['file_id'], job['total'])
        try:
            for row in job['rows']:
                if row['skip']:
                    continue
                settings = {**job['settings'], 'fft_smoothing_sigma': row['sigma_bins']}
                for roi in row['rois']:
                    if self.cancel.is_set():
                        raise CancelledError()
                    result = engine.analyze(item, roi, settings, images=False, cancel_event=self.cancel)
                    if self.cancel.is_set():
                        raise CancelledError()
                    with self.lock:
                        row['samples'].append(compact(result))
                        job['completed'] += 1
            with self.lock:
                job['recommendation'] = summarize(job['rows'])
                job['state'] = 'complete'
        except CancelledError:
            with self.lock:
                job['state'] = 'cancelled'
        except Exception as exc:
            LOG.exception('Window size check failed')
            with self.lock:
                job.update(state='error', error=str(exc))
        finally:
            with self.lock:
                job['_elapsed'] = round(time.monotonic()-job['_started'], 1)
            LOG.info('Window size check %s %s: %s/%s trials', job['id'][:8], job['state'], job['completed'], job['total'])
