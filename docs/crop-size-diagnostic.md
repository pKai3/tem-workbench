# Crop-size diagnostic

`tools/crop_size_diagnostic.py` runs the production engine outside the web server. It does not modify app settings, image data or analysis defaults. This is the first diagnostic runner; an in-app panel is deferred until the experiment outputs have been reviewed.

```sh
python tools/crop_size_diagnostic.py \
  --export /path/to/saved_region.json \
  --output /path/to/new-diagnostic-folder \
  --workers 4 --smoothing
```

Use the app's Python environment. Choose a new output directory. Prefer a local directory while calculating, then copy the completed folder to cloud storage. A failed run can be continued using the same arguments and `--resume`; source metadata, settings, engine version and sampling plan must agree. Completed crop/mode groups are recovered from their numerical exports. `--smoke` runs the central 4 nm crop in all three modes.

## Experiment

- Nine centres at 25%, 50% and 75% of each image dimension, with 4, 6, 8, 12 and 20 nm square crops.
- Additional centred 30 nm and full-image crops. Crops that do not fit are omitted, never shifted or clipped. Pixel rounding and actual dimensions are recorded.
- Manual minimum strength from the supplied export; geometry-auto; rank-auto. All other settings are shared.
- Optional `--smoothing`: at centred 4, 8, 20 nm and full-image crops, compare sigma 0, 0.35 and 1.3 FFT bins, plus constant reciprocal sigma 0.065 nm^-1. Baseline retains the supplied sigma. The constant physical setting is sigma_bins = 0.065 / df and is omitted outside the engine's 0–3 bin range. This is a controlled comparison, not automatic smoothing optimization.
- Four spawned workers by default; each reads the same temporary memory-mapped source with one FFT thread. Workers analyze all three modes of their assigned crop sequentially.

The source is resolved against the configured data root and checked against the saved pixel hash. Currently only square, equally calibrated real-space images are supported. Region or grid exports supply settings. A region's primary model supplies the expected zone/mirror/in-plane angle; use `--expected-zone u v w` to change the zone criterion. The evaluation phase is currently HCP. A grid export without a primary model evaluates any HCP orientation. This expected solution never enters detection or matching. The strict orientation check uses the same three-index representation and mirror as the reference, within 5 degrees modulo 180; it is not a general crystallographic symmetry-equivalence test. Broad HCP acceptance is reported separately.

## Outputs

- `index.html`: diagnostic plots and per-crop links to raw/processed FFT previews, results and trial traces.
- `metrics.csv`, `summary_by_size.csv`: detection, timing, fit, lattice and acceptance metrics, including rejected fits.
- Per-crop `*_fields.npz`: numerical log-power FFT, processed detector signal and extent; `*_pool.json.gz`: the initially admitted profile pool before the minimum-strength sweep.
- Per-crop/mode `*.json.gz`: selected production result, all explored selected-threshold candidates, expected-solution metrics and cached-candidate rescoring with overall, ratio, peak-evidence or all penalties disabled.
- `*_trials.json.gz`: all crystal-fit calls (all thresholds for rank-auto, selected threshold for geometry-auto), with peaks, candidates and retained models. Geometry trials also retain reconstructed geometry fits and the production objective values. No crystal matching is secretly added to geometry-auto's selection.
- `manifest.json`: source, settings, original/export engine hashes, diagnostic runner hash, worker count and sampling plan.

Engine timing excludes the diagnostic's independent field reconstruction, plot rendering and trace serialization. Rescoring-only ablations reuse the explored candidate pool; they do not refit scales, add peaks or re-optimize thresholds. They cannot reveal candidates that the original search never explored.

Nested/overlapping crops are correlated. At 30 nm and full-image size there is only one centre. Passing rate here measures internal consistency with a working hypothesis, not validated accuracy. Manually checked peak sets, 1203 and mixed-pattern controls remain separate follow-up experiments before any defaults are changed.
