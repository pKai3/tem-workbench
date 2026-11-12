"""Bounded, ordered component jobs using the grid's spawn/thread limits.

Only the coordinator publishes results. Large read-only inputs are memory-mapped
once per stage; queued work and out-of-order results are bounded by worker count.
"""
from collections import OrderedDict, deque
from concurrent.futures import ProcessPoolExecutor, Future, TimeoutError, CancelledError
from pathlib import Path
import multiprocessing as mp
import tempfile
import threading

from parallel_execution import configure_numeric_threads, worker_count, _watch_parent


def selected_workers(options, fallback=1):
    requested = options.get('workers', fallback)
    try:
        return requested, worker_count(requested)
    except ValueError:
        raise ValueError('Choose Auto or 1–16 PCA/NMF workers.') from None


def _initialize(result, templates, context, stop):
    configure_numeric_threads()
    import numpy as np
    def opened(values):
        return {k:np.load(v['mmap'], mmap_mode='r', allow_pickle=False)
                if isinstance(v, dict) and set(v)=={'mmap'} else v for k,v in values.items()}
    global _result, _templates, _context, _stop
    _result, _templates, _context, _stop = opened(result), templates, opened(context), stop
    threading.Thread(target=_watch_parent, daemon=True).start()


def _invoke(function, task):
    if _stop.is_set():raise CancelledError()
    return function(_result, _templates, _context, task, _stop)


def search_task(result, templates, context, task, cancel):
    import analysis_core as core
    from nmf_fitting import search_candidates
    return core.retain(search_candidates(result, task['peaks'], templates, cancel), topn=task['topn'])


class ComponentPool:
    def __init__(self, result, templates, workers=1, cancel=None, context=None, mapping=False):
        self.workers = selected_workers({'workers':workers})[1]
        self.cancel = cancel
        self.result, self.templates, self.context = result, templates, context or {}
        self.executor = self.directory = self.stop = None
        self.cache = OrderedDict()
        if self.workers == 1:return
        configure_numeric_threads()
        process = mp.get_context('spawn')
        self.stop = process.Event()
        self.directory = tempfile.TemporaryDirectory(prefix='tem-components-')
        try:
            import numpy as np
            def shared(values, prefix):
                out = {}
                for key,value in values.items():
                    if isinstance(value, np.ndarray):
                        path = Path(self.directory.name)/f'{prefix}-{key}.npy'
                        np.save(path, value, allow_pickle=False)
                        out[key] = {'mmap':str(path)}
                    else:out[key] = value
                return out
            keys = ['plan', 'settings']
            if mapping:
                keys += ['raw_spectra', 'scores', 'radii', 'angles']
                if '_source_image' in result:keys += ['source', '_source_image']
            inputs = shared({key:result[key] for key in keys}, 'input')
            if 'method_version' in result:inputs['method_version']=result['method_version']
            self.executor = ProcessPoolExecutor(max_workers=self.workers, mp_context=process,
                initializer=_initialize, initargs=(inputs, templates, shared(self.context, 'context'), self.stop))
        except BaseException:
            self.directory.cleanup()
            raise

    def check(self):
        if self.cancel is not None and self.cancel.is_set():
            if self.stop is not None:self.stop.set()
            raise CancelledError()

    def map(self, function, tasks, key=None):
        """Yield (task, result, cache_hit) in submission order, with bounded lookahead."""
        pending = deque();tasks = iter(tasks);exhausted = False
        while pending or not exhausted:
            self.check()
            while not exhausted and len(pending) < self.workers:
                self.check()
                try:task = next(tasks)
                except StopIteration:
                    exhausted = True;break
                identity = key(task) if key else None
                hit = key is not None and identity in self.cache
                if hit:
                    future = self.cache.pop(identity);self.cache[identity] = future
                elif self.executor:
                    future = self.executor.submit(_invoke, function, task)
                else:
                    future = Future()
                    future.set_result(function(self.result, self.templates, self.context, task, self.cancel))
                if key is not None and not hit:
                    self.cache[identity] = future
                    if len(self.cache)>128:self.cache.popitem(last=False)
                pending.append((task, future, hit))
            if not pending:break
            task, future, hit = pending[0]
            try:value = future.result(timeout=.05)
            except TimeoutError:
                if future.done():raise
                continue
            self.check()
            pending.popleft()
            yield task, value, hit

    def close(self):
        if self.stop is not None:self.stop.set()
        try:
            if self.executor:self.executor.shutdown(wait=True, cancel_futures=True)
        finally:
            self.cache.clear()
            if self.directory:self.directory.cleanup()

    def __enter__(self):return self
    def __exit__(self, *_):self.close()
