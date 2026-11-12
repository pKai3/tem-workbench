# TEM Workbench 1.0.34

- Run PCA and NMF stability maps from Automatic grid, with the familiar sampling, progress, project/subfolder batch selection and map PNG exports.
- Add an Accepted hypotheses selector and collapsible hypothesis table to the main window. Selection, opacity and shared map controls stay linked to the detailed inspector and survive browser reloads.
- Fix Best match maps becoming weaker when more hypotheses are included. Colours and opacity now follow the strongest average passing evidence, consistently in the viewer and exports.
- Merge near-duplicate NMF crystal geometries across signal groups, retaining their source information. NMF now uses the same selectable hypothesis pools as PCA and can inspect each fit against its original window.
- Hide the PCA/NMF inspector button for ordinary grid methods.
- Expand local logs with settings and actions, analysis stages and timing, batch progress, exports, reconnections and browser errors. Repeated polling and large image/spectrum payloads are omitted.

PCA/NMF remains experimental: map support is not a phase fraction. Similar rotation angles can still represent different lattice dimensions; merging compares predicted geometry, not angle alone. Restarting Workbench stops retained jobs; rerun NMF mapping after updating to use the merged hypotheses.

Use **Check for updates → Install update and restart**.
