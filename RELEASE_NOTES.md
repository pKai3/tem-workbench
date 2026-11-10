# TEM Workbench next release

- Speed up repeated map scoring-weight updates by reusing geometric diagnostics. Keep navigation responsive during recalculation and publish map changes together, with stale requests safely ignored. Fits and numerical results are unchanged.
- Add Continuous map to Best match alongside Hex grid. Keep phase colours, contributing-window inspection and exported map keys consistent.
- Rename and reorder map modes: Individual windows, Best match, Match score, Match frequency, Multiple-structure support, Placement sensitivity and Sampling density. Keep averaging details in help and put best-match colour keys on the right beside overlay intensity.
- Keep the current FFT fit when releasing the region box without a pixel-position change, including after a drag has already finished fitting. Preserve live crops, FFT-only hover previews and analysis of genuinely moved or resized regions.
- Move zone-symbol interpretation into a tooltip, align colour-reference labels with their bar ends and keep exported best-match captions compact.

Use **Check for updates → Install update and restart**. Export unsaved grid results before restarting.
