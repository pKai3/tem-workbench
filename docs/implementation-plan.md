# TEM Workbench implementation plan

Last updated: 30 October 2026

This is the maintained plan for upcoming analysis and performance work. The next three analysis tasks have an agreed order. The user authorized parallel grid execution ahead of the remaining analysis tasks on 30 October 2026; that implementation is on `perf/parallel-analysis`. The order of the three analysis tasks below is otherwise unchanged.

## Next tasks in agreed order

| Order | Task | Status |
| --- | --- | --- |
| 1 | Revise fully free HCP fitting | First-pass optional mode implemented; data validation pending |
| 2 | Revise automatic minimum peak strength selection to retain weaker separate patterns | Design discussion pending |
| 3 | Batch grid analysis across qualifying images, with per-image and ST/STA summaries | Planned after the fitting and peak-selection changes |

### 1 HCP fitting

Implemented 30 October 2026: **Auto: overall scale + HCP c/a**, alongside the original modes. The agreed first pass uses broad existing reciprocal-axis bounds (0.85–1.15), without an additional tight c/a cap or an assumed stronger shape penalty.

- Let sa and sc be the reciprocal a* and c* multipliers. Overall reciprocal scale s = sqrt(sa × sc); real-space c/a multiplier r = sa/sc. Model dimensions remain a0/sa and c0/sc.
- Scale cost = λ[ln(s)/ln(1.05)]² + μ[ln(r)/ln(1.05)]². Both weights default to 0.10; independent number boxes and sliders use 0.01 slider steps. A factor 1.05 (or its reciprocal) costs the relevant weight. These are exploratory preferences, not measured material limits.
- Cubic fits use the same overall log-scale cost, with no ratio term. HCP zones insensitive to c fit only the observed basal scale and report c/a as unconstrained.
- The same positional search/refinement is reused; the separate costs rank explored candidates before retention. This is not a penalty-aware continuous optimizer. Equal defaults do not reproduce the old independent-axis cost exactly, because the new shape coordinate measures the full c/a change.
- Costs and multipliers are retained in results; table tooltips show the decomposition. Both weights can reweight a completed grid's cached candidates without changing matches or cell boundaries. Changing fitting mode requires a new grid.
- All top-level processing settings are grouped in one persistent collapsible section. Previous/next file buttons follow the current filtered and sorted file list, stopping at its ends.

Material-specific priors and extra parameter-count corrections remain unvalidated; no such constraints were added.

Compare the revised fitting with the current single-scale and independent-a/c modes on ambiguous HCP/BCC examples and the stronger ST1203 BCC candidate. Report positional agreement, scale costs and phase/zone stability so a more flexible model does not win simply by changing its proportions excessively.

### 2 Automatic minimum peak strength

The current strongest-candidate objective can raise the detection threshold until weaker BCC evidence disappears, leaving a strong HCP result. Keep that behaviour available for deliberately selecting the dominant pattern, and design an alternative that searches lower thresholds for a separately supported second pattern.

The second pattern may be another orientation of the same phase. Two candidates explaining the same measured profiles are competing interpretations, not evidence of two patterns. The new objective must distinguish those cases and account for shared and independently explained profiles.

First pass implemented 30 October 2026: **Auto · geometry (1–2 patterns)** retains the existing best-crystal-rank mode. It searches all distinct strength cutoffs using the existing geometry screen, then runs crystal matching once on the selected peak set. The objective uses positional evidence normalized to the full admitted peak pool, counts shared profiles once, subtracts the existing chance allowance for each grid and 0.03 per grid, and adds a screened secondary only if it improves that score. The secondary still requires three unique profiles in nonparallel directions. This is exploratory: it does not guarantee detection of a weak second pattern or change crystal classification thresholds. Trials, objective and selected cutoff are exported; browser preferences, saved regions and grid workers carry the choice. The 104-test suite passes, including shared-evidence deduplication, independent-pair selection, one final crystal search, and manual-cutoff reproduction. Browser checks verified both mode-specific limit layouts, thread preference persistence, Auto control state, the source-detector boundary, and no horizontal overflow at 1440/850 px. Validation on the real mixed examples remains pending.

