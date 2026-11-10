# TEM Workbench 1.0.28

- Update the selected real-space crop immediately while moving or resizing the region. Refresh raw/processed FFT previews independently of phase fitting, and show a compact crop preview while dragging in FFT-only view. Old fit overlays cannot attach to a newer region.
- Autosave project names on leaving the field or pressing Enter, with visible save/error feedback. Keep the open image and background grids intact; place Save source changes above the source list for folder edits.
- Add average passing strength maps alongside passing frequency, with continuous/hex displays, optional opacity normalization, compact colour keys and three-phase colour blending. Map controls sit beneath the source image.
- Add optional image-rim sampling. Rim-point visibility can be customized after a run; points always remain visible while their grid is running. Remove finished-map gridlines.
- Reopen the last image after reload, retain grids while browsing other images, and show persistent clickable grid/batch progress cards with two-click cancellation.
- Use selected phase/variant colours throughout combined-fit labels, add DD counts and DD-inclusive coverage, label fitted cell axes, and use compact omega subscripts.
- Align crop/FFT image areas, streamline overlay legends and tooltips, move a compact Saved regions panel beneath image details, and add scale-fitting reset and parameter help from the info icons. Slider drags and numeric entry no longer open help popups.
- Allow fitting-limit handles to move in radius and angle, with 15° angle snapping and per-image persistence in direct diffraction. All FFT colour palettes now share a near-black zero.

Use **Check for updates → Install update and restart**. Export unsaved grid results before restarting. Display changes do not alter measured map values or fitting scores.
