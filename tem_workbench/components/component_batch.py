"""Sequential-image PCA/NMF batches; each image owns its decomposition and pool."""
import copy
from datetime import datetime
import json
import os
from pathlib import Path
import tempfile
import threading
import uuid

from tem_workbench.app.engine import Engine
from tem_workbench.components import shared_spectra
from tem_workbench.components.component_execution import selected_workers


def timestamp():
    return datetime.now().astimezone().isoformat()


class ComponentBatch:
    def __init__(self, app):
        self.app=app;self.lock=threading.RLock();self.thread=None
        self.cancel=threading.Event();self.analysis=shared_spectra.SharedSpectra()
        self.data=dict(state='idle',images=[],finished=0,total=0)

    def running(self):
        return bool(self.thread and self.thread.is_alive())

    def status(self):
        with self.lock:
            value=copy.deepcopy(self.data)
            if self.running():value['state']='running'
            job_id=value.get('job_id')
        if job_id:
            try:value['current_job']=self.analysis.status(job_id)
            except ValueError:pass
        return value

    def cancel_run(self, job_id):
        with self.lock:
            if job_id!=self.data.get('id'):raise ValueError('This component batch is no longer active.')
            self.cancel.set();self.analysis.cancel.set()
        return self.status()

    def start(self, body):
        app=self.app
        with app.lock, app.job_lock:
            if (app.closing or self.running() or app.batch.running() or app.pca.running()
                    or app.window_probe.running() or (app.grid_thread and app.grid_thread.is_alive())):
                raise ValueError('Finish or cancel the current analysis before starting a PCA/NMF batch.')
            chosen=body.get('file_ids')
            if (not isinstance(chosen,list) or not chosen or any(not isinstance(k,str) for k in chosen)
                    or len(set(chosen))!=len(chosen)):
                raise ValueError('Select one or more distinct images.')
            rows={row['id']:row for row in app.engine.catalog()}
            if any(key not in rows for key in chosen):raise ValueError('An image is no longer in the catalogue. Review the list again.')
            options=copy.deepcopy(body.get('options',{}));fit_options=copy.deepcopy(body.get('fit_options',{}))
            settings=copy.deepcopy(body.get('settings',{}))
            if options.get('method','pca') not in ('pca','nmf'):raise ValueError('Choose PCA or NMF.')
            selected_workers(options);selected_workers(fit_options,options.get('workers',1))
            json.dumps([options,fit_options,settings],allow_nan=False)
            engine=Engine(copy.deepcopy(app.config));engine.catalog()
            job_id=uuid.uuid4().hex
            folder=Path(app.config['output_root']).resolve()/('components_'+datetime.now().strftime('%Y%m%d_%H%M%S')+'_'+job_id[:6])
            folder.mkdir(parents=True,exist_ok=False)
            with self.lock:
                self.cancel=threading.Event();self.analysis=shared_spectra.SharedSpectra()
                self.data=dict(id=job_id,state='running',total=len(chosen),finished=0,images=[],current=None,job_id=None,
                    selected_file_ids=list(chosen),options=options,fit_options=fit_options,settings=settings,
                    output_directory=str(folder),manifest=str(folder/'batch.json'),engine_sha256=engine.version,
                    started_at=timestamp(),interpretation='Independent decomposition and hypotheses per image. Component and model IDs do not align across images. Window support is not phase fraction or independent validation.')
            try:self.write()
            except OSError as exc:
                with self.lock:self.data.update(state='error',error=str(exc))
                raise
            self.thread=threading.Thread(target=self._run,args=(engine,rows,folder),name='component-batch',daemon=True)
            self.thread.start()
        return self.status()

    def _run(self, engine, rows, folder):
        try:
            for key in self.data['selected_file_ids']:
                if self.cancel.is_set():break
                row=rows[key];record=dict(file_id=key,name=row['name'],state='running')
                with self.lock:self.data.update(current=dict(file_id=key,name=row['name']),job_id=None)
                self.write()
                try:
                    item=engine.load(key);info=copy.deepcopy(item['info'])
                    if info.get('image_kind')!='real_space':raise ValueError('Requires a calibrated real-space image.')
                    roi=dict(x=0,y=0,w=info['width'],h=info['height'])
                    _,settings=engine.validate(item,roi,self.data['settings'])
                    options=copy.deepcopy(self.data['options']);fit_options=copy.deepcopy(self.data['fit_options'])
                    fit_options.setdefault('workers',options.get('workers',1))
                    # Validate each source before allocating its spectra. Calibration,
                    # fitting limits and pixel footprints are resolved independently.
                    shared_spectra.plan(info,settings,options)
                    if self.cancel.is_set():break
                    destination=engine.output_for(key)/folder.name
                    started=self.analysis.start({**item,'info':info},settings,options,destination,
                        viewer=dict(file_id=key,roi=roi,settings=settings,options=options,fit_options=fit_options),
                        pipeline=dict(templates=engine.templates_for(settings),options=fit_options))
                    with self.lock:self.data['job_id']=started['id']
                    while self.analysis.running():
                        if self.cancel.is_set():self.analysis.cancel.set()
                        self.analysis.thread.join(.1)
                    status=self.analysis.status(started['id']);result=self.analysis.result
                    complete=bool(result and result.get('fit_status')=='complete' and result.get('phase_support_status')=='complete')
                    record.update(state='complete' if complete else 'cancelled' if self.cancel.is_set() else 'error',
                                  analysis_state=status['state'])
                    if result is not None:
                        record.update(fit_status=result.get('fit_status'),mapping_status=result.get('phase_support_status'),
                            windows=result['plan']['count'],checked_windows=len((result.get('phase_support') or {}).get('windows',[])),
                            execution=result.get('execution'),sampling={k:result['plan'][k] for k in
                                ('window_nm','window_pixels','spacing_nm','count','components','g_min','g_max','layout','passes','sample_edges') if k in result['plan']})
                        record['export']=shared_spectra.export(result,destination)
                    if record['state']=='error':
                        record['error']=status.get('error') or (result or {}).get('phase_support_status') or (result or {}).get('fit_status') or 'Analysis did not complete.'
                except Exception as exc:
                    record.update(state='error',error=str(exc))
                finally:
                    # Retain no spectral matrices or large live/map snapshots from
                    # earlier images. Interactive PCA/NMF uses a separate manager.
                    self.analysis=shared_spectra.SharedSpectra()
                    item=result=None
                    engine.loaded.clear()
                with self.lock:
                    self.data['images'].append(record);self.data['finished']+=1;self.data['job_id']=None
                self.write()
            with self.lock:self.data['state']='cancelled' if self.cancel.is_set() else 'complete'
        except Exception as exc:
            with self.lock:self.data.update(state='error',error=str(exc))
        finally:
            with self.lock:self.data.update(current=None,job_id=None,finished_at=timestamp())
            try:self.write()
            except OSError as exc:
                with self.lock:self.data.update(state='error',error='Could not save batch manifest: '+str(exc))

    def write(self):
        with self.lock:data=copy.deepcopy(self.data)
        target=Path(data['manifest'])
        fd,name=tempfile.mkstemp(prefix='.batch-',suffix='.json',dir=target.parent)
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as stream:
                json.dump(data,stream,indent=2,allow_nan=False);stream.write('\n');stream.flush();os.fsync(stream.fileno())
            os.replace(name,target)
        finally:Path(name).unlink(missing_ok=True)
