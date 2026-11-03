# TEM Workbench
## Interpretable crystallographic candidate mapping from local Fourier transforms and electron diffraction

Methods manuscript draft · 4 November 2026

### Abstract

TEM Workbench combines calibrated image handling, local Fourier analysis, direct diffraction spot analysis and finite crystal-template searches in an inspectable screening workflow. Observed peak profiles are assigned one-to-one to predicted reciprocal nodes. Candidate ranks combine positional agreement, a chance-match allowance, adjustable lattice-scale preferences and weak-peak and unsupported-prediction terms. HCP fitting can distinguish overall reciprocal scale from changes in c/a. Uniform, adaptive and overlapping-window searches expose local variation; shifted sampling passes quantify sensitivity to window placement. Measured evidence, rejected alternatives and processing settings remain available for inspection and export. Existing regression checks and historical parallel-execution measurements establish selected implementation properties, not phase-identification accuracy. The resulting maps describe candidate support rather than validated phase fractions. Independent microscopy validation and comparisons with established indexing and local-spectrum decomposition methods are needed before quantitative materials conclusions.

Keywords: transmission electron microscopy; local Fourier transform; diffraction indexing; crystallographic screening; overlapping windows; phase mapping.

### 1  Introduction and relationship to prior work

Local changes in lattice periodicity can reveal microstructural heterogeneity, but a reciprocal-space pattern is not a unique chemical label. Missing reflections, limited bandwidth, superposed crystals and uncertain calibration can allow several structures to explain similar observations. The workflow therefore retains alternative fits and their supporting measurements.

Automatic electron-diffraction indexing is established. CrysTBox provides automated zone-axis determination and reflection indexing for electron microscopy, including tools linking diffraction analysis and crystallographic visualization [1]. Local Fourier mapping also predates this work: Jany, Janas and Krok applied moving-window Fourier transforms, PCA-based component selection and non-negative matrix factorization (NMF) to obtain spatial loadings and corresponding spectral factors [2]. Zhang and colleagues subsequently combined local spectral decomposition with learned phase recognition in HRTEM images [3]. These works are direct precedents for image-based spatial analysis.

For scanned diffraction, py4DSTEM implements automated orientation mapping through sparse correlation matching [4], while pyxem provides multicore and GPU-accelerated template matching within reproducible 4D-STEM workflows [5]. TEM Workbench does not claim to introduce automatic indexing, local Fourier maps, multiple-pattern analysis or parallel template matching. Its contribution to be evaluated is their integration into a transparent, locally operated screening workflow for individual images and conventional diffraction records, emphasizing explicit score decomposition, editable evidence and placement-sensitive spatial summaries.

The following sections separate implemented methods from proposed shared-spectrum analysis. The development examples establish neither comparative superiority nor confirmed phase identities.

<!-- pagebreak -->
### 2  Workflow and measurement model

The application has a browser interface, a local Python service and a numerical analysis engine. Image calibration determines the signal path. Real-space images are analysed through Fourier transforms of selected regions; diffraction images are analysed directly in recorded detector coordinates. DM4 metadata provide calibration when available. Imported raster images require an explicit scale-bar calibration and image type. Display rescaling, colours and animated marker styles are independent of the fitting inputs.

<!-- workflow-figure -->

Figure 1. Implemented analysis workflow. Both signal paths produce observed reciprocal profiles for a common candidate matcher. The geometry-only check operates alongside crystal matching. Spatial aggregation follows independent window analysis; it does not currently share spectra or detected peaks between windows. A separate eight-panel architecture atlas expands the numerical and software boundaries.

A measured profile is represented by its reciprocal vector oᵢ, a bounded evidence weight wᵢ and additional descriptors such as radius and intensity. The convention is cycles per nanometre, without a 2π factor. Thus gᵢ = |oᵢ| and the corresponding spacing is dᵢ = 1/gᵢ. Opposite observations are grouped into one independent profile. In direct diffraction, only observed detector spots are marked; a visible partner does not create a measured spot behind a beam stop.

