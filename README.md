# TEM Workbench

A small local web interface for DM4 images, movable-region FFTs, automatic peak
detection, HCP/BCC candidate comparison, and uniform or adaptive grid analysis.
Plain HTML/CSS/JavaScript, a Python standard-library HTTP server, NumPy, SciPy,
and Pillow. No JavaScript dependencies or build step.

## Start

Copy `tem-paths.example.json` to `.tem-paths.json` and fill in the local paths.
The configured Python environment needs `requirements.txt`; the configured
`dm_reader` is the saved ncempy reader from the existing TEM analysis. That
third-party reader remains outside this repository with its original GPLv3
license. No research data are bundled.

Double-click **Launch TEM Workbench.command**, or use:

```sh
python server.py --open
```

The server listens only on `127.0.0.1:8767`. Stop it with Control-C in its terminal.
Use `--port 8768` if the default port is occupied. The launcher uses the Python
environment configured in `.tem-paths.json`, or `TEM_WORKBENCH_PYTHON` if set.

## Use

- Choose a real-space DM4 from the STA or ST folders; it opens as soon as you select it. ST1221 opens by default.
- Click **☆ Favourite open image** to add it to the separate **Favourites** dropdown. Choosing a favourite opens it immediately; click the star again to remove it. The shortlist is remembered in this browser for this TEM folder.
- **Colour overlay intensity** adjusts the grid fill over the real-space reference image from 0–100%. It does not rerun analysis; grid outlines remain visible. Use **Show grid** to hide the grid entirely.
- Move the box; resize its lower-right handle. Coordinates and width are editable.
  Click the image, then arrow keys nudge ten pixels; Shift moves fifty. The FFT and candidate results update
  as computation completes. The timing line records the coordinates of the result
  being shown; while dragging, these can briefly trail the moving box.
- Change **Background** to adjust FFT contrast without changing detected peaks. Choose colour (magma) or greyscale. Maxima markers can be white circles, white crosshairs, or hidden.
  Measured profiles and either candidate's matched predicted positions can be
  overlaid. The candidate table and individual phase-fit list are sorted by support, highest first; this display order does not change the phase decision. Individual fit controls also expose every retained below-threshold candidate and both geometry-only grid fits. Dashed rings flag rejected candidates; displaying a fit does not accept it. Opposite spots represent one independent profile.
- **Run grid** starts with a uniform grid, defaulting to 20 per side (400 regions). With **Adaptive** checked, unresolved, insufficient, HCP/BCC-ambiguous or two-candidate-structure regions split into four, as do regions with a substantial second independently supported periodic pattern. The two-structure label triggers subdivision even if the separate geometry-only check finds one predominant pattern. This repeats until a supported phase candidate predominates or a further split would make children smaller than the chosen **Stopping limit, nm** (any positive value; default 5 nm) or 32 pixels. The grid-size hint explains when the starting grid is already too fine to subdivide. Limits below 5 nm are allowed; the FFT warning reports the actual Hann broadening at the selected region size. On ST1221, 20 per side starts at about 6 nm, so it cannot split again with a 5 nm stopping size; use a coarser starting grid for refinement. Click a map cell to calculate its detailed FFT. Saved grid settings record the refinement policy and every region records its stopping reason.
- **Grid results** shows current map-region counts and area percentages for every candidate label. Areas are weighted by tile size; subdivided parents are excluded. Running or cancelled grids also show uncovered image area. These are candidate-labelled areas, not confirmed phase fractions.
- Cancel retains a partial result and clearly marks it cancelled. Completed and
  partial grids can be saved. A partial adaptive tree may have pending children.
- **Save region / Save grid results** writes JSON to the configured results folder
  inside TEM, including source pixel hash, region coordinates, settings, peaks,
  candidate fits, calculation timings, and analysis code hash. Nothing overwrites
  the original images or previous analysis.

## Calibration and interpretation

The default is the stored DM4 calibration, shared scale 1.000. HCP references use
a = 0.295 nm and c = 0.468 nm; BCC defaults to a = 0.330 nm. The peak threshold is editable. **Scale comparison** is available for every real-space image:

- **Stored scale** uses a model multiplier of 1.000.
- **Comparison scale ×0.950** reproduces the previous ST1221 model estimate. On other images it is an exploratory comparison, not a calibration measured for that image.
- **Custom comparison scale** enables **Model size ×**, from 0.850 to 1.150.
- **1222 BCC reference** uses the provisional BCC parameter described below with a shared multiplier of 0.950.

The selection is remembered per source pixel hash in this browser. New images start
at stored scale. The multiplier applies to both structures' predicted reciprocal
vectors and stays fixed across a grid; measured FFT axes and reported d spacings
retain the stored DM4 calibration. A better fit after adjusting model size does not
measure strain, independently calibrate the microscope, or confirm a phase. The
current matcher still checks absolute distances, not only ratios and angles.

`analysis_core.py` contains the numerical functions from the existing ST1221
analysis. Their source hashes and limitations are in `engine_provenance.json`.
`templates.json` is the same bounded library of 46 HCP/BCC templates. No new
scientific validation or exhaustive phase search is claimed for this interface.
The 0.950 preset and nominal references reproduce only their corresponding
scenario. The fixed-reference view uses the same 0.950 scale and provisional BCC a = 0.32452995 nm from diffraction 1222.

Compatibility is not a confirmed phase identification. Support is weighted
Fourier evidence, not phase fraction or probability. Images lacking the full
3–10 nm⁻¹ sampling band are shown but phase fitting is disabled. This first
version supports finite 2D real-space DM4 images with equal x/y length calibration;
the automatic grid currently requires a square source image. Direct diffraction,
other phases, arbitrary region masks, and persistent sessions are future work.

## Structure

`analysis_core.py` holds reusable numerical functions; `engine.py` handles source
images and regions; `server.py` exposes local endpoints and grid jobs; `web/` is
the interface. Filesystem paths live in the ignored `.tem-paths.json`. Results
and microscope data belong in TEM, outside this repository. Changing analysis
settings clears the displayed grid so old colours cannot be mistaken for a new
calculation. Grid jobs record their own settings.

API: `GET /api/config`, `POST /api/open`, `POST /api/analyze`, `POST /api/grid`,
`GET /api/job?id=…`, `POST /api/cancel`, and `POST /api/save`. POST requests require
the local session token returned by the configuration endpoint. Server paths are
limited to configured source files, explicit static assets, and the results folder.

This is a local research tool, not an internet-facing server.

## License

[MIT](LICENSE). Copyright (c) 2026 pKai3.
