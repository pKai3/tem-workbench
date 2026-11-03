# Optional TEM demo images

Images are hosted separately, keeping GitHub source downloads small. Put **unchanged original DM4 files** into a shared Dropbox folder, or a ZIP served over HTTPS. No manifest or PNG files are required. Add more DM4s directly to the shared folder whenever needed.

## Download

Under **Data Sources and Outputs**, paste the link and click **Download demo images**. Dropbox zips the shared folder automatically; enclosing folders are supported. Nothing downloads until requested. Download progress and cancellation are available.

The app discovers the DM4 images, keeps their microscope metadata and calibration, and generates missing same-name PNG previews locally. Existing previews are reused. Previews are greyscale and at most 1400 pixels along the longest side, with log intensity for direct diffraction. They never replace the analysis data. Optional PNGs in an older download are accepted; old `pack.json` files are ignored.

Installed images are in `demo/packs/`, ignored by Git, and appear in the **Demo** group. They use the normal DM4 reader (`ncempy`, included by the desktop installer). A source-only installation can install it with `python -m pip install ncempy`. Keep `demo/packs/` when moving an installation to avoid downloading again. Legacy NPZ demos remain readable.

The original examples are ST1221 (real-space FFT inspection), ST1144 (direct diffraction) and ST1203 (a strong BCC candidate example). These are inspection examples, not confirmed phase-identification standards.

## Updating the shared folder

Add or remove DM4s in the shared folder, then download again in the app. Keep filenames distinct. IDs such as `demo/st1221` stay stable for saved regions. Downloading the same originals again reuses their installed pack, regardless of the ZIP wrapper or whether previews were included. Expanded packs are installed separately; previously installed images are retained.

The downloader checks ZIP integrity, rejects unsafe archive paths, and only installs DM4s and matching previews. Use a trusted hosting link. No data images or previews belong in Git.

An optional developer helper, `tools/build_demo_pack.py`, copies DM4s into a new folder (`--folder`) or ZIP. It is not needed for a Dropbox folder and produces no manifest or previews.