Candidate models contain a structure family, a zone template, in-plane rotation, metric parameters, predicted nodes and an assignment to observed profiles. Their ranks are heuristic ordering statistics. The terms “compatible”, “ambiguous” and “two candidate structures” summarize evidence under the enabled model library, rather than certify phase identity.

Named regions and grid exports retain numerical results, source references, calibration, settings and implementation provenance. Reanalysis requires the source pixels. PNG/GIF presentations complement the JSON records but cannot substitute for them. The methods described here were checked against implementation revision 64118d8; the documentation date is not a new experimental acquisition date.

<!-- pagebreak -->
### 3  Signal extraction

#### 3.1  Local Fourier transforms

Let I[m,n] denote an Nₓ × Nᵧ image crop with pixel spacings sₓ and sᵧ. The default path subtracts its mean and applies a separable Hann taper before transformation:

> (1)  F = FFT₂{(I − Ī) HₓHᵧ};   L = ln(1 + |F|²).

Mean removal and tapering are independently selectable. Windowing trades spectral leakage against reciprocal-space resolution; it does not recover information absent from the crop [6]. Fourier samples are separated by Δgₓ = 1/(Nₓsₓ) and Δgᵧ = 1/(Nᵧsᵧ). The detector uses Δg = max(Δgₓ, Δgᵧ) for its scalar width conventions. A radial mean of L is subtracted and the residual is smoothed:

> (2)  D(q) = Gσ ∗ [L(q) − meanradial L(|q|)].

Here σ is specified in FFT bins. The analysis band excludes the central region and reciprocal radii above the selected outer limit. Within that band, the initial component cutoff is

> (3)  T = max(Tfloor, f maxband D).

Each connected region with D > T contributes its maximum if it also exceeds the minimum-strength setting. A local parabolic estimate refines the position by at most half a bin along each axis. Strongest-first separation suppresses neighbouring fragments, including neighbours across the canonical half-plane boundary. The effective separation is at least the estimated window-response width: 1.44Δg for Hann and 0.886Δg for a rectangular crop. The profile cap is finite, normally 70.

The FFT evidence weight is clip(Dᵢ − 2, 1, 6). It represents capped radial-background enrichment rather than a physical scattered-intensity fraction. Profile radius is estimated from the thresholded component area; raw power at the peak is retained separately. The processed display exposes D, while the raw FFT view retains the unsmoothed power-derived display. Brightness changes do not alter peak selection.

#### 3.2  Direct diffraction

For detector centre (cₓ,cᵧ) and reciprocal calibration sₓ,sᵧ,

> (4)  qₓ = (x − cₓ)sₓ;   qᵧ = (cᵧ − y)sᵧ.

Masked differences of Gaussian-smoothed detector images are evaluated at multiple spot widths. Candidates must exhibit sufficient contrast in both the filtered response and the recorded intensity relative to local background variation. Localization, deduplication and opposite-spot grouping then form profiles. The direct-mode weight is clip[ln(1 + local contrast), 1, 6]. These weights have a different construction from FFT enrichment, so numerical ranks from the two modes should not be treated as calibrated equivalents.

A bounded robust fit to opposite-spot midpoints may refine a shared centre before comparing structures. If competing centres remain plausible, the starting estimate is retained. Manual additions, removals and masks are recorded; added observations bypass the automatic contrast threshold and therefore require inspection. Neither beam-stop interpolation nor a virtual opposite spot supplies independent measured evidence. The current matching tolerance is τ = max(0.10 nm⁻¹, estimated profile width), distinct from peak separation and manual editing radii.

<!-- pagebreak -->
### 4  Crystal hypotheses and fitting

#### 4.1  Reciprocal grids

The search uses a finite library of zone axes for HCP, BCC, FCC and generic primitive orthorhombic geometry. The reciprocal construction uses integer plane indices, an editable reference cell and the zone law. For cubic cells, q = (h,k,l)/a. In the internal HCP three-index coordinates,

> (5)  q = ((2h + k)/(√3 a), k/a, l/c);   hu + kv + lw = 0.

Vectors satisfying the zone law are projected into a two-dimensional basis of the zone plane. HCP zone labels are converted to Miller–Bravais notation for display. BCC predictions require h+k+l to be even; FCC requires h,k,l to have the same parity. The ideal HCP basis excludes odd-l reflections for which h−k is divisible by three. Primitive orthorhombic predictions use q = (h/a,k/b,l/c) without a material-specific atomic basis or additional extinction rules.

