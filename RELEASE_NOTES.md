# TEM Workbench 1.0.35

- Use the ordinary FFT detector, rotation/scale refinement, scoring and acceptance rules when checking PCA/NMF hypotheses against original image windows. Original-window inspectors now show the native FFT and the same rank and cell measurements as ordinary fitting.
- Add **New windows first** as the default hypothesis order and **Auto** as the default pool size. Auto keeps the smallest leading pool retaining at least 99% of attainable passing-window coverage. Counts and manual checkboxes remain available; selection stays linked between the main map and detailed inspector, and applies to batch map exports.
- Match the ordinary grid's 10,000-window capacity for PCA and NMF, including placement passes and rim sampling.
- Keep individual-window symbols and winner counts consistent between main and detailed maps. Distinct orientations of the same zone retain separate symbols, and rejected alternatives cannot hide a passing winner.

Rerun PCA/NMF after updating to use native-window validation. Existing results are not silently rescored. Component spectra still generate hypotheses from their relative features; their amplitudes are not native image brightness. Mapping remains experimental and is not a phase-fraction measurement. Auto may omit small regions within its 1% allowance; use explicit selection when those matter.

Use **Check for updates → Install update and restart**.
