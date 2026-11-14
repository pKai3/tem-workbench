# TEM Workbench 1.0.37

- Polish AZtec line comparisons and PNG exports: matching live and saved layouts, aligned reference images, compact overlays, and a choice of one combined image or one PNG per acquisition.
- Reorder map and line acquisitions, edit export labels alongside the selected order, and find them through sample and site groups with larger reference previews. Project files show one representative electron image per sample.
- Keep native OIPX comparisons linked when a project file moves. Map and line comparisons now hide channels absent from every selected acquisition.
- Inspect native AZtec raw line spectra and reconstruct approximate Kα1 window count-rate profiles where only saved composition profiles are present. The spectrum viewer adds reference X-ray transition markers and measured window totals for the verified elements.
- Browse native EBSD phase, Euler, band, error, angular-deviation and pattern-quality fields from the G9-HT project. Each of its three full maps includes a labelled saved preview; stored IPF and Euler colour images are viewable.
- Show the effect of map smoothing on spread more clearly and use the shared bottom-right notice for AZtec exports.

AZtec inputs remain read-only. Reconstructed Kα1 windows retain background and overlapping peaks and are not fitted peak areas. EBSD raw patterns, FSD images and the native phase-colour palette are not decoded; Workbench does not re-index or clean EBSD data.

Use **Check for updates → Install update and restart**.