These filters specify allowed positions, not their intensity. Generic orthorhombic fitting is particularly flexible and should be interpreted as a geometric explanation. Several zone/cell combinations can produce the same projection. An axis absent from the observations remains unmeasured, even if the software retains a reference value internally.

#### 4.2  Rotation and metric parameters

A candidate is rotated in-plane and fitted using fixed scale, a common automatic reciprocal scale, independent HCP basal/axial scales, or an overall-scale-plus-c/a parameterization. Independent orthorhombic metric dimensions can be fitted where observable. The ordinary reciprocal multiplier bounds are 0.85–1.15; the Unknown-material search widens these to 0.5–2.0 and removes the overall-scale cost. Search bounds remain active even when their penalty is zero.

For HCP reciprocal multipliers sₐ and s_c,

> (6)  a = a₀/sₐ;   c = c₀/s_c;   s = √(sₐs_c);   r = sₐ/s_c.

Thus r = (c/a)/(c₀/a₀). The projected metric is recomputed under anisotropic changes rather than stretching arbitrary display axes. The scalar s is a geometric mean of two fitted reciprocal parameters; it is not a volume-weighted strain measure. When a zone contains no information about c, the ratio term is omitted and c/a is reported as unconstrained.

Seeds are generated from a bounded subset of observed profiles and refined through weighted positional fitting and reassignment. Supplementary seeds allow up to two additional orientations with distinct support, using an angular separation greater than 2° and support Jaccard overlap no greater than 80% relative to retained seeds. These are search-budget heuristics, not instrument angular-resolution limits. The finite zones, seed budgets and local optimizer can miss a better explanation.

#### 4.3  Assignment

For observation oᵢ and prediction pⱼ, the Friedel-equivalent distance is dᵢⱼ = min(|oᵢ−pⱼ|, |oᵢ+pⱼ|). A Gaussian quality is truncated at τ:

> (7)  Qᵢⱼ = exp[−½(dᵢⱼ/(τ/2))²] for dᵢⱼ ≤ τ; otherwise 0.

The assignment maximizes ΣwᵢQᵢⱼ with at most one use of each observation and prediction. Dummy slots permit unmatched observations. This is a rectangular linear assignment problem, solved using SciPy’s modified Jonker–Volgenant implementation [7,8]. Predicted positions are recomputed for each fitted metric and restricted to the selected band.

<!-- pagebreak -->
### 5  Scoring and acceptance

Let W = Σᵢwᵢ over all admitted profiles and let A denote assigned observation–prediction pairs. Weighted peak coverage C and position-weighted coverage U are

> (8)  C = ΣA wᵢ / W;   U = ΣA wᵢQᵢⱼ / W.

A density allowance estimates accidental angular support conditional on observed radii. With gᵢ = |oᵢ| and ĝⱼ = |pⱼ|,

> (9)  bᵢ = min{1, Σⱼ 1[|gᵢ−ĝⱼ|<τ] (2/π) asin[min(τ/max(gᵢ,0.1),1)]}.

The position score is P = U − Σwᵢbᵢ/W. The numeric 0.1 has reciprocal-distance units. This allowance discourages dense templates; it is not a calibrated null-hypothesis probability. The displayed RMS is √meanA(dᵢⱼ²), without evidence weighting.

In overall-scale-plus-c/a mode, the scale cost is

> (10)  S = λ[ln(s)/ln(1.05)]² + μ[ln(r)/ln(1.05)]².

A multiplicative 5% change or its reciprocal contributes the corresponding weight. Cubic and c-insensitive HCP fits omit the ratio term. Legacy independent-axis fitting instead uses a mean squared fractional axis deviation normalized to 5%. Penalties rank the explored positional fits after refinement; the coordinates are not jointly optimized against the final penalized rank. Fitted metric shifts can reflect calibration, composition, imaging effects or model mismatch as well as physical lattice variation.

