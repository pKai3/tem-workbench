# TEM Workbench — upcoming release

- Add rectangular and polygon FFT selections with adjustable edge fading, an inset fade preview, editable vertices and saved-region support. Correct FFT overlay alignment for non-square selections.
- Extend parent-linked β + ω variant fitting to FFT regions, including grid and batch summaries. Add an adjustable ω-specific positional falloff control in Scale fitting.
- Show combined phase/orientation solutions, their ranks and acceptance status in region hover cards. Restore both measured FFT peak markers when displaying linked β + ω solutions.
- Clarify which threshold limits FFT peak detection, put smoothing first, and tidy selection and processing controls. Show the source filename above the main image and remove the duplicate central-exclusion control.
- Add Windows drive selection and bounded retries for temporary network-folder sharing locks, with clearer diagnostics. Confirmation on the affected managed Windows computer is still needed.

The new FFT linked search can change analysis results. The ω falloff defaults to 1; larger values are exploratory tolerance choices, not confirmation of a phase. Rerun grids to apply new matching settings.

Use **Check for updates → Install update and restart**. Export unsaved grid results before restarting.