Remaining decisions:

- How to score a pair of separately supported patterns without favouring noisy low thresholds or counting shared evidence twice.
- Whether coverage should be evaluated against the whole detected set, the evidence assigned to each pattern, or both.
- How geometry-only primary/secondary fits contribute to finding and accepting the second crystal pattern.
- How to balance dominant-pattern quality with additional evidence explained by a weaker pattern.

Evaluate aligned HCP/BCC alternatives, a strong single BCC example, and multiple orientations of one phase. Show the selected threshold and objective, and preserve reproducible settings and candidate evidence in exports. Simply maximizing the sum of the top two candidate ranks is not an agreed solution.

### 3 Batch grids

Run the usual grid analysis over all qualifying images using one captured parameter set. Compile the usual classifications, image-area percentages and zone-axis breakdowns for each image and for each sample group, including ST and STA.

Eligibility should cover OneView real-space images, excluding direct diffraction. The requested magnification cutoff is around 400,000×; confirm whether 400kX itself is included and how missing or ambiguous magnification metadata should be handled. Show the eligible list and exclusions before running.

Retain the selected uniform/adaptive settings, stopping size and passing-region checks. Record the complete analysis settings and engine version with each run. Provide progress, cancellation and per-image failures without discarding completed results.

Summaries should include:

- Per-image analyzed area and coverage, all classification categories, passing phase candidates and zone-axis breakdowns.
- ST/STA summaries with explicit denominators. Distinguish pooled physical image area from an unweighted mean of image percentages.
- Current adaptive leaf regions only, excluding superseded parents and discarded trial children.
- Ambiguous, unresolved, insufficient and multiple-pattern area. Do not double-count overlapping phase support as two disjoint areas.
- Machine-readable per-image and sample summaries, with the underlying grid results retained for inspection and reweighting.

These are candidate-labelled image-area percentages, not validated volume fractions. Independently acquired fields may overlap; sample summaries must not imply unique specimen coverage unless that is established.

## Parallel grid execution

Implemented 30 October 2026 on `perf/parallel-analysis`, following explicit approval to proceed independently of the remaining analysis tasks. Implementation commit: `8f7aa0c`.

- Uniform and adaptive grids use a bounded spawn-process pool. **Workers: Auto / 1 / 2 / 4 / 8** is remembered in the browser; Auto uses at most four workers, leaves one logical CPU free, and all choices are capped by CPU count. Each worker owns its analysis engine and caches. One read-only memory-mapped copy of the source is shared per job; only ROIs and results cross the queue.
- Results are committed in submission order, preserving deterministic region IDs, tie ordering and subdivision decisions. All four children must finish before replacing a parent, including ordinary unresolved-parent subdivision. Cancellation/errors retain the parent and mark incomplete child probes as trial-only. Initial cells not yet analysed remain uncovered.
- The grid no longer holds the interactive engine lock. Pending work is bounded by worker count. Cancellation is checked between automatic-strength trials; a current fitting trial may finish first. Pool shutdown is completed before another grid can start. Each worker exits if its backend disappears; normal close removes the temporary image file. Forced process termination can leave a temporary file in the OS temp directory.
- Numerical-library threads are limited to one before loading the app's numeric stack; grid FFTs use one internal worker. Direct diffraction offers remembered Smoothing threads Auto / 1 / 2 / 4 / 8 (Auto: two; capped by CPU count), retaining the original calculations and order. Thread changes preserve the detector cache. The original diffraction detector view now shows the outer fitting-limit boundary using the current beam centre and separate X/Y calibration. Added 30 October 2026: central exclusion and outer fitting limit move together into the active FFT or Direct diffraction settings panel. Single-region matching and the auto-strength search within each region remain sequential.
- Exports retain execution worker count and elapsed seconds separately from scientific settings. Reweighting uses the same cached fit pool as before. No changes to fitting, scoring, thresholds or the adaptive decision criteria are intended.
- Validation: 104 tests passed, including actual spawn equivalence and cached reweighting, serial/threaded detector equivalence, adaptive child decisions, cancellation and injected worker errors. Browser checks covered worker preference persistence, progress, cancellation and manual analysis during a grid. Terminating the isolated test backend left no analysis workers. Windows uses spawn and a windowless interpreter when available; native Windows runtime testing is still pending.
- Benchmarks on an 11-core Apple M3 Pro: 100-cell ST1203 grid with automatic strength and HCP overall/c/a fitting was about 3× faster with four workers; adaptive testing returned identical regions and classifications. Direct diffraction 1096 improved from about 12.2 to 8.9 seconds with two smoothing threads. See [benchmark details](parallel-performance.md) and `tools/benchmark_parallel.py` for reproduction and limits.

