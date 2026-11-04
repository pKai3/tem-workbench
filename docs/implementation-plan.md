# TEM Workbench implementation plan

Last updated: 4 November 2026

This is the maintained implementation status and roadmap. The original three analysis priorities remain in their agreed order below, with delivered first passes separated from unfinished work. Parallel execution, geometry-first automatic strength, manual diffraction peak editing, batch grids and subsequent fixes are included in the 2 November 2026 integration of `perf/parallel-analysis` into `main`. Listing an open item here does not authorize starting it.

## Diffraction controls and radius grips — 4 November 2026

Compacted the desktop centre/calibration controls into one row with aligned peer-panel heights. Translation refinement and its shift limit follow the centre controls, before calibration, on the same row on wide screens and wrapping together on narrower screens. Scale-fitting controls are left-aligned. Save/remove override buttons sit alongside the direct-mode fitting-limit inputs, with saved status above to preserve alignment. Save is disabled when current limits match the saved override; changed limits show Update override. The left detector hover preview is available in View as well as Set centre mode. The previous field widths are retained; further width/layout changes are deferred for discussion. Controls follow centre/calibration → inner/outer fitting limits → smoothing/detection, including keyboard order. Fitting-limit grips now sit on their circles, pointing radially inward/outward, with a 30% wider/taller hit target. Smoothing offers 10/12/14/16 threads as well as existing choices, capped by available logical CPUs; Auto remains two. Actual concurrent work also depends on the number of smoothing scales.

## Interactive fitting limits — completed 4 November 2026

Follow-up: numeric radius edits now stay image-local just like drag edits. Opening an image explicitly restores both shared limits (direct inner default 2.5 nm⁻¹) before applying its own override, ignoring stale detector-radius memory. Regression checks cover switching from saved overrides to unsaved images and back in both modes.

FFT/direct-pattern fitting-circle labels have draggable arrow handles; the captured diffraction image also shows labels and handles. Dragging snaps to 0.1 nm⁻¹, updates the circles/labels and numeric fields live, and recalculates once on release. Inner/outer limits cannot cross; cancellation restores the previous limits. These are reciprocal-space search limits, not calibration changes.

**Save override / Remove override** beside the fitting-limit inputs remember or clear both limits per image (pixel hash) in browser storage. Dragged limits stay local to the open image until explicitly saved; opening another image restores shared controls or that image’s saved override. Removing restores shared FFT limits (direct inner default 2.5 nm⁻¹). Exported result settings contain the effective limits; drag handles are omitted from spectrum PNG/GIF exports. Existing grids must be rerun when limits change. Browser-local overrides do not transfer between computers.

Fixed a live-overlay refresh bug that removed the fitting-limit handles immediately after drawing them. Peak-edit refreshes now preserve both radius controls; export snapshots still omit them. Regression coverage exercises refreshes in FFT and diffraction modes.

## Vector cell dimensions — completed 4 November 2026

Bottom-left vector rows include cell dimensions derived from the same g/d: cubic a, HCP basal a or axial c, and pure-axis orthorhombic a/b/c. Mixed reflections are labelled coupled rather than claiming independent dimensions. Vector options now separate Measured planes (P1/P2 observations), Fitted planes (P1/P2 predicted positions for the same indexed matches), and A/B/C (fitted grid). Each supports passing/any winner and enabled-phase choices; selection is remembered. Equal-letter rows consolidate their dimension details. The key tooltip explains the distinction; PNG/GIF inherit these rows. HCP keys also show the fitted c/a ratio beside the zone axis, or unconstrained when c is not observable.

## HCP display notation — completed 4 November 2026

Marker styles now includes a remembered **HCP notation** selector (four-index default, three-index optional). It updates zone axes and indexed reflections in fit tables, vectors, map legends and hover cards without rerunning analysis. Current-view FFT PNG/GIF and map PNG exports inherit the displayed labels. Zone-symbol identities and selected individual overlays remain unchanged. Numerical JSON/CSV records retain their existing three-index schema; server-generated batch figures are unchanged.

## Paper draft and architecture refresh — completed 4 November 2026

Created a [methods manuscript draft](paper/README.md), editable Markdown and reproducible PDF/figure renderer. It describes implementation `64118d8`, credits original indexing, local-FFT/PCA/NMF and orientation-mapping work, and separates historical software checks from pending scientific validation. No new experimental analysis or accuracy claim. Authorship, experimental figures, independent ground truth and submission declarations remain to be completed.

Refreshed the explicitly requested [architecture atlas](architecture/README.md) to eight panels: signal extraction, template fitting, scores, classification, adaptive/batch searches, overlapping maps and parallel execution/state. Routine future changes still do not require a refresh unless requested.

## Shared-spectrum PCA/NMF — proposed, 4 November 2026

Discussed following Jany, Janas and Krok (Micron 130, 102800; DOI 10.1016/j.micron.2019.102800): collect nonnegative local spectra on a common reciprocal grid; use PCA to inform component count; estimate NMF spectral factors and spatial loadings; inspect/index factors using the crystal matcher. Compare with the existing independent-window pipeline, which aggregates results only after fitting.

Potential benefit is more stable recovery of weak recurring patterns. This is unimplemented and not a guaranteed improvement. Components may encode orientation, thickness, background or imaging contrast rather than phase. Rare components and sharp boundaries must be retained; loadings are not phase fractions. Define normalization, nonnegative representation, component count, reproducible initialization, memory limits and provenance before implementation. Test minority-pattern recovery, boundary localization, calibration sensitivity and runtime on independently characterized images with held-out tuning. This proposal does not supersede the agreed analysis priorities or authorize starting implementation.

## Window-size check and blended support — 3 November 2026

**Implemented:** Suggest window size sits beside Search mode. It tests 5%, 7.5%, 10% and 15% of the shorter image side at five paired locations, using the selected manual, auto geometry or auto rank settings. A separate cancellable job keeps the source/settings snapshot; grid and batch starts are blocked until it finishes. No map runs automatically. Equal X/Y calibration and at least two usable sizes are required; unsupported sizes are skipped rather than silently clamped.

The check offers **Fixed nm⁻¹** smoothing (anchored to the starting grid window, or manual ROI in standard mode) and **Fixed bins**. Thus sigma in bins changes with test size only in the former mode. Applying a recommendation explicitly sets both the tested window width and smoothing for the overlapping map. The check is not an automatic smoothing search.

Recommendations compare the same spatial sites across adjacent sizes. At least four of five must retain a passing phase, zone and rotation within 5°. Supported dual geometry favours smaller windows only if a consistent passing larger-window candidate survives; loss of all fits is not treated as successful separation. Otherwise the longest stable tested range offers smaller/localisation and larger/reciprocal-resolution choices. These bounded heuristics are advisory, not a validated optimum or full-image validation. Settings/image changes invalidate application; no stable range produces no recommendation.

**Display:** All-phase passing frequency now defaults to All phases and replaces split stripes with continuous hue blending. Positive phase supports weight hue along the short colour-wheel arc; opacity uses the strongest independent passing frequency. A lone passing phase fills the tile with its own colour. With more than two phases the strongest chromatic phase anchors the hue blend. White is handled without imposing a hue. Numerical support remains independent and does not sum to 100%. A mixed colour does not establish separate structures within any one window; that remains a distinct classifier view.

**Passing support · hex grid** applies this display to the existing overlapping-reading aggregates at hex centres, with no hex outline. **Top match · averaged hex grid** remains available as a discrete highest-mean-rank display. Hover shows actual per-phase passing percentages and mean ranks, with a contributing FFT identified as such. Main-map PNGs, batch live maps and batch PNGs use the same blending rules; batch exports include an optional hex-support PNG. Two-phase views include a relative-support colour key. No new fitting or FFT averaging occurs when changing views.

Validation: 27 targeted tests pass (window-size recommendations/cancellation and smoothing modes, Python/JavaScript colour parity, overlap aggregation and batch exports); isolated browser checks cover hex/raster blends, single-phase colours, hover values, the retained winner display and applying size recommendations. A real analysis-engine smoke check completes all 20 trials in each of manual, geometry-auto and rank-auto modes. Restart the backend and reload for the new size-check API.

## Exact window count — 3 November 2026

The Centres layout dropdown precedes the centre-spacing controls. Overlapping-map settings show a compact blue “≈ N windows” readout beside Placement passes instead of the options-summary paragraph. The number is calculated exactly despite the requested approximate-style prefix. Counting uses the same backend sampling layout as the run, even with the preview unchecked; requests are debounced and stale responses ignored. Invalid layouts show their error in the same location. No FFT analysis runs to obtain the count.

