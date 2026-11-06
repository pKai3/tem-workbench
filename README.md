# TEM Workbench

A local web application for exploring transmission electron microscopy images through movable-region FFTs, direct diffraction spot analysis, automatic peak detection, and HCP/BCC/FCC candidate fitting.

The interface pairs real-space images with reciprocal-space previews and supports uniform or adaptive grids for spatial comparison. Analysis runs locally in Python. The frontend uses plain HTML, CSS and JavaScript, with no build step.

**Phase labels are exploratory candidate assignments, not confirmed phase identities or phase fractions.**

## Features

- Move and resize a region to inspect its FFT, detected maxima and fitted crystal patterns.
- Open calibrated direct-diffraction DM4 spot patterns, with editable beam centre, reciprocal calibration and exclusions.
- Compare HCP, BCC and FCC candidates, including rejected fits and phase-independent geometry fits.
- Fit a uniform prediction scale, or independent HCP basal and c-axis scales.
- Adjust a scale penalty and reweight a completed grid from cached fits.
- Map candidate labels and zone axes, with separate HCP/BCC/FCC symbols and legends.
- Run uniform or adaptive grids with parallel workers and inspect area-weighted result summaries.
- Adjust FFT colour, brightness and contrast independently of numerical analysis.
- Choose data and output folders through the interface, with local directory links.
- Save named, tagged regions linked to their source images and analysis settings.
- Export region and grid results as JSON with source pixel hashes and engine provenance.
- Download optional full-resolution TEM and diffraction examples separately.

## Parallel analysis

Under **Automatic grid**, choose **Workers**: Auto, 1, 2, 4, 8, 10, 12, 14 or 16. Explicit choices may exceed logical CPU count; that can increase memory use without improving speed. Auto uses up to four workers and leaves one logical CPU free. Lower counts reduce CPU and memory use. The choice is remembered and applies to the next run. Progress includes worker count and elapsed time; manual region inspection remains available during a grid.

Each grid uses separate Python processes with private fit caches and one shared, read-only temporary source image. Results and adaptive decisions are applied in a fixed order. Cancel stops queued work and checks between automatic-strength trials; the current trial may finish first. A partially checked subdivision retains its parent. Completed grids can still be reweighted from cached fits.

Direct diffraction offers **Smoothing threads: Auto / 1 / 2 / 4 / 8**, remembered between sessions and images. Auto uses two threads where available; choices are capped by CPU count. Changing threads preserves cached detections and takes effect on the next uncached detection. Central exclusion and outer fitting limit sit together in the active FFT or Direct diffraction settings panel. These execution changes preserve the detector and matcher calculations. Process startup adds overhead to very small grids; speedup depends on the image, settings, CPU and memory. Windows and macOS use the same spawn-based design; the initial performance measurements and live UI checks were on macOS. See [measurements and validation](docs/parallel-performance.md).

## Overlapping stability maps

Under **Automatic grid → Search mode**, choose **Overlapping stability map**. Set a square FFT window (default 5 nm), centre spacing (2.5 nm), square or hexagonal centres, and 1, 3 or 7 shifted placement passes. Each window is matched independently using the current analysis settings and grid workers.

View each phase's passing frequency, disagreement between placement passes, sampling coverage, raw centres, or separately supported structures within the same window. Click a map location to inspect a contributing window. Exports retain raw fits and aggregation settings; PNG exports capture the selected view. These are overlapping candidate-support maps, **not physical phase fractions**. Windows are correlated, edges have fewer samples, and the FFT window sets spatial resolution. Batch grids also support this mode: the same physical window size, spacing and placement passes are applied to each selected image. Batch PNGs show all-phase passing frequencies; summaries pool covered raster area without summing overlapping window areas. Details and remaining work are in the [implementation plan](docs/implementation-plan.md#overlapping-window-phase-candidate-map).

## Installation and updates

