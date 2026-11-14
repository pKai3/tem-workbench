# AZtec reader foundation

The `/eds` workspace browses native OIPX projects and optional H5OINA files,
with stored point spectra, element/ratio maps and line/image overlays. It retains
original values and lets users choose signals and processing explicitly. Planned work and
priorities live in [the implementation plan](implementation-plan.md).

## Shared projects and saved workspace

The Project selection is shared with the diffraction viewer. Each project keeps
separate return locations for the two modes: diffraction image and selected
region, or AZtec file, site, acquisition and comparison view. AZtec scans the
selected project's source folder and subfolders, listing supported OIPX and
H5OINA files together. Search filters filenames and subfolder names; Rescan files
refreshes the list. All projects combines the configured sources. Project settings
uses the same source/output editor and folder picker as the diffraction viewer.
Native project entries in the Files list and comparison Project files selector
show the largest decoded electron image per sample. Hover or focus enlarges a
thumbnail; clicking it opens or selects the project. These images load after
file discovery.
The diffraction
image collection excludes those acquisition folders and their raster exports;
native DM4 images in mixed folders remain available.

PNG, numerical ZIP and catalogue exports save to the source project's configured
output folder, or the main output folder when that project's output is blank.
The most specific source folder determines ownership when sources overlap.
Each export gets a unique filename and shows its saved path in the interface.

Viewer preferences, comparison selections, aliases and named map/line presets
autosave to `tem-workbench.workspace.json` beside the folder configuration.
The header's Saved indicator gives its full path; save failures remain visible
with a retry button. Existing browser preferences migrate on first connection,
without replacing settings already on disk. Browser storage is a local cache,
so clearing it does not delete the disk workspace. Include this JSON with your
configuration backups. Research inputs are never changed. Comparisons can use
acquisitions from different native AZtec project files.
The comparison Acquisitions disclosure groups choices by project file, sample
and site. Small registered reference-image previews mark the map or line and
enlarge on hover, focus or tap. Below the choices, each selected card combines
its export label with Move earlier/later controls; saved comparisons retain
the resulting row, overlay-reference and export order.
The site cards have a fixed width and larger reference previews. Map and line
channel choices follow the currently selected acquisitions, removing channels
that none of those acquisitions contain.

Native EBSD OIPX maps expose saved phase IDs, Euler angles in radians, mean
angular deviation in degrees, band contrast, band slope, band count, error code
and pattern quality as separate images. Saved IPF/Euler colour maps are displayed
from their native BGRA bytes; phase-colour indices are stretched to greyscale
without a decoded native palette. Each full map has a smaller saved preview;
the preview pixels are not a simple resize and are not treated as independent
analytical maps. The three full maps were checked against
their H5OINA exports. Workbench does not re-index or clean these fields. Raw
EBSP patterns and FSD images remain undecoded.

`NativeProjectReader` reads supported OIPX records without deserializing .NET
objects. Stored spectrum blobs are matched by UUID and label; verified versions
2 and 3 contain signed 32-bit nonnegative counts and a channel-width/offset pair
in eV. The plot uses that saved axis in keV. Unknown layouts retain metadata;
truncated or invalid supported records are rejected. All 38 spectra in the
inspected TEM project decode, including six named points, saved preview spectra
and existing sums. The Line 1 sum exactly matches all 2,048 channels summed from
its H5OINA export. The native saved axis and the export's refined calibration
differ slightly; matching counts does not establish identical energy axes.
Native SmartLines spectrum tiles and per-position live times are now decoded
read-only. Their raw view shows a spectrum heatmap and the count rate inside an
editable energy window. The window keeps background and overlapping peaks;
it is not a fitted element-specific peak area. Raw map spectra and arbitrary
region spectrum extraction remain undecoded. Legacy OIP is not yet supported.

When a native line has saved composition but no saved Kα1 intensity profiles,
the browser can reconstruct Al, Ti, V and Fe Kα1 window-count profiles from its
own raw spectra. Each saved-profile position groups eight raw positions and
uses their summed live time. Channel-edge weights were checked against a line
that has both raw spectra and saved Kα1 profiles. The new channels are visibly
marked reconstructed in the line viewer and numerical export, and use no
H5OINA data. They are approximate for acquisitions without a saved intensity
profile and retain background and overlapping peaks.