## Overlapping-window preview — 3 November 2026

Replaced the all-window outline overlay with sampling-centre dots and a selected window and all immediate neighbours from the same placement pass (normally six for hexagonal or four for square centres). High-contrast 3-pixel outlines have black backing; the selected window is solid cyan and its neighbours dashed gold. Shared area is shaded, centres are joined by connector lines without numbered labels, and actual window dimensions and centre distance are shown in the expandable preview box directly beneath the Preview overlapping windows checkbox. A pass selector defaults to the first pass and optionally shows all shifted passes. Hovering changes the selected neighbourhood without analysis. Existing results/ROI and their legends are temporarily hidden during planning and restored on closing; exports remain independent of this preview. Uses the existing backend sampling layout without changing analysis or placement.

## Incremental placement passes — proposed, 3 November 2026

Increasing passes during or after a run should retain completed windows and analyse only new placements when image and analysis settings match. Current jobs start fresh, and centring the complete sample bounds can shift earlier passes as the pass count changes. Before implementing extension, use a stable placement origin across pass counts; match reuse by exact source/window/settings; preserve completed and in-flight work; update aggregation and progress for the expanded pass set. Existing exported layouts must retain their original coordinates. This is pending, not delivered by the preview change.

## Map update feedback — 3 November 2026

A centred spinner and “Updating map…” badge appear immediately while penalty changes queue or rescore the current map, including overlapping stability maps. The indicator clears after success/error, grid clearing or image switching, and stays visible across queued slider changes. It is display-only and excluded from map exports. The zone-symbol checkbox is hidden for overlapping maps, where Centre markers controls symbols; before a run its visibility follows the selected search mode.

## Grid symbol label — 3 November 2026

Renamed the grid checkbox to **Show zone-axis symbols**. Rendering already uses all phases enabled in the grid settings, including ORT; the old HCP/BCC/FCC list was only a stale label. Display behaviour and matching are unchanged.

## Phase settings layout — 3 November 2026

Phase colour/search controls use one compact four-column row, with ORT alongside HCP/BCC/FCC. Reference lattice inputs are disabled and greyed for excluded phases, retaining their values for re-enabling; this follows manual phase changes, material presets, resets and restored settings. The scale-fitting selector is capped at a compact width instead of stretching across Processing settings. A reset arrow beside Material restores its lattice references, including disabled phases. Custom edits remember their last chosen preset for reset (Titanium fallback); phase search/colour selections are retained.

## External review responses — 3 November 2026

Both supplied Claude review responses are archived unchanged in [docs/reviews](reviews/README.md), with the real-image response identified as the latest. Both review `166cab9`. The newer response includes ST1203, ST1221, Ti_0274 and ST1144, but not ST1156. Its full experimental matrix has not been independently reproduced.

**Implemented follow-up:** crop-local weak-candidate and template-coordinate reuse, reuse of geometry-auto's selected geometry, up to two supplementary orientation seeds while preserving the existing scale variants, the same orientation expansion for fixed-scale search, consistent zone-aware candidate retention, and FFT weak checks using the selected smoothing/floor. Rank-auto is now labelled **Auto · dominant rank**, with explicit subset-score interpretation and admitted-pool metadata in exports. Three-profile results explain the unchanged four-profile screen. See the [finding-by-finding response and validation](reviews/2026-11-03-follow-up.md).

Validation: 169 tests pass, including ten new review regressions, noise-only and single-orientation controls, and existing spawned-worker checks. On 24 local real-image cases (1221/1203/0274/1156, centred 6/20 nm, manual/geometry/rank), caching alone preserved analysis data exactly apart from runtime/version identifiers; the completed changes preserved all labels and did not lower either phase's best score. These are stability checks, not phase ground truth. Additional search costs time; no universal speedup is claimed.

**Still experimental:** fixed-pool/pair crystal objectives, detector recurrence/prominence admission, robust radial backgrounds, auto/physical smoothing, per-peak uncertainty, three-profile acceptance and library/parameter complexity corrections. The dominant-rank objective and existing acceptance thresholds are unchanged. Retaining/exploring another orientation does not guarantee it passes the global-coverage screen. Native Windows verification of these changes remains outstanding. No architecture refresh.

## Analysis priorities and current status

| Order | Task | Status |
| --- | --- | --- |
| 1 | Revise fully free HCP fitting | Overall-scale + c/a mode implemented; comparative validation and optimizer review remain open |
| 2 | Revise automatic minimum peak strength selection to retain weaker separate patterns | Geometry (1–2 patterns) mode implemented (`f9d0d03`); dataset comparisons completed, further objective design/validation remains open |
| 3 | Batch grid analysis across qualifying images, with per-image and ST/STA summaries | Implemented 31 October 2026 (`977ae03`), with selection, progress and export follow-ups; shared overlay styles remain open |

## Ordinary image calibration — completed 2 November 2026

JPEG, standalone PNG and single-frame TIFF inputs now use the existing FFT or direct-diffraction pipeline after manual scale-bar calibration. Users choose endpoints, printed value and units; changing units automatically selects real-space or diffraction mode (2 November follow-up). Image type can also be selected explicitly; calibration is isotropic, saved locally against source path/pixel hash, and carried in exported image metadata. Recalibration invalidates loaded data. Native-resolution hover magnification supports placement and endpoint dragging. Drawing locks Y horizontally by default, with a Free Y option; stored angled bars retain their geometry. Same-name preview PNGs are not catalogued twice.

Validation: raster input/calibration tests cover persistence, real-space and diffraction analysis, unit conversion, invalid inputs, changed source pixels, TIFF stacks and preview sidecars. Browser checks cover calibration, remembered reopening, horizontal locking, Free Y and cursor magnification. No automatic scale-bar recognition or anisotropic calibration is included.

### File selection and peak removal follow-up — 2 November 2026

File dropdowns, favourites and the visual browser show extensions; ordinary images show Calibrated/Uncalibrated, updated after calibration. Catalogue status uses saved file size/mtime when unchanged and verifies pixel identity otherwise. New diffraction removal edits target one selected observation within 2 original pixels, rather than clearing the entire 50-pixel deduplication area. Additions keep their adjustable deduplication radius. Existing saved area-removal edits retain their original interpretation; Undo/Reset can remove those edits.

## Open follow-ups at a glance

- **HCP fitting:** compare the scaling modes and review penalty-aware optimization/candidate retention. Material priors and complexity corrections are not validated.
- **Automatic strength:** improve retention of separately supported weaker patterns; do not simply sum two candidates explaining the same peaks. Geometry-auto is already available.
- **Grid display/export:** offer the same symbol and text-label overlay choices in interactive grids and batch PNGs. The two renderers still differ.
- **Crop-size diagnostic:** the runner and ST1156 experiment are complete; representative failure inspection, ST1203/mixed-pattern controls and an in-app panel remain open. Automatic smoothing is deferred.
- **Parallel/platform validation:** native Windows uniform grids pass at one and four workers. Adaptive grids, cancellation/restart, automatic-strength modes, batch runs and diffraction threading need broader native Windows checks; smaller-machine memory/load checks remain open.
- **Explicitly deferred:** Mac–Windows numerical reproducibility review, partially obscured/inferred diffraction peaks, FFT manual peak editing and Hitachi acquisition-map calibration. Details and limits are below.
- **Overlapping maps:** first pass implemented 2 November 2026: square FFT windows on square/hexagonal centres, 1/3/9 shifted passes, per-phase support and placement-disagreement views. Batch integration is implemented; zone-stability maps remain planned.

## Completed work overview

| Delivered | Date | Reference |
| --- | --- | --- |
| Bounded parallel grids and diffraction smoothing | 30 Oct | `8f7aa0c` |
| Geometry-first auto strength and selectable diffraction threads | 30 Oct | `f9d0d03` |
| Manual diffraction peaks and batch grid exports | 31 Oct | `977ae03` |
| Peak-edit controls and live batch viewer | 31 Oct | `000a4d3` |
| Remembered batch cutoff, ETA, thumbnail/name selection and keyword filters | 31 Oct | `5666df4`, `930f941`, `2d98bbd`, `7a3ba5b` |
| Crop-size diagnostic runner and fixed-smoothing comparisons | 31 Oct | `c138c80` |
| Grid symbols stacked vertically by candidate rank | 1 Nov | `c1a6b10` |
| Windows worker interpreter fix | 1 Nov | `c54e173` |
| Native Mac/Windows comparison recorded; further numerical review deferred | 2 Nov | `30bc0a6` |

