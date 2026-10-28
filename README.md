# TEM Workbench

A small local web interface for DM4 images, movable-region FFTs, automatic peak
detection, HCP/BCC candidate comparison, and uniform or adaptive grid analysis.
Plain HTML/CSS/JavaScript, a Python standard-library HTTP server, NumPy, SciPy,
and Pillow. No JavaScript dependencies or build step.

## Start

On macOS, double-click **Install TEM Workbench App.command** to build a small native app in `~/Applications/TEM Workbench.app`. It uses this checkout and its existing configured Python environment. ST1221 is bundled as a full-resolution, lossless demo; the Python environment is separate. Apple Command Line Tools are needed to compile the launcher.

The app has **Open Workbench**, **View log**, and **Start/Stop** controls. Closing its window leaves it in the Dock; quitting stops only the server it started. Save grid results before stopping. It tries port 8767 first and uses the next available local port if another session is already running. Click **Open Workbench** to open the page; the launcher does not take over an existing browser tab.


The Python environment needs `requirements.txt`. With no `.tem-paths.json`, the
app opens the bundled **ST1221 demo**. It needs no TEM folder or external DM4
reader. On a fresh checkout, create `.venv` and install the requirements there;
the macOS launcher uses that environment when no local settings are present.

To open your own images, copy `tem-paths.example.json` to `.tem-paths.json` and
fill in the local paths. `dm_reader` is the saved ncempy reader from the existing
TEM analysis, loaded only for external DM4 files. That third-party reader remains
outside this repository with its original GPLv3 licence.

Double-click **Launch TEM Workbench.command**, or use:

```sh
python server.py --open
```

Use `python server.py --demo` to run only the bundled demo even when local data settings exist. Demo-only results go to the user application-data folder (`~/Library/Application Support/TEM Workbench/Demo/Analysis/tem_workbench` on macOS). With your usual configuration, demo and research results both use the configured TEM results folder.


The server listens only on `127.0.0.1`, normally port 8767; the Dock app can choose the next free port. Stop a Terminal-launched server with Control-C.
Use `--port 8768` if the default port is occupied. The launcher uses the Python
environment configured in `.tem-paths.json`, or `TEM_WORKBENCH_PYTHON` if set.

## Use

- Choose **Demo → ST1221 · bundled demo** from All images, or a real-space DM4 from the configured STA/ST folders. Selection opens the image immediately. The demo works with movable regions, scale fitting, saving and automatic grids; it preserves the original pixels and calibration. Existing local settings keep their default image.
- Click **☆ Favourite open image** to add it to the separate **Favourites** dropdown. Choosing a favourite opens it immediately; click the star again to remove it. The shortlist is remembered in this browser for this TEM folder.
- **Colour overlay intensity** adjusts the grid fill over the real-space reference image from 0–100%. It does not rerun analysis; grid outlines remain visible. Use **Show grid** to hide the coloured cells. The independent **Zone axes: HCP + BCC** toggle shows both structures’ best fitted zone in each cell: blue HCP on the left and gold BCC on the right. Each phase reuses the same symbol set, with separate legends directly below the image, alongside the colour key. Symbols keep their zone association within a grid as penalties change; faded symbols mean the candidate fails the screen. These are alternative fits, not evidence that both phases coexist. Cells without a fitted candidate have no symbol for that structure.
- Move the box; resize its lower-right handle. Coordinates and width are editable.
  Click the image, then arrow keys nudge ten pixels; Shift moves fifty. The FFT and candidate results update
  as computation completes. The timing line records the coordinates of the result
  being shown; while dragging, these can briefly trail the moving box.
