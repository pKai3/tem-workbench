# Local FFT PCA / NMF (experimental)

Available on `feature/local-fft-pca`; not included in main v1.0.32. Open a calibrated real-space image, then choose **Local FFT PCA / NMF** beside the automatic-grid window-size check. Restart using this branch to enable its API. The regular grid and crystal matcher are unchanged.

## Using it

1. Choose window width and centre spacing. Defaults are 10% and 5% of the shorter image side. Full square physical windows cover the whole image; the current region/polygon does not restrict the run. Pixel rounding is reported in the result.
2. Choose **NMF** (default, four nonnegative components) or **PCA** (signed components). Begin with zero rotation/spacing smoothing. The run snapshots current material/phase/scale settings, FFT taper, mean removal and inner/outer limits. Detector thresholds and crystal scores do not enter decomposition.
3. Results open in **Top signals** by default. Inspect component maps and spectra. PCA bars show explained variance, and blue/red maps show opposite deviations from the mean. NMF bars show contribution shares after spectral normalization, not explained variance or phase fractions. Click a map location or use arrow keys to inspect its spectrum and reconstruction.
4. Select components to inspect their combined activity and reconstruction. NMF adds nonnegative contributions. PCA adds the mean to the reconstruction; PCA group activity is the square root of the sum of squared scores and discards sign.
5. For gradual lattice drift, compare a new run with modest rotation or spacing smoothing. These are Gaussian standard deviations, not permitted fitting ranges. They broaden peaks before decomposition; they neither register orientations nor force one crystal into one component. Compare against the preserved original sampled spectra.
6. **Run NMF** automatically performs decomposition, fits every nonempty component combination against the captured phase/template library, then builds phase-support maps. Completed stages appear while the next runs. **Fit all combinations** and **Build phase maps** remain available for separate reruns. Adjust **Factor peak cutoff** if needed; this is relative signal height, separate from ordinary FFT detection controls. A progress bar counts completed combinations; Cancel preserves completed groups and the decomposition. Click a result’s component numbers to inspect its spectrum and checks against original windows.
7. **Export data** writes an NPZ containing the numeric arrays and a JSON containing the source identity, calibration, settings, sampling positions, representation and method version. Exports go to the source's configured output folder. Completed fits, phase-support maps and their completion/cancellation status are included. Every retained component is exported; the current visual checkbox selection is not a separate scientific result.

Close the workspace without cancelling to let a run finish while the browser page remains open. Cancel or a failed stage stops the automatic sequence and retains completed results. Only the most recent decomposition result is retained in memory. Restarting the app loses it unless exported. There is no in-app NPZ reimport yet. Grid, batch and size-check jobs cannot run concurrently with decomposition or factor fitting; ordinary region inspection remains available.

## Representation and equations

For each sampled window, mean subtraction (if enabled) precedes the selected Hann/Tukey/rectangular aperture. The spectrum is

    L(q) = log(1 + |FFT(windowed image)|² / pixel_count)

It is antialiased and interpolated onto 96 logarithmically spaced radial bins and 180 angular bins spanning 0–180°. Opposite samples are averaged, appropriate for the power spectrum of a real-valued image. Axes use g = 1/d, qx to the right and qy upwards. The inner and outer radii are the captured fitting limits; the outer radius must lie below both Nyquist limits. No peaks are detected or selected during decomposition.

Antialias smoothing is applied in native reciprocal coordinates with sigma equal to half the largest outer-edge target bin width. This makes downsampling less sensitive to pixel placement. The “Original spectrum” view is this sampled, antialiased log-power representation, not the original native FFT array.

Optional broadening operates in angle and log radius. Angular boundaries wrap at 180°; radial boundaries use nearest extension. A spacing sigma of p% uses log(1 + p/100). Reciprocal-area metric weights are proportional to radius (the square root of the log-polar area Jacobian), normalized to unit RMS. With unit-norm normalization, each weighted window is divided by its own norm before centering across windows. None retains brightness variation.

    X = processed window spectra
    mean = mean(X, axis=windows)
    X_centered ≈ scores @ components
    reconstructed = mean + selected_scores @ selected_components

