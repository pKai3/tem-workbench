# TEM Workbench

A local web application for exploring transmission electron microscopy images through movable-region FFTs, direct diffraction spot analysis, automatic peak detection, and HCP/BCC candidate fitting.

The interface pairs real-space images with reciprocal-space previews and supports uniform or adaptive grids for spatial comparison. Analysis runs locally in Python. The frontend uses plain HTML, CSS and JavaScript, with no build step.

**Phase labels are exploratory candidate assignments, not confirmed phase identities or phase fractions.**

## Features

- Move and resize a region to inspect its FFT, detected maxima and fitted crystal patterns.
- Open calibrated direct-diffraction DM4 spot patterns, with editable beam centre, reciprocal calibration and exclusions.
- Compare HCP and BCC candidates, including rejected fits and phase-independent geometry fits.
- Fit a uniform prediction scale, or independent HCP basal and c-axis scales.
- Adjust a scale penalty and reweight a completed grid from cached fits.
- Map candidate labels and zone axes, with separate HCP/BCC symbols and legends.
- Run uniform or adaptive grids and inspect area-weighted result summaries.
- Adjust FFT colour, brightness and contrast independently of numerical analysis.
- Choose data and output folders through the interface, with local directory links.
- Save named, tagged regions linked to their source images and analysis settings.
- Export region and grid results as JSON with source pixel hashes and engine provenance.
- Explore bundled, full-resolution ST1221 imaging and ST1144 diffraction examples without external data.

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

Without `.tem-paths.json`, the application starts with the bundled demo and defaults to `./data` and `./output`. `--demo` hides external images until folders are applied, even when a configuration file exists.

### macOS launcher

After installing the Python dependencies, double-click **Install TEM Workbench App.command** to build a Dock application in `~/Applications`. Building the launcher requires macOS 13 or newer and Apple Command Line Tools or Xcode.

The launcher provides **Start/Stop**, **Open Workbench** and **View log** controls. It uses the repository checkout and a separate Python environment; it is not a standalone Python distribution. Keep the checkout in place, or reinstall the launcher after moving it. Closing the window leaves the application running; quitting stops the server it started.

**Launch TEM Workbench.command** is also available for terminal-based startup. The launcher uses `TEM_WORKBENCH_PYTHON` when set, otherwise the configured Python executable, the checkout's `.venv`, or `python3` as applicable.

## Opening DM4 images

Expand **Folders** at the top of the page. Browse to a data folder and an output folder, then select **Apply folders**. The picker browses the local filesystem; it does not upload or copy images. **Refresh images** rescans after new files arrive.

The app maintains `./data` and `./output` directory links to those locations (symlinks on macOS/Linux, directory junctions on Windows). Existing nonempty real directories are never replaced. Relative paths resolve from the application directory. The choices are saved in the ignored `.tem-paths.json`, preserving other configuration fields. Changing folders clears the in-memory grid; finish or cancel any running grid and export results first.

The catalog finds `.dm4` files recursively beneath the selected data folder, including files at its root. `STA` and `ST` folders retain their sample grouping; other folders also work. The selected output directory is skipped during scanning. Output may be outside the data directory.