Main integration validation, 2 November 2026: all 115 automated tests pass, alongside JavaScript syntax and diff checks. A batch cancellation test now waits for the coordinator to publish the running job before asserting status and always cleans up its workers; production calculations are unchanged. Historical test counts below describe their respective changes, not the size of the current test suite. Architecture diagrams are unchanged unless a refresh is explicitly requested.

### 1 HCP fitting

Implemented 30 October 2026: **Auto: overall scale + HCP c/a**, alongside the original modes. The agreed first pass uses broad existing reciprocal-axis bounds (0.85–1.15), without an additional tight c/a cap or an assumed stronger shape penalty.

- Let sa and sc be the reciprocal a* and c* multipliers. Overall reciprocal scale s = sqrt(sa × sc); real-space c/a multiplier r = sa/sc. Model dimensions remain a0/sa and c0/sc.
- Scale cost = λ[ln(s)/ln(1.05)]² + μ[ln(r)/ln(1.05)]². Both weights default to 0.10; independent number boxes and sliders use 0.01 slider steps. A factor 1.05 (or its reciprocal) costs the relevant weight. These are exploratory preferences, not measured material limits.
- Cubic fits use the same overall log-scale cost, with no ratio term. HCP zones insensitive to c fit only the observed basal scale and report c/a as unconstrained.
- The same positional search/refinement is reused; the separate costs rank explored candidates before retention. This is not a penalty-aware continuous optimizer. Equal defaults do not reproduce the old independent-axis cost exactly, because the new shape coordinate measures the full c/a change.
- Costs and multipliers are retained in results; table tooltips show the decomposition. Both weights can reweight a completed grid's cached candidates without changing matches or cell boundaries. Changing fitting mode requires a new grid.
- Processing settings are grouped in one persistent collapsible section. Phase colours/search and material reference settings sit above that section and remain visible when it is collapsed (31 October 2026). Previous/next file buttons follow the current filtered and sorted file list, stopping at its ends.

Material-specific priors and extra parameter-count corrections remain unvalidated; no such constraints were added.

Compare the revised fitting with the current single-scale and independent-a/c modes on ambiguous HCP/BCC examples and the stronger ST1203 BCC candidate. Report positional agreement, scale costs and phase/zone stability so a more flexible model does not win simply by changing its proportions excessively.

### 2 Automatic minimum peak strength

The current strongest-candidate objective can raise the detection threshold until weaker BCC evidence disappears, leaving a strong HCP result. Keep that behaviour available for deliberately selecting the dominant pattern, and evaluate the implemented geometry-first alternative, which also searches lower thresholds for a separately supported second pattern.

The second pattern may be another orientation of the same phase. Two candidates explaining the same measured profiles are competing interpretations, not evidence of two patterns. The new objective must distinguish those cases and account for shared and independently explained profiles.

First pass implemented 30 October 2026: **Auto · geometry (1–2 patterns)** retains the existing best-crystal-rank mode. It searches all distinct strength cutoffs using the existing geometry screen, then runs crystal matching once on the selected peak set. The objective uses positional evidence normalized to the full admitted peak pool, counts shared profiles once, subtracts the existing chance allowance for each grid and 0.03 per grid, and adds a screened secondary only if it improves that score. The secondary still requires three unique profiles in nonparallel directions. This is exploratory: it does not guarantee detection of a weak second pattern or change crystal classification thresholds. Trials, objective and selected cutoff are exported; browser preferences, saved regions and grid workers carry the choice. The 104-test suite passes, including shared-evidence deduplication, independent-pair selection, one final crystal search, and manual-cutoff reproduction. Browser checks verified both mode-specific limit layouts, thread preference persistence, Auto control state, the source-detector boundary, and no horizontal overflow at 1440/850 px. Exploratory real-data comparisons have since been completed; controlled validation of weak-pattern recovery remains open.

Dataset review completed 31 October–1 November 2026: the merged 74-image set (46 labelled ST, 28 labelled STA) was compared in manual, geometry-auto and rank-auto modes, including secondary patterns. Geometry-auto retained 34 separately supported BCC secondary cells; rank-auto retained only one of those as a BCC secondary and five with any passing BCC fit. This supports keeping the objectives distinct, but does not establish phase identities or validate a new pair objective. ST1156 crop-size/smoothing results are recorded below. Experimental reports stay in the analysis output directory, outside Git; sample labels remain as recorded.

Remaining decisions:

- How to score a pair of separately supported patterns without favouring noisy low thresholds or counting shared evidence twice.
- Whether coverage should be evaluated against the whole detected set, the evidence assigned to each pattern, or both.
- How geometry-only primary/secondary fits contribute to finding and accepting the second crystal pattern.
- How to balance dominant-pattern quality with additional evidence explained by a weaker pattern.

Evaluate aligned HCP/BCC alternatives, a strong single BCC example, and multiple orientations of one phase. Show the selected threshold and objective, and preserve reproducible settings and candidate evidence in exports. Simply maximizing the sum of the top two candidate ranks is not an agreed solution.

### 3 Batch grids

Implemented 31 October 2026 following explicit approval to proceed now. **Automatic grid → Batch grids** reviews and selects images, captures the current FFT/fitting/grid parameter set, and exports results automatically into a unique batch folder in the configured output directory.

- Filename eligibility: OneView, no “diffraction”, and a parseable magnification. Default ≥400,000×; the minimum magnification is editable and inclusive. As of 31 October 2026 it is saved with basic browser preferences, surviving reloads, app restarts and image changes; invalid/blank edits preserve the last valid saved value. Missing/ambiguous magnification is excluded and shown with a reason. Calibration, real-space mode, square shape, grid cell size and sampling are checked when each selected file loads; failures are reported per image.
- 31 October 2026: Batch review adds Select all / Deselect all for eligible images, a left-aligned Names grid, keyword filtering by filename/sample/acquisition (bulk selection applies to matches and preserves hidden selections), and minimum magnification in k× (300 = 300,000×). Existing saved cutoffs retain their meaning.
- 31 October 2026: Batch review offers remembered Names / Previews views, selectable thumbnail cards, selection counts and enlarged hover previews (also available on keyboard focus). Selection is retained when switching views; ineligible files remain disabled with reasons. Existing sidecar PNGs are loaded lazily without analyzing or switching the open source. Missing previews are labelled. Changing the cutoff requires a fresh review before starting.
- 31 October 2026: Batch grids sits below all interactive grid settings/results. A browser-side projected finish time uses elapsed batch time, completed images and partial progress through the running grid. It starts after initial progress, is explicitly approximate, and hides for completed/cancelled/error batches. This works with the existing status API without restarting an active backend.
- Images run sequentially with the existing bounded parallel region pool for each grid. No nested per-image pools. Uniform/adaptive settings, stopping size, passing-region checks and worker choice are captured. A separate source engine avoids replacing the interactive image cache. Settings changes during a run do not change the batch.
- Progress and cancellation retain completed image exports and the interrupted grid's current leaves. Errors on individual files do not discard other results. Folder changes and competing grid starts are blocked during the batch. Status survives page reload while the backend remains running; interrupted batches are not resumed after backend shutdown.
- Every image writes the usual full grid JSON with source name, settings, engine version, classifications, models and measured evidence. Optional PNG maps show classification colours and passing zone labels where cells have room; PNG zone indices are explicitly three-index. PNG rendering is server-side and does not depend on keeping a browser tab open.
- `summary.json`, `images.csv`, `samples.csv`, `zones.csv` and `sample_zones.csv` are updated throughout the run. Per-image summaries use current leaf regions only. All classification categories, coverage and passing phase/zone support are retained.
- Sample summaries separate pooled physical image area from the unweighted mean of per-image percentages. Denominators are full areas of images with grid results, including partial grids; coverage and completion state are explicit. Failed images without grids are excluded and listed separately. ST/STA labels are retained as stored. Acquired fields may overlap; pooled area is not unique specimen coverage.
- Classification percentages are disjoint; passing zone/phase support can overlap and must not be summed as phase fractions. Results remain candidate-labelled image-area percentages, not validated volume fractions.

Approved follow-up, 31 October 2026 (not yet implemented): offer both zone-symbol maps and the batch-style text-label overlay as display choices for interactive grids and batch PNG exports. Preserve the existing batch style rather than replacing it. Unify zone notation, phase colours, eligibility and symbol/legend mapping across the two renderers; currently interactive exports capture the browser SVG, while batch PNGs independently draw passing three-index zone labels.
- Grid and region JSON export filenames now include the source image name alongside timestamp and unique suffix.

