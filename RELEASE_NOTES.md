# TEM Workbench 1.0.39

- Add KAM/IPF map comparisons with per-acquisition native OIPX, processed H5OINA recalculation and saved H5OINA KAM choices. Configure kernels, angle limits, IPF directions, colour palettes and compact phase keys; missing pixels display white.
- Build publication layouts with chosen full-resolution overview images, transposition, coloured panel labels and configurable scale/key placement. Live / As Exported previews the actual PNG layout; rectangular fields retain their proportions without excess padding.
- Add layered EDS maps and pixel-distribution histograms/exceedance curves, label-matched colours, configurable axes, descriptive tables and a separate high-resolution PNG export.
- Separate Browse and Compare navigation, improve project/site previews and acquisition selection, and show sample, site, acquisition and physical dimensions together. Named comparisons autosave selections and settings, with Save as and Rename.
- Share multiple source folders and per-mode folder choices across TEM, AZtec and Figures. Project settings autosave, with Revert changes for the current popup. Explicit export-folder inclusion shows an orange warning; folder navigation stays fixed while lists change.
- Recover moved Figures sources by verified content identity and native AZtec projects by UUID. Improve figure browsing, native DM4 rendering, transpose layouts and intentional missing-acquisition placeholders.

KAM recalculation uses the selected orientation source; saved H5OINA mode reads its stored result directly. Data sources and processing choices remain explicit in numerical exports. Figure PNGs remain edited 8-bit RGB renderings; source microscopy files are unchanged.

Use **Check for updates → Install update and restart**.