Stored point and sum spectra, and individual H5OINA raw spectrum rows, show
reference X-ray transition markers for selected elements. The line energies
and K/L/M transition names come from [xraylib](https://github.com/tschoonj/xraylib)
(BSD licence; [notice](../web/xraylib.LICENSE)). Hover near a channel to see
possible transitions; a marker does not establish that an element is present.
Four measured Kα1 window totals (Al, Ti, V, Fe) use fractional contributions
from the channels crossed by each inferred AZtec window boundary. H5OINA rows
also show counts per second only when a live-time value exists for each raw
spectrum row; the supplied line exports have fewer, aggregated time values.
These are raw window integrals including background and peak overlap, not fitted
peak areas. [eXSpy](https://github.com/hyperspy/exspy) informed the scope of
the viewer but its GPL-3.0 code and database are not included.

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

## Line spatial-structure check

The line viewer adapts the earlier `analyse_joint_elements.py` shuffle check.
It compares the smoothed profile's relative standard deviation (SD/mean) with
the median from 256 deterministic shuffles. Numerator and denominator samples
move together, preserving their within-sample relationship; both are smoothed
before division, matching the viewer. This intentionally differs from the old
report's smooth-log-ratio operation. Exclude 3σ at each end, require at least 16
interior samples, and report unavailable for undefined ratios or a zero shuffled
baseline. Process permutations in bounded batches.

The displayed multiplier is observed variation / typical shuffled variation.
Values near 1 mean random ordering can produce similar smooth variation. The
expanded readout includes the shuffled 95th percentile as a model reference.
This is an exploratory check of spatial ordering, **not** a confidence interval,
fraction of noise or proof of segregation. Spatially correlated measurement
errors, drift and thickness also produce ordering. Display gain and scalar
normalization cancel from the metric. Formal counting uncertainty is deferred
until exposure, background/deconvolution and covariance are established; see
[NIST's uncertainty propagation guidance](https://www.nist.gov/pml/nist-technical-note-1297/nist-tn-1297-appendix-law-propagation-uncertainty).

## Data distinctions to preserve in the interface

- **Raw spectra and exported profiles/maps can have different grids.** The
  inspected EDS files include unbinned spectra alongside binned scalar outputs.
  The catalogue reports this mismatch; `read_grid` refuses to reshape them onto
  the wrong grid. Explicit rebinning and spatial correspondence are future work.
- **Signal types remain separate.** Saved window integrals, peak areas, weight
  percent, atomic percent, raw counts and live times keep their original paths
  and units. Reconstructed native window counts are explicitly labelled and
  never presented as stored or fitted peak areas. Ratios name both operands and
  their processing; this reader does not calculate compositions or substitute
  counts for corrected elemental signals.
- **Coordinates are retained, not guessed.** X/Y arrays, steps, stage positions,
  relative offsets, scan rotations and units remain available. Grid reshaping
  preserves native storage order; it does not flip or rotate an image. Signed
  image storage is preserved rather than silently converted to unsigned pixels.
- **Source changes require reopening.** The catalogue records the absolute path,
  file size, modification time and filesystem identity. Reads check that identity
  before and after opening. This is a stale-file guard, not a content checksum or
  proof of scientific provenance. Catalogue and reader versions are exported.

## EBSD inspection and remaining analysis

The native browser now shows full-map EBSD fields and paired saved previews;
EBSD processing and re-indexing remain separate future work. H5OINA reader
support keeps acquired EBSD arrays and Data Processing results
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
energy axes for all 15 EDS files. No real point H5OINA export was supplied;
native point spectra are inspected as described above. These are extraction checks, not
validation of quantification or phase interpretation.

Remaining EDS work includes raw-to-binned coordinate mapping, raw region spectra,
processing recipes and data/image export; priorities remain in the implementation
plan. No EBSD re-indexing or live instrument control is provisioned.
