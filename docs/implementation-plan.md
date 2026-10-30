# TEM Workbench implementation plan

Last updated: 30 October 2026

This is the maintained plan for upcoming analysis and performance work. The next three analysis tasks have an agreed order. Parallel grid execution is also under consideration because automatic parameter searches are making grid analysis increasingly expensive; its position relative to those tasks has not yet been decided.

## Next tasks in agreed order

| Order | Task | Status |
| --- | --- | --- |
| 1 | Revise fully free HCP fitting | Design discussion pending |
| 2 | Revise automatic minimum peak strength selection to retain weaker separate patterns | Design discussion pending |
| 3 | Batch grid analysis across qualifying images, with per-image and ST/STA summaries | Planned after the fitting and peak-selection changes |

### 1 HCP fitting

Revisit the current independent HCP a/c scaling. The proposed approach separates a common overall scale from a change in c/a:

- Overall scale accommodates a shared size or calibration discrepancy.
- c/a adjustment has a tighter material-specific range and a stronger penalty for changing the pattern proportions.

Decide the parameterization, material-specific bounds, penalties and user controls before implementation. No numerical bounds or penalty strengths are agreed yet. Preserve the distinction between reciprocal prediction scaling, real-space lattice dimensions and calibration error.

Compare the revised fitting with the current single-scale and independent-a/c modes on ambiguous HCP/BCC examples and the stronger ST1203 BCC candidate. Report positional agreement, scale costs and phase/zone stability so a more flexible model does not win simply by changing its proportions excessively.

### 2 Automatic minimum peak strength

The current strongest-candidate objective can raise the detection threshold until weaker BCC evidence disappears, leaving a strong HCP result. Keep that behaviour available for deliberately selecting the dominant pattern, and design an alternative that searches lower thresholds for a separately supported second pattern.

The second pattern may be another orientation of the same phase. Two candidates explaining the same measured profiles are competing interpretations, not evidence of two patterns. The new objective must distinguish those cases and account for shared and independently explained profiles.

Open decisions:

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

Status: requested for planning and estimation; implementation has not started. Whether to move this ahead of tasks 1–3 remains open. It can be developed independently of the fitting changes and reused by batch grids.

The current grid has one background worker processing regions sequentially under the shared engine lock. FFT calculation uses two internal workers, but automatic peak-strength selection repeats matching for multiple detected-profile sets. Independent regions are the initial parallelization target.

Proposed sequence:

1. Benchmark representative serial uniform grids with the expensive automatic settings enabled. Record elapsed time, peak memory and manual-region responsiveness.
2. Prototype a bounded worker pool for whole regions. Compare threads with processes if needed; process workers are the initial candidate for Python-heavy matching. Avoid sending the full source image with every task and avoid multiplying internal FFT/BLAS threads across workers.
3. Preserve serial numerical results and deterministic region identity. Keep image/settings snapshots fixed for a job and ensure workers cannot mutate shared engine caches.
4. Extend to adaptive subdivision and passing-parent child checks. Apply each parent decision only after its required children are available; retain correct leaf coverage on cancellation or error.
5. Integrate progress, worker limits, responsive manual inspection, cancellation, shutdown and worker failure handling. Check the macOS Dock launcher and Windows process startup.
6. Measure actual speedup and memory use before choosing defaults. Reuse the pool for batch grids without launching nested pools per image.

No GPT-credit estimate or speedup is established. The earlier hour estimates were rough human-effort estimates, not credit estimates. A uniform-grid benchmark is the first decision point before committing to the broader adaptive implementation.

## Overlapping window phase candidate map

Build this as a separate mapping mode alongside the existing uniform and adaptive grids. The first result should be a spatial map of HCP/BCC/FCC evidence, with ambiguity retained, rather than an estimate of phase percentage.

1. **Sample overlapping windows.** Start with an adjustable window near 5 nm and spacing near 2 nm. Offer square or hexagonal arrangements of window centres; the FFT crop can remain square in either case. Handle image edges explicitly and record the actual analysed footprint. Overlap makes the display denser; it does not create independent measurements or improve the resolution set by the window.
2. **Retain all structure fits at every centre.** Store coordinates, window dimensions, FFT/peak settings, best HCP, BCC and FCC candidates, zone axes, rank components, peak coverage, acceptance reasons and shared-evidence ambiguity. Include unresolved and insufficient-evidence windows. Do not preselect beta-like regions or discard windows simply because no candidate passes.
3. **Show raw results before aggregation.** Display each sample centre and its footprint, with the same crop/FFT inspection card. Add separate views for HCP, BCC and FCC evidence, pairwise differences, and evidence quality/ambiguity. Keep numerical scores labelled as heuristic evidence rather than probabilities.
4. **Add optional spatial averaging.** Average a score difference over neighbouring overlapping windows using documented distance and evidence-quality weights. Also expose contributions, usable coverage and disagreement. Treat unresolved/insufficient results explicitly; do not fill them silently or force a winning phase. Overlapping windows are correlated, so their count is not an independent sample size. Shared HCP/BCC/FCC spot assignments and overlap through specimen depth remain unresolved by averaging.
5. **Compare and export.** Trial the mode on the demo images, comparing 5 nm windows with 8–10 nm windows, different spacings and square/hexagonal centres. Check known boundaries and sensitivity to thresholds, scaling penalties and missing-peak weights. Export raw per-window fits, aggregation settings and the resulting maps so smoothing is reproducible and can be removed.

Candidate-labelled image area can be reported with unresolved area beside it. Converting it into physical alpha/beta fractions would require separate validation, including orientation/contrast bias and through-thickness overlap; FFT intensity or rank ratios alone do not establish volume fraction.

[Related work by Jany et al. on local FFT analysis of HRTEM images](https://arxiv.org/abs/1907.10929) is a starting point for methodological review, not validation of this app’s classifier or of phase-fraction estimates.

Parallel grid execution is tracked separately above and can support this mapping mode when implemented.

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