Weak evidence is inspected at unmatched predicted positions with sufficient visibility and separation. A separate local-maxima assignment produces a bounded quality contribution. Its normalized support is compared with eleven rotated control patterns; only positive excess contributes the weak bonus B. Weak detections do not count as strong profiles for acceptance. Predictions outside the assessable region are neither unsupported nor affirmative evidence.

For unsupported assessable positions, the optional radial cost is

> (11)  M = Σunsupported 2^[−(gⱼ/r½)²] / Nassessable;   R = P − S + ηB − ηM.

Setting r½ to zero selects uniform missing-prediction weights. The falloff discourages absent inner predictions more strongly than outer ones, but does not model the microscope contrast-transfer function. It does not change the measured-profile term or weak bonus.

A candidate must match at least four independent strong profiles, have nonparallel spread max|sin(θᵢ−θⱼ)| > 0.5, coverage C > 0.30, position score P > 0.20 and final rank R > 0.20. The four-profile rule means that an apparently clean three-profile pattern can remain below screen. These thresholds are explicit implementation choices rather than experimentally calibrated phase-certainty levels.

The whole-set denominator is consequential: a fit explaining all of one pattern but none of another loses coverage. Adding a second physical component does not automatically produce a second accepted crystal fit. Similarly, unsupported allowed reflections can arise from imaging conditions; they are not demonstrated systematic absences. The interface therefore exposes each score term, the acceptance reasons and rejected alternatives.

<!-- pagebreak -->
### 6  Pattern multiplicity and automatic peak strength

#### 6.1  Competing phases versus additional patterns

The highest-ranked accepted crystal model is the primary interpretation. An accepted secondary must contribute at least three profiles not assigned to the primary, directional spread greater than 0.5 and more than 15% of the total observed weight. A different structure family gives “two candidate structures”; the same family gives “multiple orientations”. Two passing fits that explain the same peaks are alternatives, not two-pattern evidence.

A close, substantially overlapping rival of another phase can instead yield “ambiguous”. An additional model-economy check preserves ambiguity when accepted alternatives match exactly the same profile identities but the leading fit uses more scale parameters or more unsupported predictions. This avoids automatically deciding a shared-evidence tradeoff through rank alone. The classifier provides a primary/secondary interpretation, not a general many-crystal mixture decomposition.

#### 6.2  Geometry-only diagnostic

A separate search fits two free reciprocal basis vectors and their integer combinations. It evaluates positional support, density and coupled combination nodes, without a phase identity or reflection basis. A secondary grid requires additional independent evidence rather than a duplicate basis explaining the same observations. Its acceptance criteria differ from the crystal screen. Consequently, “second geometry” and “second identified phase” need not agree.

Crystal matching is not performed only on peaks assigned to a particular geometry grid. Both searches inspect the detected set. Geometry supplies a periodicity diagnostic, adaptive-refinement cues and one automatic-threshold objective. This separation avoids making a potentially incorrect free-grid decomposition a mandatory phase-indexing partition, but leaves whole-set competition between weak and strong components unresolved.

#### 6.3  Two automatic objectives

Automatic minimum strength begins with the pool admitted by the other detector settings and evaluates distinct strength cutoffs. It cannot recover a feature already excluded by the initial relative cutoff, spatial separation or fitting band. In dominant-rank mode, crystal matching is repeated for every threshold subset; selection prioritizes a passing result, then top candidate rank and retained profile count. Because W changes with the subset, excluding genuine weak-component peaks can increase the winning rank. The mode is useful for the dominant pattern but is not a joint phase-separation objective.

Geometry-auto evaluates free-grid fits before a single final crystal search. Its objective uses the total admitted-pool weight W₀. Shared profiles contribute once, at their best geometric quality; chance allowances and a 0.03 cost per included grid are subtracted:

> (12)  J = Σᵢ wᵢ maxₖ Qᵢₖ / W₀ − Dgrids − 0.03 K.

Only screened grids enter this expression, and a secondary is included only when it improves the objective. The fixed denominator reduces the reward for simply discarding difficult profiles. It does not establish that the remaining components are distinct phases, nor guarantee recovery of a weak second orientation.

