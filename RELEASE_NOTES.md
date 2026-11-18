# TEM Workbench 1.0.38

- Add Figures, a third workspace for reusable multi-image panels. Browse project or custom-folder images, arrange and replace panels, inspect original metadata bars, calibrate replacement scale bars, adjust tone and sharpness, and reopen saved figure recipes.
- Read available SEM footer and matching TXT metadata for figure labels and filters. Preprocess folders with a chosen OCR worker count; verify extracted values and printed scale bars against the source image.
- Export figures at a chosen 25–100% of native crop resolution, with expected pixel dimensions and an approximate PNG size before export. Export transparent label tags separately with editable text and shade colours.
- Improve batch grid selection and output: review thumbnails, filter selected images, save multiple PNG view choices, and keep one batch in one destination with a warning when projects are mixed.
- Refine diffraction grid sampling and progress: fill only uncovered image-rim gaps, show every PCA/NMF FFT sample as it completes, and identify acquisitions by folder as well as number when counters repeat.
- Add white and transparent AZtec plot backgrounds and colourable export labels. Visual image browsers retain acquisition numbers, show image-type badges, and offer snapped preview sizes.

Figure PNGs are edited 8-bit RGB renderings; standalone label tags retain transparency. Smaller PNG sizes are measured directly; larger sizes are estimated from native-detail samples and can vary with image content. Confirm OCR fields and scale-bar calibration before using a figure for publication.

Use **Check for updates → Install update and restart**.