- Choose **FFT brightness**: log power reveals weak background and reflections; linear amplitude gives a darker background. **Background** sets the lower display percentile and **White point** sets the upper percentile. **Auto contrast** restores per-image percentile limits (log: 60–99.8%; linear: 30–99.9%). These controls use a 16-bit encoded log field and do not rerun or change the FFT, measured peak positions or fitting. Choose colour (magma) or greyscale. Maxima markers can be white circles, white crosshairs, or hidden.
  The default overlay is **Best HCP + Best BCC**. **Primary + Secondary Geometry** shows the phase-independent reciprocal grids as purple/teal diamonds. A substantial secondary geometry pattern can trigger adaptive subdivision but does not determine the HCP/BCC phase label. Measured profiles and candidate prediction points can also be overlaid. The candidate table and individual phase-fit list are sorted by support, highest first; this display order does not change the phase decision. Individual fit controls also expose every retained below-threshold candidate and both geometry-only grid fits. Solid rings mark assigned detected peaks; dotted rings mark unassigned predictions from accepted fits; dashed rings flag rejected candidates. Displaying a fit does not accept it. Opposite spots represent one independent profile. HCP zone axes use four-index Miller–Bravais [u v t w] notation and HCP reflection labels use (h k i l); BCC keeps three indices. Negative indices display an overbar. Opposite reflection tooltips carry opposite signs. These are display conversions; saved numerical indices and phase fits are unchanged.
- **Run grid** starts with a uniform grid, defaulting to 20 per side (400 regions). With **Adaptive** checked, unresolved, insufficient, HCP/BCC-ambiguous or two-candidate-structure regions split into four, as do regions with a substantial second independently supported periodic pattern. The two-structure label triggers subdivision even if the separate geometry-only check finds one predominant pattern. This repeats until a supported phase candidate predominates or a further split would make children smaller than the chosen **Stopping limit, nm** (any positive value; default 5 nm) or 32 pixels. The grid-size hint explains when the starting grid is already too fine to subdivide. Limits below 5 nm are allowed; the FFT warning reports the actual Hann broadening at the selected region size. On ST1221, 20 per side starts at about 6 nm, so it cannot split again with a 5 nm stopping size; use a coarser starting grid for refinement. Click a map cell to calculate its detailed FFT. Saved grid settings record the refinement policy and every region records its stopping reason.
- **Grid results** shows current map-region counts and area percentages for every candidate label. Areas are weighted by tile size; subdivided parents are excluded. Running or cancelled grids also show uncovered image area. These are candidate-labelled areas, not confirmed phase fractions.
- **Clear grid**, beside Cancel, clears the map and its legends; it cancels a running grid first. It does not delete saved results or change the selected region.
- Cancel retains a partial result and clearly marks it cancelled. Completed and
  partial grids can be saved. A partial adaptive tree may have pending children.
- **Save region / Save grid results** writes JSON to the configured results folder
  inside TEM, including source pixel hash, region coordinates, settings, peaks,
  candidate fits, calculation timings, and analysis code hash. Nothing overwrites
  the original images or previous analysis.

## Calibration and interpretation

The default is the stored DM4 calibration, shared scale 1.000. HCP references use
a = 0.295 nm and c = 0.468 nm; BCC defaults to a = 0.330 nm. The peak threshold is editable. **Scale fitting** is available for every real-space image:

- **Stored scale** uses a model multiplier of 1.000.
- **Comparison scale ×0.950** reproduces the previous ST1221 model estimate. On other images it is an exploratory comparison, not a calibration measured for that image.
- **Custom comparison scale** enables **Model size ×**, from 0.850 to 1.150.
- **1222 BCC reference** uses the provisional BCC parameter described below with a shared multiplier of 0.950.
- **Auto: single scale for HCP and BCC** fits one uniform reciprocal-space multiplier independently for each candidate in each movable region or grid cell. HCP c/a stays fixed.
- **Auto: BCC single · HCP a + c** fits one multiplier for BCC and independent basal/c reciprocal multipliers for HCP. The HCP deformation is derived from its 3D reciprocal metric, not independent screen x/y stretching. Zones without c-sensitive reflections report c as unconstrained.

