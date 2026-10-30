"""DM4 input and reusable single-region analysis, independent of the web UI."""
from parallel_execution import configure_numeric_threads
configure_numeric_threads()
from concurrent.futures import CancelledError
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
from acquisition_map import MetadataIndex, stage_position, reference_crop, LENGTH_NM
from preview_files import sidecar_path
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
            ['analysis_core.py', 'materials.py', 'crystal_templates.py', 'diffraction.py', 'scale_fitting.py', 'phase_comparison.py', 'peak_evidence.py', 'adaptive_refinement.py', 'demo_data.py', 'engine.py', 'parallel_execution.py', 'templates.json'])).hexdigest()
        self.files = {}
        self.loaded = {}
        self.acquisition_index = MetadataIndex()

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
                rows.append({'id': file_id, 'name': path.stem, 'sample': sample,
                             'has_preview': sidecar_path(path).is_file()})
        return rows

    def dm_reader(self):
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
                    raise ValueError('Install ncempy in the app Python environment to open DM4 files, or configure dm_reader in .tem-paths.json. The optional demo pack uses original DM4 files and needs the same reader.') from exc
        return self.reader

    def read_dm4(self, path):
        with self.dm_reader().fileDM(path, on_memory=False) as f:
            meta = f.getMetadata(0)
            array = np.asarray(f.getDataset(0)['data'])
        return array, meta

    def acquisition_locations(self, file_id):
        catalog = self.catalog()
        current = next((row for row in catalog if row['id'] == file_id), None)
        if current is None:
            raise ValueError('Choose an image before opening the acquisition map.')
        rows, errors = [], []
        for entry in catalog:
            if entry['sample'] != current['sample']:
                continue
            path = self.files.get(entry['id']) or demo_data.DEMOS.get(entry['id'], {}).get('source')
            if path is None:
                errors.append({'name': entry['name'], 'error': 'No original DM4 metadata available.'})
                continue
            try:
                info = self.acquisition_index.read(path, self.dm_reader())
                rows.append({**entry, **info, 'folder': str(Path(entry['id']).parent)})
            except Exception as exc:
                errors.append({'name': entry['name'], 'error': str(exc)})
        return {'sample': current['sample'], 'files': rows, 'errors': errors,
                'stage_units': None}

    def acquisition_reference_crop(self, file_id, bounds):
        if file_id in demo_data.DEMOS:
            array, metadata = demo_data.load(file_id, reader=self.read_dm4)
        else:
            path = self.files.get(file_id)
            if not path or not path.resolve().is_relative_to(self.data_root):
                raise ValueError('Choose a reference from the configured data folder.')
            array, metadata = self.read_dm4(path)
        if any(str(metadata.get(f'Calibrations Dimension {d} Units', '')).strip() not in LENGTH_NM for d in (1, 2)):
            raise ValueError('Reference crops require a real-space image.')
        return reference_crop(array, bounds)

    def file_preview(self, file_id):
        path = self.files.get(file_id)
        if not path or not path.resolve().is_relative_to(self.data_root):
            raise ValueError('Choose a DM4 from the configured data folder.')
        array, meta = self.read_dm4(path)
        if array.ndim != 2 or min(array.shape) < 1 or not np.isfinite(array).all():
            raise ValueError('Preview requires a finite two-dimensional image.')
        units = [str(meta.get(f'Calibrations Dimension {d} Units', '')).strip() for d in (1, 2)]
        if all(diffraction.reciprocal_factor(unit) is not None for unit in units):
            array = np.log1p(np.maximum(array, 0))
        return png(array, max_size=1400)

    def load(self, file_id):
        if file_id in self.loaded:
            return self.loaded[file_id]
        is_demo = file_id in demo_data.DEMOS
        if is_demo:
            array, meta = demo_data.load(file_id, reader=self.read_dm4)
            name = demo_data.DEMOS[file_id]['name']
        else:
            path = self.files.get(file_id)
            if not path or not path.resolve().is_relative_to(self.data_root):
                raise ValueError('Choose an installed demo or a DM4 from the configured TEM folder.')
            array, meta = self.read_dm4(path)
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
                'device': str(meta.get('Acquisition Device Name', '')),
                'stage_position': stage_position(meta)}
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
        values = {k: float(settings.get(k, v)) for k, v in [('scale', 1.), ('g_min', 3.), ('g_max', 10.), ('threshold', .35), ('scale_penalty_strength', scale_fitting.DEFAULT_SCALE_PENALTY), ('ca_penalty_strength', scale_fitting.DEFAULT_CA_PENALTY), ('peak_evidence_weight', peak_evidence.DEFAULT_WEIGHT)]}
        if not all(np.isfinite(v) for v in values.values()):
            raise ValueError('Analysis settings must be finite numbers.')
        if not (.85 <= values['scale'] <= 1.15 and 0 <= values['g_min'] < 30 and 4 <= values['g_max'] <= 30 and .15 <= values['threshold'] <= .7 and 0 <= values['scale_penalty_strength'] <= .5 and 0 <= values['ca_penalty_strength'] <= .5 and 0 <= values['peak_evidence_weight'] <= .5):
            raise ValueError('Analysis settings are outside the supported range.')
        detector_defaults = {'fft_smoothing_sigma': .65, 'fft_threshold_floor': 1.8,
                             'fft_minimum_enrichment': 3., 'fft_minimum_separation': .12,
                             'fft_max_peaks': 70}
        detector = {key: float(settings.get(key, default)) for key, default in detector_defaults.items()}
        if not all(np.isfinite(v) for v in detector.values()) or not (
                0 <= detector['fft_smoothing_sigma'] <= 3 and 0 <= detector['fft_threshold_floor'] <= 20 and
                0 <= detector['fft_minimum_enrichment'] <= 20 and 0 <= detector['fft_minimum_separation'] <= 3 and
                4 <= detector['fft_max_peaks'] <= 200 and detector['fft_max_peaks'].is_integer()):
            raise ValueError('Use FFT smoothing 0–3 bins, threshold floor and strength 0–20, separation 0–3 nm⁻¹, and 4–200 whole peak profiles.')
        detector['fft_max_peaks'] = int(detector['fft_max_peaks'])
        values.update(detector)
        values.update(reference_settings(settings))
        mode = settings.get('scale_mode', 'fixed')
        if mode not in scale_fitting.MODES:
            raise ValueError('Choose a supported scale fitting mode.')
        values['scale_mode'] = mode
        window = settings.get('fft_window', 'hann')
        remove_mean = settings.get('remove_mean', True)
        if window not in ('hann', 'none') or not isinstance(remove_mean, bool):
            raise ValueError('Choose Hann or no window and a boolean mean-removal setting.')
        auto_strength = settings.get('fft_auto_strength', False)
        if not isinstance(auto_strength, bool):
            raise ValueError('Auto peak strength must be enabled or disabled.')
        objective = settings.get('fft_auto_objective', 'rank')
        if objective not in ('rank', 'geometry'):
            raise ValueError('Choose rank or geometry for automatic peak strength.')
        values.update(fft_window=window, remove_mean=remove_mean, fft_auto_strength=auto_strength, fft_auto_objective=objective)
        if direct:
            values['diffraction'] = diffraction.validate(item['info'], settings.get('diffraction', {}))
            values['g_min'] = values['diffraction']['exclude_radius_nm_inv']
        if values['g_min'] >= values['g_max']:
            raise ValueError('Central exclusion must be smaller than the outer fitting limit.')
        return {'x': x, 'y': y, 'w': w, 'h': h}, values

    def _fit_spectrum(self, s, settings, templates, can_index, context):
        """Compare one detected profile set; the FFT pixels are already prepared."""
        tol = max(.10, core.peak_width(s))
        candidates = []
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
                                          ca_penalty_strength=settings['ca_penalty_strength'],
                                          candidate_sink=candidates, fcc_a=settings['fcc_a'], g_max=settings['g_max'], g_min=settings['g_min'])
        if can_index:
            s['weak_maxima'] = context['maxima']
            for model in candidates:
                peak_evidence.inspect(model, context)
                peak_evidence.apply(model, settings['peak_evidence_weight'])
            models = (core.retain if settings['scale_mode'] == 'fixed' else scale_fitting.retain)(candidates)
        return models, candidates

    def analyze(self, item, roi, settings, images=True, cache_candidates=False, cancel_event=None):
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
            can_index = min(.5/sx, .5/sy) >= settings['g_max']
            auto_strength = settings['fft_auto_strength'] and can_index and bool(settings['enabled_phases'])
            s = core.spectrum(crop, sx, sy, profile_fraction=settings['threshold'],
                              window=settings['fft_window'], remove_mean=settings['remove_mean'], g_max=settings['g_max'], g_min=settings['g_min'],
                              smoothing_sigma=settings['fft_smoothing_sigma'], threshold_floor=settings['fft_threshold_floor'],
                              minimum_enrichment=0. if auto_strength else settings['fft_minimum_enrichment'], minimum_separation=settings['fft_minimum_separation'],
                              max_peaks=settings['fft_max_peaks'])
        templates = self.templates_for(settings)
        if direct:
            models, candidates = self._fit_spectrum(s, settings, templates, can_index, context)
        else:
            # Minimum strength only filters the existing connected components.
            # Reuse one FFT and test every distinct admitted profile set, including
            # stricter cutoffs. Other detector controls and the fit screen stay fixed.
            pool = s['peaks']
            levels = ([s['profile_threshold']] + sorted({p['log_radial_enrichment'] for p in pool})
                      if auto_strength else [settings['fft_minimum_enrichment']])
            geometry_auto = auto_strength and settings['fft_auto_objective'] == 'geometry'
            pool_weight = sum(p['weight'] for p in pool)
            best, attempts, last_count = None, [], None
            for strength in levels:
                if cancel_event is not None and cancel_event.is_set():
                    raise CancelledError('Grid cancelled')
                peaks = [p for p in pool if p['log_radial_enrichment'] >= strength]
                if auto_strength and len(pool) >= 4 and len(peaks) < 4:
                    break
                if len(peaks) == last_count:
                    continue
                last_count = len(peaks)
                trial = {**s, 'peaks': peaks, 'minimum_peak_enrichment': float(strength)}
                if geometry_auto:
                    tolerance = max(.10, core.peak_width(trial))
                    geometry = core.purity(peaks, tolerance, g_max=settings['g_max'], g_min=settings['g_min'])
                    evidence = core.geometry_strength_score(peaks, geometry, pool_weight, tolerance)
                    merit = (evidence['pattern_count'] > 0, evidence['score'], len(peaks))
                    attempts.append({'strength': float(strength), 'profiles': len(peaks), **evidence})
                    if best is None or merit > best[0]:
                        best = (merit, trial, None, None)
                    continue
                context = peak_evidence.prepare(trial, crop.shape, sx, sy) if can_index else None
                trial_models, trial_candidates = self._fit_spectrum(trial, settings, templates, can_index, context)
                passing = [m for m in trial_models if m['valid']]
                leader = max(passing or trial_models, key=lambda m: m['score'], default=None)
                rank = leader['score'] if leader else None
                # Prefer an accepted fit; if none passes anywhere, retain the best
                # rejected fit honestly. Ties retain the larger detected profile set.
                merit = (bool(passing), rank if rank is not None else -float('inf'), len(peaks))
                attempts.append({'strength': float(strength), 'profiles': len(peaks),
                                 'rank': rank, 'passing': bool(passing)})
                if best is None or merit > best[0]:
                    best = (merit, trial, trial_models, trial_candidates)
            _, s, models, candidates = best
            if geometry_auto:
                context = peak_evidence.prepare(s, crop.shape, sx, sy)
                models, candidates = self._fit_spectrum(s, settings, templates, can_index, context)
            if settings['fft_auto_strength']:
                s['auto_peak_strength'] = {
                    'status': 'optimized' if auto_strength else 'skipped',
                    'selected_strength': s['minimum_peak_enrichment'],
                    'tested_sets': len(attempts) if auto_strength else 0,
                    'objective': settings['fft_auto_objective'],
                    'selection': ('geometry_supported' if best[0][0] else 'no_geometry') if geometry_auto else ('passing' if best[0][0] else 'below_threshold' if models else 'no_fit'),
                    'trials': attempts if auto_strength else [],
                }
        tol = max(.10, core.peak_width(s))
        classification = self.classify(s, models, settings, width_nm, height_nm, can_index)
        periodicity = core.purity(s['peaks'], tol, g_max=settings['g_max'], g_min=settings['g_min']) if can_index else {'status': 'unresolved_pattern', 'substantial_second_pattern': False}
        log = s.pop('log')
        detector_signal = s.pop('detector_signal', None)
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
            if detector_signal is not None:
                signal_lo, signal_hi = float(detector_signal.min()), float(detector_signal.max())
                signal = Image.fromarray(np.uint16(np.clip(
                    (detector_signal-signal_lo)/max(signal_hi-signal_lo, 1e-12), 0, 1)*65535))
                signal.thumbnail((768, 768), Image.Resampling.NEAREST)
                values = np.asarray(signal, dtype=np.uint16)
                packed = np.zeros((*values.shape, 3), dtype=np.uint8)
                packed[..., 0] = values >> 8; packed[..., 1] = values & 255
                stream = BytesIO(); Image.fromarray(packed).save(stream, format='PNG')
                encoded.update(detector_signal16=data_url(stream.getvalue()),
                               detector_signal_limits=[signal_lo, signal_hi])
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
            if settings['scale_mode'] in ('auto_hcp_ac', 'auto_hcp_ratio') and 'HCP' in settings.get('enabled_phases', PHASES):
                classification['flags'].append('HCP has an extra fitting parameter where c is visible. Scale penalties discourage large adjustments; the separate shared-evidence check retains unresolved model tradeoffs.')
            if settings['scale_mode'] == 'auto_hcp_ratio':
                classification['flags'].append(
                    f"Separate scale costs: overall weight {settings['scale_penalty_strength']:.3f}, "
                    f"c/a weight {settings.get('ca_penalty_strength', .10):.3f}. "
                    'Each charges squared log change normalized to log(1.05). '
                    'Overall reciprocal scale is sqrt(a* scale × c* scale); real c/a multiplier is a* scale / c* scale. '
                    'Both are ranking preferences, not measured strain limits. Fits retain the 0.85–1.15 per-axis bounds.')
            elif settings['scale_penalty_strength']:
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
            if s.get('peak_edit_count'):
                classification['flags'].append(f"{s['peak_edit_count']} manual peak edit(s) applied. Manually added observations bypass the automatic contrast cutoff and count as measured profiles; review their positions.")
            return classification
        auto = s.get('auto_peak_strength')
        if auto and auto['status'] == 'optimized':
            classification['flags'].append(
                f"Auto peak strength used {auto['selected_strength']:.3f}, comparing {auto['tested_sets']} detected-profile sets. "
                'Rank was used to select the cutoff; it is not independent confirmation. Cached reweighting keeps these profiles; rerun to optimize the cutoff again.')
        elif auto:
            classification['flags'].append('Auto peak strength was skipped: enable a phase and ensure the image samples the fitting band.')
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
                scale_fitting.penalize(model, model['scale_a'], c, settings['scale_penalty_strength'], settings.get('ca_penalty_strength', .10))
            peak_evidence.apply(model, settings.get('peak_evidence_weight', peak_evidence.DEFAULT_WEIGHT))
        return candidates

    def rescore(self, result, strength, evidence_weight=None, ca_penalty_strength=None):
        """Only ranking/classification changes; all measured evidence is reused."""
        strength = float(strength)
        if not np.isfinite(strength) or not 0 <= strength <= .5:
            raise ValueError('Scale penalty must be between 0 and 0.5.')
        settings = {**result['settings'], 'scale_penalty_strength': strength}
        if evidence_weight is not None:
            settings['peak_evidence_weight'] = float(evidence_weight)
        if ca_penalty_strength is not None:
            ca_penalty_strength = float(ca_penalty_strength)
            if not np.isfinite(ca_penalty_strength) or not 0 <= ca_penalty_strength <= .5:
                raise ValueError('c/a penalty must be between 0 and 0.5.')
            settings['ca_penalty_strength'] = ca_penalty_strength
        candidates = self.cached_models(result, settings)
        models = (core.retain if settings['scale_mode'] == 'fixed' else scale_fitting.retain)(candidates)
        classification = self.classify(result['spectrum'], models, settings,
                                       result['width_nm'], result['height_nm'])
        return {**result, 'settings': settings, 'models': models, 'classification': classification}