Validation: automated tests cover eligibility, leaf-only areas, overlapping support, pooled versus mean denominators, PNG rendering, actual spawn-grid exports, per-image errors and cancellation retaining completed output. The full suite passed 111 tests. Browser verification covered add/remove, snapping, undo/reset and persistence, plus a two-worker batch of ST1203 and STA1114 with complete coverage, per-image JSON/PNG and sample summaries. JavaScript syntax and diff checks passed. Native Windows batch-specific verification remains pending; the separate uniform-grid one/four-worker test has passed (see numerical reproducibility below).

31 October 2026 UI follow-up: Phase colours/search and material cells remain above Processing settings. Batch selection uses an inclusive minimum magnification; the redundant Include cutoff checkbox was removed.

31 October 2026 batch UI: a compact live image/map above the batch summaries displays finished leaf regions as each grid runs, automatically advancing to the next image and retaining the last map on completion/cancellation. A separate preview endpoint uses a small cached batch thumbnail without switching the interactive source. Summary phase columns follow the enabled phases captured for that batch.

Validation for the 31 October follow-up: 112 tests passed, including snap metadata persistence, larger search radii, live batch leaf snapshots and thumbnail retrieval. Browser checks covered purple markers following the selected shape, source/enlarged-view ring dragging and undo, background editing without dimming/spinner, separate settings reset preserving edits, and two real-image 6×6 batches advancing in the viewer with disabled FCC omitted from the table.

## Manual diffraction peak editing

Implemented 31 October 2026: **Detector tool → Add peak / Remove peak**, usable on the source detector, reciprocal plot and enlarged reciprocal plot. Add optionally snaps to the brightest lightly smoothed native detector pixel within an adjustable 1–200 px radius (default 50 px). Disable snapping for exact placement. This is a local image search, not a crystal-model prediction or confirmation that a reflection exists.

Ordered edits use original detector coordinates and are remembered per image, included in saved-region settings and numerical exports. Removal suppresses the selected neighbourhood; it does not automatically remove the opposite partner. Adding replaces nearby detections to avoid double counting, bypasses the automatic contrast cutoff, measures local contrast for its weight, and records manual provenance. Manual reciprocal-plot markers are pink; source-detector markers are purple and follow the selected measured-peak shape (including Off). Analysis flags explicitly identify manual evidence. Edits respect masks and the fitting band. Undo last edit and reset all peak edits are available. Snap and deduplication radii are separate visible controls, both defaulting to 50 original detector pixels and remembered in browser preferences. The deduplication radius also controls removal click tolerance; new edits capture its value, while existing edits keep their recorded radius. Centre refinement rechecks the edited observations; cached automatic detections remain unchanged. Search rings follow the cursor in Add mode; manual peaks retain their original search centre and individual radius (older edits use their recorded point and a 50 px ring until adjusted). Drag a ring or its handle on either image (including the enlarged plot) to resize and re-snap; undo restores the previous edit. Editing remains interactive while fits update in the background, without dimming or a blocking spinner; snapping reads the already-loaded detector independently of the analysis lock. Detection settings have a separate reset which preserves peak edits. Peak tools use explicit buttons in a panel to the right of the main diffraction settings, stacking on narrow screens.

Deferred explicitly by the user on 31 October 2026 (do not implement in this change):

- Partially obscured peaks: estimate centre from visible signal with appropriate positional uncertainty, without snapping blindly to an exposed edge.
- Fully hidden opposite spots: distinct inferred markers, not additional measured evidence. Treat verified beam-stop-obscured locations as unobservable rather than missing reflections; avoid duplicate profile/coverage/rank credit.
- Extend manual editing to real-space FFT mode after the diffraction interaction is established.

## Parallel grid execution

Implemented 30 October 2026 in `8f7aa0c`, originally on `perf/parallel-analysis`, and included in the 2 November main integration. Parallel execution was explicitly brought forward ahead of the remaining analysis tasks.

- Uniform and adaptive grids use a bounded spawn-process pool. **Workers: Auto / 1 / 2 / 4 / 8** is remembered in the browser; Auto uses at most four workers, leaves one logical CPU free, and all choices are capped by CPU count. Each worker owns its analysis engine and caches. One read-only memory-mapped copy of the source is shared per job; only ROIs and results cross the queue.
- Results are committed in submission order, preserving deterministic region IDs, tie ordering and subdivision decisions. All four children must finish before replacing a parent, including ordinary unresolved-parent subdivision. Cancellation/errors retain the parent and mark incomplete child probes as trial-only. Initial cells not yet analysed remain uncovered.
- The grid no longer holds the interactive engine lock. Pending work is bounded by worker count. Cancellation is checked between automatic-strength trials; a current fitting trial may finish first. Pool shutdown is completed before another grid can start. Each worker exits if its backend disappears; normal close removes the temporary image file. Forced process termination can leave a temporary file in the OS temp directory.
- Numerical-library threads are limited to one before loading the app's numeric stack; grid FFTs use one internal worker. Direct diffraction offers remembered Smoothing threads Auto / 1 / 2 / 4 / 8 (Auto: two; capped by CPU count), retaining the original calculations and order. Thread changes preserve the detector cache. The original diffraction detector view now shows the outer fitting-limit boundary using the current beam centre and separate X/Y calibration. Added 30 October 2026: central exclusion and outer fitting limit move together into the active FFT or Direct diffraction settings panel. Single-region matching and the auto-strength search within each region remain sequential.
- Exports retain execution worker count and elapsed seconds separately from scientific settings. Reweighting uses the same cached fit pool as before. No changes to fitting, scoring, thresholds or the adaptive decision criteria are intended.
- Validation: 104 tests passed, including actual spawn equivalence and cached reweighting, serial/threaded detector equivalence, adaptive child decisions, cancellation and injected worker errors. Browser checks covered worker preference persistence, progress, cancellation and manual analysis during a grid. Terminating the isolated test backend left no analysis workers. Windows uses spawn with the backend interpreter. Native Windows uniform-grid validation subsequently passed at one and four workers; broader checks remain open as listed below.
- Benchmarks on an 11-core Apple M3 Pro: 100-cell ST1203 grid with automatic strength and HCP overall/c/a fitting was about 3× faster with four workers; adaptive testing returned identical regions and classifications. Direct diffraction 1096 improved from about 12.2 to 8.9 seconds with two smoothing threads. See [benchmark details](parallel-performance.md) and `tools/benchmark_parallel.py` for reproduction and limits.

1 November 2026 Windows test: user reported four-worker grids failing with `BrokenProcessPool` before any completed cells, while single-region analysis worked. The log shows a private venv based on Miniconda. Removed the forced switch to `pythonw.exe`; workers now retain the backend interpreter. Fix committed as `c54e173`. Subsequent user exports completed successfully on Windows; the precise original worker failure was not captured.

Remaining: broader native Windows checks (adaptive grids, cancellation/restart, automatic strength modes and diffraction threading); broader memory/load measurements on smaller computers; batch grids now reuse this pool sequentially across images without nested per-image pools. Further validation of the weaker-second-pattern objective remains separate. Architecture diagrams were intentionally not refreshed.

## Deferred review: Mac–Windows numerical reproducibility

Recorded 2 November 2026 at the user’s request. **Review later; no fitting changes authorized by this note.** Preserve the existing analysis task order.

Validation on the same ST1203 pixels and 100 uniform crops, manual peak strength, HCP overall/c/a fitting and a 12 nm⁻¹ outer limit:

- Within each machine, one versus four workers produced exactly identical exported models, classifications, spectra and periodicity results for all 100 cells. Mac: 17.85 → 7.12 s (2.51×); Windows: 59.11 → 16.92 s (3.49×). Thus the observed cross-machine differences are not caused by worker count in this test.
- Across machines: all 100 classification labels, peak counts (781 profiles total), best passing phase/zone assignments, and selected primary/secondary phase/zone assignments agree. Source pixel hashes and analysis settings match. The stopping limits differ (4 versus 5 nm), but subdivision is disabled and all ROIs match. Engine fingerprints differ, so identical source/dependency builds have not been established.
- Largest peak-position difference: 0.001053 nm⁻¹, about 0.00516 FFT bins. Median best-passing rank differences are about 3×10⁻⁸; maximum HCP 0.0001954, BCC 0.0002796.
- Best passing fits: maximum absolute lattice differences HCP a = 0.000001475 nm, HCP c = 0.00002304 nm, BCC a = 0.00002581 nm; HCP c/a relative difference up to 0.00544%.
- Rejected alternatives differ more: maximum best-HCP rank difference 0.100501, a difference 0.004308 nm, c difference 0.021778 nm. The largest cases match only two profiles, with nearly identical positional agreement but different fitted scales/scale penalties. Three rejected BCC top candidates switch between almost-tied zones. These are not all negligible rounding differences, despite unchanged final classifications.