PCA uses exact SVD for at most 64 samples/features on the shorter matrix axis; larger jobs use a seeded randomized range (seed 0, three power iterations, twelve oversampling directions). Each component's largest absolute loading is given positive sign for repeatability. Explained variance is captured score energy divided by total centered energy, not renormalized to the retained components. Residual maps show the unexplained norm after all retained components.

Display reconstruction reverses area weighting and row normalization. Negative reconstructed bins are retained numerically but displayed black; their fraction is reported. Original, broadened and reconstructed spectra share one intensity range per inspected window. Component spectra have a separate symmetric signed scale. The mean normalized input spectrum is not directly intensity-comparable with the unnormalized original mean.

## NMF and exhaustive crystal fitting

NMF uses the same nonnegative processed spectra without across-window mean centering:

    X ≈ W H, with W ≥ 0 and H ≥ 0
    H ← H * (Wᵀ X) / (Wᵀ W H)
    W ← W * (X Hᵀ) / (W H Hᵀ)

Products/divisions in the updates are elementwise, with a positive denominator floor. A fixed random seed makes runs reproducible. The solver checks relative squared-error improvement every ten iterations, stopping after at least fifty iterations when improvement falls below 1e-5, or at 300 iterations. This finds a local solution, not a guaranteed global optimum. Residual/error measures use the processed, weighted matrix.

Each row of H is normalized to unit L1 sum and the corresponding W column multiplied by that sum, preserving W H. Bars show each column's share of total W. Group activity adds selected columns of W. No mean term is added to NMF reconstruction. With normalization enabled these are contributions to normalized log-power spectra, not measured phase abundances.

Exhaustive fitting visits all `2^K − 1` nonempty subsets: four factors give 15 groups, six give 63, and sixteen give 65,535. It never silently falls back to pairs or a restricted search. Progress counts fully completed groups and names the current template. Cancellation is checked between template fits; it cannot interrupt an individual numerical fit. The table loads 100 rows at a time, with all completed groups available through subsequent pages and exports.

For each group, a window is considered co-occurring when every included factor reaches at least 20% of its own maximum coefficient. Mean coefficients across those windows weight the combined spectrum. If no window qualifies, global mean coefficients are used and the group is explicitly marked hypothetical. This threshold reports spatial support; it does not prune combinations. Rescaling any factor and inversely rescaling its coefficients leaves the combined spectrum unchanged.

The detector subtracts each radial bin's median over angles, takes local maxima above the user-controlled fraction of the strongest residual, and applies the captured physical minimum-separation and profile-count controls. Profiles have equal weight. Angular sampling identifies opposite reflections as one profile. The fitting tolerance is the larger of 0.1 nm⁻¹ and one native FFT bin from the sampled window. Optional broadening does not enlarge that tolerance.

The existing single-crystal matcher searches each group's peaks using the captured phase library, reference dimensions, scale mode, penalties and omega tolerance. It reports the highest-ranked candidate per phase, ranked by positional agreement minus chance allowance and scale costs. Ordinary weak/missing-peak photometry and double-diffraction adjustments are not applied to factor intensities. These exploratory ranks must not be compared directly with main-analysis ranks. This does not perform a joint beta-plus-omega model search.

For the best candidate, up to three strongly co-occurring original sampled windows are checked at the fitted prediction positions without refitting. These are within-image consistency checks, not independent validation. Combined spectra, source-window checks and alternative phase ranks are available using the group’s **Fits** button. Clicking its number opens the group activity map and combined spectrum. The group table includes fitted rotation. The NPZ/JSON export preserves all completed groups, coefficients, co-occurrence counts, fitting settings and checks; cancellation leaves a partial export available.

## NMF group support and phase maps

Passing group hypotheses are checked against every eligible original, unbroadened sampled window with bounded local refinement (±3° rotation and ±3% uniform reciprocal scale; fixed-scale mode allows rotation only). Cell proportions and phase/zone identity remain fixed. Eligibility requires each included factor to reach 20% of its own maximum activity. Activity alone is not evidence of a phase. The highest-ranking passing model per phase is retained; overlapping groups are never summed.