A joint crystal objective that assigns evidence among multiple candidates while charging for added complexity remains future work. Summing two independently computed ranks is insufficient because they can count the same profiles twice. Any replacement objective should be assessed on single-pattern, known-mixture and noise controls before tuning it to attractive material maps.

<!-- pagebreak -->
### 7  Spatial sampling and overlap aggregation

Uniform grids analyse a tessellation. Adaptive grids subdivide eligible regions subject to a minimum width. An optional passing-parent check evaluates four children and retains a split when there is a changed phase/zone, a separate pattern or a mixture of passing and unresolved children. If all children merely lose evidence, the parent is retained. Only current leaves enter map-area summaries.

Overlapping mode instead uses fixed physical square windows at square or hexagonal centres. For centre spacing D, the hexagonal centre lattice has basis vectors (D,0) and (D/2,√3D/2). Shifted passes use fractional translations of those vectors. Full windows are rounded to source pixels and centred collectively to balance the outer margins. Additional passes increase sampling density but do not create independent measurements. Every window is processed and matched independently; FFT arrays are not averaged before fitting.

At display position x, window i contributes a compact spatial weight

> (13)  aᵢ(x) = exp{−8[(Δx/Wᵢ)² + (Δy/Hᵢ)²]} inside its footprint; otherwise 0.

For phase p and placement pass k, the weighted passing frequency is

> (14)  fₚₖ(x) = Σᵢ∈k aᵢ(x) 1[p passes in window i] / Σᵢ∈k aᵢ(x).

The displayed Fₚ(x) is the equal-weight mean of fₚₖ over passes covering x. A missing fit contributes no passing support. Placement disagreement is the range across contributing passes:

> (15)  Δₚ(x) = maxₖ fₚₖ(x) − minₖ fₚₖ(x).

It is reported as zero with fewer than two contributing passes, which means that a range cannot be estimated, not that stability has been demonstrated. Rank is averaged separately only where a phase candidate exists, selecting the best passing fit or otherwise the best rejected fit within each window. Candidate presence is therefore reported alongside rank and passing frequency.

Raster and hexagonal displays evaluate the same aggregated readings at different output locations. A hexagonal display cell is not a hexagonal FFT aperture. Its spacing follows the centre spacing, with a display-size cap; neither a dense display nor repeated shifts improve the physical bandwidth of the original square windows. Near image boundaries there are fewer contributing windows and passes.

Independent phase supports need not sum to one. Blended colours can indicate that different overlapping windows support different phases, even when no single window contains two separately supported structures. A separate map field counts windows explicitly classified as two candidate structures. These displays must not be read interchangeably.

A preliminary window-size check compares several image-relative widths at paired sites. It offers localization versus reciprocal-resolution choices and can prefer a smaller size when additional geometry is resolved. Fixed-bin and fixed-reciprocal-width smoothing are distinct settings. This advisory check is not a validated optimum, and automatic smoothing optimization is not part of the implemented procedure.

<!-- pagebreak -->
### 8  Implementation checks and computational performance

Whole-window analysis is parallelized using spawned Python processes and read-only memory-mapped source pixels. Numeric-library and internal FFT thread counts are limited within workers. Adaptive publication preserves the parent until all trial children are available. Direct diffraction can parallelize independent smoothing scales using threads; its crystal fitting remains sequential within a request. Interactive browser requests discard stale results when the selected image changes, although an obsolete server calculation may still finish in the background.

Historical measurements on 30 October 2026 used an Apple M3 Pro with 11 logical CPUs and 18 GiB RAM, Python 3.12.2, NumPy 2.5.4 and SciPy 1.18.1. ST1203 was analysed with HCP/BCC enabled and automatic minimum strength [9]. The measurements include worker startup, source mapping, analysis and shutdown, but exclude image loading.

| Workload | 1 worker | 2 workers | 4 workers | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Uniform, 100 regions | 118.30 s | 67.38 s | 38.07 s | 3.11× |
| Adaptive, 80 analysed / 61 leaves | 103.93 s | 60.56 s | 33.17 s | 3.13× |

Table 1. Previously recorded local timings, not a new benchmark of the present revision. Numerical fingerprints agreed across worker counts after excluding timing and designated metadata. These observations do not establish identical arithmetic across platforms or throughput on other images. The original settings and fingerprints are retained in the repository [9].