Review scope: verify source revisions and fingerprint sensitivity to line endings; record Python/NumPy/SciPy and numerical-library versions on both machines; reproduce the rejected HCP cases (notably ROI x=2048, y=1638 and x=2867, y=1638, each 410×410 px); inspect underconstrained scale optimization, numerical tie-breaking and candidate retention. Determine sensible reproducibility tolerances and whether scoring/optimization needs adjustment. Poorly constrained solutions are a hypothesis, not an established root cause. Do not generalize this one-image result to all modes or datasets.

Source exports (filenames retained here; experimental data are not bundled into Git):

- Mac one worker: `20261101_235124_1MX_OneView_ST_1203_grid_9c6057.json`
- Mac four workers: `20261101_234248_1MX_OneView_ST_1203_grid_94c3d2.json`
- Windows one worker: `20261101_085216_1MX_OneView_ST_1203_demo_grid_ac0d26.json`
- Windows four workers: `20261101_084643_1MX_OneView_ST_1203_demo_grid_518121.json`

## Overlapping window phase candidate map

**Approved and first pass implemented — 2 November 2026.** Automatic grid now offers **Overlapping stability map**. Defaults: 5 nm square windows, 2.5 nm centre spacing, hexagonal centres, one pass; optional square centres and three/nine deterministic shifted passes. Existing uniform/adaptive behavior is retained. Full windows only, a 32-pixel minimum, and a 10,000-window cap (raised 3 November 2026 for larger fields in nine-pass batches). Uses the existing selectable process workers, cancellation and cached reweighting.

**Update — 2 November 2026:** nine passes use every combination of 0, ⅓ and ⅔ shifts along both lattice directions. Legacy seven-pass requests remain supported; saved UI choice migrates to nine. Grid/batch worker choices extend through 10/12/14/16; Auto remains at most four. Explicit choices can exceed CPU count. Diffraction smoothing retains its existing limit. Tests check nine-offset completeness and worker validation.

**Display update — 2 November 2026:** raw centres offer Circles (classification colour), Circles + zone icon, or Zone icon (remembered display preference). Zone icons show the highest-ranked candidate, with passing-winner legend counts (not areas). Rejected winners remain faded. Aggregated views show a colour-scale legend directly below the image; sample coverage uses saturated cyan.

**Original combined passing-frequency view — 2 November 2026 (superseded by the blended display above):** Phase selector offers All phases plus individual enabled phases. Each aggregate tile uses the full tile for one phase with positive passing support, and splits into phase-coloured horizontal bands only when multiple phases have positive support, strongest at the top. Zero-support phases receive no band; tiles with no passing phase remain muted. Opacity indicates each independent frequency. Separate ramps identify the colours; no blended phase colours or normalization to a 100% total. Existing PNG export includes the visible bands and explanatory key.

**Hex winner display and sampling preview — 3 November 2026:** Preview overlapping windows checkbox requests the exact centred sampling layout without running analysis, showing square footprints and pass-coloured centres. Top match · averaged hex grid evaluates the same Gaussian / equal-pass aggregation directly at hex centres and selects the phase with highest averaged rank, not the most frequent individual winner. Missing candidates are excluded from rank averages; all-rejected winners remain possible and fading indicates passing support. Hex hover cards include per-phase mean rank, passing frequency and window/pass counts; clicks inspect a contributing window, not a synthetic averaged FFT. Display hex spacing follows centre spacing (coarsened only to bound display density near 4,000 tiles); pixel aspect calibration is respected and tiles are clipped to sampled footprints. JSON includes hex values; visible-map PNG includes hex colours and phase key, excluding the planning preview. Existing raster statistics and batch PNG frequency views are unchanged. Ten overlap tests and four batch-stability tests pass, including mean-rank selection, equal-pass weighting, absent candidates and anisotropic calibration. A UI smoke check covers hex polygons/clipping, winner colours/legend, averaged hover values and visibility; JavaScript syntax and diff checks pass.

**Image-relative windows — 3 November 2026:** overlapping maps offer Fixed nm or % of image. Relative windows default to 10% of the shorter physical image side; spacing initially followed window size (superseded by the independent control below); square physical crops respect pixel anisotropy. Batch sampling resolves percentages independently per source and exports the requested percentages, reference extent, resolved nm sizes and actual pixel footprints. Existing fixed-nm preferences remain unchanged. The preview and size note follow the selection; the note reports effective smoothing sigma in reciprocal units. Smoothing stays in FFT bins (reciprocal sigma approximately bins / window width), with no silent retuning: constant bins track finite-window broadening but do not guarantee detection quality. Compare physical resolutions explicitly across images; the 10% setting is an empirical starting point, not a validated universal threshold. Sampling and two-image batch tests cover per-source resolution and export provenance.

**Independent spacing and PNG selection — 3 November 2026:** centre spacing now has its own Fixed nm / % of window selector, defaulting to fixed nm independently of window sizing. Legacy relative API requests keep their old window-relative interpretation. Both choices persist; exported metadata records each mode and the resolved dimensions. Batch PNG checkboxes select combined or per-phase passing frequency, averaged hex winner, per-phase placement disagreement, sample coverage, separate-pattern frequency and raw classification circles. Uniform/adaptive batches retain classification + zone-label PNGs. Export choices are remembered; disabled phases are omitted, one-pass disagreement is unavailable, and each product is listed in per-image `png_files`. Data exports remain complete regardless of PNG choices. Validation: 41 targeted overlap, batch, folder, detector and auto-strength tests passed, plus mocked UI checks for persistence/visibility and rendered PNG inspection. Views render from completed results without additional matching; batch rendering of zone symbols remains a separate planned item.

**Map sizing and error feedback — 3 November 2026:** percentage window and spacing inputs show their resolved nm values immediately beside the input, updating for the current image and control changes. Invalid/unavailable values show a dash. Errors also appear in a persistent, dismissible viewport notification, including grid and batch job failures; repeated polling does not reopen dismissed errors. The existing export notification is reused, with manual-popover support so feedback remains above open dialogs without stealing focus. Inline status details are retained.

**FFT separation default — 3 November 2026:** default/reset minimum separation is 0.50 nm⁻¹ in detector, validated settings and UI. Saved explicit values remain unchanged; effective separation still respects crop-window broadening.

**Auto smoothing proposal — 3 November 2026 (not implemented):** user favours a coarse sweep in 0.25-bin increments rather than continuous optimization. Benchmark a bounded range with reused FFT/background work before selecting a range, objective and stopping rule. Crystal-rank trials can multiply matching cost, especially when combined with auto strength; geometry screening can reduce full matching calls but must preserve weak secondary patterns. No runtime estimate or automatic smoothing change has been validated yet.

**Aggregation decision:** match every FFT independently, then aggregate results. Do not average complex FFTs or power spectra for this spatial map. Every enabled phase contributes independently, including weaker passing fits. Windows without a passing fit remain in the denominator. Weights are `exp(-8*(dx²+dy²))` inside the window footprint, with offsets normalized by width/height. Normalize each placement pass separately, then give represented passes equal weight. No rank/quality weighting is applied to support, to avoid letting stronger HCP erase weaker passing BCC.

**Available views:** passing frequency for each phase, per-phase placement disagreement (max-minus-min support across represented passes), sample coverage and raw sample centres. A separate view records the existing classifier's `coexisting_candidates` outcome within individual windows, distinguishing it from neighboring windows favouring different phases. That inherits existing classifier limitations, including same-phase secondary-orientation detection. Overlap means correlated measurements, not independent observations. Disagreement is sensitivity to placement, not a confidence interval. One-pass disagreement is disabled and locations with fewer than two passes are blank in that view.

A 64-column aspect-preserving raster samples aggregate values at tile centres; its coverage estimate is approximate. Raster density does not improve the FFT window's resolution. JSON (`*_overlap_map_*.json`) includes raw candidates/coordinates, actual pixel footprints, pass IDs/offsets, settings, weights/version and aggregate support, rank, candidate presence and separate-pattern support. PNG uses the visible map and interpretation key. Aggregate rank excludes missing candidates; support does not. No overlapping-window areas are summed into specimen phase percentages.

