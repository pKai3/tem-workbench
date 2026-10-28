"""DM4 input and reusable single-region analysis, independent of the web UI."""
from pathlib import Path
from io import BytesIO
import base64
import hashlib
import importlib.util
import json
import time
import numpy as np
from PIL import Image
import analysis_core as core

ROOT = Path(__file__).resolve().parent


def png(array, limits=None, max_size=None):
    lo, hi = limits if limits is not None else np.percentile(array, [.3, 99.7])
    image = Image.fromarray(np.uint8(np.clip((array-lo)/max(hi-lo, 1e-12), 0, 1)*255))
    if max_size:
        image.thumbnail((max_size, max_size))
    stream = BytesIO()
    image.save(stream, format='PNG')
    return stream.getvalue()


def data_url(data):
    return 'data:image/png;base64,' + base64.b64encode(data).decode()


class Engine:
    def __init__(self, settings):
        self.settings = settings
        self.data_root = Path(settings['data_root']).expanduser().resolve()
        reader = Path(settings['dm_reader']).expanduser().resolve()
        if not reader.is_file():
            raise ValueError('The configured DM4 reader is missing. Check .tem-paths.json.')
        spec = importlib.util.spec_from_file_location('workbench_dm_reader', reader)
        self.reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.reader)
        self.templates = json.loads((ROOT/'templates.json').read_text())
        for t in self.templates:
            for key in ['q', 'hkl', 'g']:
                t[key] = np.array(t[key])
        self.version = hashlib.sha256((ROOT/'analysis_core.py').read_bytes()).hexdigest()
        self.files = {}
        self.loaded = {}

    def catalog(self):
        rows = []
        for sample in ['STA', 'ST']:
            for path in sorted((self.data_root/sample).rglob('*.dm4')):
                relative = path.relative_to(self.data_root).as_posix()
                self.files[relative] = path
                rows.append({'id': relative, 'name': path.stem, 'sample': sample})
        return rows

    def load(self, file_id):
        if file_id in self.loaded:
            return self.loaded[file_id]
        path = self.files.get(file_id)
        if not path or not path.resolve().is_relative_to(self.data_root):
            raise ValueError('Choose a DM4 from the configured TEM folder.')
        with self.reader.fileDM(path, on_memory=False) as f:
            meta = f.getMetadata(0)
            array = np.asarray(f.getDataset(0)['data'])
        if array.ndim != 2 or not np.isfinite(array).all():
            raise ValueError('This first version supports finite, two-dimensional images.')
        factors = {'nm': 1., 'µm': 1000., 'μm': 1000., 'um': 1000., 'm': 1e9, 'A': .1, 'Å': .1}
        scales = []
        for dim in [1, 2]:
            unit = str(meta.get(f'Calibrations Dimension {dim} Units', '')).strip()
            if unit not in factors:
                raise ValueError('Choose a real-space image calibrated in length units. Direct diffraction is not supported by this FFT view yet.')
            scale = float(meta[f'Calibrations Dimension {dim} Scale'])*factors[unit]
            if not np.isfinite(scale) or scale <= 0:
                raise ValueError('Image calibration is invalid.')
            scales.append(scale)
        if abs(scales[0]/scales[1]-1) > 1e-4:
            raise ValueError('Unequal x/y pixel calibration needs an additional fitting check; this first version supports square pixels.')
        sx, sy = scales
        h, w = array.shape
        info = {'id': file_id, 'name': path.stem, 'width': w, 'height': h,
                'pixel_x_nm': sx, 'pixel_y_nm': sy, 'field_nm': [w*sx, h*sy],
                'sha256_pixels': hashlib.sha256(array.tobytes()).hexdigest(),
                'date': str(meta.get('DataBar Acquisition Date', '')),
                'time': str(meta.get('DataBar Acquisition Time', '')),
                'device': str(meta.get('Acquisition Device Name', '')),
                'can_index': min(.5/sx, .5/sy) >= 10.}
        limits = np.percentile(array, [.3, 99.7])
        item = {'array': array, 'info': info, 'limits': limits, 'preview': png(array, limits, 1400)}
        self.loaded.clear()  # Keep one source in memory; running grid jobs retain their own reference.
        self.loaded[file_id] = item
        return item

    def validate(self, item, roi, settings):
        try:
            x, y, w, h = [int(roi[k]) for k in ['x', 'y', 'w', 'h']]
        except (TypeError, ValueError, KeyError):
            raise ValueError('Region must have integer x, y, w and h values.')
        ih, iw = item['array'].shape
        if min(w, h) < 32 or x < 0 or y < 0 or x+w > iw or y+h > ih or abs(w-h) > 1:
            raise ValueError('Choose a square region within the image, at least 32 pixels wide.')
        values = {k: float(settings.get(k, v)) for k, v in [('scale', 1.), ('bcc_a', .330), ('threshold', .35)]}
        if not all(np.isfinite(v) for v in values.values()):
            raise ValueError('Analysis settings must be finite numbers.')
        if not (.85 <= values['scale'] <= 1.15 and .30 <= values['bcc_a'] <= .37 and .15 <= values['threshold'] <= .7):
            raise ValueError('Analysis settings are outside the supported range.')
        return {'x': x, 'y': y, 'w': w, 'h': h}, values

    def analyze(self, item, roi, settings, images=True):
        roi, settings = self.validate(item, roi, settings)
        started = time.perf_counter()
        x, y, w, h = [roi[k] for k in ['x', 'y', 'w', 'h']]
        info = item['info']; sx, sy = info['pixel_x_nm'], info['pixel_y_nm']
        crop = item['array'][y:y+h, x:x+w]
        if min(.5/sx, .5/sy) < 3:
            z = (crop-crop.mean())*np.hanning(h)[:, None]*np.hanning(w)[None, :]
            lg = np.log1p(abs(core.fftshift(core.fft2(z)))**2)
            fx=core.fftshift(core.fftfreq(w, sx)); fy=-core.fftshift(core.fftfreq(h, sy))
            s={'log': lg, 'extent': [float(fx[0]), float(fx[-1]), float(fy[-1]), float(fy[0])], 'peaks': [], 'df': max(1/(w*sx),1/(h*sy)), 'hann_power_fwhm_nm_inv': 1.44*max(1/(w*sx),1/(h*sy))}
        else:
            s = core.spectrum(crop, sx, sy, profile_fraction=settings['threshold'])
        tol = max(.10, s['hann_power_fwhm_nm_inv'])
        models = core.search(s['peaks'], self.templates, settings['scale'], tol, bcc_a=settings['bcc_a']) if info['can_index'] else []
        classification = core.classify(s['peaks'], models, s['df'])
        periodicity = core.purity(s['peaks'], tol) if info['can_index'] else {'status': 'unresolved_pattern', 'substantial_second_pattern': False}
        if not info['can_index']:
            classification['label'] = 'insufficient'
            classification['flags'].append('The stored sampling does not cover the full 3–10 nm⁻¹ fitting band; phase fitting is disabled.')
        if min(w*sx, h*sy) < 5:
            classification['flags'].append('Region is smaller than 5 nm; broad peaks limit identification.')
        log = s.pop('log')
        # Return an encoded log-power field; display contrast is adjusted in the browser only.
        if images:
            lo, hi = float(log.min()), float(log.max())
            display = Image.fromarray(np.uint8(np.clip((log-lo)/max(hi-lo,1e-12),0,1)*255))
            display.thumbnail((768,768), Image.Resampling.NEAREST)
            stream=BytesIO(); display.save(stream,format='PNG')
            encoded = {'fft': data_url(stream.getvalue()), 'crop': data_url(png(crop, item['limits'], 768))}
        else:
            encoded = {}
        return {'roi': roi, 'width_nm': w*sx, 'height_nm': h*sy, 'settings': settings,
                'spectrum': s, 'models': models, 'classification': classification,
                'periodicity': periodicity, 'images': encoded,
                'elapsed_ms': round((time.perf_counter()-started)*1000, 1),
                'engine_sha256': self.version}