A later implementation review recorded synthetic two-orientation tests, cache-consistency tests, a small noise control and 24 real-image regression cases spanning four images, two crop widths and three strength modes [10]. The orientation tests verify that a weaker same-phase orientation reaches refinement; they do not require that every such fit passes. Three Gaussian-noise seeds across the three modes produced no passing fits, which is too small a sample to estimate false-positive rates reliably.

| Image identifier | Crop width | Manual | Geometry-auto | Rank-auto |
| --- | --- | --- | --- | --- |
| ST1221 | 6 nm | Insufficient | HCP | HCP |
| ST1203 | 6 nm | BCC | BCC | BCC |
| ST1203 | 20 nm | Unresolved | Unresolved | Unresolved |
| Ti0274 | 20 nm | Unresolved | BCC | BCC |
| ST1156 | 6 and 20 nm | HCP | HCP | HCP |

Table 2. Selected outputs from the recorded 3 November regression set [10]. Labels are software outputs, not independent truth. The full set and crop recipe are in the review record. These examples show mode and size dependence and motivate controlled validation; they are not evidence that a particular mode is more accurate.

No experimental phase fraction is reported here. Repeated acquisitions of the same particle, neighbouring windows and overlapping passes are correlated. A materials comparison should group repeated fields of view before uncertainty estimation. Source labels must also be checked independently where specimen identity is uncertain.

<!-- pagebreak -->
### 9  Discussion and proposed shared-spectrum analysis

The present workflow supports scrutiny of a candidate explanation: the user can inspect which original profiles are matched, how much score is lost to metric changes or unsupported predictions, and whether a second structure contributes distinct evidence. This is useful where a high rank might otherwise be mistaken for identification. The scientific value of these design choices requires measurement through reproducibility, error analysis and expert-reviewed examples, rather than novelty being inferred from the availability of a graphical interface.

The largest current limitation is that neighbouring windows share no information during peak detection or template fitting. Post-fit averaging can reduce placement sensitivity, but it cannot recover a reciprocal feature that repeatedly falls below the local detector cutoff. It may also smooth a consistently wrong assignment. Generic orthorhombic geometry and independently adjustable HCP metrics increase model flexibility, while the candidate library is finite and uneven. A calibrated model-complexity correction and better detection uncertainty remain open problems.

#### 9.1  Proposed PCA and NMF extension

Following the local-spectrum approach of Jany and colleagues [2], a future branch could place nonnegative spectra on a common reciprocal grid and form X, with windows as rows and reciprocal pixels as columns. PCA would assist selection of a component count; NMF would estimate nonnegative spatial loadings A and spectral factors B:

> (16)  X ≈ AB,   A ≥ 0, B ≥ 0;   minimize ||X − AB||²F.

The proposed Workbench addition is to inspect and index those factors using the existing matcher, then compare their maps with the independent-window results. This could stabilize weak recurring signals, but is a hypothesis rather than a demonstrated performance gain. Component count, background treatment, intensity normalization and initialization must be exposed and tested. The signed background-subtracted detector field cannot simply be supplied to NMF without choosing a defensible nonnegative representation.

A component can describe orientation, contrast or thickness variation instead of a distinct phase; a rare phase can be omitted by a variance-driven component count. Mixtures in HRTEM power spectra need not behave as a simple linear sum of ideal phase spectra. Factor loadings would therefore remain signal contributions, not physical phase fractions. This proposal is not implemented in the present architecture.

#### 9.2  Validation needed for a phase-mapping claim

A validation study should separate algorithm tuning from final evaluation. Useful controls include single crystals over a range of crop sizes, independently established phase boundaries, two orientations of one phase, known overlapping phases and noncrystalline backgrounds. Repeated zooms of one feature should be kept in the same evaluation group. An independently characterized A/B/A field provides a boundary-localization test, but the identity and provenance of each region must be documented rather than inferred from this tool’s colours.