**Validation:** six focused tests cover staggered bounded deterministic sampling, invalid/oversized requests, equal-pass weighting, missing/failed fits, simultaneous phase support, empty maps, JSON and grid-coordinator integration, including a real two-worker run, cached rescoring and exported raw candidates/pass IDs. Six existing parallel/coordinator tests pass on Python 3.14.7. An isolated browser test of demo ST1203 ran 378 windows (8 nm / 4 nm, hex, three passes) using two workers in 28.8 s; HCP/BCC support, disagreement views and UI completion were verified. This is functional validation, not scientific calibration.

**Batch stability maps — 3 November 2026:** the selected overlap window size, spacing, hex/square layout and placement passes now run across reviewed images using the existing worker pool. The live viewer shows completed window centres during analysis, then the all-phase passing-frequency map. Optional PNGs originally used split tiles (superseded by the blended display above) with phase colours and a frequency key; JSON retains every raw window, pass and candidate plus aggregation. Per-image CSVs report support and candidate-presence frequencies over covered raster area; per-sample CSVs report covered-area-weighted support and equal-image means. Missing/empty coverage is unmeasured, not zero support. Zone breakdowns count best passing fits per phase per window, explicitly correlated counts rather than area fractions. Cancellation and individual image failures preserve available results. Standard batches retain their existing schemas. The folder picker loads from the catalogue before Review images, accepts multiple parent folders and includes descendants. Ticking folders selects the eligible union without duplicate images; keyword search further filters the review list. Flatten subfolders for summary combines descendants under the outermost selected parent, or the top-level folder for All folders; otherwise each source subfolder is summarized separately. Both modes add folder summaries alongside sample summaries, plus folders.csv, folder_zones.csv and image_folders.csv. Select only matches replaces selection, while Select all/Deselect all operate on shown matches. Tests cover overlapping denominators, simultaneous phases, empty/partial maps, unequal image areas, aspect-preserving PNG bands, and a real two-worker multi-image export with a failed image. The existing 11 manual/batch and eight overlap tests also pass; a UI smoke check covers folder subtree/search selection, phase columns, centre rendering and split tiles. Restart the backend for the new batch capability.

**Still planned:** zone/orientation agreement maps; pairwise rank differences; dedicated comparison of 5 versus 8–10 nm windows on ST1156/ST1203/ST1217; any use as physical phase fractions. No architecture diagram update requested.

Original design retained below for the remaining scope:

Build this as a separate mapping mode alongside the existing uniform and adaptive grids. The first result should be a spatial map of HCP/BCC/FCC evidence, with ambiguity retained, rather than an estimate of phase percentage.

1. **Sample overlapping windows.** Start with an adjustable window near 5 nm and spacing near 2 nm. Offer square or hexagonal arrangements of window centres; the FFT crop can remain square in either case. Handle image edges explicitly and record the actual analysed footprint. Overlap makes the display denser; it does not create independent measurements or improve the resolution set by the window.
2. **Retain all structure fits at every centre.** Store coordinates, window dimensions, FFT/peak settings, best HCP, BCC and FCC candidates, zone axes, rank components, peak coverage, acceptance reasons and shared-evidence ambiguity. Include unresolved and insufficient-evidence windows. Do not preselect beta-like regions or discard windows simply because no candidate passes.
3. **Show raw results before aggregation.** Display each sample centre and its footprint, with the same crop/FFT inspection card. Add separate views for HCP, BCC and FCC evidence, pairwise differences, and evidence quality/ambiguity. Keep numerical scores labelled as heuristic evidence rather than probabilities.
4. **Add optional spatial averaging.** Average a score difference over neighbouring overlapping windows using documented distance and evidence-quality weights. Also expose contributions, usable coverage and disagreement. Treat unresolved/insufficient results explicitly; do not fill them silently or force a winning phase. Overlapping windows are correlated, so their count is not an independent sample size. Shared HCP/BCC/FCC spot assignments and overlap through specimen depth remain unresolved by averaging.
5. **Compare and export.** Trial the mode on the demo images, comparing 5 nm windows with 8–10 nm windows, different spacings and square/hexagonal centres. Check known boundaries and sensitivity to thresholds, scaling penalties and missing-peak weights. Export raw per-window fits, aggregation settings and the resulting maps so smoothing is reproducible and can be removed.

Candidate-labelled image area can be reported with unresolved area beside it. Converting it into physical alpha/beta fractions would require separate validation, including orientation/contrast bias and through-thickness overlap; FFT intensity or rank ratios alone do not establish volume fraction.

