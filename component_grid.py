"""Run component discovery through the ordinary grid and batch lifecycle.

Only original-window checks enter the map. The decomposition and source fits
remain available through SharedSpectra for detailed inspection/export.
"""
import copy
import logging
import threading
import time

import overlap_maps
import shared_spectra
from component_execution import selected_workers

LOG = logging.getLogger('tem_workbench')


def options_for(info, overlap, component, workers):
    if not isinstance(component, dict) or component.get('method') not in ('pca', 'nmf'):
        raise ValueError('Choose PCA or NMF for component mapping.')
    _, sampling = overlap_maps.sampling(info, overlap or {})
    options = {**component.get('options', {}), 'method': component['method'], 'workers': workers,
               **{k: sampling[k] for k in ('window_nm', 'spacing_nm', 'layout', 'passes', 'sample_edges')}}
    fit_options = {**component.get('fit_options', {}), 'workers': workers}
    selected_workers(options)
    return options, fit_options, sampling


def regions(result, model_ids=None):
    """Adapt local checks to the established map contract without rescoring."""
    from nmf_phase_maps import classify
    samples = shared_spectra.window_samples(result['plan'])
    maps = result.get('phase_support') or {'models': [], 'windows': []}
    models = {m['id']: m for m in maps['models']}
    output = []
    for window in maps['windows']:
        sample = samples[window['index']]
        candidates = [c for c in window['candidates'] if model_ids is None or c['model'] in model_ids]
        if result['plan']['method'] == 'pca' or 'peak_positions' in window:
            peaks = [dict(profile_id=i, qx=x, qy=y) for i, x, y in window.get('peak_positions', [])]
            state = classify(candidates, peaks)
        else:
            state = window
        phases = set(state.get('phases', []))
        label = state['label']
        if label == 'single': label = next(iter(phases)).lower() + '_compatible'
        elif label == 'multiple': label = 'coexisting_candidates' if len(phases) > 1 else 'multiple_orientations'
        local = []
        for candidate in candidates:
            source = models[candidate['model']]
            local.append({k: source[k] for k in ('phase', 'zone_3index')}
                         | candidate | dict(score_basis='original_window_support'))
        output.append(dict(id=str(window['index']), roi=sample['roi'], pass_id=sample.get('pass_id', 0),
                           rim=sample.get('rim', False), leaf=True, depth=0, elapsed_ms=0.,
                           classification=dict(label=label), models=local,
                           component_window=window['index'], peak_count=window['peak_count']))
    return output


def select_pool(app, job_id, model_ids):
    """Change the displayed hypothesis pool, preserving all retained checks."""
    result = app.pca.inspectable(job_id)
    maps = result.get('phase_support') or {}
    available = {m['id'] for m in maps.get('models', [])}
    if not isinstance(model_ids, list) or any(type(i) is not int or i not in available for i in model_ids):
        raise ValueError('Choose hypotheses from this component analysis.')
    ids = sorted(set(model_ids))
    LOG.info('Component grid %s pool: %s/%s hypotheses; ids=%s',job_id[:8],len(ids),len(available),ids)
    with app.job_lock:
        job = app.jobs.get(job_id)
        if not job or not job.get('component'):
            raise ValueError('This analysis is not the current component grid.')
        job['_component_models'] = ids
        revision = job['_pool_revision'] = job.get('_pool_revision', 0) + 1
    while True:
        mapped = regions(result, ids)
        aggregate = overlap_maps.aggregate({**job, 'regions': mapped})
        with app.job_lock:
            if job['_pool_revision'] != revision:
                break
            if len(mapped) >= job['processed']:
                job.update(regions=mapped, aggregation=aggregate,
                           component_pool=dict(models=ids, available=len(available)),
                           interpretation='Selected hypotheses checked against original windows. One best passing score per phase per window; all checks remain in the retained component analysis. Overlapping support is not phase fraction.')
                break
        # Mapping advanced while this selection was aggregating. Never replace
        # a newer (especially final) snapshot with an earlier partial map.
        result = app.pca.inspectable(job_id)
    return app.status(job_id)


