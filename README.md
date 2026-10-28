# TEM Workbench

A local web application for exploring transmission electron microscopy images through movable-region FFTs, automatic peak detection, and HCP/BCC candidate fitting.

The interface pairs real-space images with reciprocal-space previews and supports uniform or adaptive grids for spatial comparison. Analysis runs locally in Python. The frontend uses plain HTML, CSS and JavaScript, with no build step.

**Phase labels are exploratory candidate assignments, not confirmed phase identities or phase fractions.**

## Features

- Move and resize a region to inspect its FFT, detected maxima and fitted crystal patterns.
- Compare HCP and BCC candidates, including rejected fits and phase-independent geometry fits.
- Fit a uniform prediction scale, or independent HCP basal and c-axis scales.
- Adjust a scale penalty and reweight a completed grid from cached fits.
- Map candidate labels and zone axes, with separate HCP/BCC symbols and legends.
- Run uniform or adaptive grids and inspect area-weighted result summaries.
- Adjust FFT colour, brightness and contrast independently of numerical analysis.
- Save region and grid results as JSON with settings, source pixel hashes and engine provenance.
- Explore a bundled, full-resolution ST1221 demonstration image without external data.

## Quick start

Python 3.12 is the tested environment. Numerical dependencies are listed in [requirements.txt](requirements.txt).

```sh
git clone https://github.com/pKai3/tem-workbench.git
cd tem-workbench
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py --demo --open
```

On Windows, create the environment with `py -m venv .venv` and activate it with `.venv\Scripts\Activate.ps1` in PowerShell before running the installation and server commands.

The server normally listens at **http://127.0.0.1:8767**. Use `--port 8768` to select another port. Stop a terminal-launched server with Ctrl+C. This application is intended for local use, not public web hosting.

Without `.tem-paths.json`, the application starts with the bundled demo. `--demo` explicitly selects demo-only mode even when a configuration file exists.

### macOS launcher

After installing the Python dependencies, double-click **Install TEM Workbench App.command** to build a Dock application in `~/Applications`. Building the launcher requires macOS 13 or newer and Apple Command Line Tools or Xcode.

The launcher provides **Start/Stop**, **Open Workbench** and **View log** controls. It uses the repository checkout and a separate Python environment; it is not a standalone Python distribution. Keep the checkout in place, or reinstall the launcher after moving it. Closing the window leaves the application running; quitting stops the server it started.

**Launch TEM Workbench.command** is also available for terminal-based startup. The launcher uses `TEM_WORKBENCH_PYTHON` when set, otherwise the configured Python executable, the checkout's `.venv`, or `python3` as applicable.

## Opening DM4 images

Copy [tem-paths.example.json](tem-paths.example.json) to `.tem-paths.json` and set the following fields. The local configuration is excluded from Git.

| Field | Purpose |
| --- | --- |
| `data_root` | Absolute path to the TEM data directory. |
| `output_root` | Results directory, which must be inside `data_root`. |
| `dm_reader` | Absolute path to a compatible `ncempy.io.dm` Python module. |
| `python_executable` | Python executable used by the launcher. |
| `default_file` | Optional image path relative to `data_root`, or `demo/st1221`. |

The current catalog scans `.dm4` files recursively under `STA` and `ST` subdirectories:

```text
TEM/
├── STA/
│   └── example.dm4
├── ST/
│   └── example.dm4
└── Analysis/
    └── tem_workbench/
```

