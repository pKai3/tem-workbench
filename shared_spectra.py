"""Exploratory local-FFT PCA/NMF. No phase classification or changes to source data.

Spectra are sampled on a shared log-radius / angle grid. Reciprocal-area weights
make the PCA metric approximate Cartesian spectral area rather than overweighting
small radii. Broadening in angle/log-radius tolerates small shifts but is NOT an
orientation correction or a guarantee that one crystal occupies one component.
"""
from concurrent.futures import CancelledError
import copy
import io
import json
import logging
import math
import os
import shutil
import sys
import tempfile
from pathlib import Path
import threading
import time
import uuid

import numpy as np
from scipy import fft, ndimage, linalg
from PIL import Image
import analysis_core as core

VERSION = 'local-fft-components-v2'
RADIAL_BINS, ANGULAR_BINS = 96, 180
MAX_MATRIX_BYTES = 64 * 1024**2
LOG = logging.getLogger('tem_workbench')


def check_cancel(cancel):
    if cancel is not None and cancel.is_set():
        raise CancelledError()


def number(options, key, default, lo, hi):
    value = float(options.get(key, default))
    if not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError(f'{key.replace("_", " ")} must be between {lo:g} and {hi:g}.')
    return value


def plan(info, settings, options):
    if info.get('image_kind') == 'diffraction':
        raise ValueError('Local FFT PCA needs a calibrated real-space image.')
    sx, sy = float(info['pixel_x_nm']), float(info['pixel_y_nm'])
    if min(sx, sy) <= 0 or not np.isfinite([sx, sy]).all():
        raise ValueError('A finite positive real-space calibration is required.')
    width, height = int(info['width']), int(info['height'])
    physical = min(width*sx, height*sy)
    window = number(options, 'window_nm', physical*.1, min(sx, sy)*32, physical)
    spacing = number(options, 'spacing_nm', window/2, min(sx, sy), physical)
    w, h = round(window/sx), round(window/sy)
    if min(w, h) < 32 or max(w, h) > 2048 or w > width or h > height:
        raise ValueError('PCA windows must fit the image and contain 32–2048 pixels on each side.')
    inner, outer = float(settings['g_min']), float(settings['g_max'])
    if not 0 < inner < outer < min(.5/sx, .5/sy):
        raise ValueError('PCA needs a positive inner limit and an outer limit below both Nyquist limits.')
    if (outer-inner)*min(w*sx, h*sy) < 4:
        raise ValueError('The chosen window resolves fewer than four FFT bins across the fitting band.')
    dx, dy = max(1, round(spacing/sx)), max(1, round(spacing/sy))
    nx, ny = (width-w)//dx+1, (height-h)//dy+1
    count = nx*ny
    if count < 4:
        raise ValueError('Choose a smaller window or spacing to sample at least four locations.')
    if count*RADIAL_BINS*ANGULAR_BINS*4 > MAX_MATRIX_BYTES:
        raise ValueError(f'{count} windows exceed the PCA memory budget (maximum {MAX_MATRIX_BYTES//(RADIAL_BINS*ANGULAR_BINS*4)}). Increase centre spacing.')
    xs = ((width-w-(nx-1)*dx)//2 + np.arange(nx)*dx).astype(int)
    ys = ((height-h-(ny-1)*dy)//2 + np.arange(ny)*dy).astype(int)
    n_components = number(options, 'components', 8, 1, 16)
    if int(n_components) != n_components:
        raise ValueError('Component count must be an integer.')
    method = options.get('method', 'pca')
    if method not in ('pca', 'nmf'):
        raise ValueError('Choose PCA or NMF.')
    normalization = options.get('normalization', 'unit_norm')
    if normalization not in ('unit_norm', 'none'):
        raise ValueError('Choose unit norm or no spectral normalization.')
    return dict(method=method,window_pixels=[w,h], window_nm=[w*sx,h*sy], spacing_nm=[dx*sx,dy*sy],
                xs=xs.tolist(), ys=ys.tolist(), map_shape=[ny,nx], count=count,
                pixel_nm=[sx,sy], image_shape=[height,width], g_min=inner,g_max=outer,
                components=min(int(n_components),count-1),
                antialias_sigma_nm_inv=.5*max(outer*math.pi/ANGULAR_BINS,outer*math.log(outer/inner)/RADIAL_BINS),
                angular_sigma_deg=number(options,'angular_sigma_deg',0,0,5),
                spacing_sigma_percent=number(options,'spacing_sigma_percent',0,0,5),
                normalization=normalization, radial_bins=RADIAL_BINS, angular_bins=ANGULAR_BINS,
                matrix_mib=round(count*RADIAL_BINS*ANGULAR_BINS*4/1024**2,1))


def axes(p):
    # Bin centres; 180 degrees suffice for real-image Friedel-symmetric power.
    edges = np.linspace(np.log(p['g_min']), np.log(p['g_max']), RADIAL_BINS+1)
    radii = np.exp((edges[:-1]+edges[1:])/2)
    angles = np.arange(ANGULAR_BINS)*np.pi/ANGULAR_BINS
    weights = (radii/np.sqrt(np.mean(radii*radii)))[:,None]*np.ones((1,ANGULAR_BINS))
    return radii, angles, weights.astype(np.float32)


def local_spectrum(crop, p, settings, radii, angles):
    if not np.isfinite(crop).all():
        raise ValueError('The image contains non-finite pixels.')
    z = core.prepare_fft_input(crop, settings['fft_window'], settings['remove_mean'],
                               tukey_alpha=settings['fft_tukey_alpha'])
    # Fixed sample-count power normalization; every window uses one aperture.
    power = np.log1p(np.abs(fft.fftshift(fft.fft2(z,workers=1)))**2 / z.size)
    h,w = z.shape; sx,sy = p['pixel_nm']
    sigma_q=p['antialias_sigma_nm_inv']
    power=ndimage.gaussian_filter(power,(sigma_q*h*sy,sigma_q*w*sx),mode='nearest')
    qx = radii[:,None]*np.cos(angles)[None,:]
    qy = radii[:,None]*np.sin(angles)[None,:]
    # Average conjugate samples to remove tiny interpolation asymmetry.
    forward = ndimage.map_coordinates(power,[h//2-qy*h*sy,w//2+qx*w*sx],order=1,mode='nearest')
    reverse = ndimage.map_coordinates(power,[h//2+qy*h*sy,w//2-qx*w*sx],order=1,mode='nearest')
    return ((forward+reverse)*.5).astype(np.float32)


def features(raw, p, weights):
    dlog = math.log(p['g_max']/p['g_min'])/RADIAL_BINS
    sigma = (math.log1p(p['spacing_sigma_percent']/100)/dlog,
             p['angular_sigma_deg']/(180/ANGULAR_BINS))
    values = ndimage.gaussian_filter(raw, sigma, mode=('nearest','wrap')) if max(sigma)>0 else raw.copy()
    values = values*weights
    norm = float(np.linalg.norm(values)) if p['normalization']=='unit_norm' else 1.
    return values/max(norm,1e-20), norm


def decompose(matrix, components, cancel=None):
    """Centred PCA; exact small SVD, seeded randomized range for larger jobs.

    Explained variance uses TOTAL centred energy, not just retained components.
    Sign convention is deterministic: largest-magnitude loading is positive.
    """
    check_cancel(cancel)
    mean = matrix.mean(axis=0,dtype=np.float64).astype(np.float32)
    x = matrix-mean
    energy = float(np.sum(x.astype(np.float64)**2))
    if energy <= 1e-14*max(1.,float(np.sum(matrix.astype(np.float64)**2))):
        raise ValueError('No measurable variation between windows; PCA has nothing to separate.')
    k = min(components,min(x.shape)-1)
    if min(x.shape)<=64:
        u,s,v = linalg.svd(x,full_matrices=False,check_finite=False)
        algorithm='exact_svd'
    else:
        rank=min(k+12,min(x.shape))
        omega=np.random.default_rng(0).standard_normal((x.shape[1],rank)).astype(np.float32)
        q,_=linalg.qr(x@omega,mode='economic',check_finite=False)
        for _ in range(3):
            check_cancel(cancel)
            z,_=linalg.qr(x.T@q,mode='economic',check_finite=False)
            q,_=linalg.qr(x@z,mode='economic',check_finite=False)
        check_cancel(cancel)
        _,s,v=linalg.svd(q.T@x,full_matrices=False,check_finite=False)
        algorithm='randomized_svd_seed0_power3_oversample12'
    check_cancel(cancel)
    v=v[:k].copy()
    for row in v:
        if row[np.argmax(np.abs(row))]<0:row*=-1
    scores=x@v.T
    captured=np.sum(scores.astype(np.float64)**2,axis=0)
    variance=captured/energy
    residual=np.sqrt(np.maximum(0,np.sum(x.astype(np.float64)**2,axis=1)-np.sum(scores.astype(np.float64)**2,axis=1)))
    return dict(mean=mean,components=v,scores=scores,explained_variance_ratio=variance,
                residual=residual,algorithm=algorithm,total_energy=energy)



def decompose_nmf(matrix, components, cancel=None, progress=None, iterations=300):
    """Seeded Euclidean multiplicative NMF (Lee & Seung); local optimum only.

    L1-normalized spectral rows make W additive component contributions, rather
    than scale-ambiguous coefficients. No mean subtraction or phase labels.
    """
    check_cancel(cancel)
    x=np.asarray(matrix,dtype=np.float32)
    if not np.isfinite(x).all() or np.any(x<0) or not np.any(x>0):
        raise ValueError('NMF needs finite nonnegative spectra with some signal.')
    k=min(int(components),min(x.shape))
    rng=np.random.default_rng(0)
    amplitude=np.sqrt(float(x.mean())/k)
    w=(rng.random((len(x),k),dtype=np.float32)+.1)*amplitude
    h=(rng.random((k,x.shape[1]),dtype=np.float32)+.1)*amplitude
    energy=float(np.sum(x.astype(np.float64)**2));previous=None;converged=False
    for step in range(1,iterations+1):
        check_cancel(cancel)
        h *= (w.T@x)/np.maximum((w.T@w)@h,1e-20)
        w *= (x@h.T)/np.maximum(w@(h@h.T),1e-20)
        if step%10==0 or step==iterations:
            residual=x-w@h
            error=float(np.sum(residual.astype(np.float64)**2))
            if progress:progress(step,iterations,'NMF iterations')
            if previous is not None and step>=50 and 0 <= (previous-error)/max(previous,1e-20)<1e-5:
                converged=True;break
            previous=error
    check_cancel(cancel)
    norm=np.maximum(h.sum(axis=1),1e-20);h/=norm[:,None];w*=norm[None,:]
    shares=w.sum(axis=0,dtype=np.float64);shares/=shares.sum()
    order=np.argsort(-shares);h=h[order];w=w[:,order];shares=shares[order]
    residual=np.linalg.norm(x-w@h,axis=1)
    return dict(mean=np.zeros(x.shape[1],np.float32),components=h,scores=w,
                explained_variance_ratio=np.zeros(k),contribution_share=shares,
                residual=residual,algorithm='euclidean_multiplicative_nmf_seed0',
                total_energy=energy,iterations=step,converged=converged,
                relative_reconstruction_error=float(np.linalg.norm(residual)/np.sqrt(energy)))


def compute(array, info, settings, options, cancel=None, progress=None):
    p=plan(info,settings,options)
    r,a,weights=axes(p)
    raw=np.empty((p['count'],RADIAL_BINS*ANGULAR_BINS),np.float32)
    matrix=np.empty_like(raw);norms=np.empty(p['count'],np.float32)
    positions=[];w,h=p['window_pixels']
    for i,(y,x) in enumerate((y,x) for y in p['ys'] for x in p['xs']):
        check_cancel(cancel)
        spectrum=local_spectrum(array[y:y+h,x:x+w],p,settings,r,a)
        feature,norm=features(spectrum,p,weights)
        raw[i]=spectrum.ravel();matrix[i]=feature.ravel();norms[i]=norm
        positions.append([x,y,w,h])
        if progress:progress(i+1,p['count'],'Sampling local FFTs')
    if progress:progress(p['count'],p['count'],'Decomposing spectra')
    result=(decompose_nmf(matrix,p['components'],cancel,progress) if p['method']=='nmf' else decompose(matrix,p['components'],cancel))
    result.update(plan=p,raw_spectra=raw,normalizations=norms,positions=np.asarray(positions),
                  radii=r,angles=a,area_weights=weights,source=copy.deepcopy(info),settings=copy.deepcopy(settings),
                  method_version=VERSION)
    return result


def cartesian(polar, p, size=256):
    axis=(np.arange(size)+.5)/size*2*p['g_max']-p['g_max']
    x,y=np.meshgrid(axis,-axis);radius=np.hypot(x,y)
    valid=(radius>=p['g_min'])&(radius<=p['g_max'])
    ir=(np.log(np.maximum(radius,1e-20)/p['g_min'])/math.log(p['g_max']/p['g_min'])*RADIAL_BINS-.5)
    it=(np.arctan2(y,x)%np.pi)/np.pi*ANGULAR_BINS
    # Periodic angular padding avoids seam interpolation/clamping artefacts.
    padded=np.pad(polar.reshape(RADIAL_BINS,ANGULAR_BINS),((0,0),(1,1)),mode='wrap')
    return ndimage.map_coordinates(padded,[np.clip(ir,0,RADIAL_BINS-1),it+1],order=1,mode='nearest'),valid


def color_png(values, valid=None, signed=False, limits=None):
    data=np.asarray(values,dtype=float)
    valid=np.ones(data.shape,bool) if valid is None else valid
    if signed:
        hi=max(float(np.max(np.abs(data[valid]))) if valid.any() else 0,1e-20)
        t=np.clip(data/hi,-1,1)
        rgb=np.stack((.12+.88*np.maximum(t,0),.12+.45*np.abs(t),.12+.88*np.maximum(-t,0)),axis=-1)
        lo=-hi
    else:
        lo,hi=limits if limits is not None else (np.percentile(data[valid],[0,99.5]) if valid.any() else (0.,1.))
        t=np.clip((data-lo)/max(hi-lo,1e-20),0,1)
        rgb=np.stack((t,np.sqrt(t)*.85,t*t*.65),axis=-1)
    rgb[~valid]=0
    stream=io.BytesIO();Image.fromarray(np.uint8(rgb*255)).save(stream,format='PNG')
    return stream.getvalue(),[float(lo),float(hi)]


def encoded(values,valid=None,signed=False,limits=None):
    import base64
    png,limits=color_png(values,valid,signed,limits)
    return dict(image='data:image/png;base64,'+base64.b64encode(png).decode(),limits=limits)


def spectrum_image(polar,p,signed=False,limits=None):
    values,valid=cartesian(polar,p)
    return encoded(values,valid,signed,limits)


def component_image(polar, p, signed):
    """Compact display raster; numeric exports retain full precision."""
    import base64
    values, valid = cartesian(polar, p)
    result = encoded(values, valid, signed)
    lo, hi = result['limits']
    raster = np.rint(np.clip((values-lo)/max(hi-lo, 1e-20), 0, 1)*254).astype(np.uint8)
    raster[~valid] = 255
    result.update(raster=base64.b64encode(raster.tobytes()).decode(), size=raster.shape[0])
    return result


def summary(result):
    p=result['plan'];w=result['area_weights'].ravel();nmf=p.get('method')=='nmf'
    components=[]
    for i,(spectrum,ratio) in enumerate(zip(result['components'],result.get('contribution_share',result['explained_variance_ratio']))):
        scores=result['scores'][:,i].reshape(p['map_shape'])
        components.append(dict(index=i,variance=float(ratio),scores=scores.tolist(),
                               spectrum=component_image(spectrum/w,p,not nmf)))
    return dict(plan=p,source_name=result['source'].get('name','Image'),
                source_hash=result['source'].get('sha256_pixels'),method=VERSION,
                algorithm=result['algorithm'],components=components,decomposition=p.get('method','pca'),
                fit_status=result.get('fit_status'),fits=result.get('fits'),phase_support=result.get('phase_support'),phase_support_status=result.get('phase_support_status'),
                iterations=result.get('iterations'),converged=result.get('converged'),
                relative_reconstruction_error=result.get('relative_reconstruction_error'),
                mean=spectrum_image((result['scores'].mean(axis=0)@result['components'] if nmf else result['mean'])/w,p),
                raw_mean=spectrum_image(result['raw_spectra'].mean(axis=0),p),
                residual=result['residual'].reshape(p['map_shape']).tolist(),
                explained=float(result['explained_variance_ratio'].sum()))


def sample(result,index,selected):
    n=result['plan']['count'];k=len(result['components'])
    if not isinstance(index,int) or not 0<=index<n:
        raise ValueError('Choose a sampled window.')
    if not isinstance(selected,list) or not selected or any(type(i) is not int or not 0<=i<k for i in selected):
        raise ValueError('Choose one or more retained components.')
    selected=sorted(set(selected));w=result['area_weights'].ravel();p=result['plan']
    reconstructed=result['mean']+result['scores'][index,selected]@result['components'][selected]
    norm=max(float(result['normalizations'][index]),1e-20)
    original=spectrum_image(result['raw_spectra'][index],p)
    processed,_=features(result['raw_spectra'][index].reshape(RADIAL_BINS,ANGULAR_BINS),p,result['area_weights'])
    return dict(roi=result['positions'][index].tolist(),selected=selected,
                raw=original,
                processed=spectrum_image(processed.ravel()/w*norm,p,limits=original['limits']),
                reconstruction=spectrum_image(reconstructed/w*norm,p,limits=original['limits']),
                negative_fraction=float(np.mean(reconstructed<0)),scores=result['scores'][index].tolist())


def export_staging_root():
    """Keep recoverable exports outside project and synced output folders."""
    if sys.platform == 'darwin':
        base = Path.home() / 'Library/Application Support/TEM Workbench'
    elif sys.platform == 'win32':
        base = Path(os.environ['LOCALAPPDATA']) / 'TEMWorkbench'
    else:
        base = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'tem-workbench'
    return base / 'export-recovery'


def copy_export_file(source, destination):
    """Sequential cloud write; publish only after the complete file closes."""
    from folder_paths import retry_sharing_violation
    fd, name = tempfile.mkstemp(prefix='.' + destination.name + '-', suffix='.part', dir=destination.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as target, source.open('rb') as origin:
            shutil.copyfileobj(origin, target, length=1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
        retry_sharing_violation(lambda: os.replace(temporary, destination), 'publishing spectrum export')
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            LOG.warning('Could not remove incomplete export transfer: %s', temporary, exc_info=True)


def export(result, folder):
    from batch_grids import safe_name
    folder=Path(folder)
    stem=time.strftime('%Y%m%d_%H%M%S_')+safe_name(result['source'].get('name','image'))+'_'+result['plan'].get('method','pca')+'_'+uuid.uuid4().hex[:6]
    meta=dict(method=VERSION,source=result['source'],processing=result['settings'],plan=result['plan'],
              algorithm=result['algorithm'],explained_variance_ratio=result['explained_variance_ratio'].tolist(),
              conventions=dict(spectra='log(1 + abs(FFT)**2 / number_of_pixels); conjugate averaged',
              angular_domain='[0, pi), radians; qy up',normalization='per-window weighted norm before centering',
              reconstruction='mean + scores @ components; divide by area_weights then multiply window normalization',
              components='signed variance directions, not phases; scores and grouped energy are not fractions',
              broadening='Gaussian in log radius and angle before decomposition; no orientation registration',
              source_settings='Window, taper, mean removal and fitting band used; peak detection/matching settings not used'),
              reference='Jany et al., Micron 130 (2020) 102800; doi:10.1016/j.micron.2019.102800')
    meta.update(fits=result.get('fits'),fit_status=result.get('fit_status'),
                phase_support=result.get('phase_support'),phase_support_status=result.get('phase_support_status'))
    if result.get('fits') and result['plan'].get('method','pca')=='pca':
        meta['conventions']['source_settings']='Decomposition uses taper, mean removal and fitting band. Signed-lobe indexing uses captured material/phase/scale settings; original-window checks do not gate by score sign.'
    if result['plan'].get('method')=='nmf':
        meta.update(contribution_share=result['contribution_share'].tolist(),iterations=result['iterations'],converged=result['converged'],relative_reconstruction_error=result['relative_reconstruction_error'],fits=result.get('fits'),fit_status=result.get('fit_status'),phase_support=result.get('phase_support'),phase_support_status=result.get('phase_support_status'))
        meta['conventions'].update(normalization='Per-window weighted norm, no centering; H rows have unit L1 sum',reconstruction='scores @ components; divide by area_weights and multiply window normalization',components='Nonnegative spectral factors; contribution shares are not phase fractions or explained variance',source_settings='Decomposition uses taper, mean removal and fitting band. Optional indexing uses captured material/phase/scale settings; see fits provenance.')
        meta['nmf_reference']='Lee & Seung, Algorithms for Non-negative Matrix Factorization, NIPS 2000 (2001), https://proceedings.neurips.cc/paper/2000/file/f9d1152547c0bde01830b7e8bd60024c-Paper.pdf'
    metadata=json.dumps(meta,allow_nan=False,indent=2)
    staging_root = export_staging_root()
    staging_root.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=stem + '-', dir=staging_root))
    local_files = [staging / (stem + suffix) for suffix in ('.npz', '.json')]
    try:
        LOG.info('Preparing %s export locally: %s', result['plan'].get('method', 'pca'), staging)
        np.savez_compressed(local_files[0],**{key:result[key] for key in ('raw_spectra','normalizations','positions','radii','angles','area_weights','mean','components','scores','explained_variance_ratio','residual')},metadata=np.array(metadata))
        local_files[1].write_text(metadata+'\n', encoding='utf-8')
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    destination_files = [folder / path.name for path in local_files]
    try:
        folder.mkdir(parents=True, exist_ok=True)
        LOG.info('Copying completed spectrum export to %s', folder)
        for source, destination in zip(local_files, destination_files):
            copy_export_file(source, destination)
    except OSError as error:
        LOG.warning('Spectrum export transfer to %s failed; complete local copies retained at %s: %s', folder, staging, error, exc_info=True)
        return dict(files=[str(path) for path in local_files], saved_locally=True,
                    warning=f'Could not copy export to {folder}: {error}. Complete export saved locally:',
                    requested_folder=str(folder))
    shutil.rmtree(staging, ignore_errors=True)
    LOG.info('Spectrum export complete: %s', destination_files[0])
    return dict(files=[str(path) for path in destination_files], saved_locally=False)



class SharedSpectra:
    def __init__(self):
        self.lock=threading.RLock();self.thread=None;self.cancel=threading.Event();self.job=None;self.result=None

    def running(self):
        with self.lock:return bool(self.thread and self.thread.is_alive())

    def start(self,item,settings,options,folder):
        p=plan(item['info'],settings,options)
        with self.lock:
            if self.running():raise ValueError('Finish or cancel the current PCA first.')
            self.cancel=threading.Event();self.result=None;self.folder=Path(folder)
            self.job=dict(id=uuid.uuid4().hex,state='running',completed=0,total=p['count'],stage='Preparing',started=time.monotonic())
            job_id=self.job['id']
            def progress(done,total,stage):
                with self.lock:self.job.update(completed=done,total=total,stage=stage)
            def run():
                try:
                    result=compute(item['array'],copy.deepcopy(item['info']),copy.deepcopy(settings),copy.deepcopy(options),self.cancel,progress)
                    check_cancel(self.cancel)
                    with self.lock:self.result=result;self.job.update(state='complete',stage='Complete')
                except CancelledError:
                    with self.lock:self.job.update(state='cancelled',stage='Cancelled')
                except Exception as exc:
                    LOG.exception('Local FFT PCA failed')
                    with self.lock:self.job.update(state='error',error=str(exc),stage='Failed')
                finally:
                    with self.lock:self.job['elapsed_seconds']=round(time.monotonic()-self.job['started'],1)
            self.thread=threading.Thread(target=run,name='local-fft-pca',daemon=True);self.thread.start()
            return self.status(job_id)

    def status(self,job_id):
        with self.lock:
            if not self.job or self.job['id']!=job_id:raise ValueError('This PCA job is no longer in memory.')
            status={k:v for k,v in self.job.items() if k!='started'}|dict(elapsed_seconds=self.job.get('elapsed_seconds',round(time.monotonic()-self.job['started'],1)))
            # Do not advertise completion until the worker can safely be replaced.
            if status['state']!='running' and self.running():status['state']='running'
            return status

    def completed(self,job_id):
        with self.lock:
            self.status(job_id)
            if self.job['state']!='complete' or self.result is None:raise ValueError('PCA has not completed.')
            return self.result

    def inspectable(self,job_id):
        """Completed source fits stay readable while original-window checks run."""
        with self.lock:
            self.status(job_id)
            if (self.job['state']=='running' and self.job.get('operation')=='support'
                    and self.result is not None and self.result.get('fit_status')=='complete'):
                # Support writes only its own result/status. Do not expose a
                # previous map or mutable stage status through source readers.
                return {k:v for k,v in self.result.items() if k not in ('phase_support','phase_support_status')}
            return self.completed(job_id)

    def fit(self,job_id,templates,options):
        with self.lock:
            result=self.completed(job_id)
            if self.running():raise ValueError('Finish or cancel the current operation first.')
            pca=result['plan'].get('method','pca')=='pca'
            if pca:
                from pca_fitting import fit_features as fit_groups, combination_options as validate_options
            else:
                from nmf_fitting import fit_groups, validate_options
            validate_options(result,options)
            self.cancel=threading.Event()
            result.pop('phase_support',None);result.pop('phase_support_status',None)
            result['fit_status']='running'
            self.job.update(state='running',operation='fit',completed=0,total=2*len(result['components']) if pca else (1<<len(result['components']))-1,
                            stage='Preparing signed PCA features' if pca else 'Preparing exhaustive combinations',started=time.monotonic())
            self.job.pop('elapsed_seconds',None);self.job.pop('error',None)
            def progress(done,total,stage):
                with self.lock:self.job.update(completed=done,total=total,stage=stage)
            def run():
                try:
                    fits=fit_groups(result,templates,options,self.cancel,progress)
                    with self.lock:result['fits']=fits;result['fit_status']='complete'
                except CancelledError:
                    with self.lock:result['fit_status']='cancelled'
                except Exception as exc:
                    LOG.exception('Component crystal fitting failed')
                    with self.lock:result['fit_status']='error: '+str(exc)
                finally:
                    with self.lock:self.job.update(state='complete',stage='Group fitting '+result.get('fit_status','finished'),elapsed_seconds=round(time.monotonic()-self.job['started'],1))
            self.thread=threading.Thread(target=run,name='component-crystal-fit',daemon=True);self.thread.start()
            return self.status(job_id)

    def support(self,job_id,templates):
        with self.lock:
            result=self.completed(job_id)
            if self.running():raise ValueError('Finish or cancel the current operation first.')
            if result['plan'].get('method','pca')=='pca':
                from pca_fitting import build
            else:
                from nmf_phase_maps import build
            fits=result.get('fits')
            if not fits or fits['completed']!=fits['total']:
                raise ValueError('Finish component crystal fitting first.')
            self.cancel=threading.Event()
            result['phase_support_status']='running'
            self.job.update(state='running',operation='support',completed=0,total=len(result['raw_spectra']),
                            stage='Preparing phase maps',started=time.monotonic())
            self.job.pop('elapsed_seconds',None);self.job.pop('error',None)
            def progress(done,total,stage):
                with self.lock:self.job.update(completed=done,total=total,stage=stage)
            def run():
                try:
                    maps=build(result,templates,self.cancel,progress)
                    with self.lock:result['phase_support']=maps;result['phase_support_status']='complete'
                except CancelledError:
                    with self.lock:result['phase_support_status']='cancelled'
                except Exception as exc:
                    LOG.exception('Original-window checking failed')
                    with self.lock:result['phase_support_status']='error: '+str(exc)
                finally:
                    with self.lock:self.job.update(state='complete',stage='Phase mapping '+result['phase_support_status'],elapsed_seconds=round(time.monotonic()-self.job['started'],1))
            self.thread=threading.Thread(target=run,name='component-window-checks',daemon=True);self.thread.start()
            return self.status(job_id)
