"""DM4 input and reusable single-region analysis, independent of the web UI."""
from pathlib import Path
from io import BytesIO
import base64
import hashlib
import importlib
import importlib.util
import json
import time
import os
import folder_paths
import zlib
import numpy as np
from PIL import Image
import analysis_core as core
import scale_fitting
import phase_comparison
import demo_data
import peak_evidence
import diffraction
from materials import PHASES, reference_settings
from crystal_templates import fcc_templates

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
        self.data_root = folder_paths.resolve_folder(settings.get('data_root', './data'), ROOT)
        self.reader = None  # Load the optional DM4 reader only for external DM4 files.
        self.templates = json.loads((ROOT/'templates.json').read_text())
        for t in self.templates:
            for key in ['q', 'hkl', 'g']:
                t[key] = np.array(t[key])
        self.template_library = self.templates + fcc_templates()
        self.templates = scale_fitting.prepare_templates(self.template_library)
        self.auto_templates = self.templates
        self._template_cache = {(10., 3., .295, .468, .330, .417): self.templates}
        self.version = hashlib.sha256(b''.join((ROOT/name).read_bytes() for name in
            ['analysis_core.py', 'materials.py', 'crystal_templates.py', 'diffraction.py', 'scale_fitting.py', 'phase_comparison.py', 'peak_evidence.py', 'adaptive_refinement.py', 'demo_data.py', 'engine.py', 'templates.json'])).hexdigest()
        self.files = {}
        self.loaded = {}

    def templates_for(self, settings):
        key = tuple(settings[k] for k in ('g_max', 'g_min', 'hcp_a', 'hcp_c', 'bcc_a', 'fcc_a'))
        if key not in self._template_cache:
            if len(self._template_cache) >= 4:
                self._template_cache.pop(next(iter(self._template_cache)))
            self._template_cache[key] = scale_fitting.prepare_templates(
                self.template_library, g_max=key[0], g_min=key[1], hcp_a=key[2], hcp_c=key[3], bcc_a=key[4], fcc_a=key[5])
        enabled = settings.get('enabled_phases', PHASES)
        return [template for template in self._template_cache[key] if template['phase'] in enabled]

    def catalog(self):
        rows = demo_data.catalog_entries()
        self.files = {}
        if self.settings.get('demo_only'):
            return rows
        output = folder_paths.resolve_folder(self.settings.get('output_root', './output'), ROOT)
        for directory, folders, names in os.walk(self.data_root, followlinks=False):
            folders[:] = sorted(name for name in folders if not name.startswith('.') and (Path(directory)/name).resolve() != output)
            for name in sorted(names):
                path = Path(directory)/name
                if path.suffix.lower() != '.dm4' or not path.resolve().is_relative_to(self.data_root):
                    continue
                relative = path.relative_to(self.data_root)
                file_id = relative.as_posix()
                sample = next((part for part in relative.parts[:-1] if part in ('STA', 'ST')),
                              relative.parts[0] if len(relative.parts) > 1 else 'Images')
                self.files[file_id] = path
                rows.append({'id': file_id, 'name': path.stem, 'sample': sample})
        return rows

    def load(self, file_id):
        if file_id in self.loaded:
            return self.loaded[file_id]
        is_demo = file_id in demo_data.DEMOS
        if is_demo:
            array, meta = demo_data.load(file_id)
            name = demo_data.DEMOS[file_id]['name']
        else:
            path = self.files.get(file_id)
            if not path or not path.resolve().is_relative_to(self.data_root):
                raise ValueError('Choose the bundled demo or a DM4 from the configured TEM folder.')
            if self.reader is None:
                if self.settings.get('dm_reader'):
                    reader = Path(self.settings['dm_reader']).expanduser().resolve()
                    if not reader.is_file():
                        raise ValueError('The configured DM4 reader is unavailable. Update dm_reader in .tem-paths.json, or remove it to use installed ncempy.')
                    spec = importlib.util.spec_from_file_location('workbench_dm_reader', reader)
                    self.reader = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(self.reader)
                else:
                    try:
                        self.reader = importlib.import_module('ncempy.io.dm')
                    except ImportError as exc:
                        raise ValueError('Install ncempy in the app Python environment to open DM4 files, or configure dm_reader in .tem-paths.json. The bundled demo works without it.') from exc
            with self.reader.fileDM(path, on_memory=False) as f:
                meta = f.getMetadata(0)
                array = np.asarray(f.getDataset(0)['data'])
            name = path.stem
        if array.ndim != 2 or min(array.shape) < 32 or not np.isfinite(array).all():
            raise ValueError('Choose a finite two-dimensional image at least 32 pixels per side.')
        factors = {'nm': 1., 'µm': 1000., 'μm': 1000., 'um': 1000., 'm': 1e9, 'A': .1, 'Å': .1}
        units = [str(meta.get(f'Calibrations Dimension {d} Units', '')).strip() for d in (1, 2)]
        reciprocal = [diffraction.reciprocal_factor(unit) for unit in units]
        is_diffraction = all(factor is not None for factor in reciprocal)
        scales = []
        for dim, unit in enumerate(units, 1):
            factor = reciprocal[dim-1] if is_diffraction else factors.get(unit)
            if factor is None:
                raise ValueError('DM4 must have length calibration for an image or reciprocal-length calibration for diffraction on both axes.')
            scale = float(meta[f'Calibrations Dimension {dim} Scale'])*factor
            if not np.isfinite(scale) or scale <= 0:
                raise ValueError('Image calibration is invalid.')
            scales.append(scale)
        if not is_diffraction and abs(scales[0]/scales[1]-1) > 1e-4:
            raise ValueError('Real-space FFT analysis currently requires equal x/y pixel calibration.')
        sx, sy = scales
        h, w = array.shape
        info = {'id': file_id, 'name': name, 'is_demo': is_demo,
                'image_kind': 'diffraction' if is_diffraction else 'real_space', 'width': w, 'height': h,
                'sha256_pixels': hashlib.sha256(array.tobytes()).hexdigest(),
                'date': str(meta.get('DataBar Acquisition Date', '')),
                'time': str(meta.get('DataBar Acquisition Time', '')),
                'device': str(meta.get('Acquisition Device Name', ''))}
        limits = np.percentile(array, [.3, 99.7])
        if is_diffraction:
            info.update(pixel_x_nm_inv=sx, pixel_y_nm_inv=sy, field_nm_inv=[w*sx, h*sy],
                        beam_center=diffraction.estimate_center(array), can_index=True)
            preview = png(np.log1p(np.maximum(array, 0)), max_size=1400)
        else:
            info.update(pixel_x_nm=sx, pixel_y_nm=sy, field_nm=[w*sx, h*sy],
                        can_index=min(.5/sx, .5/sy) >= 10.)
            preview = png(array, limits, 1400)
        item = {'array': array, 'info': info, 'limits': limits, 'preview': preview}
        self.loaded.clear()  # Keep one source in memory; running grid jobs retain their own reference.
        self.loaded[file_id] = item
        return item

    def region_preview(self, item, roi):
        if item['info'].get('image_kind') == 'diffraction':
            raise ValueError('Region previews apply to real-space images.')
        x, y, w, h = [int(roi[k]) for k in ('x', 'y', 'w', 'h')]
        ih, iw = item['array'].shape
        if min(w, h) < 1 or x < 0 or y < 0 or x+w > iw or y+h > ih:
            raise ValueError('Preview region must lie within the source image.')
        return png(item['array'][y:y+h, x:x+w], item['limits'], 384)

    def native_preview(self, item):
        """Lazy native-pixel display for the centre-placement magnifier."""
        if item['info'].get('image_kind') != 'diffraction':
            return item['preview']
        if 'native_preview' not in item:
            item['native_preview'] = png(np.log1p(np.maximum(item['array'], 0)))
        return item['native_preview']

    def validate(self, item, roi, settings):
        try:
            x, y, w, h = [int(roi[k]) for k in ['x', 'y', 'w', 'h']]
        except (TypeError, ValueError, KeyError):
            raise ValueError('Region must have integer x, y, w and h values.')
        ih, iw = item['array'].shape
        direct = item['info'].get('image_kind') == 'diffraction'
        if direct and (x, y, w, h) != (0, 0, iw, ih):
            raise ValueError('Direct diffraction analyses use the full detector image; use exclusion masks for unwanted areas.')
        if min(w, h) < 32 or x < 0 or y < 0 or x+w > iw or y+h > ih or (not direct and abs(w-h) > 1):
            raise ValueError('Choose a square region within the image, at least 32 pixels wide.')
        values = {k: float(settings.get(k, v)) for k, v in [('scale', 1.), ('g_min', 3.), ('g_max', 10.), ('threshold', .35), ('scale_penalty_strength', scale_fitting.DEFAULT_SCALE_PENALTY), ('peak_evidence_weight', peak_evidence.DEFAULT_WEIGHT)]}
        if not all(np.isfinite(v) for v in values.values()):
            raise ValueError('Analysis settings must be finite numbers.')
        if not (.85 <= values['scale'] <= 1.15 and 0 <= values['g_min'] < 30 and 4 <= values['g_max'] <= 30 and .15 <= values['threshold'] <= .7 and 0 <= values['scale_penalty_strength'] <= .5 and 0 <= values['peak_evidence_weight'] <= .5):
            raise ValueError('Analysis settings are outside the supported range.')
        values.update(reference_settings(settings))
        mode = settings.get('scale_mode', 'fixed')
        if mode not in scale_fitting.MODES:
            raise ValueError('Choose a supported scale fitting mode.')
        values['scale_mode'] = mode
        window = settings.get('fft_window', 'hann')
        remove_mean = settings.get('remove_mean', True)
        if window not in ('hann', 'none') or not isinstance(remove_mean, bool):
            raise ValueError('Choose Hann or no window and a boolean mean-removal setting.')
        values.update(fft_window=window, remove_mean=remove_mean)
        if direct:
            values['diffraction'] = diffraction.validate(item['info'], settings.get('diffraction', {}))
            values['g_min'] = values['diffraction']['exclude_radius_nm_inv']
        if values['g_min'] >= values['g_max']:
            raise ValueError('Central exclusion must be smaller than the outer fitting limit.')
        return {'x': x, 'y': y, 'w': w, 'h': h}, values

    def analyze(self, item, roi, settings, images=True, cache_candidates=False):
        roi, settings = self.validate(item, roi, settings)
        started = time.perf_counter()
        x, y, w, h = [roi[k] for k in ['x', 'y', 'w', 'h']]
        info = item['info']
        direct = info.get('image_kind') == 'diffraction'
        crop = item['array'][y:y+h, x:x+w]
        if direct:
            s, context = diffraction.spectrum(crop, settings['diffraction'], cache=item.setdefault('_diffraction_cache', {}), g_max=settings['g_max'])
            width_nm = height_nm = None
            can_index = s['can_index']
        else:
            sx, sy = info['pixel_x_nm'], info['pixel_y_nm']
            width_nm, height_nm = w*sx, h*sy
            s = core.spectrum(crop, sx, sy, profile_fraction=settings['threshold'],
                              window=settings['fft_window'], remove_mean=settings['remove_mean'], g_max=settings['g_max'], g_min=settings['g_min'])
            can_index = min(.5/sx, .5/sy) >= settings['g_max']
        tol = max(.10, core.peak_width(s))
        candidates = []
        templates = self.templates_for(settings)
        if not can_index:
            models = []
        elif settings['scale_mode'] == 'fixed':
            models = core.search(s['peaks'], templates, settings['scale'], tol, bcc_a=settings['bcc_a'], candidate_sink=candidates, fcc_a=settings['fcc_a'], g_max=settings['g_max'], g_min=settings['g_min'])
            for model in candidates:
                model.update({'scale_mode': 'fixed', 'scale_a': settings['scale'],
                              'scale_c': settings['scale'] if model['phase'] == 'HCP' else None,
                              'fitted_a_nm': model['nominal_a_nm']/settings['scale'],
                              'fitted_c_nm': model['nominal_c_nm']/settings['scale'] if model['phase'] == 'HCP' else None,
                              'scale_parameter_count': 0, 'position_score': model['score'],
                              'position_valid': model['valid'], 'scale_penalty': 0.,
                              'scale_penalty_strength': 0.})
        else:
            models = scale_fitting.search(s['peaks'], templates, tol,
                                          settings['scale_mode'], bcc_a=settings['bcc_a'],
                                          scale_penalty_strength=settings['scale_penalty_strength'],
                                          candidate_sink=candidates, fcc_a=settings['fcc_a'], g_max=settings['g_max'], g_min=settings['g_min'])
        if can_index:
            if not direct:
                context = peak_evidence.prepare(s, crop.shape, sx, sy)
            s['weak_maxima'] = context['maxima']
            for model in candidates:
                peak_evidence.inspect(model, context)
                peak_evidence.apply(model, settings['peak_evidence_weight'])
            models = (core.retain if settings['scale_mode'] == 'fixed' else scale_fitting.retain)(candidates)
        classification = self.classify(s, models, settings, width_nm, height_nm, can_index)
        periodicity = core.purity(s['peaks'], tol, g_max=settings['g_max'], g_min=settings['g_min']) if can_index else {'status': 'unresolved_pattern', 'substantial_second_pattern': False}
        log = s.pop('log')
        # Return an encoded log-power field; display contrast is adjusted in the browser only.
        if images:
            lo, hi = float(log.min()), float(log.max())
            display = Image.fromarray(np.uint8(np.clip((log-lo)/max(hi-lo,1e-12),0,1)*255))
            display.thumbnail((768,768), Image.Resampling.NEAREST)
            stream=BytesIO(); display.save(stream,format='PNG')
            encoded = {'fft': data_url(stream.getvalue())}
            if not direct:
                encoded['crop'] = data_url(png(crop, item['limits'], 768))
            # Carry a precise log field for reversible display curves. The original
            # FFT and peak fitting above are unchanged. RGB stores high/low bytes.
            precise = Image.fromarray(np.uint16(np.clip((log-lo)/max(hi-lo, 1e-12), 0, 1)*65535))
            precise.thumbnail((768, 768), Image.Resampling.NEAREST)
            values = np.asarray(precise, dtype=np.uint16)
            packed = np.zeros((*values.shape, 3), dtype=np.uint8)
            packed[..., 0] = values >> 8
            packed[..., 1] = values & 255
            stream = BytesIO(); Image.fromarray(packed).save(stream, format='PNG')
            encoded.update({'fft_log16': data_url(stream.getvalue()), 'fft_log_limits': [lo, hi]})
        else:
            encoded = {}
        result = {'roi': roi, 'image_kind': info.get('image_kind', 'real_space'),
                'width_nm': width_nm, 'height_nm': height_nm, 'settings': settings,
                'spectrum': s, 'models': models, 'classification': classification,
                'periodicity': periodicity, 'images': encoded,
                'elapsed_ms': round((time.perf_counter()-started)*1000, 1),
                'engine_sha256': self.version}
        if cache_candidates:
            # Internal, compressed pool: never serialize it into API/saved output.
            result['_fit_cache'] = zlib.compress(json.dumps(candidates, separators=(',', ':'), allow_nan=False).encode(), 1)
        return result

    def classify(self, s, models, settings, width_nm, height_nm, can_index=True):
        classification = phase_comparison.classify(s['peaks'], models, s['df'])
        if settings['scale_mode'] != 'fixed':
            classification['flags'].append('Prediction scales are fitted independently in this region (0.85–1.15). Fitted lattice dimensions depend on the image calibration used.')
            if settings['scale_mode'] == 'auto_hcp_ac' and 'HCP' in settings.get('enabled_phases', PHASES):
                classification['flags'].append('HCP has an extra fitting parameter where c is visible. Scale penalties discourage large adjustments; the separate shared-evidence check retains unresolved model tradeoffs.')
            if settings['scale_penalty_strength']:
                classification['flags'].append(
                    f"Scale penalty strength {settings['scale_penalty_strength']:.3f}: scale cost subtracts "
                    'the mean squared reciprocal-scale deviation, normalized to 5%. This is an adjustable preference, not a measured strain limit.')
            primary = classification.get('primary_model')
            if primary and primary.get('scale_at_bound'):
                classification['flags'].append('The leading fit reaches an automatic scale limit.')
            if primary and primary.get('scale_note'):
                classification['flags'].append(primary['scale_note'])
        if settings.get('peak_evidence_weight', 0):
            classification['flags'].append('Prediction-site evidence is an exploratory ranking adjustment. Weak maxima are checked against local background and rotated controls; they do not count toward the initial fit screen or separate-pattern criteria. Missing spots are not proof of an absent reflection.')
        if not can_index:
            classification['label'] = 'insufficient'
            classification['flags'].append('No usable sampling in the phase-fitting band.' if s.get('kind') == 'diffraction' else f"The stored sampling does not cover the full {settings.get('g_min', 3.):g}–{settings['g_max']:g} nm⁻¹ fitting band; lower the outer limit to enable phase fitting.")
        # Report the actual window broadening rather than the original fixed 5 nm example.
        classification['flags'] = [f for f in classification['flags'] if not f.startswith('At ~5nm, Hann broadening')]
        if s.get('kind') == 'diffraction':
            classification['flags'] = [f.replace('HRTEM contrast transfer can suppress spots',
                'diffraction intensities depend on excitation and thickness') for f in classification['flags']]
            classification['flags'].append(f"Direct detector spots, without an FFT. Verify the beam centre and reciprocal calibration; fitting uses the {settings.get('g_min', 3.):g}–{settings['g_max']:g} nm⁻¹ band.")
            classification['flags'].append(f"Matching radius {max(.10, core.peak_width(s)):.3f} nm⁻¹ uses the estimated spot width with a 0.10 nm⁻¹ floor. Opposite spots are grouped once; only observed spots are marked.")
            translation = s.get('center_refinement', {})
            if translation.get('enabled') and not translation.get('applied'):
                classification['flags'].append('Translation refinement: '+translation['reason'])
            elif translation.get('near_limit'):
                classification['flags'].append('The fitted centre is near the translation limit; verify its position.')
            if not s['full_band_on_detector']:
                classification['flags'].append('The detector does not cover the entire fitting band. Predictions outside the detector or inside exclusions are unchecked.')
            if s['mask_count']:
                classification['flags'].append('Manual exclusion rectangles remove spots from detection and leave obscured prediction profiles unchecked when neither opposite position is visible.')
            return classification
        window = settings.get('fft_window', 'hann')
        if s['df'] > .15:
            window_name = 'Hann' if window == 'hann' else 'rectangular'
            classification['flags'].append(
                f"This {min(width_nm, height_nm):.2f} nm region has an approximate {window_name}-window peak width of "
                f"{core.peak_width(s):.3f} nm⁻¹; closely spaced candidate reflections may not be distinguishable.")
        if window == 'none':
            classification['flags'].append('Hann window is off: crop-edge streaks and side lobes can produce extra detected peaks.')
        return classification

    def cached_models(self, result, settings):
        if '_fit_cache' not in result:
            raise ValueError('Run a grid on the current engine to enable cached rescoring.')
        candidates = json.loads(zlib.decompress(result['_fit_cache']))
        candidates = [model for model in candidates if model['phase'] in settings.get('enabled_phases', PHASES)]
        for model in candidates:
            if settings['scale_mode'] != 'fixed':
                c = model.get('scale_c') if model.get('scale_parameter_count') == 2 else None
                scale_fitting.penalize(model, model['scale_a'], c, settings['scale_penalty_strength'])
            peak_evidence.apply(model, settings.get('peak_evidence_weight', peak_evidence.DEFAULT_WEIGHT))
        return candidates

    def rescore(self, result, strength, evidence_weight=None):
        """Only ranking/classification changes; all measured evidence is reused."""
        strength = float(strength)
        if not np.isfinite(strength) or not 0 <= strength <= .5:
            raise ValueError('Scale penalty must be between 0 and 0.5.')
        settings = {**result['settings'], 'scale_penalty_strength': strength}
        if evidence_weight is not None:
            settings['peak_evidence_weight'] = float(evidence_weight)
        candidates = self.cached_models(result, settings)
        models = (core.retain if settings['scale_mode'] == 'fixed' else scale_fitting.retain)(candidates)
        classification = self.classify(result['spectrum'], models, settings,
                                       result['width_nm'], result['height_nm'])
        return {**result, 'settings': settings, 'models': models, 'classification': classification}