Required comparisons include manual versus both automatic objectives; scale models and penalties; smoothing and window size; one versus several placement passes; and independent matching versus shared-spectrum decomposition. Report phase/zone accuracy against independent indexing, false-positive rates, weak-component recovery, boundary localization, rejection frequency, runtime and sensitivity to calibration. Confidence intervals should resample independent images or specimen regions, not thousands of overlapping windows as if they were independent acquisitions.

<!-- pagebreak -->
### 10  Conclusions

TEM Workbench combines conventional crystallographic pattern generation and assignment with explicit score inspection, optional metric preferences, geometry-only diagnostics and spatial sampling. Its overlapping maps quantify the frequency and placement sensitivity of passing candidate fits. They do not establish chemical phase identity or phase fraction. Existing regression records support selected implementation and reproducibility properties, while independent accuracy validation remains the central requirement for a scientific phase-mapping claim.

Shared-spectrum decomposition is a promising next comparison because it would use repeated image-wide evidence before indexing. Its lineage should be attributed to established local-FFT/PCA/NMF workflows, while any additional benefit from linking spectral factors to explicit crystal hypotheses must be demonstrated experimentally.

### Code and data availability

The implementation, maintained plan, numerical-method atlas and reproducible documentation sources are available in the TEM Workbench repository: https://github.com/pKai3/tem-workbench. The manuscript describes revision 64118d8. Benchmark and regression records cited below are versioned with the repository. Raw experimental images are not reproduced in this draft. A submission should identify the released evaluation datasets, acquisition conditions and access permissions, including any third-party images.

### References

[1] Klinger M, Jäger A. Crystallographic Tool Box (CrysTBox): automated tools for transmission electron microscopists and crystallographers. Journal of Applied Crystallography 48 (2015), 2012–2018. https://doi.org/10.1107/S1600576715017252

[2] Jany BR, Janas A, Krok F. Automatic microscopic image analysis by moving window local Fourier Transform and Machine Learning. Micron 130 (2020), 102800. https://doi.org/10.1016/j.micron.2019.102800. Open manuscript: https://arxiv.org/abs/1907.10929

[3] Zhang Q, Yang L, Bai R, Peng B, Liu Y, Duan C, Zhang C. Phase division and recognition of crystal HRTEM images based on machine learning and deep learning. Micron 184 (2024), 103665. https://doi.org/10.1016/j.micron.2024.103665

[4] Ophus C, Zeltmann SE, Bruefach A, Rakowski A, Savitzky BH, Minor AM, Scott MC. Automated Crystal Orientation Mapping in py4DSTEM using Sparse Correlation Matching. Microscopy and Microanalysis 28 (2022). https://doi.org/10.1017/S1431927622000101. Open manuscript: https://arxiv.org/abs/2111.00171

[5] Cautaerts N, Crout P, Ånes HW, Prestat E, Jeong J, Dehm G, Liebscher CH. Free, flexible and fast: orientation mapping using the multi-core and GPU-accelerated template matching capabilities in the python-based open source 4D-STEM analysis toolbox Pyxem. Ultramicroscopy (2022), 113517. https://doi.org/10.1016/j.ultramic.2022.113517. Open manuscript: https://arxiv.org/abs/2111.07347

[6] Harris FJ. On the use of windows for harmonic analysis with the discrete Fourier transform. Proceedings of the IEEE 66 (1978), 51–83. https://doi.org/10.1109/PROC.1978.10837

[7] Crouse DF. On implementing 2D rectangular assignment algorithms. IEEE Transactions on Aerospace and Electronic Systems 52 (2016), 1679–1696. https://doi.org/10.1109/TAES.2016.140952

[8] SciPy developers. scipy.optimize.linear_sum_assignment. SciPy reference documentation, accessed 4 November 2026. https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.linear_sum_assignment.html

[9] TEM Workbench development record. Parallel analysis: initial measurements, 30 October 2026; accompanying machine-readable benchmark record. https://github.com/pKai3/tem-workbench/blob/64118d8/docs/parallel-performance.md

[10] TEM Workbench development record. Claude review: implementation response, 3 November 2026. Regression recipe, outputs and limitations. https://github.com/pKai3/tem-workbench/blob/64118d8/docs/reviews/2026-11-03-follow-up.md