[Related work by Jany et al. on local FFT analysis of HRTEM images](https://arxiv.org/abs/1907.10929) is a starting point for methodological review, not validation of this app’s classifier or of phase-fraction estimates.

Parallel grid execution is reused by single-image and batch overlapping maps. Batch stability summaries use the aggregation-aware schema described above; uniform/adaptive batches retain their disjoint-area summaries.

## Platform delivery

2 November 2026: backend startup logs now identify Python version/implementation/executable, virtual environment and base paths, OS/architecture/CPU count/PID, scientific package versions, application/config/data/output/project paths, engine fingerprint, template/image counts, parallel defaults and ready timing. Preserves the launcher’s readiness line; no configuration secrets are logged.

2 November 2026: changed new-environment interpreter preference to Python 3.14, followed by 3.13, 3.12, 3.11 and 3.10, for macOS and Windows. Existing compatible environments are reused; 3.15 remains excluded. Updated setup instructions and discovery checks. User testing of the scientific stack on 3.14 is pending; previous runtime validation was on 3.12.

30 October 2026: added Windows double-click installer and launcher, private `.venv\Scripts\python.exe`, installed-Python discovery, and a desktop shortcut. A native Tk control window provides Start/Stop, Open Workbench and View log without a terminal; closing it stops its own server. Uses the existing browser interface and Windows directory junctions for data/output. Python 3.10–3.14 supported, 3.12 preferred; no automatic Python download. Runtime regression checks run on macOS. The user has since installed and run the Windows app and exported completed demo-image grids with one and four workers. Original-DM4 loading, direct diffraction, adaptive/batch runs and cancellation still need broader native Windows verification; the successful demo-grid test does not cover those paths. This packaging work does not change the analysis roadmap order.

## Display updates

3 November 2026: Visual image browser has a folder selector with All folders, parent/subfolder paths and image counts. Parent selections include descendants, combine with keyword search and sorting, and are remembered per data source. Top-level files have their own option; stale selections fall back to All folders when a folder disappears. Preview generation scope remains the full linked collection.

2 November 2026: PNG and GIF spectrum exports include the currently visible overlay key as a wrapped footer. Shapes, colours and line styles match the displayed legend; swatches remain stationary during animation. Export height expands for the key, with both formats retaining the same resolution and the existing 3200-pixel safety limit.

2 November 2026: fresh-start marker defaults now use open crosshairs for measured peaks, diamonds for HCP/BCC/FCC predictions, squares for both geometry grids, original dots for weak detections, A/B/C Winning Fit (Passing) vectors and Bounce + rotate. Existing saved display preferences retain precedence.

2 November 2026: added a visible overlay legend below the FFT/direct-diffraction image and in its enlarged view. The key follows rendered marker shapes, phase colours, manual/weak detections, geometry grids, prediction line styles, vectors, label connectors and fitting/exclusion boundaries. Hidden marker types and unused evidence styles are omitted. Display only; analysis and scoring are unchanged.

3 November 2026: vector arrows now carry compact A/B/C identifiers (phase-prefixed when multiple phases are shown), or phase-prefixed P1/P2 for indexed reflections. Full reciprocal lengths and plane spacings are grouped at bottom left beneath each phase zone/angle summary; indexed rows include plane indices. Repeated fitted letters share one measurement row. All displayed phase groups stack at bottom left, with measured-width backgrounds and collision avoidance for the short arrow labels. PNG/GIF use the same SVG layout. Display only; vector selection and matching are unchanged.

30 October 2026: added Bounce + rotate marker motion (−45° to +45°, largest at 0°; 2.4-second rotation cycle with the original 1.2-second bounce timing), preserving phase timing offsets, reduced-motion preferences and GIF export support.

30 October 2026: phase-colour dropdown options use neutral text to avoid inheriting the selected phase colour in Windows native menus.

30 October 2026: peak-evidence weight preserves in-progress decimal input; both ranking-weight number fields accept arbitrary decimal steps within 0–0.5.

30 October 2026: both ranking-weight sliders use 0.01 increments and show two decimal places when adjusted; manual decimal entry remains uninterrupted.

30 October 2026: Windows launcher readiness accepts Windows CRLF logs. The window, taskbar and installed shortcut use an ICO generated from the existing macOS icon artwork.

30 October 2026: renamed template construction constants to `TEMPLATE_BASE_A` and documented their distinction from material presets. Values and matching behaviour are unchanged.

30 October 2026: corrected GIF export limits for the full 72-frame Bounce + rotate cycle at 30 fps and 2800-pixel width. Older running servers are detected before rendering frames and prompt a restart.

## Approximate acquisition map — implemented 30 October 2026

The file toolbar opens a stage-metadata map for the current labelled sample. It defaults to the current folder and acquisition date; users can expand to the whole sample, change date and select an overview. The largest calibrated real-space field on that date is the initial backdrop, including overview images in sibling folders. Click a calibrated location or list entry to use it as the next reference; Back restores each previous reference and view. Open for analysis remains a separate action. A visible folder selector switches folders within the labelled sample; pan, zoom, and fit all locations or the overview extent.

Only DM4 metadata is read for indexing; cached entries invalidate on file size/mtime changes. Overview previews are loaded on demand without analysis or changing the loaded source. Switchable hover comparisons show the full acquired image beside a crop of original reference pixels at the predicted footprint, with bounded preview caching and black padding outside the reference. The reference itself never opens a comparison card. Calibrated real-space images have physical footprints; diffraction/uncalibrated images have location points only. Missing positions and read failures are reported. Raw stage X/Y/tilts are also retained in newly exported source metadata.

This is a schematic location aid, not registration: stage units are undeclared in these files (µm is a visible, adjustable assumption), and stage-to-image rotation/flips are manual display controls. Stage rounding, drift, image shifts and tilt are not corrected. Footprint dots and acquisition labels sit at the top-right corner to leave image centres clear. Coincident positions remain available in the list. ST/STA folder labels are retained as recorded; suspected sample swaps are not resolved by this feature. The acquisition map does not perform automatic image alignment. Batch grids and parallel execution are separate features described above.

Follow-up: Hitachi-specific placement calibration remains deferred at the user’s request. The user observed approximately −90° stage-to-image rotation for the current acquisition set; rotation remains an adjustable map control, not a universal camera calibration.

Acquisition-map stage rotation is remembered per reference image and data folder in browser storage, including across reloads and app restarts in the same browser/address. Changing reference or navigating Back restores that reference’s angle; an unset reference starts at 0°.

Manual placement — implemented 30 October 2026: **Adjust placements** enables footprint dragging with an image selector for overlapping acquisitions. Each reference–image pair remembers its manually chosen centre in reference-image coordinates, scoped to the data folder and browser. These positions override the stage estimate at that level without changing original metadata or image pixels; **Reset placement** removes the override. During a drag the comparison card stays visible and crops the cached reference preview immediately; release saves the centre and requests the original-pixel crop. Cancelled drags restore the previous placement. Zoom-out is bounded to twice the fitted view width, with All locations available for deliberate reframing. Hitachi-specific automatic calibration remains deferred.

## Crop-size consistency diagnostic

Approved and implemented first runner, 31 October 2026: `tools/crop_size_diagnostic.py` runs the existing engine outside the live app. Compare manual, geometry-auto and rank-auto on nine fixed centres at 4/6/8/12/20 nm plus centred 30 nm and full image. Capture raw/processed previews, detected profiles, all rank-auto candidate trials, geometry-auto trial evidence, score decompositions, rejection reasons and cached-candidate penalty ablations. No production detection or scoring defaults changed. The expected HCP orientation is evaluation-only and is a working hypothesis from the saved region, not independent ground truth.

Optional fixed smoothing sensitivity at representative sizes compares off/lower/higher smoothing and a constant reciprocal-space smoothing width. Automatic smoothing optimization is explicitly deferred for discussion. The runner supports restart after failure with matching provenance and preserves completed groups; use local temporary output before copying to cloud storage. See [diagnostic instructions](crop-size-diagnostic.md).

Next: follow up the completed ST1156 experiment with manual inspection of representative missed/spurious peaks and fit rejections, then test ST1203 and a mixed-pattern control before altering defaults. Build the in-app crop-size diagnostic panel after deciding which diagnostic outputs to retain. No architecture refresh requested.

ST1156 first experiment completed 31 October 2026: 189 analyses (141 baseline crop/mode combinations plus 48 fixed-smoothing checks). Expected-orientation acceptance was 29/47 manual, 28/47 geometry-auto and 40/47 rank-auto. Eighteen of nineteen geometry-auto failures passed the position screen but failed after ranking penalties; this implicates scoring as well as detection. Smoothing effects depend on crop size and selection mode. Nine targeted runner/auto-strength tests pass, including unchanged production results in all three modes. Results are exploratory; no defaults changed and automatic smoothing remains deferred.

## Grid marker layout

Implemented 1 November 2026 (`c1a6b10`): interactive grid zone symbols are centred in a vertical stack, ordered by descending candidate rank (coverage breaks rank ties), rather than fixed phase positions. Only enabled phases with a retained candidate occupy a slot; one candidate is centred. Below-screen candidates remain faded, independently of rank order. Layout uses the active phase list, including FCC, and shrinks symbols for larger stacks. Browser map PNG exports inherit the same layout. Batch text-label PNG rendering is unchanged; unifying its overlay options remains the separate follow-up above.

## Maintaining this plan

Update this document when a task's scope, priority, decisions or implementation status changes. Keep proposals distinct from agreed behaviour and mark work complete only after implementation and relevant verification. Add the completion date and commit reference when closing a task; keep a short completed-work record as tasks leave the active list.

The README links here instead of maintaining a second plan. Update the [architecture and methods documentation](architecture/README.md) when the user requests a refresh. This document records delivered scope alongside remaining work; the README describes how to use available features.

## Reciprocal peak-edit radii and Unknown material — completed 2 November 2026

Snap and deduplication controls, cursor rings and per-peak dragged snap rings use nm⁻¹ (defaults 0.50 / 0.10; adjustable 0.001–5). Distances use both calibration axes, including anisotropic pixels. Existing saved pixel-radius edits retain their original behaviour. Initially, new removal edits targeted one observation. Superseded by the persistent area-removal tools described below (2 November 2026). Detector smoothing and centre-shift controls remain detector-pixel operations.

Initial implementation: Unknown material enabled all three existing phases, switches fixed fitting to automatic, and searches reciprocal multipliers ×0.5–2.0 using a denser HCP proportion seed sweep. References remain editable search anchors and scoring penalties remain user-controlled. Ordinary presets retain ×0.85–1.15 bounds; the finite orientation library is unchanged. Catalog/browser labels include extensions and calibration status for ordinary images. No architecture refresh.


## Generic orthorhombic search and hover controls — completed 2 November 2026

Approved scope: a generic primitive orthorhombic lattice, not titanium α″. Added ORT phase/search colour, editable a/b/c anchors (0.300/0.400/0.500 nm), 38 zone/mirror templates, independent reciprocal-metric fitting in the two multi-parameter modes, and fixed-proportion single-scale fitting. Axes not individually identifiable in the selected zone are exported/displayed as unconstrained in independent mode. Matching, cached rescoring, legends, grids, batch summaries, marker styles and vector overlays accept ORT. Ti/Fe presets keep it disabled; Unknown enables all four structures. A finite pair-seed search and existing evidence screens are used; generic compatibility is not a chemical phase assignment or proof of symmetry. Complexity calibration and broader experimental validation remain open.

Unknown now forces overall scale cost to zero in analysis and cached rescoring, while keeping the HCP c/a weight in overall + c/a mode. The disabled overall control shows zero and retains the preference for other materials.

FFT/diffraction clicking no longer opens an enlarged modal. The spectrum cursor is a crosshair; existing hover magnification remains available. Add/remove tools show the active reciprocal-space selection radius as a dashed cursor ring; saved per-peak rings remain draggable.

Validation: synthetic orthorhombic recovery, principal/partially identifiable zones, fixed/common scale, edited reference caching, full FFT analysis and cached rescoring; Unknown penalty regression; browser control and full existing regression checks. No architecture refresh.

### Diffraction centre and removal tools — completed 2 November 2026

Set centre works on the detector and reciprocal plot, converting clicks using the displayed plot’s centre and calibration. New removal edits clear every observation in their reciprocal-distance radius (shared deduplication/removal control). Pink dashed removal circles persist on both images in View as well as editing modes; in Add/Remove modes, drag a boundary or handle to resize. Resizing a removal never snaps its centre. Saved legacy single-spot edits preserve their original effect until resized, when they become area removals. Undo, per-image memory and exports retain the edits. Opposite partners are not removed unless inside a removal circle.

**Added-peak rings — 2 November 2026:** saved addition search circles also persist on both images in every detector tool mode. Each has an inset × button to delete that addition, with keyboard Enter/Space and Undo support. Deletion replays the remaining edits, so an original automatic detection can return. Rings are drawn from saved edit records, including additions subsequently suppressed by another edit; resizing stays available in Add/Remove modes.

**Removal-circle deletion — 2 November 2026:** the same inset × control now deletes removal edits on both images, including legacy single-spot removals. Keyboard Enter/Space and Undo work for both edit types. Remaining edits are replayed, allowing previously removed peaks to return unless another removal still covers them.

**Centred overlapping grids — 2 November 2026:** new square/hex overlap maps translate the complete multi-pass sampling layout to balance unused margins on opposite image edges (within one pixel). This preserves window count, size, lattice spacing and relative pass offsets. Exports record the centring shift and placement policy, version overlap-v3. Existing maps retain their analysed coordinates; rerun to use centred sampling.

**FFT minimum separation — 2 November 2026:** corrected suppression across the canonical half-plane boundary: separation now uses the nearer of q−p and q+p, consistent with opposite spots representing one profile. The TiFe0107 export exposed profiles 5/11 only 0.2605 nm⁻¹ apart despite a 3 nm⁻¹ setting. Regression covers boundary-straddling peaks, stronger-profile retention and unchanged FFT pixels. Restart and recalculate affected regions/maps; saved results retain their original detections.

**Measured peak sizes/intensities — 2 November 2026:** bottom peak table includes spot radius (nm⁻¹) and intensity, separate from the shared prediction matching radius stated below it. FFT radius is half the above-threshold equivalent component diameter; intensity is raw FFT power at the component maximum. Direct diffraction uses half estimated FWHM and the recorded pixel value of the observation with greatest local contrast in each opposite-spot profile; manual sizes are smoothing estimates. New fields persist in JSON. Old results show missing intensity as a dash until recalculated. Display brightness does not alter these values.

## Plain demo downloads — 3 November 2026

Demo downloads accept plain DM4 folders/ZIPs without a manifest. Original-DM4 catalogue entries are discovered from files with the same stable filename-derived IDs as before. Matching PNGs are optional; existing local previews are reused and missing previews are generated locally during installation. ZIP integrity/path checks remain, and pack identity uses original filenames/content rather than manifests or previews. Legacy NPZ reading is retained. The optional developer packaging helper now copies only DM4s; users can update a shared Dropbox folder directly. This change does not alter the hosted Dropbox folder automatically.

## Radial missing-peak cost and settings layout — 4 November 2026

Implemented adjustable missing-prediction falloff, shared by FFT and direct diffraction: each missing node costs `2^(-(g/r)^2)` relative to its previous weight. The new UI starts at a half-weight radius `r = 8 nm⁻¹`; zero restores equal weighting. The denominator remains the number of assessable predictions. Strong coverage and weak-peak bonuses are unchanged. Cached maps can be reweighted without repeating FFTs; exports retain the setting and weighted/unweighted evidence factors. Legacy results without this field restore zero to preserve their original scores.

FFT controls use two aligned rows on wide screens, with scale fitting and a consistent penalty-control grid to the right; narrower screens stack the panels. Long FFT/scale descriptions now appear through hover/focus help. This is the ongoing UI convention, recorded in AGENTS.md. Errors and live progress remain visible.

Validation: 41 focused analysis tests passed, including radial weighting, disabled/legacy behaviour, cached map reweighting and export propagation. Browser checks covered control synchronization, fitting-limit relocation, desktop alignment and responsive help. This changes missing-peak weighting, not the acceptance threshold; a candidate can remain below threshold because of other costs.

The same layout pass aligns phase-colour and material fields under matched headings, moving their explanatory notes into help. Direct diffraction now groups centre/calibration, detection and inner/outer bounds in aligned rows, with a separate peak-edit panel. Centre-fit and peak-edit details are available from help icons; existing control IDs, settings and edit behaviour are preserved.

At desktop widths, direct diffraction, peak editing and scale fitting share one row as three peer panels. Below 1400 px the groups wrap to retain usable input widths.

Diffraction calibration fields and metadata display five significant figures; full calibration values remain in analysis state, persistence and exports. Hovering a calibration input reveals its full value.
Starting centre coordinates similarly display one decimal place without rounding the stored values.

Follow-up controls: manual minimum FFT peak strength has a synchronized slider (hidden in auto modes); changes apply on release. Set centre sits beside centre coordinates, leaving the four peak tools on one row. The compact Edit radius label retains its full explanation on hover. Exclusion actions align with the two peak-edit action columns.

Centre changes now show the normal delayed analysis spinner, including while Set centre remains selected. Peak-edit modes still suppress it to keep editing unobstructed.


## File switching during analysis — 4 November 2026

Interactive analysis no longer holds the shared catalogue lock while fitting. Source arrays remain referenced by the running request; mutable template and detector cache containers are isolated per request. Switching files abandons the previous browser request and immediately permits the new source/analysis to load. Late replies and cleanup cannot replace the new result or clear its loading state. An abandoned server calculation may finish in the background; this does not forcibly terminate numeric routines or change grid cancellation.

Validation: a blocked-analysis regression confirms a second source completes before the first is released, with isolated caches. Browser request-function tests cover late success and failure without stale results, errors or spinner cleanup affecting the new request.


## Desktop releases and versioning — implemented 4 November 2026

Approved handoff from Tensile Workbench: numbered GitHub releases on verified main pushes, Git-free archive updates with checksums, transaction recovery, persistent Mac/Windows launchers and external Python 3.14 environments. Full synthetic tests and native launcher checks run in GitHub; local checks target modified paths. Preserve research, project state, calibration overrides and existing environments. First release publication is gated by the complete GitHub suite. Implemented the shared updater, isolated external environments, official-Python bootstrap, persistent launchers and release workflows on feature/desktop-releases. Local validation: 98 focused tests passed (7 Windows-only skips); native Mac launcher typecheck passed. GitHub full synthetic suite passed. Native Mac app build/signature and archive unpack verification passed. Windows launcher/update/process checks passed; release preparation exposed a Windows text-encoding error, corrected with explicit UTF-8. The corrected native Mac/Windows suite passes (99 tests, platform-specific skips). Browser interaction regressions are now part of the full release gate. Initial publication follows merge to main; actual first-install experience on a clean physical Windows machine remains a user smoke test. Existing local .venv is preserved.

### Diffraction hover preview — completed 4 November 2026

The left detector preview follows the cursor in View and Set centre modes, with viewport-edge clamping instead of detector-quadrant corner anchoring. Native-pixel crops stay centred on the pointed detector position. Scrolling/resizing hides stale previews. Browser regression checks cover tracking, edges, crop coordinates and tool changes. No analysis or saved settings changed.

### Windows legacy shortcut upgrade — 4 November 2026

The first physical Windows upgrade exposed a shortcut-description mismatch: the previous launcher was rejected as unrelated after dependencies installed successfully. Accept the old description only when its target, arguments and working directory match this checkout. Preserve protection for unrelated shortcuts. Report shortcut errors concisely; reserve Tcl/Tk advice for a failed desktop-interface check. Regression coverage includes a temporary native Windows .lnk roundtrip without touching Desktop or Start menu shortcuts. Publication remains gated by native Windows/Mac and analysis tests.

### Windows demo download certificates — 4 November 2026

A Windows demo download reported a self-signed certificate in its chain. Use Truststore's native Windows SSL context for demo downloads so Windows-managed trust and chain building apply, without disabling verification or changing global SSL behaviour. Add a Windows-only dependency and clear certificate-error guidance. Tests cover context selection, mandatory hostname/certificate validation and failure without insecure retries; native Windows context construction runs in the desktop gate. The user's particular network/certificate chain still needs an on-device retry.

### Mac updater with Homebrew Python — 4 November 2026

When the analysis environment lacks Tk, the updater/recovery window locates an installed standard 64-bit Python 3.14 with Tk and relaunches only its helper under that interpreter. The session retains the original analysis environment; no packages or environments are changed to open the window. If none is available, give explicit Python.org/Homebrew Tk setup guidance.