Remaining: native Windows smoke test; broader memory/load measurements on smaller computers; reuse this pool in future batch grids without nested per-image pools. Batch grids and the weaker-second-pattern objective remain separate tasks, not implemented here. Architecture diagrams were intentionally not refreshed.

## Overlapping window phase candidate map

Build this as a separate mapping mode alongside the existing uniform and adaptive grids. The first result should be a spatial map of HCP/BCC/FCC evidence, with ambiguity retained, rather than an estimate of phase percentage.

1. **Sample overlapping windows.** Start with an adjustable window near 5 nm and spacing near 2 nm. Offer square or hexagonal arrangements of window centres; the FFT crop can remain square in either case. Handle image edges explicitly and record the actual analysed footprint. Overlap makes the display denser; it does not create independent measurements or improve the resolution set by the window.
2. **Retain all structure fits at every centre.** Store coordinates, window dimensions, FFT/peak settings, best HCP, BCC and FCC candidates, zone axes, rank components, peak coverage, acceptance reasons and shared-evidence ambiguity. Include unresolved and insufficient-evidence windows. Do not preselect beta-like regions or discard windows simply because no candidate passes.
3. **Show raw results before aggregation.** Display each sample centre and its footprint, with the same crop/FFT inspection card. Add separate views for HCP, BCC and FCC evidence, pairwise differences, and evidence quality/ambiguity. Keep numerical scores labelled as heuristic evidence rather than probabilities.
4. **Add optional spatial averaging.** Average a score difference over neighbouring overlapping windows using documented distance and evidence-quality weights. Also expose contributions, usable coverage and disagreement. Treat unresolved/insufficient results explicitly; do not fill them silently or force a winning phase. Overlapping windows are correlated, so their count is not an independent sample size. Shared HCP/BCC/FCC spot assignments and overlap through specimen depth remain unresolved by averaging.
5. **Compare and export.** Trial the mode on the demo images, comparing 5 nm windows with 8–10 nm windows, different spacings and square/hexagonal centres. Check known boundaries and sensitivity to thresholds, scaling penalties and missing-peak weights. Export raw per-window fits, aggregation settings and the resulting maps so smoothing is reproducible and can be removed.

Candidate-labelled image area can be reported with unresolved area beside it. Converting it into physical alpha/beta fractions would require separate validation, including orientation/contrast bias and through-thickness overlap; FFT intensity or rank ratios alone do not establish volume fraction.