def start(app, item, settings, workers, batch, engine, overlap, component):
    options, fit_options, sampling = options_for(item['info'], overlap, component, workers)
    planned = shared_spectra.plan(item['info'], settings, options)
    with app.job_lock:
        if (app.closing or (app.grid_thread and app.grid_thread.is_alive()) or app.pca.running()
                or app.component_batch_running() or app.window_probe.running()
                or (not batch and app.batch.running())):
            raise ValueError('Finish or cancel the current analysis first.')
        manager = shared_spectra.SharedSpectra() if batch else app.pca
        info = copy.deepcopy(item['info'])
        viewer = dict(file_id=info['id'], roi=dict(x=0, y=0, w=info['width'], h=info['height']),
                      settings=settings, options=options, fit_options=fit_options, mapping_pool='all')
        started = manager.start({**item, 'info': info}, settings, options, engine.output_for(info['id']),
                                viewer=viewer, pipeline=dict(templates=engine.templates_for(settings), options=fit_options))
        job = dict(id=started['id'], state='running', source=info, _batch=batch,
                   settings=copy.deepcopy(settings), initial_settings=copy.deepcopy(settings),
                   grid={**sampling, 'component_method': options['method']}, component=copy.deepcopy(component),
                   regions=[], active_windows=[], processed=0, pending=planned['count'], error=None, cancel=False,
                   execution=dict(workers=planned['workers'], requested_workers=workers, elapsed_seconds=0.),
                   interpretation='All discovered hypotheses checked against original windows. One best passing score per phase per window; overlapping support is not phase fraction.')
        app.jobs = {job['id']: job}

        def work():
            began = time.monotonic(); last_map = 0.; previous = -1
            try:
                while True:
                    if job['cancel']: manager.cancel.set()
                    status = manager.status(job['id'])
                    running = manager.running()
                    with app.job_lock:
                        job['component_progress'] = {k: status.get(k) for k in ('operation', 'stage', 'completed', 'total')}
                        job['execution']['elapsed_seconds'] = round(time.monotonic()-began, 1)
                    result = None
                    try: result = manager.inspectable(job['id'])
                    except ValueError: pass  # Sampling/decomposition has no map yet.
                    count = len(((result or {}).get('phase_support') or {}).get('windows', []))
                    if result is not None and count != previous and (not running or time.monotonic()-last_map >= 1.):
                        with app.job_lock:
                            ids = job.get('_component_models')
                            revision = job.get('_pool_revision', 0)
                        mapped = regions(result, ids)
                        aggregate = overlap_maps.aggregate({**job, 'regions': mapped})
                        with app.job_lock:
                            if job.get('_pool_revision', 0) != revision:
                                continue  # A new display pool superseded this aggregate.
                            available = len((result.get('phase_support') or {}).get('models', []))
                            job.update(regions=mapped, aggregation=aggregate, processed=count, pending=planned['count']-count,
                                       component_pool=dict(models=ids, available=available))
                        previous=count;last_map=time.monotonic()
                    if not running:
                        complete = bool(result and result.get('phase_support_status') == 'complete')
                        with app.job_lock:
                            job['state'] = 'complete' if complete else 'cancelled' if job['cancel'] or status['state']=='cancelled' else 'error'
                            job['error'] = status.get('error') or (None if job['state']!='error' else 'Component mapping did not complete.')
                            # Only batch jobs retain a result reference until their
                            # numeric export. Interactive results belong to app.pca.
                            if batch and result is not None: job['_component_result'] = result
                        break
                    manager.thread.join(.1)
            except Exception as exc:
                LOG.exception('Component grid failed')
                manager.cancel.set()
                manager.thread.join()
                with app.job_lock: job.update(state='error', error=str(exc))
        app.grid_thread = threading.Thread(target=work, name='component-grid', daemon=True)
        app.grid_thread.start()
    return app.status(job['id'])