External DM4 loading uses the [openNCEM DM reader](https://openncem.readthedocs.io/en/latest/ncempy.io.dm.html). Install it in the app's Python environment:

```sh
python -m pip install ncempy
```

An installed reader is detected automatically. A specific reader module can instead be set through `dm_reader` in `.tem-paths.json`. The bundled demo does not require ncempy. Source microscope files are read only.

For manual configuration, copy [tem-paths.example.json](tem-paths.example.json) to `.tem-paths.json`:

| Field | Purpose |
| --- | --- |
| `data_root` | Data directory, normally `./data`; absolute paths also work. |
| `output_root` | Export directory, normally `./output`. |
| `dm_reader` | Optional path to a compatible `ncempy.io.dm` module; otherwise uses installed ncempy. |
| `python_executable` | Optional Python executable used by the launcher. |
| `default_file` | Optional image path relative to `data_root`, or `demo/st1221` / `demo/st1144`. |

### Saved regions and results

Expand **Saved regions** below the image controls. Give a box a name, optional comma-separated tags, and notes, then **Save region**. Choose a saved entry to reopen its source image, box and analysis settings. **All images** exposes entries for other photos. **Update region** changes that definition; **Save as new** keeps the original.

Definitions live in the ignored `tem_workbench.project.json` beside the app. Each entry records the relative image path, pixel checksum, dimensions, calibration, coordinates, settings and annotations. Reopening checks the image identity and calibration before applying coordinates. The file is replaced atomically and remains available after restarting; stale concurrent edits are rejected until refreshed. There is no automatic backup history.

**Export result** and **Export grid results** write numerical JSON files to `./output`, independently of the region definitions. Browser preferences, project definitions, folder settings and numerical exports serve separate purposes. Only app source and the bundled demos belong in Git.

### Activity log

The launcher’s **View log** shows image opens, region previews (limited to one entry per second), grid progress and completion, rescoring, saved regions, exports, folder changes and errors. A terminal-launched server writes the same activity to its terminal. Routine browser asset requests are omitted.

### Bundled demos

The **Demo** image group contains ST1221 for real-space FFT inspection and ST1144 for direct diffraction. Both Grade 9 titanium examples contain their original **4096 × 4096 float32 pixels** and stored calibration. The archives are losslessly compressed; loading verifies the reconstructed pixel checksums. They are inspection examples, not labelled phase-identification standards. See [demo/README.md](demo/README.md) for format and provenance details.

Exports use the configured output directory, defaulting to `./output` beside the app. Both demos are always available alongside configured external images and work without a DM4 reader.

## Workflow

1. Select an image. Favourites provide a shorter image list. **Sort by** switches between filename order and acquisition number (ascending), within each sample group and in Favourites. Acquisition numbers are read from filenames, including descriptive suffixes such as `_Diffraction`; unnumbered images appear last. The sort choice is remembered across restarts.
2. Drag the region box or resize its corner. Arrow keys move it by 10 pixels; Shift+arrow moves it by 50.
3. Select a scale-fitting mode and inspect candidate rank, peak coverage, residuals, model dimensions and prediction-scale changes. Candidate tables are sorted by rank, highest first; geometry-only checks have a separate score group.
4. Choose FFT overlays. The default shows the best HCP and best BCC fits; individual-fit controls also expose rejected candidates. Click the FFT to enlarge it with the same axes, peaks and overlays; close with Escape, the × button or a click outside.
5. Run a grid and click cells to inspect their detailed FFTs. Save results before stopping the server.

FFT brightness, background, white point and colour are display controls. The reset icon beside the white-point field restores the background and white-point defaults. These controls do not alter detected peaks or fitted coordinates. White maxima markers can be crosshairs, open crosshairs, circles or off. Open crosshairs leave the spot centre uncovered and draw four outer alignment arms; the choice is remembered.

The **FFT processing** row above Scale fitting controls **Hann window**, **Remove mean**, and the peak threshold. Windowing and mean removal default to on, preserving the original computation. Turning Hann off uses the rectangular crop. These affect the FFT and detected peaks, so changing them recalculates the selected region and clears the previous grid. Saved analyses record both choices. Display controls remain separate.

Window widths used for matching and weak-peak checks follow the selected window (approximately 1.44 FFT bins for Hann or 0.886 for a rectangular crop, with existing minimum tolerances). Windowing suppresses side lobes at the cost of a wider central peak; see the [SciPy spectral-analysis guide](https://docs.scipy.org/doc/scipy/tutorial/signal.html#spectral-analysis).

### Direct diffraction (experimental)

Opening a DM4 with reciprocal-length calibration (for example `1/nm`) automatically switches to **Direct diffraction**. The recorded detector intensity is analysed directly, without an FFT, Hann window or mean removal. The first version supports spot patterns, not ring indexing. It uses the same limited HCP/BCC template library and **3–10 nm⁻¹** fitting band as FFT analysis.

- **Beam centre:** an initial estimate clusters opposite-spot midpoints near the detector centre. When a clear dark beam-stop shadow is present centrally, it helps choose between repeated lattice inversion centres; its silhouette centroid is not treated as the direct beam. The pair count, residual and use of this shadow constraint are shown. Verify visually: neither spot symmetry nor a beam-stop shadow uniquely guarantees the correct origin. If pairs are inadequate, the detector midpoint is labelled as a fallback. Edit X/Y, or choose **Set beam centre**: a magnified native-pixel preview follows the cursor, with a clear-centred crosshair; click to place the centre. **Use estimated centre** restores the initial estimate. Previous manual choices remain saved until changed.
- **Refine translation:** enabled by default for direct diffraction. The selected centre is a fixed starting point; one shared X/Y translation is fitted from the midpoints of detected opposite spots, before fitting HCP/BCC rotation and scale. At least three independent pairs spanning two directions are required. Robust positional least squares rejects inconsistent pairs; their intensities need not match. The default maximum total movement is **50 original detector pixels**, adjustable from 1 to 200. Competing centre solutions or a solution outside the limit retain the starting centre with an explanation. Turn the checkbox off to hold that centre fixed. This is a local refinement, so an incorrect lattice-equivalent starting centre may still require manual correction.
  The readout reports the fitted centre, signed X/Y shift (detector Y points down), pair count and opposite-pair RMS before/after. The diffraction view, masks and reciprocal coordinates use the fitted centre, shared by both structures. Original image pixels and pixel calibration are unchanged. The starting position never advances between runs. Saved settings preserve that starting point and refinement controls; exports also record the fitted centre and supporting pair midpoints. Initial analysis may need a second detection pass at the fitted centre; both passes are cached for repeat fits. Real-space FFTs retain their fixed origin.
- **Calibration:** X/Y values are reciprocal spacing per detector pixel in nm⁻¹. Both can be edited; **Stored calibration** restores the DM4 values. These values and the centre define measured reciprocal coordinates. Scale fitting separately moves the crystal predictions. Positive reciprocal y points upwards; detector y increases downwards.
- **Exclusions:** set the central exclusion radius and draw rectangles over beam-stop or detector artefacts. Undo removes the last rectangle; Clear removes all rectangles. A predicted profile is unchecked when neither opposite position has a visible neighbourhood. One visible opposite remains assessable. Exclusions are shown on both views.
- **Spot controls:** smoothing sets the minimum detection size in original pixels (default 2 px). The detector checks progressively larger sizes (2, 4, 8, 16 and 32 px at the default), selecting maxima across position and size. Each feature uses a background annulus sized outside its core, so broad reflections are not rejected as their own background. Contrast must exceed the cutoff in both the background-subtracted filter response and the smoothed detector intensity. **Minimum spot contrast** defaults to 9 robust local background spreads; its slider and number field update the detection and fits. Lower values admit more faint features and noise. Existing per-image choices are retained. The last detector measurements are cached in memory so cutoff or fitting changes do not repeat the filters; changing centre, masks, calibration or smoothing recomputes them.
- **Duplicate spots:** native-pixel centroid refinement is followed by a separate duplicate check, keeping the strongest blob response within three-quarters of the larger measured spot width (at least 1.5 times the minimum smoothing). Opposite observations are paired afterwards and remain separate markers. Distinct same-side observations are not folded into one profile by the opposite-pairing step. This is a spot-footprint heuristic, not deconvolution of overlapping reflections. Detection and deduplication do not use crystal predictions.
- **Evidence:** opposite observations share one profile; the plot marks only spots actually detected. Profile weights use `log(1 + local contrast)`, capped at 1–6. Additional maxima above local contrast 3 can supply weak evidence, separately from the strong threshold. The estimated spot width is bounded to 0.30 nm⁻¹; matching uses that width with a 0.10 nm⁻¹ floor. These are exploratory choices, not calibrated confidence levels.
- **Persistence:** centre, calibration, detector settings and exclusions are remembered per image in browser storage. **Save region** stores a named whole-pattern analysis in the local project, with tags and notes; **Export result** writes numerical results and provenance to the output folder.

The left view shows the full detector; the right view shows the ±10.5 nm⁻¹ field and can be enlarged by clicking it. Display resampling and brightness controls do not change detected coordinates. Different x/y reciprocal calibrations and rectangular detector images are supported. Automatic real-space grids are hidden and disabled for diffraction: subdividing a detector pattern does not map locations in the specimen.

Centre estimation can choose a different lattice inversion centre, and masks or noise can affect spot detection. Diffraction intensities also depend on excitation and thickness, so a missing allowed spot is not definitive evidence against a structure. This mode retains candidate/ambiguous labels rather than treating an overlay as confirmation. General beam-centre and masking methods are documented in [pyxem](https://pyxem.readthedocs.io/en/stable/reference/generated/pyxem.signals.Diffraction2D.html); this app uses its own small implementation and does not require pyxem.

The **Measured peaks** selector offers circles, diamonds, squares, triangles and crosshairs. **Marker styles** independently controls HCP/BCC predictions, both geometry overlays and weak detections. Weak detections default to a hollow white diamond at the observed position; choose another shape, a dashed version of the measured marker, the original dot, or Off. Duplicate weak markers shared by displayed fits are drawn once. Prediction line styles retain their evidence/acceptance meaning for every shape. **Marker motion** offers Off, Pulse and Bounce + size. Pulse alternates opacity; Bounce shifts the markers slightly while growing and shrinking them. Off restores their exact positions. Both animations also work in the enlarged view, respect reduced-motion preferences, and make no analysis requests. Marker choices are remembered across images and restarts.

### Remembered settings

Basic preferences are saved automatically in browser local storage: the last image, region width, scale-fitting mode and custom scale, ranking weights, FFT processing and peak threshold, grid size and stopping limit, adaptive options, grid visibility, and FFT display/overlay controls. Analysis controls carry across images; a new image opens with a centred region at the remembered physical width, limited to the image size. Existing display preferences and favourites are retained.

These preferences survive browser and app restarts at the same address in the same browser profile. Clearing site data resets them. This stores settings only: grids, analysis results and individual candidate-overlay selections are not restored. Use **Save region** for a reusable box definition, and **Export result** or **Export grid results** for numerical output.

### Grid analysis

The initial grid defaults to **20 × 20** cells. Adaptive mode subdivides unresolved or ambiguous cells, cells supporting two candidate structures, and cells with substantial secondary periodicity. Subdivision stops when the next children would fall below the selected physical size or the 32-pixel minimum. The default physical stopping limit is 5 nm; it is adjustable.

Optional **Check passing regions** trials four children even when a parent has a supported single-phase candidate. Keep the children when they reveal a different phase/zone, separate strong evidence for another pattern, **or a mix of passing and unresolved phase assignments**. For example, two passing HCP children and two unresolved/insufficient children replace the parent, exposing the spatial loss of phase evidence. Ambiguous children also count as unassigned in this mixed case. If all four simply lose evidence, retain the parent; uniformly weaker children alone do not justify a split.

A different phase/zone is compared against the parent’s family fitted to **that same child**, using the complete retained hypothesis pool. It must pass when that family fails, or beat its passing fit by at least 0.08 ranking score. Raw parent and child scores are never compared. Accepted children can be checked again down to the stopping limit. These are heuristic checks within the limited template library; an unresolved child does not establish a different phase or absence of crystallinity.

The parent stays visible until all four trial children finish. Rejected trial subdivisions are retained in saved results but excluded from map counts and area. Cancellation during a trial retains its parent. The grid summary reports parents retained and subdivided after these checks.

The colour legend and zone-symbol legends appear below the image. Blue symbols identify the best HCP zone and gold symbols identify the best BCC zone. Both structures reuse the same symbol set. Faded symbols indicate candidates below the acceptance threshold; showing both is not evidence of phase coexistence. HCP directions use four indices, BCC directions use three, and negative indices carry an overbar.

**Cancel** retains a partial grid. **Clear grid** clears the displayed map and cancels an active run without deleting saved results. Area summaries use current leaf cells and exclude subdivided parents.

### Scale fitting and rescoring

The reference lattice dimensions are HCP **a = 0.295 nm, c = 0.468 nm** and BCC **a = 0.330 nm**. The default is automatic BCC uniform / HCP independent a-and-c scaling. Automatic uniform scaling for both structures, stored scale and custom comparison scale are also available. The last-used mode carries across images and restarts; removed preset choices fall back to the automatic default.

Automatic reciprocal-scale multipliers are bounded to **0.85–1.15**. Scaling moves predicted reflections; measured reciprocal axes remain tied to the image calibration used. Model lattice dimensions change inversely with reciprocal scale. Zones without c-sensitive reflections cannot determine HCP c.

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
- Peak coverage is the sum of weights of matched original detected peak profiles divided by the weight of all original detected profiles. FFT weights use height above the radial background; direct spots use log(1 + local contrast). Both are capped at 1–6; additional weak maxima are excluded. Neither peak coverage nor rank score is an intensity fraction, phase probability or phase fraction.
- The scale penalty is a preference for smaller adjustments, not a calibrated strain prior. Calibration errors can change candidate rankings.
- Independent HCP a/c fitting adds flexibility. The penalty is not a statistical correction for the number of fitted parameters.
- Additional weak maxima and unsupported prediction positions contribute optional heuristic ranking adjustments. HRTEM contrast transfer can suppress allowed reflections; a missing peak is not proof that a structure is absent.
- A conservative shared-evidence check retains ambiguity when competing structures explain the same detected profiles and the leading fit requires additional flexibility or unsupported predictions.
- Small regions broaden FFT peaks, limiting separation of nearby reflections. Image-calibrated fits alone do not establish lattice strain.

Supported input is finite, two-dimensional DM4 data with length or reciprocal-length calibration. Real-space FFTs require equal x/y pixel calibration; automatic grids require square real-space images. Direct diffraction supports rectangular detector exclusions. Ring indexing and arbitrary real-space region shapes are not implemented.

## Development

| Component | Responsibility |
| --- | --- |
| `analysis_core.py` | FFT processing, peak detection, fixed-scale matching and geometry checks. |
| `diffraction.py` | Reciprocal calibration, beam-centre estimation, direct spot detection and detector exclusions. |
| `scale_fitting.py` | Bounded automatic scale fitting, candidate ranking and cached reranking. |
| `phase_comparison.py` | Prediction counts and shared-evidence ambiguity checks. |
| `peak_evidence.py` | Independent weak-maxima detection, prediction-site audits and ranking adjustments. |
| `adaptive_refinement.py` | Same-child comparisons and mixed assignability checks for passing parents. |
| `folder_paths.py`, `workbench_project.py` | Local directory links and reusable region definitions. |
| `engine.py` | Image loading, region analysis, previews and fit caches. |
| `server.py` | Local HTTP endpoints, grid jobs and JSON exports. |
| `web/` | Buildless browser interface. |
| `demo_data.py`, `demo/` | Bundled example and lossless decoder. |
| `engine_provenance.json` | Numerical provenance and recorded limitations. |

Run the focused numerical checks with:

```sh
python -m unittest discover -s tests
```

The local API provides `/api/config`, `/api/open`, `/api/analyze`, `/api/grid`, `/api/job`, `/api/rescore-grid`, `/api/cancel`, `/api/save`, `/api/browse-folders`, `/api/folders`, `/api/regions`, `/api/regions/save` and `/api/regions/open`. POST requests require the session token returned by `/api/config`.

After updating Python source, save active results, restart the server and reload the page. Previously saved results retain the engine hash and settings used to produce them.

A lower-priority performance follow-up is parallel grid-cell execution, with bounded memory use, responsive region inspection and reliable cancellation.

## License

[MIT](LICENSE). The macOS launcher includes code adapted from Tensile Workbench; its attribution is retained in [macos/TENSILE-LICENSE](macos/TENSILE-LICENSE). Third-party dependencies retain their respective licences.
