# TEM Workbench 1.0.29

- Speed up repeated map scoring-weight updates by reusing geometric diagnostics. Keep navigation responsive during recalculation and publish map changes together, with stale requests safely ignored. Fits and numerical results are unchanged.
- Add Continuous map to Best match alongside Hex grid. Keep phase colours, contributing-window inspection and exported map keys consistent.
- Rename and reorder map modes: Individual windows, Best match, Match score, Match frequency, Multiple-structure support, Placement sensitivity and Sampling density. Keep averaging details in help and put best-match colour keys on the right beside overlay intensity.
- Keep the current FFT fit when releasing the region box without a pixel-position change, including after a drag has already finished fitting. Preserve live crops, FFT-only hover previews and analysis of genuinely moved or resized regions.
- Move region coordinates and width into compact editable header values. Align map mode/display controls left and overlay intensity/legends right, with Show grid beside the slider as a master visibility toggle. Keep zone-symbol interpretation in inline help and dropdown widths consistent across modes.
- Default scale fitting and Reset to overall scale + HCP/ω c/a, while preserving saved mode choices.
- Add another Export map PNG button beside Export grid results, sharing the same export and availability checks as the image-header button.
- Simplify map PNG captions: remove instructional text and footer notes, retain legends, round window size/spacing to two decimals and use singular “pass” for one pass. Keep the Individual windows type legend across the image and zone counters left-aligned above its mode selector.
- Swap Sort by and Acquisition map in the source toolbar.

Use **Check for updates → Install update and restart**. Export unsaved grid results before restarting.
