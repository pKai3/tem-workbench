# TEM Workbench

A local web application for exploring transmission electron microscopy images through movable-region FFTs, direct diffraction spot analysis, automatic peak detection, and HCP/BCC/FCC candidate fitting.

**Installing for the first time?** Download **TEM-Workbench-<version>.zip** from [Releases](https://github.com/pKai3/tem-workbench/releases/latest), extract the whole folder, then open **1 - Install TEM Workbench - Windows.bat** or **1 - Install TEM Workbench - macOS.command**. The extracted folder's **0 - START HERE.txt** walks through setup. Keep that folder in place after installation.

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
- Use **Mask / iFFT** above the FFT to keep or reject paired circular frequency regions and preview the reconstructed crop. Click to add a pair, drag to move, and set radius/edge fade in nm⁻¹. Exports include a native-size PNG, numerical NPZ and reusable JSON mask recipe. Input Hann/polygon fading remains in the reconstruction; this does not change matching results or establish phase identity.
- Choose data and output folders through the interface, with local directory links.
- Save named, tagged regions linked to their source images and analysis settings.
- Export region and grid results as JSON with source pixel hashes and engine provenance.
- Download optional full-resolution TEM and diffraction examples separately.

## Parallel analysis

Under **Automatic grid**, choose **Workers**: Auto, 1, 2, 4, 8, 10, 12, 14 or 16. Explicit choices may exceed logical CPU count; that can increase memory use without improving speed. Auto uses up to four workers and leaves one logical CPU free. Lower counts reduce CPU and memory use. The choice is remembered and applies to the next run. Progress includes worker count and elapsed time; manual region inspection remains available during a grid.

Each grid uses separate Python processes with private fit caches and one shared, read-only temporary source image. Results and adaptive decisions are applied in a fixed order. Cancel stops queued work and checks between automatic-strength trials; the current trial may finish first. A partially checked subdivision retains its parent. Completed grids can still be reweighted from cached fits.

Refreshing the page reconnects to the running grid, restoring its image, settings, progress and Cancel control. Completed or cancelled results also return until cleared or replaced. This requires the same backend to remain running; export results before stopping it. See the [implementation plan](docs/implementation-plan.md) for recovery behaviour and validation.

Direct diffraction offers **Smoothing threads: Auto / 1 / 2 / 4 / 8**, remembered between sessions and images. Auto uses two threads where available; choices are capped by CPU count. Changing threads preserves cached detections and takes effect on the next uncached detection. Central exclusion and outer fitting limit sit together in the active FFT or Direct diffraction settings panel. These execution changes preserve the detector and matcher calculations. Process startup adds overhead to very small grids; speedup depends on the image, settings, CPU and memory. Windows and macOS use the same spawn-based design; the initial performance measurements and live UI checks were on macOS. See [measurements and validation](docs/parallel-performance.md).

## Overlapping stability maps

Under **Automatic grid → Search mode**, choose **Overlapping stability map**. Set a square FFT window (default 5 nm), centre spacing (2.5 nm), square or hexagonal centres, and 1, 3 or 9 shifted placement passes. Each window is matched independently using the current analysis settings and grid workers. Optional **Sample image rim** adds full-size windows along all four borders, keeping the interior layout fixed. Preview the extra windows before running; the same option applies to batch maps. Details are in the [implementation plan](docs/implementation-plan.md#image-rim-sampling-and-display-cleanup--completed-10-november-2026).

View each phase's passing frequency, **Average passing strength**, disagreement between placement passes, sampling coverage, raw centres, or separately supported structures within the same window. Passing strength averages the best passing rank per phase, with failed/missing fits counted as zero; the existing spatial weights and equal-pass averaging still apply. Raster and hex views offer individual phases or a colour blend of all selected phases. Opacity follows the strongest mean, capped at 1; hover values retain the full score. Existing in-memory maps can use their stored fits without rerunning detection. Three selected phases use continuous colour blending with a triangular key in live and exported maps. Click a map location to inspect a contributing window. Exports retain raw fits and aggregation settings; PNG exports capture the selected view. These are overlapping candidate-support maps, **not physical phase fractions or probabilities**. Windows are correlated, edges have fewer samples, and the FFT window sets spatial resolution. Batch grids also support this mode: the same physical window size, spacing and placement passes are applied to each selected image. Batch PNGs offer frequency and strength views; summaries pool covered raster area without summing overlapping window areas. Details and remaining work are in the [implementation plan](docs/implementation-plan.md#overlapping-window-phase-candidate-map).

## Installation and updates

Download **TEM-Workbench-<version>.zip** from [Releases](https://github.com/pKai3/tem-workbench/releases/latest), extract it into a writable folder, and keep that folder in place. The optional demo images download separately inside the app.

- **macOS 13+:** double-click **1 - Install TEM Workbench - macOS.command**. Apple Command Line Tools are needed to build the Dock launcher. It installs into `~/Applications`.
- **Windows 10/11 x86-64:** double-click **1 - Install TEM Workbench - Windows.bat**. It creates Desktop and Start menu shortcuts using the same application icon as macOS.

For subsequent starts from this folder, use **Launch TEM Workbench - macOS.command** or **Launch TEM Workbench - Windows.bat**, respectively. If updating an existing source checkout, rerun its platform installer to refresh the installed app’s launcher path.

Desktop setup uses standard **64-bit Python 3.14**, including Tcl/Tk on Windows. If missing, setup offers to download the official checksummed Python installer; installation proceeds only after consent. Python 3.15 and free-threaded builds are not supported by desktop setup. Packages are installed in an environment outside the source folder and cloud storage. Existing source-folder `.venv` directories are left intact.

The desktop window provides Start/Stop, Open Workbench, live logs and **Check for updates**. Updates verify release files, prepare dependencies separately when needed, and keep rollback copies. Updates work without Git for extracted releases. A Git checkout must have clean tracked files and advance by fast-forward. Data, output, saved regions, calibration and local settings are preserved. Stop/export unfinished work before applying an update; running grids cannot survive a restart.

**Existing installations:** rerun the platform installer once to move to the new launcher/update mechanism. See [SETUP.md](SETUP.md) for environment locations, console startup and recovery. This launcher is locally built/ad-hoc signed on macOS, not an Apple-notarized standalone distribution. Windows hardware smoke testing remains useful alongside automated native checks.

The server normally listens at **http://127.0.0.1:8767** and desktop launchers choose another free local port if occupied. It is intended for local use, not public web hosting.

Without `.tem-paths.json`, the application uses `./data` and `./output`, plus installed demos. Console option `--demo` hides external images until folders are applied.

## Opening images

Expand **Data Sources and Outputs** at the top of the page. Add one or more named project source folders, choose a **Main output folder**, then **Apply sources**. Each source can optionally have its own output folder. The picker reads local files without uploading or copying them. Source folders must not overlap. Changing sources clears the in-memory grid; export results and finish or cancel active jobs first.

Immediate subfolders identify samples, with project names distinguishing samples across sources. Batch review can flatten nested subfolders for summaries. Per-image exports use that source's output override, when set; combined batch summaries use the main output folder. Choices are saved in the ignored `.tem-paths.json`. Existing single-folder configuration remains supported.

The catalogue finds DM4, JPEG, standalone PNG and single-frame TIFF files recursively, excluding configured outputs, preview sidecars and AZtec acquisition folders/raster exports. Native DM4 files in mixed folders remain available. A background check runs every 15 seconds while no grid, batch or window-size job is active; **Refresh images** also rescans explicitly. Path changes and missing files appear as bottom-right notices.

The **Project** selection is shared between diffraction and AZtec, with a separate return location in each mode. Preferences and named comparisons autosave to `tem-workbench.workspace.json` beside the folder configuration; see [saved workspace details](docs/aztec.md#shared-projects-and-saved-workspace).

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

FFT brightness, background, white point and colour are display controls. The intensity palette offers Magma (default), Viridis, Plasma, Cividis, Turbo and Greyscale; all palettes fade to Magma’s near-black zero colour. The redundant Low–High colour bar is omitted; reciprocal axes remain. The reset icon beside the white-point field restores the background and white-point defaults. These controls do not alter detected peaks or fitted coordinates. White maxima markers can be crosshairs, open crosshairs, circles or off. Open crosshairs leave the spot centre uncovered and draw four outer alignment arms; the choice is remembered.

The **FFT processing** row above Material and Scale fitting controls **Hann window**, **Remove mean**, the peak threshold fraction, and FFT peak detection:

| FFT detector control | Default | Meaning |
| --- | --- | --- |
| Smoothing σ | 0.65 bins | Gaussian smoothing of background-subtracted log power; zero disables it. |
| Threshold floor | 1.8 | Lower bound for the profile cutoff. The cutoff is max(floor, threshold fraction × strongest signal). |
| Minimum peak strength | Manual, 3.0 | Minimum height above radial background for a detected profile. Auto searches the admitted profile sets for the best passing rank. |
| Minimum separation | 0.50 nm⁻¹ | Nearby profiles merge, retaining the strongest. The effective minimum is at least the crop-window peak width. |
| Maximum profiles | 70 | Strongest independent profiles retained; opposite spots count once. |

Threshold floor and peak strength are in background-subtracted natural-log-power units, not intensity percentages. These controls select original strong profiles; prediction-site checks for additional weak maxima are a separate ranking step. FFT weak checks use the same processed detector signal, smoothing and threshold floor. They do not apply the strong-profile minimum strength, since their purpose is to assess weaker maxima. Windowing and mean removal default to on, preserving the original computation. Turning Hann off uses the rectangular crop. Changing these controls recalculates the selected region and clears the previous grid. The ↺ button beside **FFT processing** restores all controls in that row to their defaults. Settings persist across images and restarts, and saved analyses record them. Detection-only controls leave the FFT pixels and axes unchanged. Display controls remain separate.

**Brightness grouping**, under Scale fitting, is available for FFT and direct diffraction. The same bounded preference supports geometrically valid phase combinations with different integrated signal levels. It uses background-subtracted native FFT power or native detector signal, pools omega variants, counts shared observations once and allows variation within phases and with radius. Default strength is 0.10; zero disables it. Completed FFT grids can be reweighted from cached measurements. The collapsed report shows the rank bonus, relative levels and profile IDs. See the [implementation plan](docs/implementation-plan.md) for validation and limits.

Peak IDs now run from brightest integrated signal to faintest: **1 is the brightest**. Opposite spots share a number, and plot labels, measured rows, fit assignments and numerical exports use those same IDs. IDs are assigned before fitting without reordering its inputs; each automatic-strength subset receives its own consecutive numbering. Changing detection or the crop can change the numbers. Detector-bound beta anchors follow their positions. Older results need recalculation for this numbering.

**Raw FFT / Processed** above the FFT image switches between original log power and the background-subtracted, smoothed signal actually used to detect peaks. The diagnostic view shows the connected-profile cutoff and selected minimum strength; the axes, fitted patterns and measured markers are shared. Brightness curves are disabled for the detector response because it is already a processed signal. Contrast and palette still affect display only. Enlarged views and PNG/GIF exports follow the chosen view, with processed exports explicitly labelled. Switching views does not rerun detection or change results.

**Auto · dominant rank** varies minimum peak strength independently for each region. It computes the FFT once, then compares every distinct set of at least four profiles admitted by the current threshold fraction, threshold floor, separation and maximum-profile controls. It selects the highest-ranked passing candidate; if none passes, it keeps the best rejected result and leaves it below threshold. Equal ranks prefer more detected profiles. It can raise or lower the minimum strength, continues after the first passing fit, and reports the selected cutoff and number of comparisons. Other detection settings and the acceptance rules remain unchanged. This is rank optimization on the same data, not independent confirmation of a phase; rank can increase by excluding poorly matched profiles. Auto is opt-in and can require multiple fits per grid cell. Cached grid reweighting retains the selected detected profiles; rerun the grid to optimize the cutoff under new weights. Saved regions and exports preserve the Auto setting and results, including the admitted pool size/weight and the selected fraction of that weight. Dominant-rank scores use the selected subset; they are not directly comparable with manual or geometry-auto scores. This mode can discard a weaker second pattern.

Window widths used for matching and weak-peak checks follow the selected window (approximately 1.44 FFT bins for Hann or 0.886 for a rectangular crop, with existing minimum tolerances). Windowing suppresses side lobes at the cost of a wider central peak; see the [SciPy spectral-analysis guide](https://docs.scipy.org/doc/scipy/tutorial/signal.html#spectral-analysis).

**Central exclusion** and **Outer fitting limit** sit together in the active FFT processing or Direct diffraction panel. They select the reciprocal-space band after the FFT (or on the recorded diffraction image), rather than changing the transform.

**Outer fitting limit, nm⁻¹** controls the radial upper cutoff for both FFT and direct diffraction analysis (default 10, adjustable from 4 to 30). The selected limit applies to detected peaks, allowed crystal predictions, geometry checks and missing-spot checks. Reflections are generated far enough to cover that band throughout automatic scale fitting. Changing the limit recalculates the selected region and clears the old grid; run a new grid to use the new range. Each image restores its saved override or the default; saved regions retain their captured limits.

**Central exclusion, nm⁻¹** sets the radial lower cutoff: default 2.5 for both FFTs and direct diffraction. The selected radius applies to peak detection, predictions, geometry checks and weak/missing-spot checks. It must be non-negative and smaller than the outer fitting limit. A zero radius still excludes the origin itself. Lowering the radius admits longer-period features and may admit central-beam or background artefacts; it does not change the FFT pixels or calibration.

Both spectrum views show the selected central exclusion boundary and outer fitting boundary, with light shading outside the analysed band. These boundaries also appear in enlarged views and PNG/GIF exports. An FFT image must sample the selected band; lower the outer limit if the stored pixel calibration does not allow it.

Drag either fitting-limit handle inward/outward to change its radius in 0.1-unit steps, or around the centre to reposition the handle and label in 15° steps. Arrow keys adjust radius; Shift + arrows adjust angle. Angle-only moves do not recalculate fits. Direct-diffraction handle changes automatically remember both positions for that image in this browser; **Remove override** restores the default limits and handle angles. FFT changes remain local until the radii are saved with **Save override**. Handles are omitted from exports.

### Material references

**Material** groups HCP a/c, ω a/c, BCC a, FCC a and generic orthorhombic a/b/c references in one place. Titanium is the default, showing α (HCP), β (BCC) and ω. Iron shows α (BCC) and γ (FCC). Reference inputs and phase controls for other structures are hidden; Unknown and Custom retain all available structures. Selecting a preset updates the reference dimensions. Editing any dimension selects **Custom**, except in Unknown mode, where the edited search anchors retain the wider search. Cubic cells use a = b = c; HCP and ω use a = b with a 120° basal angle. These values generate the prediction grids and define zero scale deviation; automatic fitting adjusts predictions relative to the chosen references. Changing them recalculates the selected region and clears the grid. Preferences and saved regions retain the material and explicit dimensions.

**Unknown material** enables HCP, BCC, FCC, ω and primitive orthorhombic (ORT) and expands automatic reciprocal-scale bounds to ×0.5–2.0 (ordinary presets use ×0.85–1.15). Selecting it switches a fixed-scale view to automatic fitting. Its editable dimensions are search anchors, not identified material properties. Overall scale penalty is disabled in Unknown mode, including cached grid rescoring. HCP/ω c/a penalty remains adjustable and active in overall + c/a mode; peak-evidence scoring is unchanged. The overall weight is remembered for other materials. This broader finite-template search can be slower and more ambiguous; it is not an unrestricted structure identification.

**Phase colours / search**, beside Material, controls which structures are searched. **Disabled** skips that phase in FFT analysis, direct diffraction and automatic grids. Titanium defaults to HCP + BCC + ω, Iron to BCC + FCC, and Custom to all five structures. Phases offered by the selected preset can be enabled or disabled; use Unknown or Custom for other comparisons. Selecting a material applies its phase defaults; editing a lattice dimension keeps the current phase selection. The small reset arrow restores the selected material’s default phases and colours (ω defaults to purple). Changing only a colour redraws the view; enabling or disabling a phase recalculates the region and clears the old grid. Enabled phases are remembered across startup/image changes and saved with regions. All phases may be disabled to inspect peaks and geometry alone.

| Material | HCP a / c, nm | BCC a, nm | FCC a, nm | ω a / c, nm |
| --- | --- | --- | --- | --- |
| Titanium | 0.295 / 0.468 | 0.330 | — | 0.4614 / 0.2832 |
| Iron | — | 0.28675 | 0.36484 | — |

These are editable starting references, not a claim that every phase is stable under the same conditions:

- Titanium retains the workbench's nominal α-HCP and approximate β-BCC references. The FCC search anchor is available only through Unknown or Custom comparisons. [Ren et al. (2020)](https://doi.org/10.1590/1980-5373-MR-2019-0638) use HCP dimensions close to these and an energy-minimised FCC parameter of 0.4174 nm. The approximate BCC value should be adjusted for the alloy and temperature.
- Iron BCC is evaluated at 295 K and FCC at 1183 K using the temperature-dependent equations of [Seki and Nagata (2005)](https://doi.org/10.2355/isijinternational.45.1789).
- The legacy iron HCP anchor (0.24637 / 0.39568 nm), retained for saved Custom comparisons but hidden in the Iron preset, represents ε-Fe at **15 GPa and 300 K**. Its dimensions are derived from the equation-of-state volume of 10.40 Å³/atom and c/a = 1.606 tabulated by [Dewaele et al. (2023)](https://doi.org/10.1103/PhysRevLett.131.034101), using a = [4V / (√3 × c/a)]⅓ and c = (c/a)a. This is a high-pressure reference, not ambient iron.

### Titanium omega (ω)

Select **BCC** and **ω** using the regular **Phase colours / search** controls. The search then tests ordinary independent candidates and additional omega orientations constrained by each beta parent. There is no separate Beta + Omega search mode. **Pattern overlay → Best β + related ω** displays the complete parent-and-variants candidate for comparison, even when another fit ranks higher. BCC-only uses exactly the same beta hypotheses and scores, so a competing beta interpretation is reproducible by disabling ω. All candidates use the common positional/chance score, weak/missing-prediction evidence and measured-peak weights. The entire parent-linked ω family counts as one addition, costing 0.025 whether one or several supported variants are active. Each variant still needs its own nonparallel exclusive support and contributes its predicted sites to the common evidence checks. Independently fitted orientations retain a 0.025 cost per extra component, including multiple orientations of one phase. Shared positions count once.

Related combinations appear in the common ranked results table and **Individual fit overlays**, with a checkbox for the whole combination and indented component checkboxes. Parent candidates sort by rank, keeping components together. **Colour by → Phase / Variant** applies to every selected phase in diffraction and FFT: one phase colour or separate, editable legend colours for independent orientations (such as BCC1/BCC2) and related omega variants. Supported variants display as ω1, ω2…; underlying orientation IDs remain in the details. Coincident phases retain concentric marker shapes with their own animation timing; variants within a phase split that shape’s outline colours. Existing marker styles, hover previews, PNG/GIF and numerical exports remain available.

For an absent or unreliable scale bar, use **Calibrate scale bar → Open without calibration**. Selected phases are still searched using relative geometry. Unknown material also removes absolute-scale preference in direct diffraction. Independent reference-cell proportions seed a bounded search after coordinate normalization; the finite zone library remains a limitation. Absolute cell dimensions are not reported for an uncalibrated image. **Optional beta anchors** accepts two nonparallel profile IDs and BCC indices, including with BCC alone; detector positions preserve their identity if profile numbering changes.

The relation is **{111}β ∥ (0001)ω**, **⟨110⟩β ∥ ⟨11̅20⟩ω**, with aω/aβ = √2 and cω/aβ = √3/2; see [“Origin of ω-phase formation in metastable β-type Ti-Mo alloys” (2020), Fig. 4](https://doi.org/10.1038/s41598-020-65254-z). Automatic free-scale beta hypotheses cover cubic zone families through index 3. Related variants require at least two additional nonparallel profiles each. Two parent profiles can be corroborated by the related variants; the combined model must pass the ordinary four-profile/coverage/score screen. Beta-only attempts below that screen remain inspectable. Comparisons use actual passing candidates and expose their scores; a near tie is not a phase probability. Distortion, off-zone excitation, incomplete collapse and dynamical intensities are not modelled. See the [implementation plan](docs/implementation-plan.md) for validation and known limits.

Direct-diffraction spots now have background-subtracted **integrated intensity**, measured in native image pixels over an aperture based on their estimated width. A robust local background plane excludes other detected spots; overlapping apertures partition their shared pixels, and masked/truncated apertures are flagged rather than extrapolated. Signed pixel residuals are summed without positive-only clipping. Opposite spots are measured separately and averaged so two visible signs do not double a profile’s weight. The measured list stays sorted by integrated intensity, preserving IDs, and retains centre value, width and fitting weight. Hover or focus a starred intensity for measurement flags. Recorded image signal is not calibrated electron counts, and saturation or image processing cannot be undone by this measurement.

Reliable profile measurements use `clip(3 × sqrt(integrated intensity / median reliable intensity), 1, 6)` for fitting importance. Local contrast remains the detection criterion and fallback weight for incomplete or estimated measurements. The same weights apply to all candidate phases; there is no hard rule that a bright spot must be beta. Nominal omega absence coincidences and double-diffraction paths remain separate from allowed-reflection coverage. The optional DD weight adds ranking credit only for supported two-step paths.

**Double-diffraction candidates** checks each selected phase fit for extra peaks reachable through two observed, allowed reflections. Explicit combinations, including Beta + Omega and ordinary multi-orientation fits, also permit paths between their fitted components; separate alternative fits are checked independently. Expand the diagnostic below Marker styles for contributing peak IDs, indices and measured/fitted sum residuals. **Marker styles → Double diffraction** controls shape or Off; markers follow the selected phase/orientation colours. **Scale fitting → DD weight** (0–1, default 0) adds a bounded bonus based on the fitting-weight share of additional profiles, their fitted/measured sum agreement, and observed-sign support. Each target counts once regardless of path count; already allowed matches get no extra credit. The same rule applies before selecting independent and combined candidates. Zero keeps DD diagnostic only; acceptance screens and missing-prediction penalties remain unchanged. Candidate coverage stays separate from allowed coverage, and the report and rank tooltip show the DD contribution. In an image FFT these are frequency coincidences, not proof of a scattering mechanism. See the [implementation plan](docs/implementation-plan.md) for limits and validation.

The independent ω search below remains available for calibrated diffraction and FFT analysis.

ω uses an ideal monatomic **P6/mmm** model with fractional sites (0,0,0), (2/3,1/3,1/2) and (1/3,2/3,1/2). This is a separate atomic basis from α-HCP. Summing these sites gives zero structure factor when **l is even and h − k is not divisible by 3**; all other nonzero indices are allowed in this ideal model. These are allowed positions, not an intensity or dynamical-scattering simulation. Forbidden-position diagnostics use the same basis rule.

The editable starting references are **a = 0.4614 nm, c = 0.2832 nm**, reported for shock-recovered high-purity titanium by [Gray, Morris and Lawson (1992), “Omega phase formation in titanium and titanium alloys”](https://cdn.ymaws.com/titanium.org/resource/resmgr/ZZ-WCTP1992-VOL1/1992_Vol.1-2-Omega_Phase_For.pdf). They are search anchors, not universal alloy values. The matcher searches the existing 36 hexagonal zone/mirror templates with ω geometry and reflection rules, in FFT, direct diffraction, grids and batch analysis. It supports uniform scaling, separate a/c scaling and overall + c/a scaling; the HCP/ω c/a penalty applies to both hexagonal structures. Unobservable c dimensions remain marked unconstrained.

ω supports the same 3/4-index notation, prediction/vector overlays, phase colours, maps and exports as other structures. Existing saved phase selections remain unchanged: enable **ω colour** or restore Titanium phase defaults to include it. A passing ω fit is a candidate, not independent confirmation of ω phase; competing structures and calibration still need assessment.

### Direct diffraction (experimental)

Opening a DM4 with reciprocal-length calibration (for example `1/nm`) automatically switches to **Direct diffraction**. The recorded detector intensity is analysed directly, without an FFT, Hann window or mean removal. The first version supports spot patterns, not ring indexing. It uses the same limited HCP/BCC/FCC template library and adjustable fitting-band controls as FFT analysis; direct diffraction defaults to **2.5–10 nm⁻¹**.

**Raw / Processed** above the pattern uses the same display toggle as FFT mode. Processed subtracts the radial background from log intensity and applies light smoothing for more even brightness. Exclusions and off-detector padding are omitted from that calculation and shown dark. Contrast and palette remain available; hover previews and PNG/GIF exports follow the selected view. This is display-only: switching views does not rerun analysis or change peak positions, intensities or fitting results. The left detector image retains the original pixels.

- **Beam centre:** an initial estimate clusters opposite-spot midpoints near the detector centre. When a clear dark beam-stop shadow is present centrally, it helps choose between repeated lattice inversion centres; its silhouette centroid is not treated as the direct beam. The pair count, residual and use of this shadow constraint are shown. Verify visually: neither spot symmetry nor a beam-stop shadow uniquely guarantees the correct origin. If pairs are inadequate, the detector midpoint is labelled as a fallback. Edit Start X/Y, or choose **Set centre** to open a coordinate dialog. **Pick on image** enables placement on either image; the detector has a magnified native-pixel preview with a clear-centred crosshair. **Estimate** restores the initial estimate. Press **Escape** from Add/Remove peak, Mask area or centre placement to return to View and cancel any unfinished drag. In the enlarged pattern, the first Escape exits editing and a second closes the enlarged view. Previous manual choices remain saved until changed.
- **Refine translation:** enabled by default for direct diffraction. The Start X/Y fields remain a fixed starting point; the Direct diffraction heading shows the fitted centre actually used, or why it was retained. One shared X/Y translation is fitted from the midpoints of detected opposite spots, before fitting HCP/BCC/FCC rotation and scale. At least three independent pairs spanning two directions are required. Robust positional least squares rejects inconsistent pairs; their intensities need not match. The default maximum total movement is **50 original detector pixels**, adjustable from 1 to 200. Competing centre solutions or a solution outside the limit retain the starting centre with an explanation. Turn the checkbox off to hold that centre fixed. This is a local refinement, so an incorrect lattice-equivalent starting centre may still require manual correction.
  The readout reports the fitted centre, signed X/Y shift (detector Y points down), pair count and opposite-pair RMS before/after. The diffraction view, masks and reciprocal coordinates use the fitted centre, shared by all structures. Original image pixels and pixel calibration are unchanged. The starting position never advances between runs. Saved settings preserve that starting point and refinement controls; exports also record the fitted centre and supporting pair midpoints. Initial analysis may need a second detection pass at the fitted centre; both passes are cached for repeat fits. Real-space FFTs retain their fixed origin.
- **Calibration:** X/Y values are reciprocal spacing per detector pixel in nm⁻¹. Both can be edited; **Stored calibration** restores the DM4 values. These values and the centre define measured reciprocal coordinates. Scale fitting separately moves the crystal predictions. Positive reciprocal y points upwards; detector y increases downwards.
- **Exclusions:** set the central exclusion radius and draw rectangles over beam-stop or detector artefacts. Undo removes the last rectangle; Clear removes all rectangles. A predicted profile is unchecked when neither opposite position has a visible neighbourhood. One visible opposite remains assessable. Exclusions are shown on both views.
- **Spot controls:** smoothing sets the minimum detection size in original pixels (default 2 px). The detector checks progressively larger sizes (2, 4, 8, 16 and 32 px at the default), selecting maxima across position and size. Each feature uses a background annulus sized outside its core, so broad reflections are not rejected as their own background. Contrast must exceed the cutoff in both the background-subtracted filter response and the smoothed detector intensity. **Minimum spot contrast** defaults to 9 robust local background spreads; its slider and number field update the detection and fits. Lower values admit more faint features and noise. Existing per-image choices are retained. The last detector measurements are cached in memory so cutoff or fitting changes do not repeat the filters; changing centre, masks, calibration or smoothing recomputes them.
- **Duplicate spots:** native-pixel centroid refinement is followed by a separate duplicate check, keeping the strongest blob response within three-quarters of the larger measured spot width (at least 1.5 times the minimum smoothing). Opposite observations are paired afterwards and remain separate markers. Distinct same-side observations are not folded into one profile by the opposite-pairing step. This is a spot-footprint heuristic, not deconvolution of overlapping reflections. Detection and deduplication do not use crystal predictions.
- **Evidence:** opposite observations share one profile; the plot marks only spots actually detected. Reliable background-subtracted spot integrals supply median-normalized square-root weights, capped at 1–6; unreliable measurements retain local-contrast weights. Additional maxima above local contrast 3 can supply weak evidence, separately from the strong threshold. The estimated spot width is bounded to 0.30 nm⁻¹; matching uses that width with a 0.10 nm⁻¹ floor. These are exploratory choices, not calibrated confidence levels.
- **Persistence:** centre, calibration, detector settings and exclusions are remembered per image in browser storage. **Save region** stores a named whole-pattern analysis in the local project, with tags and notes; **Export result** writes numerical results and provenance to the output folder.

The left view shows the full detector; the right view extends 5% beyond the selected outer fitting limit (±10.5 nm⁻¹ by default) with a magnified preview on hover. Display resampling and brightness controls do not change detected coordinates. Different x/y reciprocal calibrations and rectangular detector images are supported. Automatic real-space grids are hidden and disabled for diffraction: subdividing a detector pattern does not map locations in the specimen.

Centre estimation can choose a different lattice inversion centre, and masks or noise can affect spot detection. Diffraction intensities also depend on excitation and thickness, so a missing allowed spot is not definitive evidence against a structure. This mode retains candidate/ambiguous labels rather than treating an overlay as confirmation. General beam-centre and masking methods are documented in [pyxem](https://pyxem.readthedocs.io/en/stable/reference/generated/pyxem.signals.Diffraction2D.html); this app uses its own small implementation and does not require pyxem.

The **Measured peaks** selector offers circles, diamonds, squares, triangles and crosshairs. **Marker styles** independently controls phase predictions, both geometry overlays and weak detections. Phase-specific dropdowns follow the selected searches; Beta + Omega also exposes BCC and ω styles. **Peak numbers** shows brightness-ranked profile IDs on both images and is remembered, off by default. Weak detections default to a hollow white diamond at the observed position; choose another shape, a dashed version of the measured marker, the original dot, or Off. Duplicate weak markers shared by displayed fits are drawn once. Prediction line styles retain their evidence/acceptance meaning for every shape. **Marker motion** offers Off, Pulse, Bounce (size only), Bounce + wobble and Bounce + rotate. Pulse alternates opacity; Bounce grows and shrinks markers around fixed centres; Bounce + wobble also moves them slightly; Bounce + rotate swings them between −45° and +45° around fixed centres, with maximum size each time they pass 0°, including in GIF exports. HCP and BCC prediction markers run half a cycle apart. Measured/weak markers and geometry markers use separate offsets, so overlapping marker types do not all change size together. The live view and GIF exports share this timing. Off restores their exact positions. The animations also work in the enlarged view, respect reduced-motion preferences, and make no analysis requests. The **Phase colours** controls above the images apply throughout the workbench. HCP and BCC each have six colour choices: Blue, Gold, Mint, Vivid green, Pink and White, with the existing blue HCP and gold BCC defaults. These colours are shared by predictions, vectors, map cells, legends and fit labels. Scale penalty and peak-evidence weight sit beside the scale-fitting area; colour overlay intensity sits under Automatic grid. Marker, phase-colour and intensity-palette choices are remembered across images and restarts.

In real-space mode, hover over a computed grid cell, the computed manual selection, or a saved-region outline for one card containing the crop and FFT, phase label, best HCP/BCC/FCC zone axes, ranks and screen status. Passing candidates appear first, then candidates are ordered by rank. Saved-region cards use that region’s saved analysis settings without changing the active selection. The FFT uses the current display palette and contrast; its axes are in nm⁻¹. Cards pause during analysis, grid runs and reweighting. A missing preview is calculated on demand after a short hover delay; the 24 most recent encoded previews are cached in memory, keyed by image, calibration, coordinates and analysis settings. Switching images clears the cache. Saved regions persist the source reference, coordinates and settings, not an FFT bitmap; use PNG/GIF export to retain an image file. The **View** selector on the right switches between **Real space + FFT** and **Large FFT only**, and remembers the choice. The crop and FFT bitmap areas match in Real + FFT; FFT Only matches the source image on the left, including after resizing the window, while its legend uses the full panel width. Axes sit outside the FFT bitmap. Diffraction uses the same size limit with its full spectrum layout. A spinner appears over the spectrum after one second while a requested analysis is pending.

**PNG** and **GIF** above the spectrum save the current brightness, markers, overlays, axes and optional indexed vectors to the configured output folder. PNG is 2800 pixels wide and uses the exact marker positions. GIF is also 2800 pixels wide and captures one repeating cycle of the chosen motion: 30 fps on average, with 36 frames over 1.2 seconds for Bounce or Bounce + wobble, or 54 frames over 1.8 seconds for Pulse (one still frame with motion Off). GIF uses alternating 30/40 ms frame delays because its timing precision is 10 ms. GIF frames share a palette and retain unchanged background pixels to reduce file size. Export snapshots the view, so later image or marker changes do not alter an export in progress. Image exports require the updated backend; restart the app after upgrading. Export buttons show progress, then **✓ Saved**; a dismissible notification confirms the filename and output path. Failures show an explicit error.

**Export map PNG** above the real-space image becomes available after a grid completes. It saves the displayed source preview, current grid colours and zone symbols, visible saved-region outlines, and the visible legends. The movable inspection box and resize handle are omitted. The map is exported up to 2800 pixels wide, reduced if necessary to keep its full height within 3200 pixels. This is a rendered map; use **Export grid results** for numerical fits and provenance.

The geometry-only check displays a secondary grid only when it passes the independent-evidence screen, including at least three additional profiles beyond the primary in nonparallel directions. Failed secondary attempts can repeat the primary grid; these are omitted and the interface reports **No distinct secondary geometry detected**. Equal scores or RMS values alone do not make two grids duplicates. These checks describe periodic patterns, not phase identities.

Hover over an FFT or diffraction image for a **3× cursor magnifier**, including the current spot/pattern markers and reciprocal coordinates. The preview uses the displayed pixels and overlays without running another analysis; clicking does not enlarge the image. It hides when the pointer leaves, on scrolling, or while a new analysis is loading.

**Pattern overlay → Winning Fit (Passing)** shows the complete highest-ranked passing fit, including both components of an ordinary combination, or nothing if none passes. **Winning Fit (Any)** also allows a candidate that fails the screen. Ordinary combinations appear in the ranked table and have a joint checkbox under **Individual fit overlays**, including two orientations of one phase. Both **Fitted A/B/C** and **Fitted planes** vector overlays offer the same choices, including **Best β + related ω** for direct diffraction with BCC and ω selected. These display options do not change rankings or accept a rejected fit. Pattern and vector menus include only enabled search phases.

**Pattern overlay → All passing fits** shows every retained passing orientation plus the components of passing combined models. The vector menu offers the same choice for both fitted vector styles. Repeated components are drawn once; rejected standalone fits are excluded. This displays alternatives together and does not establish coexistence.

**Vector overlay → Fitted planes** in Marker styles adds centre-to-reflection arrows for two nonparallel matched fitted reflections. Labels give candidate plane indices; hover an arrow for its fitted reciprocal length g and, on calibrated images, plane spacing d = 1/g. Both vector styles use the fitted lattice. The measured-plane display has been removed, and saved measured-plane selections migrate to the corresponding fitted-plane choice. Rejected candidates selected explicitly retain dashed arrows.

**Vector overlay → Fitted A/B/C** instead shows reference vectors at the fitted prediction coordinates, with the candidate zone axis labelled once. It prefers short closed triples with strong peak matches. As an app display convention, letters run from longest to shortest reciprocal length (A > B > C); equal fitted lengths share a letter, for example A/A/B. Textbook diagram letters may differ. Equality allows numerical roundoff, not measurement uncertainty. Optional information boxes show the angle between the first two vectors and, for distinct letters, their signed closure relation after ordering. Tied lengths show the letter sequence instead. Label backgrounds fit their text and stay near their vector endpoints; a dotted connector identifies a label displaced by crowding. If no closed triple is available in the prediction band, it shows the available independent directions. These reference vectors illustrate the fit based on all detected peaks; they are not the unit-cell edges a/b/c or a separate three-point phase decision. The measured FFT/diffraction image stays unchanged.

**Marker styles → Vector info** defaults to **Off (vectors only)**, keeping arrows and short endpoint labels without the bottom-left boxes. **Summary** adds phase/zone and A/B/C relationships; **Full details** also shows the joint fitted cell once in the header and individual g/d rows. Unconstrained dimensions remain labelled; uncalibrated patterns omit absolute cell dimensions. The choice is remembered and applies to enlarged views, hover previews and PNG/GIF exports.

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
rank score = position score − scale penalty + weak-peak bonus − missing-prediction cost − extra-pattern cost + brightness-grouping bonus
```

At the default strength of 0.10, a uniform 5% adjustment costs 0.10 score and a 10% adjustment costs 0.40. Independent HCP a* and c* costs are averaged. Zero disables the penalty; fixed-scale modes are not penalized.

Positional matching uses the same soft distance penalty for every phase and combination. Direct diffraction uses a distance scale of `sqrt(peak_width² + (0.04 × median_observed_radius)²)`: spot width plus a relative allowance for departures from ideal geometry. This 4% allowance is a ranking heuristic, not a fitted strain or distortion measurement. Both terms follow coordinate rescaling. FFT retains its window-response width with the existing 0.10 nm⁻¹ floor. Candidates can match out to four times the scale, with credit falling continuously to zero; the chance-match allowance integrates the same distance weighting. Larger offsets remain visible in residuals and receive less positional and brightness credit. An assigned detected spot incurs no missing-site penalty as well. The scale, its contributions and search extent are reported in the evidence tooltips and JSON. Detector footprints, masking and genuinely unsupported-site costs remain separate from the positional allowance.

Changing the scale penalty, weak-peak bonus, missing-peak penalty or brightness grouping reweights completed or cancelled grids from cached hypotheses and measurements, including fits discarded from the displayed shortlist. The scale penalty applies only in automatic modes; the other controls also work with fixed scales. It does not repeat the grid FFTs or coordinate fitting. Labels, totals and zone symbols update; **existing cell boundaries stay fixed**. Run a new adaptive grid to recompute subdivision and passing-region checks under the new weights.

Caches are held in memory and disappear when the server stops. Saved JSON records initial settings, current settings and rescoring metadata, but does not contain the internal candidate cache.

### Weak and missing peaks

Prediction-site evidence supplements the original strong-peak detector. It uses the existing FFT; neither image pixels nor the FFT coordinates are changed. The same procedure applies to all structures:

1. Find additional local maxima without reference to any crystal template, using the radially background-subtracted, smoothed log-power field. Require enrichment of at least 1.8 and local contrast of at least 2 robust background spreads, measured in an annulus two to four characteristic widths away.
2. Exclude maxima within one physical characteristic width of an original strong profile and merge nearby weak maxima. Opposite spots count once. For FFT, this footprint uses the selected window’s approximate power peak width; direct diffraction uses estimated spot width. Both retain the detector's 0.10 nm⁻¹ minimum footprint. The positional scoring scale described above is separate.
3. Match remaining prediction positions one-to-one to weak maxima using the common soft positional kernel, out to four scoring distance scales. Positions within one physical characteristic width of the fitting-band boundaries or another prediction are left unchecked. Increasing positional tolerance does not enlarge this unchecked margin. Weak evidence is capped at half credit per maximum and decreases with positional error.
4. Subtract average support at 11 rotated control patterns at the same radii from the weak-support bonus. This is a chance-match heuristic, not a statistical confidence test.

**Weak-peak bonus** (0–0.5) and **Missing-peak penalty** (0–2) are independent; each defaults to 0.10, and zero disables only that term. Existing browser preferences and saved settings initialize both from the former shared weight. The bonus remains its weight times positive excess weak support per prediction. For missing cost, every prediction assigned to a detected profile contributes 0: positional error is already charged in the position score. An unsupported prediction contributes 1, and a weak match contributes `1 − quality`, where quality is local strength times positional agreement, capped at 0.5. A weak maximum therefore retains 50–100% of a missing-site cost. Sum these deficits, with the selected radial attenuation, and divide by the number of assessable predictions. Unchecked sites are excluded and shared union positions count once. Missing half-weight 0 disables radial attenuation; smaller positive values reduce outer costs more. These controls apply to every independent phase and related combination.

Both score terms appear under **Prediction-site evidence** and in rank tooltips. Counts distinguish strong, weak, unsupported and unchecked positions; tooltips and JSON report the residual missing contribution of weak matches. Cached grid reweighting preserves observations and grid boundaries, and removes the obsolete missing deficit from detected matches. Older results need reanalysis to obtain assignments using the new positional scale.

Weak maxima can change candidate ranking but **do not supply the four-profile acceptance requirement or the unique profiles required for two candidate structures**. The conservative shared-strong-evidence ambiguity check remains active. Long-dashed prediction outlines identify assigned weak maxima whether the candidate passes or fails the screen. Other predictions from below-threshold candidates use short dashes. Passing candidates use solid outlines for strong matches and dotted outlines for positions with no assigned maximum; faint outlines are unchecked. Separate white markers show the observed weak-peak positions using the selected weak-detection style.

These adjustments do not simulate reflection intensities, thickness, defocus or the contrast transfer function. Allowed reflections can be attenuated by [image contrast transfer](https://abtem.github.io/doc/user_guide/walkthrough/contrast_transfer_function.html). Unsupported predictions receive an adjustable ranking cost, not proof of absence; local-contrast thresholds and weights remain exploratory.

### Crystal pattern generation

`tem_workbench/analysis/crystal_templates.py` defines the reciprocal coordinates and allowed-reflection rules. Cubic reflections use **g = (h, k, l) / a**; FCC allows indices all odd or all even, while BCC requires an even sum. HCP uses its hexagonal metric and basis selection rule. `fcc_templates()` generates the finite FCC zone library. Existing HCP/BCC zone templates are stored in `tem_workbench/resources/templates.json`.

`scale_fitting.prepare_templates()` enumerates integer plane indices, applies the structure rule and zone law **hu + kv + lw = 0** (three-index coordinates internally), and projects the surviving reciprocal vectors into the detector plane. The reflection range follows the selected inner/outer cutoffs and lattice references rather than a fixed number of shells. Changing HCP a/c also updates the reciprocal-plane projection so its lengths and angles follow the new hexagonal metric. `prediction_points()` applies the fitted reciprocal scale; the search then rotates the predictions to match the observed points. These are allowed positions, not simulated intensities. `tem_workbench/analysis/materials.py` supplies preset references and validates custom dimensions.

## Interpretation and limitations

- The library contains **72 templates**: the existing 46 HCP/BCC templates and 26 FCC templates, including mirror variants. FCC covers primitive cubic direction families with maximum index 3. This is a finite orientation library; other structures and untested orientations can affect results.
- Peak detection and matching default to **3–10 nm⁻¹** for FFTs and **2.5–10 nm⁻¹** for direct diffraction. Both boundaries are adjustable. Signals outside the selected band are excluded; these cutoffs are heuristics, not structure-specific physical limits.
- Peak coverage is the sum of weights of matched original detected peak profiles divided by the weight of all original detected profiles. FFT weights use height above the radial background; direct spots use compressed background-subtracted integrated intensity, falling back to local contrast for unreliable measurements. Both are capped at 1–6; additional weak maxima are excluded. Neither peak coverage nor rank score is an intensity fraction, phase probability or phase fraction.
- The scale penalty is a preference for smaller adjustments, not a calibrated strain prior. Calibration errors can change candidate rankings.
- Independent HCP a/c fitting adds flexibility. The penalty is not a statistical correction for the number of fitted parameters.
- Additional weak maxima and unsupported prediction positions contribute optional heuristic ranking adjustments. HRTEM contrast transfer can suppress allowed reflections; a missing peak is not proof that a structure is absent.
- A conservative shared-evidence check retains ambiguity when competing structures explain the same detected profiles and the leading fit requires additional flexibility or unsupported predictions.
- Small regions broaden FFT peaks, limiting separation of nearby reflections. Image-calibrated fits alone do not establish lattice strain.

Supported input is finite, two-dimensional DM4 data with length or reciprocal-length calibration, or single-frame JPEG, PNG and TIFF images calibrated manually from a scale bar. Real-space FFTs require equal x/y pixel calibration; automatic grids require square real-space images. Direct diffraction supports rectangular detector exclusions. Ring indexing and arbitrary real-space region shapes are not implemented.

## Development

The experimental [AZtec workspace](docs/aztec.md) provides read-only native OIPX
and H5OINA inspection, point spectra, and interactive element/ratio maps and line
comparisons. See the [implementation plan](docs/implementation-plan.md) for
approved scope and follow-ups.

Application modules live in `tem_workbench/`: `analysis/` holds numerical fitting,
`mapping/` grid and map operations, `components/` PCA/NMF workflows, `storage/`
image/project access, `app/` application orchestration and HTTP endpoints, and
`runtime/` workers and diagnostics. Shared reference files are in `resources/`.
Use package-qualified imports; resource locations come from `tem_workbench.paths`
and do not depend on the current working directory.

The top-level `server.py` remains the console entry point used by installed
launchers. `workbench_environment.py` and `workbench_updates.py` intentionally
remain standalone: setup and frozen update recovery must work before the
application dependencies are installed, or while application files are replaced.

| Component | Responsibility |
| --- | --- |
| `tem_workbench/analysis/analysis_core.py` | FFT processing, peak detection, fixed-scale matching and geometry checks. |
| `tem_workbench/analysis/diffraction.py` | Reciprocal calibration, beam-centre estimation, direct spot detection and detector exclusions. |
| `tem_workbench/analysis/orthorhombic.py` | Primitive orthorhombic metric seeds, independent cell fitting and dimensional observability. |
| `tem_workbench/analysis/scale_fitting.py` | Bounded automatic scale fitting, candidate ranking and cached reranking. |
| `tem_workbench/analysis/materials.py`, `tem_workbench/analysis/crystal_templates.py` | Material references, reciprocal coordinates and allowed-reflection generation. |
| `tem_workbench/analysis/phase_comparison.py` | Prediction counts and shared-evidence ambiguity checks. |
| `tem_workbench/analysis/peak_evidence.py` | Independent weak-maxima detection, prediction-site audits and ranking adjustments. |
| `tem_workbench/mapping/adaptive_refinement.py` | Same-child comparisons and mixed assignability checks for passing parents. |
| `tem_workbench/storage/folder_paths.py`, `tem_workbench/storage/workbench_project.py` | Local directory links and reusable region definitions. |
| `tem_workbench/app/engine.py` | Image loading, region analysis, previews and fit caches. |
| `tem_workbench/app/server.py` | Local HTTP endpoints, grid jobs and JSON exports. |
| `web/` | Buildless browser interface. |
| `tem_workbench/storage/demo_data.py`, `demo/` | Optional demo catalog and legacy decoder. |
| `tem_workbench/resources/engine_provenance.json` | Numerical provenance and recorded limitations. |

Run the focused numerical checks with:

```sh
python -m unittest discover -s tests
```

The local API provides `/api/config`, `/api/open`, `/api/analyze`, `/api/grid`, `/api/job`, `/api/rescore-grid`, `/api/cancel`, `/api/save`, `/api/browse-folders`, `/api/folders`, `/api/regions`, `/api/regions/save` and `/api/regions/open`. POST requests require the session token returned by `/api/config`.

After updating Python source, save active results, restart the server and reload the page. Previously saved results retain the engine hash and settings used to produce them.

## Implementation plan

The maintained [implementation plan](docs/implementation-plan.md) tracks HCP fitting, automatic peak-strength selection, batch grids, parallel execution and overlapping-window mapping, including priorities and open decisions.

## License

[MIT](LICENSE). The macOS launcher includes code adapted from Tensile Workbench; its attribution is retained in [macos/TENSILE-LICENSE](macos/TENSILE-LICENSE). Colour-table attribution is in [web/colormaps.LICENSE](web/colormaps.LICENSE). AZtec spectrum reference energies use xraylib; its BSD notice is in [web/xraylib.LICENSE](web/xraylib.LICENSE). Third-party dependencies retain their respective licences.

## Architecture and numerical workflow

The versioned [methods atlas](docs/architecture/README.md) documents the implementation with equations, flowcharts, acceptance decisions and adaptive-grid rules. Read the [eight-page PDF](docs/architecture/tem-workbench-architecture.pdf) or the individual editable SVG panels. Its [JSON source](docs/architecture/architecture.json) and [renderer](tools/render_architecture.py) live in this repository; a source-hash check flags relevant code changes for review before regeneration.

The [methods manuscript draft](docs/paper/README.md) includes the numerical workflow, equations, documented development checks and references to prior work. The manuscript records its original implementation snapshot. The separate experimental [local FFT PCA workspace](docs/local-fft-pca.md) is documented with its limitations; NMF and scientific validation remain pending.

### Acquisition locations

**Acquisition map** beside the file browser plots recorded DM4 stage positions over a selectable real-space overview. It starts with the current folder/date and the widest calibrated overview from the same labelled sample/date. Choose a **Folder** in the map or **Whole labelled sample** to include all its folders. Click a calibrated image footprint or list entry to make it the new reference; **Back** returns one level, restoring the previous view. **Open** beside a list entry opens it for analysis. Drag to pan and scroll to zoom.

Enable **Compare on hover** to see the full acquired image beside its predicted crop from the current reference. Crops use original reference pixels, preserve full-image contrast, and show out-of-frame areas in black. Hovering the reference itself does not show a comparison. Stage rounding can exceed the size of a high-magnification field, so use these comparisons to inspect placement rather than assume image registration.

This is approximate. The stage tags do not declare units: µm is the initial assumption, with units, rotation and flips adjustable in the dialog. Camera orientation, image shifts, stage rounding, drift and tilt can displace the schematic footprints. Diffraction images are points only. Missing locations are listed, not invented. Newly saved results include the raw stage coordinates when available.

Acquisition-map stage rotation is remembered per reference image and data folder in browser storage, including across reloads and app restarts in the same browser/address. Changing reference or navigating Back restores that reference’s angle; an unset reference starts at 0°.

**Adjust placements** enables manual dragging of calibrated image footprints. Select an image in **Image to adjust** when footprints overlap, then drag its highlighted footprint. The comparison card updates its reference crop during the drag and reloads the original-pixel crop on release. Manual centres are remembered per reference–image pair in this browser; Back and revisiting a reference restore its placements. **Reset placement** restores the recorded-stage estimate for the selected image. Positions use the reference image’s coordinates; stored DM4 metadata, pixel orientations and analysis coordinates are unchanged. Zoom-out is capped at twice the most recently fitted view width; **All locations** deliberately fits a wider area.

### Geometry-first automatic peak strength

**Auto · dominant rank** keeps the threshold with the strongest passing crystal fit. **Auto · geometry (1–2 patterns)** selects the threshold using periodic grids first, then performs crystal matching once. It can retain weaker, independently supported periodicity without requiring it to be a particular phase. Shared peaks count once; chance matches and an extra-grid cost reduce the score. Evidence is normalized against the full admitted peak pool so removing weak peaks does not automatically improve coverage. Threshold fraction, threshold floor and maximum profiles still bound the search. This exploratory mode can miss patterns or fit noise; two geometry grids are not proof of two crystal phases. Exports record the selection objective and trials.

### Manual diffraction peaks and batch grids

In direct diffraction mode, use the **Add peak** or **Remove peak** buttons in the **Peak editing** panel, then click the detector or reciprocal plot. Snap and edit radii use nm⁻¹ (relative units for uncalibrated images), defaulting to 0.50 and 0.10 respectively (adjustable from 0.001 to 5). Distances respect separate X/Y calibration; the ring can therefore be elliptical on detector pixels. Remove peak clears observations inside its edit radius. Older saved pixel-radius edits retain their original behaviour. Uncheck snapping for exact placement without a cursor radius. Snapped Add shows its search ring and Remove shows its removal radius, including in hover previews. Drag a saved ring or its handle to change that peak’s snap radius and search again around its original click position. A compact label in each image corner and in the hover-preview heading identifies the active tool; Add also shows whether snapping is on or off. View hides the label. **Undo peak edit** and **Reset peak edits** restore previous detections. Edits are remembered per image and saved with named regions and exports. Manual measurements are pink on the reciprocal plot; source-detector observations are purple and follow the selected measured-peak marker style. Manual measurements bypass the automatic contrast cutoff and affect fitting. Peak editing remains interactive while fitting updates in the background. Hover previews include the edit radii in both Add and Remove tools and remain visible through clicks and fit updates, using the displayed pattern during updates. Previews open upward and inward without flipping sides. Their × buttons magnify with the image so the visible boxes match the source click areas; clicks still act on the main image. Detected spots remain visible on the left detector in every tool, unless Measured peaks is Off. Saved edit/snap circles appear on the right pattern and its enlarged view only in Add/Remove tools; they remain visible on the left detector in every tool. **Reset settings** restores diffraction detection defaults, centre, calibration, exclusions and worker selection while preserving peak edits; **Reset peak edits** is separate. Hidden or partially obscured inferred spots are not implemented yet.

For real-space images, open **Automatic grid → Batch grids**, review the OneView images above the adjustable magnification cutoff, select the files, and run using the current processing and grid settings. The folder picker loads automatically and accepts multiple parent folders, including their subfolders. Ticking folders selects their eligible images; keyword search further filters the review list. **Select only matches** selects just the filtered results. **Flatten subfolders for summary** combines descendants under each selected parent (or each top-level folder when All folders is selected); unticked, each source subfolder is summarized separately. Folder summaries and zone breakdowns are exported to `folders.csv` and `folder_zones.csv`, with image-to-folder assignments in `image_folders.csv`. Sample summaries remain available too. The default includes 400kX. Each image receives a grid JSON and, optionally, a PNG map. The batch output folder also contains per-image and per-sample CSV summaries, zone breakdowns and a complete `summary.json`. For overlapping stability maps, per-image and per-sample CSVs report passing frequencies over covered raster area, with both area-weighted pooling and equal-image means. Zone CSVs report passing window counts, not areas; windows are correlated. PNGs show the combined all-phase frequency map. Cancellation preserves completed output and the current partial map. Pooled sample areas and mean image percentages are separate; passing phase/zone support may overlap and is not a measured phase fraction. Grid and region export filenames include the source image name.

Batch progress includes a compact live map of the current image above the summaries. Completed grid regions appear as they finish; the viewer advances automatically between images. Summary phase columns include only the phases enabled for that run. Minimum magnification is inclusive.

File selectors and the visual image browser include filename extensions. Ordinary images show (Calibrated) or (Uncalibrated); the status updates after calibration and checks for changed source pixels.