[Related work by Jany et al. on local FFT analysis of HRTEM images](https://arxiv.org/abs/1907.10929) is a starting point for methodological review, not validation of this app’s classifier or of phase-fraction estimates.

Parallel grid execution is implemented separately above and can support this future mapping mode.

## Platform delivery

30 October 2026: added Windows double-click installer and launcher, private `.venv\Scripts\python.exe`, installed-Python discovery, and a desktop shortcut. A native Tk control window provides Start/Stop, Open Workbench and View log without a terminal; closing it stops its own server. Uses the existing browser interface and Windows directory junctions for data/output. Python 3.10–3.14 supported, 3.12 preferred; no automatic Python download. Runtime regression checks run on macOS; actual Windows installation and DM4/grid/export smoke testing remain to be confirmed on a Windows computer. This packaging work does not change the analysis roadmap order.

## Display updates

30 October 2026: added Bounce + rotate marker motion (−45° to +45°, largest at 0°; 2.4-second rotation cycle with the original 1.2-second bounce timing), preserving phase timing offsets, reduced-motion preferences and GIF export support.

30 October 2026: phase-colour dropdown options use neutral text to avoid inheriting the selected phase colour in Windows native menus.

30 October 2026: peak-evidence weight preserves in-progress decimal input; both ranking-weight number fields accept arbitrary decimal steps within 0–0.5.

30 October 2026: both ranking-weight sliders use 0.01 increments and show two decimal places when adjusted; manual decimal entry remains uninterrupted.

30 October 2026: Windows launcher readiness accepts Windows CRLF logs. The window, taskbar and installed shortcut use an ICO generated from the existing macOS icon artwork.

30 October 2026: renamed template construction constants to `TEMPLATE_BASE_A` and documented their distinction from material presets. Values and matching behaviour are unchanged.

## Maintaining this plan

Update this document when a task's scope, priority, decisions or implementation status changes. Keep proposals distinct from agreed behaviour and mark work complete only after implementation and relevant verification. Add the completion date and commit reference when closing a task; keep a short completed-work record as tasks leave the active list.

The README links here instead of maintaining a second plan. Update the [architecture and methods documentation](architecture/README.md) when implemented numerical or execution changes affect it. This plan is a roadmap, not a description of features already available.

30 October 2026: corrected GIF export limits for the full 72-frame Bounce + rotate cycle at 30 fps and 2800-pixel width. Older running servers are detected before rendering frames and prompt a restart.

## Approximate acquisition map — implemented 30 October 2026

The file toolbar opens a stage-metadata map for the current labelled sample. It defaults to the current folder and acquisition date; users can expand to the whole sample, change date and select an overview. The largest calibrated real-space field on that date is the initial backdrop, including overview images in sibling folders. Click a calibrated location or list entry to use it as the next reference; Back restores each previous reference and view. Open for analysis remains a separate action. A visible folder selector switches folders within the labelled sample; pan, zoom, and fit all locations or the overview extent.

Only DM4 metadata is read for indexing; cached entries invalidate on file size/mtime changes. Overview previews are loaded on demand without analysis or changing the loaded source. Switchable hover comparisons show the full acquired image beside a crop of original reference pixels at the predicted footprint, with bounded preview caching and black padding outside the reference. The reference itself never opens a comparison card. Calibrated real-space images have physical footprints; diffraction/uncalibrated images have location points only. Missing positions and read failures are reported. Raw stage X/Y/tilts are also retained in newly exported source metadata.

This is a schematic location aid, not registration: stage units are undeclared in these files (µm is a visible, adjustable assumption), and stage-to-image rotation/flips are manual display controls. Stage rounding, drift, image shifts and tilt are not corrected. Footprint dots and acquisition labels sit at the top-right corner to leave image centres clear. Coincident positions remain available in the list. ST/STA folder labels are retained as recorded; suspected sample swaps are not resolved by this feature. No automatic image alignment, batch-grid work or parallel execution is included.

Follow-up: Hitachi-specific placement calibration remains deferred at the user’s request. The user observed approximately −90° stage-to-image rotation for the current acquisition set; rotation remains an adjustable map control, not a universal camera calibration.

Acquisition-map stage rotation is remembered per reference image and data folder in browser storage, including across reloads and app restarts in the same browser/address. Changing reference or navigating Back restores that reference’s angle; an unset reference starts at 0°.

Manual placement — implemented 30 October 2026: **Adjust placements** enables footprint dragging with an image selector for overlapping acquisitions. Each reference–image pair remembers its manually chosen centre in reference-image coordinates, scoped to the data folder and browser. These positions override the stage estimate at that level without changing original metadata or image pixels; **Reset placement** removes the override. During a drag the comparison card stays visible and crops the cached reference preview immediately; release saves the centre and requests the original-pixel crop. Cancelled drags restore the previous placement. Zoom-out is bounded to twice the fitted view width, with All locations available for deliberate reframing. Hitachi-specific automatic calibration remains deferred.
