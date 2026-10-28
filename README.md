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

- Choose a real-space DM4 from the STA or ST folders. ST1221 opens by default.
- Move the box; resize its lower-right handle. Coordinates and width are editable.
  Arrow keys nudge one pixel; Shift moves ten. The FFT and candidate results update
  as computation completes. The timing line records the coordinates of the result
  being shown; while dragging, these can briefly trail the moving box.
- Change **Background** to adjust FFT contrast without changing detected peaks.
  Measured profiles and either candidate's matched predicted positions can be
  overlaid. Opposite spots represent one independent profile.
- **Run grid** starts with a uniform grid. With **Adaptive** checked, regions with
  a substantial second independently supported periodic pattern split into four.
  Subdivision stops when no such second pattern is supported, or another split
  would go below the selected minimum (at least 5 nm). Phase uncertainty alone
  does not trigger subdivision. Click a map cell to calculate its detailed FFT.
- Cancel retains a partial result and clearly marks it cancelled. Completed and
  partial grids can be saved. A partial adaptive tree may have pending children.
- **Save region / Save grid results** writes JSON to the configured results folder
  inside TEM, including source pixel hash, region coordinates, settings, peaks,
  candidate fits, calculation timings, and analysis code hash. Nothing overwrites
  the original images or previous analysis.

## Calibration and interpretation

The default is the stored DM4 calibration, shared scale 1.000. HCP references use
a = 0.295 nm and c = 0.468 nm; BCC defaults to a = 0.330 nm. BCC a and the peak
threshold are editable. The saved ST1221 pixel hash unlocks its previous
model-estimated scale of 0.950. This multiplies both structures' predicted
reciprocal vectors and is applied uniformly across each grid; measured FFT axes
stay in the stored calibration. It is not an independent instrument calibration.

`analysis_core.py` contains the numerical functions from the existing ST1221
analysis. Their source hashes and limitations are in `engine_provenance.json`.
`templates.json` is the same bounded library of 46 HCP/BCC templates. No new
scientific validation or exhaustive phase search is claimed for this interface.
The 0.950 preset and nominal references reproduce only their corresponding
scenario, not every sensitivity view in the prior viewer.

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
