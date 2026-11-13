# AZtec reader foundation

This branch provisions data access for an EDS point, line and map workspace.
There is no new browser interface yet. The application must retain original
values and let users choose signals and processing explicitly. Planned work and
priorities live in [the implementation plan](implementation-plan.md).

## What works

`tem_workbench.aztec.H5OinaReader` reads H5OINA 8.0 exports without modifying them.
It catalogues acquisitions, technique layers, dataset paths, array shapes,
native types, units, element/line attributes, source identifiers, calibration,
phase definitions and coordinate metadata. It does not read signal arrays just
to list them. Full spectra stay on disk until a bounded slice is requested.

The reader uses the [Oxford Instruments H5OINA specification](https://github.com/oinanoanalysis/h5oina/blob/master/H5OINAFile.md)
and has been checked against the user's TEM EDS and SEM EBSD exports. Format 8.0
is the only version enabled for this initial implementation; older or future
versions produce an explicit unsupported-format error.

```sh
python -m tem_workbench.aztec "/path/to/acquisition.h5oina"
python -m tem_workbench.aztec "/path/to/acquisition.h5oina" --json "/path/to/new-catalogue.json"
```

The command accepts several files. The JSON output includes per-file errors and
does not overwrite an existing file. It contains metadata, not spectrum/image
payloads. Nothing is uploaded. Installation dependencies are declared in
`requirements-desktop.txt`, as for the existing desktop application.

```python
from tem_workbench.aztec import H5OinaReader

reader = H5OinaReader("/path/to/acquisition.h5oina")
catalogue = reader.inspect()
# Use the exact layer and dataset paths exposed by this catalogue.
counts = reader.read("/1/EDS/Data/Spectrum", (slice(0, 32), slice(None)))
energy_ev = reader.energy_axis("/1/EDS")
vanadium = reader.read_grid("/1/EDS", "Window Integral/V Kα1")
```

`read` accepts integers and positive-step slices. The default maximum returned
array is 64 MiB; callers can pass an explicit `max_bytes` limit. A large request
fails before array allocation. Returned arrays preserve stored types and values
and are read-only; callers can make a copy for their own processing. External,
virtual and linked payloads are not automatically loaded.

`iter_rows(path, rows=1024)` yields `(start_row, array)` blocks for processing all
spectra without loading the whole dataset at once. It retains every row; the
per-read memory limit is not a limit on acquisition size or access to the data.

## Data distinctions to preserve in the interface

- **Raw spectra and exported profiles/maps can have different grids.** The
  inspected EDS files include unbinned spectra alongside binned scalar outputs.
  The catalogue reports this mismatch; `read_grid` refuses to reshape them onto
  the wrong grid. Explicit rebinning and spatial correspondence are future work.
- **Signal types remain separate.** Window integrals, peak areas, weight percent,
  atomic percent, raw counts and live times keep their original paths and units.
  A signal is only available if the source contains it. Ratios must name both
  operands and their processing; this reader does not calculate compositions or
  substitute counts for corrected elemental signals.
- **Coordinates are retained, not guessed.** X/Y arrays, steps, stage positions,
  relative offsets, scan rotations and units remain available. Grid reshaping
  preserves native storage order; it does not flip or rotate an image. Signed
  image storage is preserved rather than silently converted to unsigned pixels.
- **Source changes require reopening.** The catalogue records the absolute path,
  file size, modification time and filesystem identity. Reads check that identity
  before and after opening. This is a stale-file guard, not a content checksum or
  proof of scientific provenance. Catalogue and reader versions are exported.

## EBSD groundwork

EBSD-specific interface and analysis are deferred while EDS is developed.
Existing reader support keeps acquired EBSD arrays and Data Processing results
as separate layers with their own phase definitions. When processed data lacks
grid dimensions, the catalogue explicitly identifies the acquired EBSD header
used for geometry. It does not infer cleanliness from filenames or folder names,
choose a preferred state, change orientations, fill unindexed pixels, or recompute
grains/KAM. Stored derived analyses and display layers are catalogued separately.

## Validation and remaining work

Synthetic tests cover point spectra, binned line/map mismatches, calibration,
native signed images, acquired/processed separation, bounded slices, lazy large
datasets, invalid selection, unsupported links and formats, changed source files,
strict JSON and non-overwriting catalogue export.

Read-only checks of 21 actual exports (15 TEM EDS, six SEM EBSD) verify 376 numeric
slices and 361 full scalar/image grids exactly against direct HDF5 reads, plus
energy axes for all 15 EDS files. No real point export was supplied; point-spectrum
access currently has synthetic coverage only. These are extraction checks, not
validation of quantification or phase interpretation.

Next EDS work: source/acquisition browsing in Workbench, linked image/spectrum/
profile views, explicit raw-to-binned coordinate mapping, signal/ratio selection,
processing recipes and data/image export. Native OIP/OIPX decoding remains
separate and must be checked against H5OINA references before it is exposed as
supported. No EBSD re-indexing or live instrument control is provisioned.
