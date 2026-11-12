# TEM Workbench 1.0.33

- Add the experimental Local FFT PCA/NMF workspace, with signed PCA features, NMF factors, score-weighted component combinations and crystal-fit inspection.
- Check proposed orientations against original image windows and display selectable hypothesis maps, overlapping support, hexagonal sampling and image-edge coverage.
- Reuse the main interface's spectrum colours, peak markers and animation; add map PNG export and retain active or finished analyses across browser reloads.
- Run PCA/NMF fitting and mapping with selectable workers. Four workers were about 2.2× faster on the 447-window example, with identical output.
- Add independent-image PCA/NMF batches with captured settings, per-image NPZ/JSON exports, a saved progress manifest, failure reporting, cancellation and background progress.

PCA/NMF remains experimental: components and map support are not measured phase fractions. Each batch image has its own decomposition; component numbers do not align across images. Browser reloads reconnect to active jobs; restarting Workbench stops them.

Use **Check for updates → Install update and restart**.