External DM4 loading uses the [openNCEM DM reader](https://openncem.readthedocs.io/en/latest/ncempy.io.dm.html). To install ncempy in the active environment and locate its reader module:

```sh
python -m pip install ncempy
python -c "import ncempy.io.dm as dm; print(dm.__file__)"
```

Set `dm_reader` to the printed path, then start with `python server.py --open`. The bundled demo does not require ncempy. Source microscope files are read only.

### Bundled demo

ST1221 is a Grade 9 titanium image containing the original **4096 × 4096 float32 pixels** and stored calibration. The archive is losslessly compressed; loading verifies the reconstructed pixel checksum. It is an inspection example, not a labelled phase-identification standard. See [demo/README.md](demo/README.md) for format and provenance details.

With a data configuration, all results use `output_root`. In demo-only mode, results go to the user's application-data directory under `TEM Workbench/Demo/Analysis/tem_workbench` on macOS and Windows, or `tem-workbench/demo/Analysis/tem_workbench` on Linux.

## Workflow

1. Select an image. Favourites provide a shorter image list.
2. Drag the region box or resize its corner. Arrow keys move it by 10 pixels; Shift+arrow moves it by 50.
3. Select a scale-fitting mode and inspect candidate rank, peak coverage, residuals, model dimensions and prediction-scale changes. Candidate tables are sorted by rank, highest first; geometry-only checks have a separate score group.
4. Choose FFT overlays. The default shows the best HCP and best BCC fits; individual-fit controls also expose rejected candidates.
5. Run a grid and click cells to inspect their detailed FFTs. Save results before stopping the server.

FFT brightness, background, white point and colour are display controls. The reset icon beside the white-point field restores the background and white-point defaults. These controls do not alter detected peaks or fitted coordinates.

The **FFT processing** row above Scale fitting controls **Hann window**, **Remove mean**, and the peak threshold. Windowing and mean removal default to on, preserving the original computation. Turning Hann off uses the rectangular crop. These affect the FFT and detected peaks, so changing them recalculates the selected region and clears the previous grid. Saved analyses record both choices. Display controls remain separate.

Window widths used for matching and weak-peak checks follow the selected window (approximately 1.44 FFT bins for Hann or 0.886 for a rectangular crop, with existing minimum tolerances). Windowing suppresses side lobes at the cost of a wider central peak; see the [SciPy spectral-analysis guide](https://docs.scipy.org/doc/scipy/tutorial/signal.html#spectral-analysis).

### Remembered settings

Basic preferences are saved automatically in browser local storage: the last image, region width, scale-fitting mode and custom scale, ranking weights, FFT processing and peak threshold, grid size and stopping limit, adaptive options, grid visibility, and FFT display/overlay controls. Analysis controls carry across images; a new image opens with a centred region at the remembered physical width, limited to the image size. Existing display preferences and favourites are retained.

These preferences survive browser and app restarts at the same address in the same browser profile. Clearing site data resets them. This stores settings only: grids, analysis results and individual candidate-overlay selections are not restored. Use **Save region** or **Save grid results** for analysis output.

### Grid analysis

The initial grid defaults to **20 × 20** cells. Adaptive mode subdivides unresolved or ambiguous cells, cells supporting two candidate structures, and cells with substantial secondary periodicity. Subdivision stops when the next children would fall below the selected physical size or the 32-pixel minimum. The default physical stopping limit is 5 nm; it is adjustable.

Optional **Check passing regions** trials four children even when a parent has a supported single-phase candidate. A child must support a different phase/zone, or separate strong evidence for another pattern. The alternative is compared against the parent’s phase/zone fitted to **that same child**, using the complete retained hypothesis pool. It must pass when that family fails, or beat its passing fit by at least 0.08 ranking score. Raw parent and child scores are never compared. Children that merely become weaker, ambiguous, or keep the same phase/zone do not replace the parent. Accepted children can be checked again down to the stopping limit. This is a heuristic check within the limited template library, not a global optimum.

The parent stays visible until all four trial children finish. Rejected trial subdivisions are retained in saved results but excluded from map counts and area. Cancellation during a trial retains its parent. The grid summary reports parents retained and subdivided after these checks.

The colour legend and zone-symbol legends appear below the image. Blue symbols identify the best HCP zone and gold symbols identify the best BCC zone. Both structures reuse the same symbol set. Faded symbols indicate candidates below the acceptance threshold; showing both is not evidence of phase coexistence. HCP directions use four indices, BCC directions use three, and negative indices carry an overbar.

**Cancel** retains a partial grid. **Clear grid** clears the displayed map and cancels an active run without deleting saved results. Area summaries use current leaf cells and exclude subdivided parents.

### Scale fitting and rescoring

The reference lattice dimensions are HCP **a = 0.295 nm, c = 0.468 nm** and BCC **a = 0.330 nm**. The default is automatic BCC uniform / HCP independent a-and-c scaling. Automatic uniform scaling for both structures, stored scale and custom comparison scale are also available. The last-used mode carries across images and restarts; removed preset choices fall back to the automatic default.

Automatic reciprocal-scale multipliers are bounded to **0.85–1.15**. Scaling moves predicted reflections; measured FFT axes remain tied to the stored image calibration. Model lattice dimensions change inversely with reciprocal scale. Zones without c-sensitive reflections cannot determine HCP c.

The adjustable scale penalty is:

```text
penalty = strength × mean[((reciprocal multiplier − 1) / 0.05)²]
rank score = position score − scale penalty + weak-peak bonus − missing-prediction cost
```

At the default strength of 0.10, a uniform 5% adjustment costs 0.10 score and a 10% adjustment costs 0.40. Independent HCP a* and c* costs are averaged. Zero disables the penalty; fixed-scale modes are not penalized.

Changing the scale penalty or peak-evidence weight reweights completed or cancelled grids from cached hypotheses, including fits discarded from the displayed shortlist. The scale penalty applies only in automatic modes; peak-evidence weight also works with fixed scales. It does not repeat the grid FFTs or coordinate fitting. Labels, totals and zone symbols update; **existing cell boundaries stay fixed**. Run a new adaptive grid to recompute subdivision and passing-region checks under the new weights.

Caches are held in memory and disappear when the server stops. Saved JSON records initial settings, current settings and rescoring metadata, but does not contain the internal candidate cache.

### Weak and missing peaks

Prediction-site evidence supplements the original strong-peak detector. It uses the existing FFT; neither image pixels nor the FFT coordinates are changed. The same procedure applies to both structures:

1. Find additional local maxima without reference to any crystal template, using the radially background-subtracted, smoothed log-power field. Require enrichment of at least 1.8 and local contrast of at least 2 robust background spreads, measured in an annulus two to four search radii away.
2. Exclude maxima within one search radius of an original strong profile and merge nearby weak maxima. Opposite spots count once. The search radius is the selected window’s approximate power peak width, with a minimum of 0.10 nm⁻¹.
3. Match remaining prediction positions one-to-one to weak maxima within that radius. Positions too near the 3–10 nm⁻¹ boundary or another prediction are left unchecked. Weak evidence is capped at half credit per maximum and decreases with positional error.
4. Subtract average support at 11 rotated control patterns at the same radii from the weak-support bonus. This is a chance-match heuristic, not a statistical confidence test.

**Peak-evidence weight** defaults to 0.10; zero disables both adjustments. The bonus is the weight times positive excess weak support per prediction. The missing-prediction cost is the weight times the fraction of assessable predictions with neither strong nor qualifying weak support. Both terms are shown separately under **Prediction-site evidence** and in rank tooltips. The main and individual-fit tables show original strong + weak counts separately.

Weak maxima can change candidate ranking but **do not supply the four-profile acceptance requirement or the unique profiles required for two candidate structures**. The conservative shared-strong-evidence ambiguity check remains active. Short-dashed prediction rings and small white centre dots identify weak maxima; dotted rings have no assigned maximum, faint rings are unchecked, and long dashes indicate a rejected fit.

These adjustments do not simulate reflection intensities, thickness, defocus or the contrast transfer function. Allowed reflections can be attenuated by [image contrast transfer](https://abtem.github.io/doc/user_guide/walkthrough/contrast_transfer_function.html). Unsupported predictions are therefore a modest ranking cost, not proof of absence; local-contrast thresholds and weights remain exploratory.

## Interpretation and limitations

- The library contains **46 HCP/BCC templates**, including mirror variants, from a limited set of zone axes. Other structures and untested orientations can affect results.
- Peak detection and matching currently use the **3–10 nm⁻¹** band. The inner cutoff is a heuristic; longer-period signals outside that band are excluded.
- Peak coverage is the sum of weights of matched original detected peak profiles divided by the weight of all original detected profiles. Weights use height above the radial background, capped at 1–6; additional weak maxima are excluded. Neither peak coverage nor rank score is an intensity fraction, phase probability or phase fraction.
- The scale penalty is a preference for smaller adjustments, not a calibrated strain prior. Calibration errors can change candidate rankings.
- Independent HCP a/c fitting adds flexibility. The penalty is not a statistical correction for the number of fitted parameters.
- Additional weak maxima and unsupported prediction positions contribute optional heuristic ranking adjustments. HRTEM contrast transfer can suppress allowed reflections; a missing peak is not proof that a structure is absent.
- A conservative shared-evidence check retains ambiguity when competing structures explain the same detected profiles and the leading fit requires additional flexibility or unsupported predictions.
- Small regions broaden FFT peaks, limiting separation of nearby reflections. Image-calibrated fits alone do not establish lattice strain.

Supported input is finite, two-dimensional real-space data with equal x/y pixel calibration. Automatic grids currently require square images. Direct diffraction analysis and arbitrary region masks are not supported by this interface.

## Development

| Component | Responsibility |
| --- | --- |
| `analysis_core.py` | FFT processing, peak detection, fixed-scale matching and geometry checks. |
| `scale_fitting.py` | Bounded automatic scale fitting, candidate ranking and cached reranking. |
| `phase_comparison.py` | Prediction counts and shared-evidence ambiguity checks. |
| `peak_evidence.py` | Independent weak-maxima detection, prediction-site audits and ranking adjustments. |
| `adaptive_refinement.py` | Same-child comparisons for optional refinement of passing parents. |
| `engine.py` | Image loading, region analysis, previews and fit caches. |
| `server.py` | Local HTTP endpoints, grid jobs and JSON exports. |
| `web/` | Buildless browser interface. |
| `demo_data.py`, `demo/` | Bundled example and lossless decoder. |
| `engine_provenance.json` | Numerical provenance and recorded limitations. |

Run the focused numerical checks with:

```sh
python -m unittest discover -s tests
```

The local API provides `/api/config`, `/api/open`, `/api/analyze`, `/api/grid`, `/api/job`, `/api/rescore-grid`, `/api/cancel` and `/api/save`. POST requests require the session token returned by `/api/config`.

After updating Python source, save active results, restart the server and reload the page. Previously saved results retain the engine hash and settings used to produce them.

A lower-priority performance follow-up is parallel grid-cell execution, with bounded memory use, responsive region inspection and reliable cancellation.

## License

[MIT](LICENSE). The macOS launcher includes code adapted from Tensile Workbench; its attribution is retained in [macos/TENSILE-LICENSE](macos/TENSILE-LICENSE). Third-party dependencies retain their respective licences.