The selection is remembered per source pixel hash in this browser. New images start
at stored scale. In fixed modes the multiplier applies to both structures' predicted reciprocal
vectors and stays fixed across a grid. Automatic modes use nominal references (HCP a = 0.295 nm, c = 0.468 nm; BCC a = 0.330 nm) and fit each candidate independently in each region, including adaptive children. Each reciprocal multiplier is bounded to 0.85–1.15. Both modes move prediction points only; measured FFT axes, measured peaks and reported d spacings retain the stored DM4 calibration. A better fit after adjusting model size does not
measure strain, independently calibrate the microscope, or confirm a phase. The
fixed matcher checks absolute distances. Automatic uniform scaling permits the absolute size to vary while retaining each structure's geometric ratios; the HCP two-scale mode additionally varies c/a.

The candidate table keeps support sorting and reports position score, scale penalty, rank score and model a/c dimensions. Individual fit overlays use a compact table that fits the panel width, with wrapped headings, one checkbox per fit, aligned values and a sticky header; rejected candidates and geometry-only grids remain available. Hover over a rank score for its position-minus-penalty breakdown. The position score includes positional agreement and the existing chance-density correction; it is not a probability. Hover over the dimensions, or expand individual fits, to see reciprocal multipliers. Lattice a = reference a / basal multiplier and c = reference c / c multiplier. Fitted dimensions depend on image calibration and do not independently measure strain. HCP gets an extra parameter in the second mode. The scale-magnitude penalty below discourages large adjustments; it is not a statistical correction for the number of free parameters. The shared-evidence check also prevents some overconfident labels. Compare the automatic modes before interpreting an improved HCP fit.

`analysis_core.py` contains the numerical functions from the existing ST1221
analysis. Their source hashes and limitations are in `engine_provenance.json`.
`templates.json` is the same bounded library of 46 HCP/BCC templates, including mirror pairs. This covers a limited set of zone axes, not all crystal orientations. Automatic fitting expands the reflection band for these same zones so resized reflections can enter the visible range; it does not expand orientation coverage. `scale_fitting.py` adds bounded scale/orientation seed searches and local refinement. This is not a guaranteed global optimum. No new
scientific validation or exhaustive phase search is claimed for this interface.
The 0.950 preset and nominal references reproduce only their corresponding
scenario. The fixed-reference view uses the same 0.950 scale and provisional BCC a = 0.32452995 nm from diffraction 1222.

**Scale penalty per 5%**, below the real-space image, defaults to **0.10** and accepts 0–0.5. For automatic modes, each positionally fitted hypothesis receives `strength × mean[((s − 1) / 0.05)²]`, where `s` is its reciprocal-scale multiplier. A single uniform scale is counted once; independent HCP a*/c* costs are averaged, so a uniform change is not penalized twice. An unconstrained c is excluded. A 5% uniform change costs 0.10 at the default; 10% costs 0.40. Zero disables this preference. The value is remembered in the browser and recorded in region/grid results. Fixed comparison modes have zero penalty.

The number field and slider update the selected region and reweight a completed or cancelled grid from cached fits. FFTs, peak detection and candidate-coordinate fitting are not repeated for the grid. The cache includes all refined hypotheses before penalty-dependent deduplication, so changing the penalty can recover previously discarded candidates. It lives in memory as compressed records, is excluded from saved JSON, and is lost when the server stops. A new grid on the updated engine is needed once to populate it. The control is unavailable during a grid run or in fixed-scale modes.

Rescoring updates labels, area totals, best HCP/BCC zones and saved candidate scores. Existing grid boundaries stay fixed. For adaptive maps, the original subdivision decisions and stopping reasons are retained with `initial_settings`; run a new grid if you want subdivision to follow the new penalty. Saved output records the current settings and rescore time separately.

