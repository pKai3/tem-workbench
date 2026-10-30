"""Bounded analysis workers; source pixels are shared through a read-only mmap.

Spawn (never fork) works with the macOS and Windows launchers. Workers own their
Engine/caches; only compact ROIs/results cross the process boundary.
"""
from concurrent.futures import ProcessPoolExecutor, CancelledError
from pathlib import Path
import multiprocessing as mp
import os
import sys
import tempfile
import threading


def configure_numeric_threads():
    # Prevent a process pool multiplying BLAS/OpenMP pools. Set before NumPy loads.
    for name in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS',
                 'VECLIB_MAXIMUM_THREADS', 'NUMEXPR_NUM_THREADS'):
        os.environ[name] = '1'


def worker_limit():
    return max(1, min(8, os.cpu_count() or 1))


def worker_count(requested=0):
    if isinstance(requested, bool) or not isinstance(requested, int) or not 0 <= requested <= 8:
        raise ValueError('Choose Auto or 1–8 grid workers.')
    return min(requested or min(4, max(1, (os.cpu_count() or 1)-1)), worker_limit())


def _watch_parent():
    # A Windows launcher may terminate the backend without Python finally blocks.
    # Do not leave analysis workers alive after their owning backend disappears.
    parent = mp.parent_process()
    if parent:
        parent.join()
        os._exit(0)


def _initialize(source, info, limits, config, settings, stop, version):
    configure_numeric_threads()
    import numpy as np
    import analysis_core
    from engine import Engine
    global _engine, _item, _settings, _stop
    analysis_core.FFT_WORKERS = 1
    _engine = Engine(config)
    if _engine.version != version:
        raise RuntimeError('Analysis code changed while starting the grid. Restart the app and rerun.')
    pixels = np.load(source, mmap_mode='r', allow_pickle=False)
    _item = dict(array=pixels, info=info, limits=limits)
    _settings, _stop = settings, stop
    threading.Thread(target=_watch_parent, daemon=True).start()


def _analyze(roi):
    if _stop.is_set():
        raise CancelledError('Grid cancelled')
    return _engine.analyze(_item, roi, _settings, images=False,
                           cache_candidates=True, cancel_event=_stop)


class RegionPool:
    """One bounded, explicitly owned pool per grid. Close before replacing it."""
    def __init__(self, item, settings, config, version, workers=0):
        self.workers = worker_count(workers)
        # Console-free workers when launched by the Windows control window.
        if sys.platform == 'win32':
            windowless = Path(sys.executable).with_name('pythonw.exe')
            if windowless.is_file():
                mp.set_executable(str(windowless))
        self.context = mp.get_context('spawn')
        self.stop = self.context.Event()
        self.directory = tempfile.TemporaryDirectory(prefix='tem-grid-')
        self.executor = None
        try:
            import numpy as np
            source = Path(self.directory.name)/'source.npy'
            np.save(source, item['array'], allow_pickle=False)
            self.executor = ProcessPoolExecutor(max_workers=self.workers,
                mp_context=self.context, initializer=_initialize,
                initargs=(str(source), item['info'], item['limits'], config,
                          settings, self.stop, version))
        except BaseException:
            self.directory.cleanup()
            raise

    def submit(self, roi):
        return self.executor.submit(_analyze, roi)

    def cancel(self):
        self.stop.set()

    def close(self):
        self.cancel()
        try:
            if self.executor:
                self.executor.shutdown(wait=True, cancel_futures=True)
        finally:
            self.directory.cleanup()
