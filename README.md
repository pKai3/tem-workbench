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
3. Select a scale-fitting mode and inspect candidate support, residuals, model dimensions and prediction-scale changes.
4. Choose FFT overlays. The default shows the best HCP and best BCC fits; individual-fit controls also expose rejected candidates.
5. Run a grid and click cells to inspect their detailed FFTs. Save results before stopping the server.

FFT brightness, background, white point and colour are display controls. The reset icon beside the white-point field restores the background and white-point defaults. These controls do not alter detected peaks or fitted coordinates.

### Grid analysis

The initial grid defaults to **20 × 20** cells. Adaptive mode subdivides unresolved or ambiguous cells, cells supporting two candidate structures, and cells with substantial secondary periodicity. Subdivision stops when the next children would fall below the selected physical size or the 32-pixel minimum. The default physical stopping limit is 5 nm; it is adjustable.

The colour legend and zone-symbol legends appear below the image. Blue symbols identify the best HCP zone and gold symbols identify the best BCC zone. Both structures reuse the same symbol set. Faded symbols indicate candidates below the acceptance threshold; showing both is not evidence of phase coexistence. HCP directions use four indices, BCC directions use three, and negative indices carry an overbar.

**Cancel** retains a partial grid. **Clear grid** clears the displayed map and cancels an active run without deleting saved results. Area summaries use current leaf cells and exclude subdivided parents.

### Scale fitting and rescoring

The reference lattice dimensions are HCP **a = 0.295 nm, c = 0.468 nm** and BCC **a = 0.330 nm**. Available modes include fixed comparisons, automatic uniform scaling for each structure, and automatic BCC uniform / HCP independent a-and-c scaling. Dataset-specific comparison presets are illustrative, not transferable microscope calibrations.

Automatic reciprocal-scale multipliers are bounded to **0.85–1.15**. Scaling moves predicted reflections; measured FFT axes remain tied to the stored image calibration. Model lattice dimensions change inversely with reciprocal scale. Zones without c-sensitive reflections cannot determine HCP c.

The adjustable scale penalty is:

```text
penalty = strength × mean[((reciprocal multiplier − 1) / 0.05)²]
rank score = position score − penalty
```

At the default strength of 0.10, a uniform 5% adjustment costs 0.10 score and a 10% adjustment costs 0.40. Independent HCP a* and c* costs are averaged. Zero disables the penalty; fixed-scale modes are not penalized.

Changing the penalty reweights completed or cancelled automatic-scale grids from cached hypotheses, including fits discarded from the displayed shortlist. It does not repeat the grid FFTs or coordinate fitting. Labels, totals and zone symbols update; **existing cell boundaries stay fixed**. Run a new adaptive grid to recompute subdivision under the new penalty.

Caches are held in memory and disappear when the server stops. Saved JSON records initial settings, current settings and rescoring metadata, but does not contain the internal candidate cache.

## Interpretation and limitations

- The library contains **46 HCP/BCC templates**, including mirror variants, from a limited set of zone axes. Other structures and untested orientations can affect results.
- Peak detection and matching currently use the **3–10 nm⁻¹** band. The inner cutoff is a heuristic; longer-period signals outside that band are excluded.
- Support measures weighted detected Fourier evidence. Neither support nor rank score is a phase probability or phase fraction.
- The scale penalty is a preference for smaller adjustments, not a calibrated strain prior. Calibration errors can change candidate rankings.
- Independent HCP a/c fitting adds flexibility. The penalty is not a statistical correction for the number of fitted parameters.
- Matches/predictions exposes unsupported model positions. There is currently no explicit penalty per missing reflection and no second search that recovers weak peaks at predicted positions. HRTEM contrast transfer can suppress allowed reflections.
- A conservative shared-evidence check retains ambiguity when competing structures explain the same detected profiles and the leading fit requires additional flexibility or unsupported predictions.
- Small regions broaden FFT peaks, limiting separation of nearby reflections. Image-calibrated fits alone do not establish lattice strain.

Supported input is finite, two-dimensional real-space data with equal x/y pixel calibration. Automatic grids currently require square images. Direct diffraction analysis and arbitrary region masks are not supported by this interface.

## Development

| Component | Responsibility |
| --- | --- |
| `analysis_core.py` | FFT processing, peak detection, fixed-scale matching and geometry checks. |
| `scale_fitting.py` | Bounded automatic scale fitting, candidate ranking and cached reranking. |
| `phase_comparison.py` | Prediction counts and shared-evidence ambiguity checks. |
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