**Rank score = position score − scale penalty.** The cost is applied to every fitted hypothesis before deduplication and best-zone selection, including competition between HCP zone axes. Fitted coordinates themselves are not moved by this ranking preference. Rank score must exceed the existing 0.20 screen; position score and its screen status remain recorded. Distinct zone hypotheses can remain in the retained list even when they explain the same profiles, up to five per phase. Best-fit previews prefer passing candidates; the individual table retains rejected fits. The search is still bounded and does not guarantee a global optimum or spatially smooth orientations. The penalty is an adjustable heuristic anchored to the chosen lattice references, not a measured strain tolerance. A systematic image-calibration error can penalize otherwise correct fits, so its strength should be assessed against reference data rather than tuned to obtain a desired phase.

The candidate table shows **Prediction scale Δ, %** immediately after model a/c: `100 × (reciprocal multiplier − 1)`. HCP reports a* and c* separately; BCC reports its single multiplier. These percentages describe prediction coordinates, not lattice strain. For example a* −13.3% corresponds to model a approximately +15.4% relative to its reference. Unconstrained HCP c remains explicit.

**Matches / predictions** reports one-to-one assigned profiles divided by allowed prediction positions within 3–10 nm⁻¹, counting opposite spots once. The position score only measures positional agreement and its original chance correction. It does not penalize every unobserved allowed reflection, because HRTEM contrast transfer can suppress reflections. `phase_comparison.py` adds a conservative ambiguity guard: when accepted HCP and BCC candidates explain exactly the same detected profiles, the leader by rank score cannot receive a sole phase label if it needs more fitted scale parameters or more unsupported predictions than the rival. Separate-pattern results are preserved. This guard does not claim statistical significance or automatically promote a sparse model. Previous saved results retain their original labels; the engine fingerprint changes and regions/grids must be rerun to use the new comparison.

The region explanation follows the phase-candidate result. The separate geometry-only pattern assessment remains visible in the individual-fit details; it uses different acceptance rules and does not measure phase proportions.

Compatibility is not a confirmed phase identification. Support is weighted
Fourier evidence, not phase fraction or probability. Images lacking the full
3–10 nm⁻¹ sampling band are shown but phase fitting is disabled. This first
version supports finite 2D real-space DM4 images with equal x/y length calibration;
the automatic grid currently requires a square source image. Direct diffraction,
other phases, arbitrary region masks, and persistent sessions are future work.

## Structure

`analysis_core.py` holds the original fixed-scale numerical functions; `scale_fitting.py` holds optional local scale fits. `phase_comparison.py` adds the conservative shared-evidence ambiguity guard. The engine fingerprint includes all three modules, the template library and the engine wrapper. `engine.py` handles source
images and regions; `server.py` exposes local endpoints and grid jobs; `web/` is
the interface. Filesystem paths live in the ignored `.tem-paths.json`. Research results and source microscope files belong in TEM, outside this repository. The expressly bundled ST1221 example is stored under `demo/`. Changing FFT/fitting settings clears the displayed grid so old colours cannot be mistaken for a new calculation. Changing only scale penalty reweights cached automatic fits and retains the grid. Grid jobs record their own initial and current settings.

API: `GET /api/config`, `POST /api/open`, `POST /api/analyze`, `POST /api/grid`,
`GET /api/job?id=…`, `POST /api/rescore-grid` (job_id and scale_penalty_strength), `POST /api/cancel`, and `POST /api/save`. POST requests require
the local session token returned by the configuration endpoint. Server paths are
limited to configured source files, explicit static assets, and the results folder.

This is a local research tool, not an internet-facing server.

## Follow-up

Low priority: benchmark a small worker pool for parallel grid-cell analysis, comparing threads with processes. Preserve responsive movable-region analysis, adaptive queueing, cancellation and deterministic output; limit memory and nested FFT worker counts. This is planned, not implemented.

## License

[MIT](LICENSE). Copyright (c) 2026 pKai3.

The native macOS launcher is adapted from Tensile Workbench under the MIT licence; its attribution is retained in `macos/TENSILE-LICENSE`. The installed bundle contains machine-specific checkout paths; those paths and compiled apps are not committed.

Run the focused synthetic scale and phase-comparison checks with `python -m unittest discover -s tests`. They do not read microscope files.
