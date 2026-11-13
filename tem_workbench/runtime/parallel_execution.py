"""Bounded analysis workers; source pixels are shared through a read-only mmap.

Spawn (never fork) works with the macOS and Windows launchers. Workers own their
Engine/caches; only compact ROIs/results cross the process boundary.
"""
from concurrent.futures import ProcessPoolExecutor, CancelledError
from pathlib import Path
import multiprocessing as mp
import os
import tempfile
import threading
import logging
import queue
import sys
import time
import traceback

LOG = logging.getLogger("tem_workbench.grid_diagnostics")


def configure_numeric_threads():
    # Prevent a process pool multiplying BLAS/OpenMP pools. Set before NumPy loads.
    for name in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS',
                 'VECLIB_MAXIMUM_THREADS', 'NUMEXPR_NUM_THREADS'):
        os.environ[name] = '1'


def worker_limit():
    return 16


def worker_count(requested=0):
    if isinstance(requested, bool) or not isinstance(requested, int) or not 0 <= requested <= 16:
        raise ValueError('Choose Auto or 1–16 grid workers.')
    return min(requested or min(4, max(1, (os.cpu_count() or 1)-1)), worker_limit())


def _watch_parent():
    # A Windows launcher may terminate the backend without Python finally blocks.
    # Do not leave analysis workers alive after their owning backend disappears.
    parent = mp.parent_process()
    if parent:
        parent.join()
        os._exit(0)


def _initialize(source, info, limits, config, settings, stop, version, events):
    global _events
    _events = events
    # Diagnostics must never keep a worker alive while its parent shuts down.
    events.cancel_join_thread()
    events.put((os.getpid(), 'initializing', None))
    try:
        _initialize_worker(source, info, limits, config, settings, stop, version)
    except BaseException:
        events.put((os.getpid(), 'initialization failed', traceback.format_exc()))
        raise


def _initialize_worker(source, info, limits, config, settings, stop, version):
    configure_numeric_threads()
    import numpy as np
    from tem_workbench.analysis import analysis_core
    from tem_workbench.app.engine import Engine
    global _engine, _item, _settings, _stop
    analysis_core.FFT_WORKERS = 1
    _events.put((os.getpid(), 'building engine', None))
    _engine = Engine(config)
    if _engine.version != version:
        raise RuntimeError('Analysis code changed while starting the grid. Restart the app and rerun.')
    _events.put((os.getpid(), 'opening shared image', None))
    pixels = np.load(source, mmap_mode='r', allow_pickle=False)
    _item = dict(array=pixels, info=info, limits=limits)
    _settings, _stop = settings, stop
    threading.Thread(target=_watch_parent, daemon=True).start()
    _events.put((os.getpid(), 'ready', {'python': sys.version.split()[0], 'executable': sys.executable, 'engine': version[:12]}))


def _analyze(roi):
    if _stop.is_set():
        raise CancelledError('Grid cancelled')
    _events.put((os.getpid(), 'analyzing', roi))
    try:
        result = _engine.analyze(_item, roi, _settings, images=False,
                                cache_candidates=True, cancel_event=_stop)
        _events.put((os.getpid(), 'completed', roi))
        return result
    except BaseException:
        _events.put((os.getpid(), 'analysis failed', traceback.format_exc()))
        raise


class RegionPool:
    """One bounded, explicitly owned pool per grid. Close before replacing it."""
    def __init__(self, item, settings, config, version, workers=0):
        self.workers = worker_count(workers)
        self.states = {}
        LOG.info('Grid pool startup: spawn; workers=%s; Python=%s; executable=%s', self.workers, sys.version.split()[0], sys.executable)
        # Keep multiprocessing's default: the same interpreter as the backend.
        # Switching a running venv from python.exe to pythonw.exe can change its
        # Windows/Conda startup behaviour and hides worker startup diagnostics.
        self.context = mp.get_context('spawn')
        self.stop = self.context.Event()
        self.events = self.context.Queue()
        self.directory = tempfile.TemporaryDirectory(prefix='tem-grid-')
        self.executor = None
        try:
            import numpy as np
            source = Path(self.directory.name)/'source.npy'
            LOG.info('Grid shared image: writing %s bytes; shape=%s; dtype=%s; temporary folder=%s', item['array'].nbytes, item['array'].shape, item['array'].dtype, self.directory.name)
            np.save(source, item['array'], allow_pickle=False)
            LOG.info('Grid shared image: ready; creating process pool')
            self.executor = ProcessPoolExecutor(max_workers=self.workers,
                mp_context=self.context, initializer=_initialize,
                initargs=(str(source), item['info'], item['limits'], config,
                          settings, self.stop, version, self.events))
            LOG.info("Grid process pool created; workers start when regions are submitted")
        except BaseException:
            self.directory.cleanup()
            self.events.close()
            self.events.join_thread()
            raise

    def diagnostics(self):
        while True:
            try:
                pid, stage, detail = self.events.get_nowait()
            except queue.Empty:
                break
            previous = self.states.get(pid)
            self.states[pid] = dict(pid=pid, stage=stage, detail=detail, since=time.monotonic())
            if stage not in {'analyzing', 'completed'} or not previous or previous['stage'] == 'ready':
                LOG.info('Grid worker %s: %s%s', pid, stage, ' '+str(detail) if detail is not None else '')
        return [dict(pid=s['pid'], stage=s['stage'], detail=s['detail'], seconds=round(time.monotonic()-s['since'], 1)) for s in self.states.values()]

    def submit(self, roi):
        return self.executor.submit(_analyze, roi)

    def cancel(self):
        LOG.info('Grid pool: cancellation requested')
        self.stop.set()

    def close(self):
        self.cancel()
        try:
            if self.executor:
                LOG.info('Grid pool: waiting for workers to stop')
                self.executor.shutdown(wait=True, cancel_futures=True)
        finally:
            self.diagnostics()
            self.directory.cleanup()
            self.events.close()
            self.events.join_thread()
            LOG.info('Grid pool: stopped; temporary image removed')