Download **TEM-Workbench-<version>.zip** from [Releases](https://github.com/pKai3/tem-workbench/releases/latest), extract it into a writable folder, and keep that folder in place. The optional demo images download separately inside the app.

- **macOS 13+:** double-click **Install TEM Workbench App - macOS.command**. Apple Command Line Tools are needed to build the Dock launcher. It installs into `~/Applications`.
- **Windows 10/11 x86-64:** double-click **Install TEM Workbench App - Windows.bat**. It creates Desktop and Start menu shortcuts using the same application icon as macOS.

For subsequent starts from this folder, use **Launch TEM Workbench - macOS.command** or **Launch TEM Workbench - Windows.bat**, respectively. If updating an existing source checkout, rerun its platform installer to refresh the installed app’s launcher path.

Desktop setup uses standard **64-bit Python 3.14**, including Tcl/Tk on Windows. If missing, setup offers to download the official checksummed Python installer; installation proceeds only after consent. Python 3.15 and free-threaded builds are not supported by desktop setup. Packages are installed in an environment outside the source folder and cloud storage. Existing source-folder `.venv` directories are left intact.

The desktop window provides Start/Stop, Open Workbench, live logs and **Check for updates**. Updates verify release files, prepare dependencies separately when needed, and keep rollback copies. Updates work without Git for extracted releases. A Git checkout must have clean tracked files and advance by fast-forward. Data, output, saved regions, calibration and local settings are preserved. Stop/export unfinished work before applying an update; running grids cannot survive a restart.

**Existing installations:** rerun the platform installer once to move to the new launcher/update mechanism. See [SETUP.md](SETUP.md) for environment locations, console startup and recovery. This launcher is locally built/ad-hoc signed on macOS, not an Apple-notarized standalone distribution. Windows hardware smoke testing remains useful alongside automated native checks.

The server normally listens at **http://127.0.0.1:8767** and desktop launchers choose another free local port if occupied. It is intended for local use, not public web hosting.

Without `.tem-paths.json`, the application uses `./data` and `./output`, plus installed demos. Console option `--demo` hides external images until folders are applied.

## Opening images

Expand **Data Sources and Outputs** at the top of the page. Add one or more named project source folders, choose a **Main output folder**, then **Apply sources**. Each source can optionally have its own output folder. The picker reads local files without uploading or copying them. Source folders must not overlap. Changing sources clears the in-memory grid; export results and finish or cancel active jobs first.

Immediate subfolders identify samples, with project names distinguishing samples across sources. Batch review can flatten nested subfolders for summaries. Per-image exports use that source's output override, when set; combined batch summaries use the main output folder. Choices are saved in the ignored `.tem-paths.json`. Existing single-folder configuration remains supported.

The catalogue finds DM4, JPEG, standalone PNG and single-frame TIFF files recursively, excluding configured outputs and preview sidecars. A background check runs every 15 seconds while no grid, batch or window-size job is active; **Refresh images** also rescans explicitly. Path changes and missing files appear as bottom-right notices.

Image identities are stored in `.tem-image-registry.json` using SHA-256 of complete file contents. Once indexed, renaming or moving an unchanged image within configured sources retains its identity, saved regions and associated preferences. Add the destination source when moving outside existing sources. Exact byte-for-byte copies share an identity; edited or re-encoded files are new identities. Preserve the registry with your project state. The first scan reads image contents (and may download cloud placeholders); later scans reuse hashes for unchanged files. Filenames remain display labels, with filename fallbacks where no acquisition number exists. Image lists include real-space, diffraction or uncalibrated type labels.

**Generate PNG previews** under Data Sources and Outputs creates missing same-name sidecars (`image.dm4` → `image.png`) throughout the linked collection. Previews are greyscale, contrast-adjusted, and up to 1400 pixels along the longest side; direct diffraction uses log intensity. This does not run a fit or estimate a beam centre. Existing PNGs are skipped, source files are unchanged, and the progress display reports saved, skipped and failed files. Cancellation stops after the current file. Demo downloads generate missing PNG previews locally during installation and reuse existing previews.

**Visual image browser** opens a searchable thumbnail gallery, ordered by filename or acquisition number. It uses existing sidecar PNGs; files without a preview remain selectable. Choose a thumbnail to load that image for analysis. The gallery can also start generation of missing previews. A ★ marks favourites in both the gallery and the image lists.

### JPEG, PNG and TIFF images

Place ordinary images in the linked data folder, then refresh the image list. On first opening, **Calibrate scale bar** asks whether the image is real space (FFT analysis) or direct diffraction. Drag along the scale bar and enter its printed value and units: nm, µm or Å for real space; nm⁻¹ or Å⁻¹ for diffraction. Changing the units automatically selects the corresponding image type.

Drawing is horizontal by default. **Free Y** permits angled bars. A cursor magnifier shows original-resolution pixels while hovering or dragging; drag an existing endpoint to refine it, or enter coordinates directly. Calibration uses the endpoint distance and assumes equal x/y pixel scales. Previously calibrated angled bars reopen with Free Y enabled.

Calibration is remembered locally in `.tem-image-calibrations.json`, keyed by tracked file content and checked against decoded pixels; existing path-based entries migrate when their image is opened. **Calibrate scale bar** can revise it later. Exports include the manual calibration in image metadata; original files are unchanged. Colour inputs are converted to greyscale; single-channel TIFF precision is preserved. Prefer original greyscale data when available—JPEG compression and rendered colour images can alter weak features. Keep printed bars/text outside FFT crops or mask them in diffraction mode. Multi-frame TIFFs are not supported.

Same-name PNG previews beside DM4/JPEG/TIFF sources remain sidecars rather than separate analysis inputs. Standalone PNGs are selectable; give an independent PNG a distinct basename if another source shares its name.

External DM4 loading uses the [openNCEM DM reader](https://openncem.readthedocs.io/en/latest/ncempy.io.dm.html). The Mac app installer includes it. For a manual installation, install it in the app's Python environment:

```sh
python -m pip install ncempy
```

An installed reader is detected automatically. A specific reader module can instead be set through `dm_reader` in `.tem-paths.json`. Downloaded demos use the same DM4 reader as local images. Source microscope files are read only.

For manual configuration, copy [tem-paths.example.json](tem-paths.example.json) to `.tem-paths.json`:

| Field | Purpose |
| --- | --- |
| `data_root` | Legacy single data directory, normally `./data`. |
| `sources` | Project source entries with `id`, `name`, `path`, and optional `output`; normally managed through the UI. |
| `output_root` | Export directory, normally `./output`. |
| `dm_reader` | Optional path to a compatible `ncempy.io.dm` module; otherwise uses installed ncempy. |
| `default_file` | Optional image path relative to `data_root`, or `demo/st1221` / `demo/st1144`. |

### Saved regions and results

Expand **Saved regions** below the image controls. Give a box a name, optional comma-separated tags, and notes, then **Save region**. Saved regions on the current image have red outlines; click an outline or choose a saved entry to reopen its source image, box and analysis settings. Outline interiors remain available for grid selection and dragging. Reopening a region on the same image keeps an existing grid when its analysis settings are unchanged. **All images** exposes entries for other photos. **Update region** changes that definition; **Save as new** keeps the original. **Delete region** removes the selected saved entry after confirmation, including its red outline. Source images and exported files are kept.

Definitions live in the ignored `tem_workbench.project.json` beside the app. Each entry records the stable image identifier, source metadata, pixel checksum, dimensions, calibration, coordinates, settings and annotations. Reopening checks the image identity and calibration before applying coordinates. The file is replaced atomically and remains available after restarting; stale concurrent edits are rejected until refreshed. There is no automatic backup history.

**Export result** and **Export grid results** write numerical JSON files to the configured main or per-source output folder, independently of the region definitions. Browser preferences, project definitions, folder settings and numerical exports serve separate purposes. Only app source belongs in Git; downloaded demo pixels and previews are ignored.

### Activity log

The launcher’s **View log** shows image opens, region previews (limited to one entry per second), grid progress and completion, rescoring, saved regions, exports, folder changes and errors. A terminal-launched server writes the same activity to its terminal. Routine browser asset requests are omitted.

### Optional demo images

Images are distributed separately so GitHub ZIP downloads stay small. When no images are available, the app offers to download the three demo images or choose a data folder. The Dropbox demo link is prefilled under **Data Sources and Outputs**; it can be replaced with another HTTPS pack link. Click **Download demo images** to start. Dropbox share links work directly; Dropbox shared folders are supported too; other hosts must return a ZIP file. Downloading starts only when requested, shows progress, and can be cancelled. Installed demos appear in the **Demo** group alongside local images and remain available after restarting.

Downloads need only unchanged original DM4 files, including their microscope metadata. PNG previews are optional: existing previews are reused and missing ones are generated locally. No manifest is required. The downloader checks ZIP integrity and archive paths before installing under `demo/packs/` (ignored by Git); a local content hash prevents duplicate installs of the same pack. These are inspection examples, not labelled phase-identification standards. The desktop installer includes the required DM4 reader (`ncempy`). See [demo/README.md](demo/README.md) for hosting instructions.

Exports use the configured output directory, defaulting to `./output` beside the app. No demo download is needed to use your own data. For a small Git clone, use `git clone --depth 1`; older repository history still contains the former bundled images.


## Workflow

1. Select an image. **Search files** filters the list by name, sample or acquisition number; Enter opens a sole match and Escape clears the search. Favourites provide a shorter image list. **Sort by** switches between filename order and acquisition number (ascending), within each sample group and in Favourites. Acquisition numbers are read from filenames, including descriptive suffixes such as `_Diffraction`; unnumbered images appear last. The sort choice is remembered across restarts.
2. Drag the region box or resize its corner. Arrow keys move it by 10 pixels; Shift+arrow moves it by 50.
3. Choose a material reference and scale-fitting mode, then inspect candidate rank, peak coverage, residuals, model dimensions and prediction-scale changes. Candidate tables are sorted by rank, highest first; geometry-only checks have a separate score group.
4. Choose FFT overlays. The default shows the best fit for each enabled phase; individual-fit controls also expose rejected candidates. Hover for a magnified preview; clicking is reserved for the active editing tool.
5. Run a grid and click cells to inspect their detailed FFTs. Save results before stopping the server.

FFT brightness, background, white point and colour are display controls. The intensity palette offers Magma (default), Viridis, Plasma, Cividis, Turbo and Greyscale; the colour bar follows the selected palette. The reset icon beside the white-point field restores the background and white-point defaults. These controls do not alter detected peaks or fitted coordinates. White maxima markers can be crosshairs, open crosshairs, circles or off. Open crosshairs leave the spot centre uncovered and draw four outer alignment arms; the choice is remembered.

The **FFT processing** row above Material and Scale fitting controls **Hann window**, **Remove mean**, the peak threshold fraction, and FFT peak detection:

| FFT detector control | Default | Meaning |
| --- | --- | --- |
| Smoothing σ | 0.65 bins | Gaussian smoothing of background-subtracted log power; zero disables it. |
| Threshold floor | 1.8 | Lower bound for the profile cutoff. The cutoff is max(floor, threshold fraction × strongest signal). |
| Minimum peak strength | Manual, 3.0 | Minimum height above radial background for a detected profile. Auto searches the admitted profile sets for the best passing rank. |
| Minimum separation | 0.50 nm⁻¹ | Nearby profiles merge, retaining the strongest. The effective minimum is at least the crop-window peak width. |
| Maximum profiles | 70 | Strongest independent profiles retained; opposite spots count once. |

Threshold floor and peak strength are in background-subtracted natural-log-power units, not intensity percentages. These controls select original strong profiles; prediction-site checks for additional weak maxima are a separate ranking step. FFT weak checks use the same processed detector signal, smoothing and threshold floor. They do not apply the strong-profile minimum strength, since their purpose is to assess weaker maxima. Windowing and mean removal default to on, preserving the original computation. Turning Hann off uses the rectangular crop. Changing these controls recalculates the selected region and clears the previous grid. The ↺ button beside **FFT processing** restores all controls in that row to their defaults. Settings persist across images and restarts, and saved analyses record them. Detection-only controls leave the FFT pixels and axes unchanged. Display controls remain separate.

**Raw FFT / Processed** above the FFT image switches between original log power and the background-subtracted, smoothed signal actually used to detect peaks. The diagnostic view shows the connected-profile cutoff and selected minimum strength; the axes, fitted patterns and measured markers are shared. Brightness curves are disabled for the detector response because it is already a processed signal. Contrast and palette still affect display only. Enlarged views and PNG/GIF exports follow the chosen view, with processed exports explicitly labelled. Switching views does not rerun detection or change results.

**Auto · dominant rank** varies minimum peak strength independently for each region. It computes the FFT once, then compares every distinct set of at least four profiles admitted by the current threshold fraction, threshold floor, separation and maximum-profile controls. It selects the highest-ranked passing candidate; if none passes, it keeps the best rejected result and leaves it below threshold. Equal ranks prefer more detected profiles. It can raise or lower the minimum strength, continues after the first passing fit, and reports the selected cutoff and number of comparisons. Other detection settings and the acceptance rules remain unchanged. This is rank optimization on the same data, not independent confirmation of a phase; rank can increase by excluding poorly matched profiles. Auto is opt-in and can require multiple fits per grid cell. Cached grid reweighting retains the selected detected profiles; rerun the grid to optimize the cutoff under new weights. Saved regions and exports preserve the Auto setting and results, including the admitted pool size/weight and the selected fraction of that weight. Dominant-rank scores use the selected subset; they are not directly comparable with manual or geometry-auto scores. This mode can discard a weaker second pattern.

Window widths used for matching and weak-peak checks follow the selected window (approximately 1.44 FFT bins for Hann or 0.886 for a rectangular crop, with existing minimum tolerances). Windowing suppresses side lobes at the cost of a wider central peak; see the [SciPy spectral-analysis guide](https://docs.scipy.org/doc/scipy/tutorial/signal.html#spectral-analysis).

**Central exclusion** and **Outer fitting limit** sit together under **Scale fitting** in both image modes. They select the reciprocal-space band after the FFT (or on the recorded diffraction image), rather than changing the transform.

**Outer fitting limit, nm⁻¹** controls the radial upper cutoff for both FFT and direct diffraction analysis (default 10, adjustable from 4 to 30). The selected limit applies to detected peaks, allowed crystal predictions, geometry checks and missing-spot checks. Reflections are generated far enough to cover that band throughout automatic scale fitting. Changing the limit recalculates the selected region and clears the old grid; run a new grid to use the new range. The setting is remembered across images and saved with regions.

**Central exclusion, nm⁻¹** sets the radial lower cutoff: default 3 for FFTs and 2.5 for direct diffraction. Values below 3 are supported; the selected radius applies to peak detection, predictions, geometry checks and weak/missing-spot checks. It must be non-negative and smaller than the outer fitting limit. A zero radius still excludes the origin itself. Lowering the radius admits longer-period features and may admit central-beam or background artefacts; it does not change the FFT pixels or calibration. Each mode remembers its own exclusion setting.

Both spectrum views show the selected central exclusion boundary and outer fitting boundary, with light shading outside the analysed band. These boundaries also appear in enlarged views and PNG/GIF exports. An FFT image must sample the selected band; lower the outer limit if the stored pixel calibration does not allow it.

### Material references

**Material** groups HCP a/c, BCC a, FCC a and generic orthorhombic a/b/c references in one place. Titanium is the default; Iron supplies a separate starting set. Selecting a preset updates the reference dimensions. Editing any dimension selects **Custom**, except in Unknown mode, where the edited search anchors retain the wider search. Cubic cells use a = b = c; HCP uses a = b with a 120° basal angle. These values generate the prediction grids and define zero scale deviation; automatic fitting adjusts predictions relative to the chosen references. Changing them recalculates the selected region and clears the grid. Preferences and saved regions retain the material and explicit dimensions.

**Unknown material** enables HCP, BCC, FCC and primitive orthorhombic (ORT) and expands automatic reciprocal-scale bounds to ×0.5–2.0 (ordinary presets use ×0.85–1.15). Selecting it switches a fixed-scale view to automatic fitting. Its editable dimensions are search anchors, not identified material properties. Overall scale penalty is disabled in Unknown mode, including cached grid rescoring. HCP c/a penalty remains adjustable and active in overall + c/a mode; peak-evidence scoring is unchanged. The overall weight is remembered for other materials. This broader finite-template search can be slower and more ambiguous; it is not an unrestricted structure identification.

**Phase colours / search**, beside Material, controls which structures are searched. **Disabled** skips that phase in FFT analysis, direct diffraction and automatic grids. Titanium defaults to HCP + BCC, Iron to BCC + FCC, and Custom to all three; these choices can be overridden. Selecting a material applies its phase defaults; editing a lattice dimension keeps the current phase selection. The small reset arrow restores the selected material’s default phases and Blue/Gold/Pink colours. Changing only a colour redraws the view; enabling or disabling a phase recalculates the region and clears the old grid. Enabled phases are remembered across startup/image changes and saved with regions. All phases may be disabled to inspect peaks and geometry alone.

| Material | HCP a / c, nm | BCC a, nm | FCC a, nm |
| --- | --- | --- | --- |
| Titanium | 0.295 / 0.468 | 0.330 | 0.417 |
| Iron | 0.24637 / 0.39568 | 0.28675 | 0.36484 |

These are editable starting references, not a claim that every phase is stable under the same conditions:

- Titanium retains the workbench's nominal α-HCP and approximate β-BCC references. FCC is a metastable comparison. [Ren et al. (2020)](https://doi.org/10.1590/1980-5373-MR-2019-0638) use HCP dimensions close to these and an energy-minimised FCC parameter of 0.4174 nm. The approximate BCC value should be adjusted for the alloy and temperature.
- Iron BCC is evaluated at 295 K and FCC at 1183 K using the temperature-dependent equations of [Seki and Nagata (2005)](https://doi.org/10.2355/isijinternational.45.1789).
- Iron HCP represents ε-Fe at **15 GPa and 300 K**. Its dimensions are derived from the equation-of-state volume of 10.40 Å³/atom and c/a = 1.606 tabulated by [Dewaele et al. (2023)](https://doi.org/10.1103/PhysRevLett.131.034101), using a = [4V / (√3 × c/a)]⅓ and c = (c/a)a. This is a high-pressure reference, not ambient iron.

### Direct diffraction (experimental)

Opening a DM4 with reciprocal-length calibration (for example `1/nm`) automatically switches to **Direct diffraction**. The recorded detector intensity is analysed directly, without an FFT, Hann window or mean removal. The first version supports spot patterns, not ring indexing. It uses the same limited HCP/BCC/FCC template library and adjustable fitting-band controls as FFT analysis; direct diffraction defaults to **2.5–10 nm⁻¹**.

- **Beam centre:** an initial estimate clusters opposite-spot midpoints near the detector centre. When a clear dark beam-stop shadow is present centrally, it helps choose between repeated lattice inversion centres; its silhouette centroid is not treated as the direct beam. The pair count, residual and use of this shadow constraint are shown. Verify visually: neither spot symmetry nor a beam-stop shadow uniquely guarantees the correct origin. If pairs are inadequate, the detector midpoint is labelled as a fallback. Edit X/Y, or choose **Set beam centre**: a magnified native-pixel preview follows the cursor, with a clear-centred crosshair; click to place the centre. **Use estimated centre** restores the initial estimate. Previous manual choices remain saved until changed.
- **Refine translation:** enabled by default for direct diffraction. The selected centre is a fixed starting point; one shared X/Y translation is fitted from the midpoints of detected opposite spots, before fitting HCP/BCC/FCC rotation and scale. At least three independent pairs spanning two directions are required. Robust positional least squares rejects inconsistent pairs; their intensities need not match. The default maximum total movement is **50 original detector pixels**, adjustable from 1 to 200. Competing centre solutions or a solution outside the limit retain the starting centre with an explanation. Turn the checkbox off to hold that centre fixed. This is a local refinement, so an incorrect lattice-equivalent starting centre may still require manual correction.
  The readout reports the fitted centre, signed X/Y shift (detector Y points down), pair count and opposite-pair RMS before/after. The diffraction view, masks and reciprocal coordinates use the fitted centre, shared by all structures. Original image pixels and pixel calibration are unchanged. The starting position never advances between runs. Saved settings preserve that starting point and refinement controls; exports also record the fitted centre and supporting pair midpoints. Initial analysis may need a second detection pass at the fitted centre; both passes are cached for repeat fits. Real-space FFTs retain their fixed origin.
- **Calibration:** X/Y values are reciprocal spacing per detector pixel in nm⁻¹. Both can be edited; **Stored calibration** restores the DM4 values. These values and the centre define measured reciprocal coordinates. Scale fitting separately moves the crystal predictions. Positive reciprocal y points upwards; detector y increases downwards.
- **Exclusions:** set the central exclusion radius and draw rectangles over beam-stop or detector artefacts. Undo removes the last rectangle; Clear removes all rectangles. A predicted profile is unchecked when neither opposite position has a visible neighbourhood. One visible opposite remains assessable. Exclusions are shown on both views.
- **Spot controls:** smoothing sets the minimum detection size in original pixels (default 2 px). The detector checks progressively larger sizes (2, 4, 8, 16 and 32 px at the default), selecting maxima across position and size. Each feature uses a background annulus sized outside its core, so broad reflections are not rejected as their own background. Contrast must exceed the cutoff in both the background-subtracted filter response and the smoothed detector intensity. **Minimum spot contrast** defaults to 9 robust local background spreads; its slider and number field update the detection and fits. Lower values admit more faint features and noise. Existing per-image choices are retained. The last detector measurements are cached in memory so cutoff or fitting changes do not repeat the filters; changing centre, masks, calibration or smoothing recomputes them.
- **Duplicate spots:** native-pixel centroid refinement is followed by a separate duplicate check, keeping the strongest blob response within three-quarters of the larger measured spot width (at least 1.5 times the minimum smoothing). Opposite observations are paired afterwards and remain separate markers. Distinct same-side observations are not folded into one profile by the opposite-pairing step. This is a spot-footprint heuristic, not deconvolution of overlapping reflections. Detection and deduplication do not use crystal predictions.
- **Evidence:** opposite observations share one profile; the plot marks only spots actually detected. Profile weights use `log(1 + local contrast)`, capped at 1–6. Additional maxima above local contrast 3 can supply weak evidence, separately from the strong threshold. The estimated spot width is bounded to 0.30 nm⁻¹; matching uses that width with a 0.10 nm⁻¹ floor. These are exploratory choices, not calibrated confidence levels.
- **Persistence:** centre, calibration, detector settings and exclusions are remembered per image in browser storage. **Save region** stores a named whole-pattern analysis in the local project, with tags and notes; **Export result** writes numerical results and provenance to the output folder.

The left view shows the full detector; the right view extends 5% beyond the selected outer fitting limit (±10.5 nm⁻¹ by default) with a magnified preview on hover. Display resampling and brightness controls do not change detected coordinates. Different x/y reciprocal calibrations and rectangular detector images are supported. Automatic real-space grids are hidden and disabled for diffraction: subdividing a detector pattern does not map locations in the specimen.

Centre estimation can choose a different lattice inversion centre, and masks or noise can affect spot detection. Diffraction intensities also depend on excitation and thickness, so a missing allowed spot is not definitive evidence against a structure. This mode retains candidate/ambiguous labels rather than treating an overlay as confirmation. General beam-centre and masking methods are documented in [pyxem](https://pyxem.readthedocs.io/en/stable/reference/generated/pyxem.signals.Diffraction2D.html); this app uses its own small implementation and does not require pyxem.

The **Measured peaks** selector offers circles, diamonds, squares, triangles and crosshairs. **Marker styles** independently controls HCP/BCC/FCC predictions, both geometry overlays and weak detections. Weak detections default to a hollow white diamond at the observed position; choose another shape, a dashed version of the measured marker, the original dot, or Off. Duplicate weak markers shared by displayed fits are drawn once. Prediction line styles retain their evidence/acceptance meaning for every shape. **Marker motion** offers Off, Pulse, Bounce (size only), Bounce + wobble and Bounce + rotate. Pulse alternates opacity; Bounce grows and shrinks markers around fixed centres; Bounce + wobble also moves them slightly; Bounce + rotate swings them between −45° and +45° around fixed centres, with maximum size each time they pass 0°, including in GIF exports. HCP and BCC prediction markers run half a cycle apart. Measured/weak markers and geometry markers use separate offsets, so overlapping marker types do not all change size together. The live view and GIF exports share this timing. Off restores their exact positions. The animations also work in the enlarged view, respect reduced-motion preferences, and make no analysis requests. The **Phase colours** controls above the images apply throughout the workbench. HCP and BCC each have six colour choices: Blue, Gold, Mint, Vivid green, Pink and White, with the existing blue HCP and gold BCC defaults. These colours are shared by predictions, vectors, map cells, legends and fit labels. Scale penalty and peak-evidence weight sit beside the scale-fitting area; colour overlay intensity sits under Automatic grid. Marker, phase-colour and intensity-palette choices are remembered across images and restarts.

In real-space mode, hover over a computed grid cell, the computed manual selection, or a saved-region outline for one card containing the crop and FFT, phase label, best HCP/BCC/FCC zone axes, ranks and screen status. Passing candidates appear first, then candidates are ordered by rank. Saved-region cards use that region’s saved analysis settings without changing the active selection. The FFT uses the current display palette and contrast; its axes are in nm⁻¹. Cards pause during analysis, grid runs and reweighting. A missing preview is calculated on demand after a short hover delay; the 24 most recent encoded previews are cached in memory, keyed by image, calibration, coordinates and analysis settings. Switching images clears the cache. Saved regions persist the source reference, coordinates and settings, not an FFT bitmap; use PNG/GIF export to retain an image file. The **View** selector on the right switches between **Real space + FFT** and **Large FFT only**, and remembers the choice. The large FFT is capped to the size of the source image on the left, including after resizing the window. Diffraction uses the same size limit with its full spectrum layout. A spinner appears over the spectrum after one second while a requested analysis is pending.

**PNG** and **GIF** above the spectrum save the current brightness, markers, overlays, axes and optional indexed vectors to the configured output folder. PNG is 2800 pixels wide and uses the exact marker positions. GIF is also 2800 pixels wide and captures one repeating cycle of the chosen motion: 30 fps on average, with 36 frames over 1.2 seconds for Bounce or Bounce + wobble, or 54 frames over 1.8 seconds for Pulse (one still frame with motion Off). GIF uses alternating 30/40 ms frame delays because its timing precision is 10 ms. GIF frames share a palette and retain unchanged background pixels to reduce file size. Export snapshots the view, so later image or marker changes do not alter an export in progress. Image exports require the updated backend; restart the app after upgrading. Export buttons show progress, then **✓ Saved**; a dismissible notification confirms the filename and output path. Failures show an explicit error.

**Export map PNG** above the real-space image becomes available after a grid completes. It saves the displayed source preview, current grid colours and zone symbols, visible saved-region outlines, and the visible legends. The movable inspection box and resize handle are omitted. The map is exported up to 2800 pixels wide, reduced if necessary to keep its full height within 3200 pixels. This is a rendered map; use **Export grid results** for numerical fits and provenance.

The geometry-only check displays a secondary grid only when it passes the independent-evidence screen, including at least three additional profiles beyond the primary in nonparallel directions. Failed secondary attempts can repeat the primary grid; these are omitted and the interface reports **No distinct secondary geometry detected**. Equal scores or RMS values alone do not make two grids duplicates. These checks describe periodic patterns, not phase identities.

Hover over an FFT or diffraction image for a **3× cursor magnifier**, including the current spot/pattern markers and reciprocal coordinates. The preview uses the displayed pixels and overlays without running another analysis; clicking does not enlarge the image. It hides when the pointer leaves, on scrolling, or while a new analysis is loading.

**Pattern overlay → Winning Fit (Passing)** shows the highest-ranked passing candidate, or nothing if none passes. **Winning Fit (Any)** shows the highest-ranked candidate even if it fails the screen. Both **Fitted A/B/C** and **Indexed reflections** vector overlays offer the same two choices. These display options do not change the phase label or accept a rejected fit. The other overlay options remain available to compare alternatives. Pattern and vector menus include only enabled search phases.

**Vector overlay → Indexed reflections** in Marker styles adds centre-to-spot arrows for two non-parallel matched reflections of the selected HCP/BCC/FCC candidate. Labels give the candidate plane indices, measured reciprocal distance g in nm⁻¹ and plane spacing d = 1/g in nm. These are reflection spacings, not unit-cell edge lengths. Rejected candidates retain dashed arrows; showing them does not accept a phase assignment.

**Vector overlay → Fitted A/B/C** instead shows reference vectors at the fitted prediction coordinates, with the candidate zone axis labelled once. It prefers short closed triples with strong peak matches. As an app display convention, letters run from longest to shortest reciprocal length (A > B > C); equal fitted lengths share a letter, for example A/A/B. Textbook diagram letters may differ. Equality allows numerical roundoff, not measurement uncertainty. The caption shows the angle between the first two vectors and, for distinct letters, their signed closure relation after ordering. Tied lengths show the letter sequence instead. Label backgrounds fit their text and stay near their vector endpoints; a dotted connector identifies a label displaced by crowding. If no closed triple is available in the prediction band, it shows the available independent directions. These reference vectors illustrate the fit based on all detected peaks; they are not the unit-cell edges a/b/c or a separate three-point phase decision. The measured FFT/diffraction image stays unchanged.

### Remembered settings

Basic preferences are saved automatically in browser local storage: the last image, region width, material and lattice references, enabled phases and phase colours, scale-fitting mode and custom scale, ranking weights, FFT processing and detection settings, central exclusion, outer fitting limit, grid size and stopping limit, adaptive options, grid visibility, and FFT display/overlay controls. Analysis controls carry across images; a new image opens with a centred region at the remembered physical width, limited to the image size. Existing display preferences and favourites are retained.

These preferences survive browser and app restarts at the same address in the same browser profile. Clearing site data resets them. This stores settings only: grids, analysis results and individual candidate-overlay selections are not restored. Use **Save region** for a reusable box definition, and **Export result** or **Export grid results** for numerical output.

### Grid analysis

The initial grid defaults to **20 × 20** cells. Adaptive mode subdivides unresolved or ambiguous cells, cells supporting two candidate structures, and cells with substantial secondary periodicity. Subdivision stops when the next children would fall below the selected physical size or the 32-pixel minimum. The default physical stopping limit is 5 nm; it is adjustable.

Optional **Check passing regions** trials four children even when a parent has a supported single-phase candidate. Keep the children when they reveal a different phase/zone, separate strong evidence for another pattern, **or a mix of passing and unresolved phase assignments**. For example, two passing HCP children and two unresolved/insufficient children replace the parent, exposing the spatial loss of phase evidence. Ambiguous children also count as unassigned in this mixed case. If all four simply lose evidence, retain the parent; uniformly weaker children alone do not justify a split.

A different phase/zone is compared against the parent’s family fitted to **that same child**, using the complete retained hypothesis pool. It must pass when that family fails, or beat its passing fit by at least 0.08 ranking score. Raw parent and child scores are never compared. Accepted children can be checked again down to the stopping limit. These are heuristic checks within the limited template library; an unresolved child does not establish a different phase or absence of crystallinity.

The parent stays visible until all four trial children finish. Rejected trial subdivisions are retained in saved results but excluded from map counts and area. Cancellation during a trial retains its parent. The grid summary reports parents retained and subdivided after these checks.

The colour legend and zone-symbol legends appear below the image. Blue, gold and pink symbols identify the best HCP, BCC and FCC zones respectively by default; phase colours are editable. All three structures reuse the same symbol set, at the left, middle and right of each cell. Faded symbols indicate candidates below the acceptance threshold. Zone-legend counts and the zone-axis breakdowns count only passing fits; zones with no passing fits are omitted from the legend. Displaying several fits is not evidence of phase coexistence. HCP directions use four indices, cubic directions use three, and negative indices carry an overbar.

**Cancel** retains a partial grid. **Clear grid** clears the displayed map and cancels an active run without deleting saved results. Area summaries use current leaf cells and exclude subdivided parents.

### Generic primitive orthorhombic search

Enable **Orthorhombic colour** under Phase colours / search, or select Unknown material. ORT tests primitive orthorhombic geometry with no atomic basis or systematic absences; it does not identify titanium α″ or any chemical phase. Titanium and Iron presets leave it disabled.

Editable a/b/c search anchors start at 0.300/0.400/0.500 nm. The independent-axis and overall + HCP c/a modes fit ORT a/b/c independently, within the material's reciprocal-scale bounds. Single-scale mode preserves reference cell proportions; fixed mode preserves all dimensions up to the chosen common multiplier. Independent fitting reports dimensions as **unconstrained** when a view cannot determine them separately. Common-scale results instead inherit the chosen proportions.

The finite library has 19 primitive nonnegative zone directions with indices up to 2, each with two in-plane mirrors (38 templates). Axis permutations are retained because a, b and c differ. Pair-based metric seeds are refined against measured profiles; this is a bounded heuristic search, not an exhaustive search over all orthorhombic cells. Outside Unknown mode, independent-axis scale cost averages squared reciprocal-axis deviations normalized to 5%, using the scale-penalty weight. Existing positional, missing-peak and weak-peak rules still apply. Extra fitting freedom can produce competing explanations; an ORT match alone does not establish orthorhombic symmetry.

### Scale fitting and rescoring

The **Material** row supplies editable reference dimensions for all three structures (see Material references above). The default is automatic BCC/FCC uniform / HCP independent a-and-c scaling. Automatic uniform scaling for every structure, stored scale and custom comparison scale are also available. The last-used mode carries across images and restarts; removed preset choices fall back to the automatic default.

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

Prediction-site evidence supplements the original strong-peak detector. It uses the existing FFT; neither image pixels nor the FFT coordinates are changed. The same procedure applies to all structures:

1. Find additional local maxima without reference to any crystal template, using the radially background-subtracted, smoothed log-power field. Require enrichment of at least 1.8 and local contrast of at least 2 robust background spreads, measured in an annulus two to four search radii away.
2. Exclude maxima within one search radius of an original strong profile and merge nearby weak maxima. Opposite spots count once. The search radius is the selected window’s approximate power peak width, with a minimum of 0.10 nm⁻¹.
3. Match remaining prediction positions one-to-one to weak maxima within that radius. Positions too near the selected fitting-band boundaries or another prediction are left unchecked. Weak evidence is capped at half credit per maximum and decreases with positional error.
4. Subtract average support at 11 rotated control patterns at the same radii from the weak-support bonus. This is a chance-match heuristic, not a statistical confidence test.

**Peak-evidence weight** defaults to 0.10; zero disables both adjustments. The bonus is the weight times positive excess weak support per prediction. The missing-prediction cost is the weight times the fraction of assessable predictions with neither strong nor qualifying weak support. Both terms are shown separately under **Prediction-site evidence** and in rank tooltips. The main and individual-fit tables show original strong + weak counts separately.

Weak maxima can change candidate ranking but **do not supply the four-profile acceptance requirement or the unique profiles required for two candidate structures**. The conservative shared-strong-evidence ambiguity check remains active. Long-dashed prediction outlines identify assigned weak maxima whether the candidate passes or fails the screen. Other predictions from below-threshold candidates use short dashes. Passing candidates use solid outlines for strong matches and dotted outlines for positions with no assigned maximum; faint outlines are unchecked. Separate white markers show the observed weak-peak positions using the selected weak-detection style.

These adjustments do not simulate reflection intensities, thickness, defocus or the contrast transfer function. Allowed reflections can be attenuated by [image contrast transfer](https://abtem.github.io/doc/user_guide/walkthrough/contrast_transfer_function.html). Unsupported predictions are therefore a modest ranking cost, not proof of absence; local-contrast thresholds and weights remain exploratory.

### Crystal pattern generation

`crystal_templates.py` defines the reciprocal coordinates and allowed-reflection rules. Cubic reflections use **g = (h, k, l) / a**; FCC allows indices all odd or all even, while BCC requires an even sum. HCP uses its hexagonal metric and basis selection rule. `fcc_templates()` generates the finite FCC zone library. Existing HCP/BCC zone templates are stored in `templates.json`.

`scale_fitting.prepare_templates()` enumerates integer plane indices, applies the structure rule and zone law **hu + kv + lw = 0** (three-index coordinates internally), and projects the surviving reciprocal vectors into the detector plane. The reflection range follows the selected inner/outer cutoffs and lattice references rather than a fixed number of shells. Changing HCP a/c also updates the reciprocal-plane projection so its lengths and angles follow the new hexagonal metric. `prediction_points()` applies the fitted reciprocal scale; the search then rotates the predictions to match the observed points. These are allowed positions, not simulated intensities. `materials.py` supplies preset references and validates custom dimensions.

## Interpretation and limitations

- The library contains **72 templates**: the existing 46 HCP/BCC templates and 26 FCC templates, including mirror variants. FCC covers primitive cubic direction families with maximum index 3. This is a finite orientation library; other structures and untested orientations can affect results.
- Peak detection and matching default to **3–10 nm⁻¹** for FFTs and **2.5–10 nm⁻¹** for direct diffraction. Both boundaries are adjustable. Signals outside the selected band are excluded; these cutoffs are heuristics, not structure-specific physical limits.
- Peak coverage is the sum of weights of matched original detected peak profiles divided by the weight of all original detected profiles. FFT weights use height above the radial background; direct spots use log(1 + local contrast). Both are capped at 1–6; additional weak maxima are excluded. Neither peak coverage nor rank score is an intensity fraction, phase probability or phase fraction.
- The scale penalty is a preference for smaller adjustments, not a calibrated strain prior. Calibration errors can change candidate rankings.
- Independent HCP a/c fitting adds flexibility. The penalty is not a statistical correction for the number of fitted parameters.
- Additional weak maxima and unsupported prediction positions contribute optional heuristic ranking adjustments. HRTEM contrast transfer can suppress allowed reflections; a missing peak is not proof that a structure is absent.
- A conservative shared-evidence check retains ambiguity when competing structures explain the same detected profiles and the leading fit requires additional flexibility or unsupported predictions.
- Small regions broaden FFT peaks, limiting separation of nearby reflections. Image-calibrated fits alone do not establish lattice strain.

Supported input is finite, two-dimensional DM4 data with length or reciprocal-length calibration, or single-frame JPEG, PNG and TIFF images calibrated manually from a scale bar. Real-space FFTs require equal x/y pixel calibration; automatic grids require square real-space images. Direct diffraction supports rectangular detector exclusions. Ring indexing and arbitrary real-space region shapes are not implemented.

## Development

| Component | Responsibility |
| --- | --- |
| `analysis_core.py` | FFT processing, peak detection, fixed-scale matching and geometry checks. |
| `diffraction.py` | Reciprocal calibration, beam-centre estimation, direct spot detection and detector exclusions. |
| `orthorhombic.py` | Primitive orthorhombic metric seeds, independent cell fitting and dimensional observability. |
| `scale_fitting.py` | Bounded automatic scale fitting, candidate ranking and cached reranking. |
| `materials.py`, `crystal_templates.py` | Material references, reciprocal coordinates and allowed-reflection generation. |
| `phase_comparison.py` | Prediction counts and shared-evidence ambiguity checks. |
| `peak_evidence.py` | Independent weak-maxima detection, prediction-site audits and ranking adjustments. |
| `adaptive_refinement.py` | Same-child comparisons and mixed assignability checks for passing parents. |
| `folder_paths.py`, `workbench_project.py` | Local directory links and reusable region definitions. |
| `engine.py` | Image loading, region analysis, previews and fit caches. |
| `server.py` | Local HTTP endpoints, grid jobs and JSON exports. |
| `web/` | Buildless browser interface. |
| `demo_data.py`, `demo/` | Optional demo catalog and legacy decoder. |
| `engine_provenance.json` | Numerical provenance and recorded limitations. |

Run the focused numerical checks with:

```sh
python -m unittest discover -s tests
```

The local API provides `/api/config`, `/api/open`, `/api/analyze`, `/api/grid`, `/api/job`, `/api/rescore-grid`, `/api/cancel`, `/api/save`, `/api/browse-folders`, `/api/folders`, `/api/regions`, `/api/regions/save` and `/api/regions/open`. POST requests require the session token returned by `/api/config`.

After updating Python source, save active results, restart the server and reload the page. Previously saved results retain the engine hash and settings used to produce them.

## Implementation plan

The maintained [implementation plan](docs/implementation-plan.md) tracks HCP fitting, automatic peak-strength selection, batch grids, parallel execution and overlapping-window mapping, including priorities and open decisions.

## License

[MIT](LICENSE). The macOS launcher includes code adapted from Tensile Workbench; its attribution is retained in [macos/TENSILE-LICENSE](macos/TENSILE-LICENSE). Colour-table attribution is in [web/colormaps.LICENSE](web/colormaps.LICENSE). Third-party dependencies retain their respective licences.

## Architecture and numerical workflow

The versioned [methods atlas](docs/architecture/README.md) documents the implementation with equations, flowcharts, acceptance decisions and adaptive-grid rules. Read the [eight-page PDF](docs/architecture/tem-workbench-architecture.pdf) or the individual editable SVG panels. Its [JSON source](docs/architecture/architecture.json) and [renderer](tools/render_architecture.py) live in this repository; a source-hash check flags relevant code changes for review before regeneration.

The [methods manuscript draft](docs/paper/README.md) includes the numerical workflow, equations, documented development checks and references to prior work. Proposed PCA/NMF analysis and outstanding validation are clearly separated from implemented behaviour.

### Acquisition locations

**Acquisition map** beside the file browser plots recorded DM4 stage positions over a selectable real-space overview. It starts with the current folder/date and the widest calibrated overview from the same labelled sample/date. Choose a **Folder** in the map or **Whole labelled sample** to include all its folders. Click a calibrated image footprint or list entry to make it the new reference; **Back** returns one level, restoring the previous view. **Open** beside a list entry opens it for analysis. Drag to pan and scroll to zoom.

Enable **Compare on hover** to see the full acquired image beside its predicted crop from the current reference. Crops use original reference pixels, preserve full-image contrast, and show out-of-frame areas in black. Hovering the reference itself does not show a comparison. Stage rounding can exceed the size of a high-magnification field, so use these comparisons to inspect placement rather than assume image registration.

This is approximate. The stage tags do not declare units: µm is the initial assumption, with units, rotation and flips adjustable in the dialog. Camera orientation, image shifts, stage rounding, drift and tilt can displace the schematic footprints. Diffraction images are points only. Missing locations are listed, not invented. Newly saved results include the raw stage coordinates when available.

Acquisition-map stage rotation is remembered per reference image and data folder in browser storage, including across reloads and app restarts in the same browser/address. Changing reference or navigating Back restores that reference’s angle; an unset reference starts at 0°.

**Adjust placements** enables manual dragging of calibrated image footprints. Select an image in **Image to adjust** when footprints overlap, then drag its highlighted footprint. The comparison card updates its reference crop during the drag and reloads the original-pixel crop on release. Manual centres are remembered per reference–image pair in this browser; Back and revisiting a reference restore its placements. **Reset placement** restores the recorded-stage estimate for the selected image. Positions use the reference image’s coordinates; stored DM4 metadata, pixel orientations and analysis coordinates are unchanged. Zoom-out is capped at twice the most recently fitted view width; **All locations** deliberately fits a wider area.

### Geometry-first automatic peak strength

**Auto · dominant rank** keeps the threshold with the strongest passing crystal fit. **Auto · geometry (1–2 patterns)** selects the threshold using periodic grids first, then performs crystal matching once. It can retain weaker, independently supported periodicity without requiring it to be a particular phase. Shared peaks count once; chance matches and an extra-grid cost reduce the score. Evidence is normalized against the full admitted peak pool so removing weak peaks does not automatically improve coverage. Threshold fraction, threshold floor and maximum profiles still bound the search. This exploratory mode can miss patterns or fit noise; two geometry grids are not proof of two crystal phases. Exports record the selection objective and trials.

### Manual diffraction peaks and batch grids

In direct diffraction mode, use the **Add peak** or **Remove peak** buttons in the **Peak editing** panel, then click the detector or reciprocal plot. Snap and deduplication radii use nm⁻¹, defaulting to 0.50 and 0.10 respectively (adjustable from 0.001 to 5). Distances respect separate X/Y calibration; the ring can therefore be elliptical on detector pixels. Remove peak deletes only the nearest selected observation. Older saved pixel-radius edits retain their original behaviour. Uncheck snapping for exact placement. A search ring follows the cursor; drag a saved ring or its handle to change that peak’s snap radius and search again around its original click position. The cursor is a crosshair; Add and Remove show their active radius as a dashed boundary. **Undo peak edit** and **Reset peak edits** restore previous detections. Edits are remembered per image and saved with named regions and exports. Manual measurements are pink on the reciprocal plot; source-detector observations are purple and follow the selected measured-peak marker style. Manual measurements bypass the automatic contrast cutoff and affect fitting. Peak editing remains interactive while fitting updates in the background. **Reset settings** restores diffraction detection defaults, centre, calibration, exclusions and worker selection while preserving peak edits; **Reset peak edits** is separate. Hidden or partially obscured inferred spots are not implemented yet.

For real-space images, open **Automatic grid → Batch grids**, review the OneView images above the adjustable magnification cutoff, select the files, and run using the current processing and grid settings. The folder picker loads automatically and accepts multiple parent folders, including their subfolders. Ticking folders selects their eligible images; keyword search further filters the review list. **Select only matches** selects just the filtered results. **Flatten subfolders for summary** combines descendants under each selected parent (or each top-level folder when All folders is selected); unticked, each source subfolder is summarized separately. Folder summaries and zone breakdowns are exported to `folders.csv` and `folder_zones.csv`, with image-to-folder assignments in `image_folders.csv`. Sample summaries remain available too. The default includes 400kX. Each image receives a grid JSON and, optionally, a PNG map. The batch output folder also contains per-image and per-sample CSV summaries, zone breakdowns and a complete `summary.json`. For overlapping stability maps, per-image and per-sample CSVs report passing frequencies over covered raster area, with both area-weighted pooling and equal-image means. Zone CSVs report passing window counts, not areas; windows are correlated. PNGs show the combined all-phase frequency map. Cancellation preserves completed output and the current partial map. Pooled sample areas and mean image percentages are separate; passing phase/zone support may overlap and is not a measured phase fraction. Grid and region export filenames include the source image name.

Batch progress includes a compact live map of the current image above the summaries. Completed grid regions appear as they finish; the viewer advances automatically between images. Summary phase columns include only the phases enabled for that run. Minimum magnification is inclusive.

File selectors and the visual image browser include filename extensions. Ordinary images show (Calibrated) or (Uncalibrated); the status updates after calibration and checks for changed source pixels.