Local support is the sum of positional match qualities divided by predicted-profile count, minus a chance-match allowance and scale costs. Extra observed peaks increase the chance allowance rather than diluting genuine support. Original group scale costs are retained; local scale drift adds a cost. Passing requires at least four matches within one matching width, nonparallel directions, >30% prediction coverage and support >0.20. This is a different metric from group-search rank. Multiple-phase labels require each included phase to explain at least three distinct nonparallel profiles and more than 15% of the detected profiles. Close competing explanations of shared peaks are labelled ambiguous. Otherwise the window remains unresolved. Phase-specific views include passing models even when the all-phase classification is unresolved or ambiguous.

These maps are same-image consistency checks, not phase fractions or independent validation. Drift beyond the refinement bounds can still be missed. Poor peak extraction and unconverged NMF can also leave many windows unresolved; the convergence status stays visible. Models, per-window evidence, classification thresholds and limitations are exported.

## Interpretation and limits

A component describes correlated variation. It can represent a phase, orientation, thickness, background, contrast or distortion—or part of several effects. One crystal may require multiple components; one component may mix crystals. There is no promise that smooth rotation belongs to a single principal component. Broadening can hide real differences, and group activity is not phase abundance. NMF factors are also exploratory; the crystal fits do not replace ordinary region/grid classifications.

The common spectral grid limits reciprocal detail. Spatial resolution is governed by FFT window width, not just centre spacing; neighbouring windows are correlated. The overlay tiles represent sampling-centre cells, not exact phase boundaries. Unsampled edge margins remain visible. Changes in retained variance after smoothing do not establish better physical interpretation.

The first pass limits each float32 spectral matrix to 64 MiB (970 windows at this grid size). Multiple matrices and decomposition buffers coexist, so this is not a total memory limit. Windows are limited to 32–2048 pixels per axis. The fitting band must span at least four native FFT bins. Cancellation is checked between windows and matrix stages, not inside a numerical-library operation.

## Validation and next experiments

Automated controls check synthetic spatial separation, PCA reconstruction, seeded repeatability, calibrated reciprocal sampling, angular wrapping, finite/invalid inputs, exports and cancellation. A synthetic small rotation/spacing change becomes less different after broadening while a widely separated orientation remains distinct. This tests the numerical mechanism; it does not validate phase mapping.

ST 1203 completed a 324-window smoke test with and without 2°/2% broadening. Independent known-phase images, gradual-distortion controls, weak secondary patterns and interface localization still need evaluation. Compare with unchanged independent-window matching, keep tuning and validation images separate, and inspect the residuals before adopting factors into classification.

## Prior work

B. R. Jany, A. Janas and F. Krok, “Automatic microscopic image analysis by moving window local Fourier Transform and Machine Learning,” *Micron* 130 (2020), 102800. [DOI](https://doi.org/10.1016/j.micron.2019.102800); [preprint](https://arxiv.org/abs/1907.10929). The paper motivates local-spectrum multivariate analysis including PCA/NMF. This implementation uses the explicitly documented representation above, not a reproduction of the complete paper workflow.

D. D. Lee and H. S. Seung, “Algorithms for Non-negative Matrix Factorization,” *Advances in Neural Information Processing Systems 13* (NIPS 2000 proceedings, 2001). [Original paper](https://proceedings.neurips.cc/paper/2000/file/f9d1152547c0bde01830b7e8bd60024c-Paper.pdf). The NMF solver uses their Euclidean multiplicative updates.

Map contrast is display-only: **Enhance variation** maps the current map’s 2nd–98th percentiles to blue–cyan–yellow and clips extremes. **Full range from zero** preserves zero as the lower colour bound. Read the numerical range in the legend: a vivid map can represent small variation, not phase separation or confidence. Signed PCA maps keep their diverging palette. Diffraction-spectrum rendering is unchanged.
