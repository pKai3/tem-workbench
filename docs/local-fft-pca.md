# Local FFT PCA (experimental)

Available on `feature/local-fft-pca`; not included in main v1.0.32. Open a calibrated real-space image, then choose **Local FFT PCA** beside the automatic-grid window-size check. Restart using this branch to enable its API. The regular grid and crystal matcher are unchanged.

## Using it

1. Choose window width and centre spacing. Defaults are 10% and 5% of the shorter image side. Full square physical windows cover the whole image; the current region/polygon does not restrict the run. Pixel rounding is reported in the result.
2. Begin with eight components and zero rotation/spacing smoothing. The run snapshots the current FFT taper, mean-removal setting and inner/outer fitting limits. Detector thresholds and crystal scores do not enter PCA.
3. Inspect the variance bars and signed spatial maps. Blue/red indicate opposite deviations from the mean spectrum, not different assigned phases. Click a map location or use arrow keys to inspect its spectrum and reconstruction.
4. Select related components to inspect their combined activity and reconstruct a window using only those components plus the mean. Group activity is the square root of the sum of squared scores. It discards sign; two opposing regions may both have high activity.
5. For gradual lattice drift, compare a new run with modest rotation or spacing smoothing. These are Gaussian standard deviations, not permitted fitting ranges. They broaden peaks before PCA; they neither register orientations nor force one crystal into one component. Compare against the preserved original sampled spectra.
6. **Export data** writes an NPZ containing the numeric arrays and a JSON containing the source identity, calibration, settings, sampling positions, representation and method version. Exports go to the source's configured output folder. Every retained component is exported; the current visual checkbox selection is not a separate scientific result.

Close the workspace without cancelling to let a run finish. Only the most recent PCA result is retained in memory. Restarting the app loses it unless exported. There is no in-app NPZ reimport yet. Grid, batch and size-check jobs cannot run concurrently with PCA; ordinary region inspection remains available.

## Representation and equations

For each sampled window, mean subtraction (if enabled) precedes the selected Hann/Tukey/rectangular aperture. The spectrum is

    L(q) = log(1 + |FFT(windowed image)|² / pixel_count)

It is antialiased and interpolated onto 96 logarithmically spaced radial bins and 180 angular bins spanning 0–180°. Opposite samples are averaged, appropriate for the power spectrum of a real-valued image. Axes use g = 1/d, qx to the right and qy upwards. The inner and outer radii are the captured fitting limits; the outer radius must lie below both Nyquist limits. No peaks are detected or selected.

Antialias smoothing is applied in native reciprocal coordinates with sigma equal to half the largest outer-edge target bin width. This makes downsampling less sensitive to pixel placement. The “Original spectrum” view is this sampled, antialiased log-power representation, not the original native FFT array.

Optional broadening operates in angle and log radius. Angular boundaries wrap at 180°; radial boundaries use nearest extension. A spacing sigma of p% uses log(1 + p/100). Reciprocal-area metric weights are proportional to radius (the square root of the log-polar area Jacobian), normalized to unit RMS. With unit-norm normalization, each weighted window is divided by its own norm before centering across windows. None retains brightness variation.

    X = processed window spectra
    mean = mean(X, axis=windows)
    X_centered ≈ scores @ components
    reconstructed = mean + selected_scores @ selected_components

PCA uses exact SVD for at most 64 samples/features on the shorter matrix axis; larger jobs use a seeded randomized range (seed 0, three power iterations, twelve oversampling directions). Each component's largest absolute loading is given positive sign for repeatability. Explained variance is captured score energy divided by total centered energy, not renormalized to the retained components. Residual maps show the unexplained norm after all retained components.

Display reconstruction reverses area weighting and row normalization. Negative reconstructed bins are retained numerically but displayed black; their fraction is reported. Original, broadened and reconstructed spectra share one intensity range per inspected window. Component spectra have a separate symmetric signed scale. The mean normalized input spectrum is not directly intensity-comparable with the unnormalized original mean.

## Interpretation and limits

A component describes correlated variation. It can represent a phase, orientation, thickness, background, contrast or distortion—or part of several effects. One crystal may require multiple components; one component may mix crystals. There is no promise that smooth rotation belongs to a single principal component. Broadening can hide real differences, and group activity is not phase abundance. NMF and crystal indexing of factors are not implemented here.

The common spectral grid limits reciprocal detail. Spatial resolution is governed by FFT window width, not just centre spacing; neighbouring windows are correlated. The overlay tiles represent sampling-centre cells, not exact phase boundaries. Unsampled edge margins remain visible. Changes in retained variance after smoothing do not establish better physical interpretation.

The first pass limits each float32 spectral matrix to 64 MiB (970 windows at this grid size). Multiple matrices and decomposition buffers coexist, so this is not a total memory limit. Windows are limited to 32–2048 pixels per axis. The fitting band must span at least four native FFT bins. Cancellation is checked between windows and matrix stages, not inside a numerical-library operation.

## Validation and next experiments

Automated controls check synthetic spatial separation, PCA reconstruction, seeded repeatability, calibrated reciprocal sampling, angular wrapping, finite/invalid inputs, exports and cancellation. A synthetic small rotation/spacing change becomes less different after broadening while a widely separated orientation remains distinct. This tests the numerical mechanism; it does not validate phase mapping.

ST 1203 completed a 324-window smoke test with and without 2°/2% broadening. Independent known-phase images, gradual-distortion controls, weak secondary patterns and interface localization still need evaluation. Compare with unchanged independent-window matching, keep tuning and validation images separate, and inspect the residuals before adopting factors into classification.

## Prior work

B. R. Jany, A. Janas and F. Krok, “Automatic microscopic image analysis by moving window local Fourier Transform and Machine Learning,” *Micron* 130 (2020), 102800. [DOI](https://doi.org/10.1016/j.micron.2019.102800); [preprint](https://arxiv.org/abs/1907.10929). The paper motivates local-spectrum multivariate analysis including PCA/NMF. This implementation uses the explicitly documented PCA-only representation above, not a reproduction of the complete paper workflow.
