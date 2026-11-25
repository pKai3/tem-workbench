# KAM in Maps comparison

Implemented 25 November 2026. Each acquisition has a three-way **EBSD source** selector:

- **Native OIPX** recalculates from the native acquired phase/Euler grids.
- **H5OINA · Recalculate KAM** recalculates from matching exported processed phase/Euler grids.
- **H5OINA · Saved KAM** reads the existing saved map without calculating KAM.

This choice also selects the IPF source. Both H5OINA choices use saved processed
IPF colours, limited to the directions actually exported. Each acquisition shows
those directions; the supplied companions contain **Z only**. An unavailable X/Y
panel does not fall back to native colours or recalculate another direction.

A comparison may mix these sources, including acquisitions in the same project.
Choices persist in settings, saved comparisons and exports and follow project-file
relocations. An opened named comparison saves subsequent edits automatically,
including acquisition selection/order, project files, settings, export labels,
colours and crops. **Save as…** creates and opens an independent copy; edit the
name field and choose **Rename** to rename the current comparison. **New comparison**
detaches the saved comparison before clearing the working selection. The active
comparison restores after reload, and unreadable source files pause autosave to
avoid replacing a saved selection with an incomplete one.
The native default remains unchanged. This supersedes the earlier
native-only runtime source decision.

Companions are discovered beside the OIPX or in its neighbouring `h5oina` folder
(up to two nested directory levels). Matching uses acquisition UUID, then verifies
native/acquired phase and Euler arrays and grid dimensions exactly. Missing,
ambiguous or mismatched exports produce explicit unavailable rows; they never
fall back to native calculations. Source snapshots invalidate cached results when
an export changes; external/linked payloads are rejected.

Shared kernel, neighbour and angle controls apply to recalculated acquisitions.
They are disabled if every selected acquisition uses saved KAM. Each saved card
and the table show the recorded settings. The supplied H5OINAs store a 3×3 square,
periphery-only kernel and maximum 5°; **minimum angle is not stored**. It is shown
as unknown, rather than assuming zero. Processed recalculation uses its own H5
phase definitions and performs no additional cleanup.

Saved mode excludes unindexed processed pixels and retains finite indexed zeros.
H5OINA provides no separate KAM-validity mask: there are 2 ST and 8 STA indexed
zeros that are blank in the CSV exports, alongside legitimate zeros. Saved mode
therefore has 118,606 / 117,193 / 113,290 valid AB/ST/STA pixels, with means
0.3229963093 / 0.2869438370 / 0.3358655387°. It does not reconstruct the CSV blank
mask or invent eligible-neighbour counts. Recalculated modes determine their own
validity from eligible neighbours.

The supplied saved KAM numbers are degrees despite a `rad` attribute. This reader
interprets them as degrees only when converting to degrees would exceed the
recorded maximum-angle bound while the raw values satisfy it; otherwise explicit
radians are converted normally. Missing/unsupported units and out-of-bound values
are rejected. The recorded unit and its interpretation remain in provenance.
The generic H5OINA reader continues to expose the original metadata.

## Calculation and interface

Compare → Map has a separate **KAM / IPF** family. Native mode uses the full acquired native
phase and Bunge Euler grids already decoded from `OINA.Ebsd.Data=002`. Reduced
preview companions are excluded. Each native phase's explicit `PhaseId`, Laue
group and lattice geometry are decoded from the inspected version-1
`DatabasePhase` records. Currently validated symmetries are hexagonal 6/mmm
(proper D6 rotations) and cubic m3m (proper O rotations). Other phase layouts or
symmetries report an error; they are never treated as having no symmetry.

For each indexed centre, average the symmetry-reduced disorientation angles to
indexed neighbours of the same phase within inclusive minimum and maximum angles. Default:
3×3 square, periphery only, 0–5°. Controls allow 3×3, 5×5, 7×7 or 9×9 squares,
All or Periphery, Min angle ≥ 0° and Max angle up to 180°, with Min strictly below Max. In the interface, reaching or crossing Max automatically raises Max to Min + 1°; Min is bounded to 0–179° and Max to 180°. Raising Min excludes small neighbour angles from the average; it is independent of Colour min/max and can leave pixels with no eligible neighbours. All excludes the centre;
Periphery uses the square's outer ring. The 3×3 case uses up to eight neighbours.
This is a square neighbourhood, not MTEX's four-connected graph-distance order.

Euler input remains radians; computed KAM is degrees. Neighbour pairs are counted
at both ends, without wrapping at image edges. Unindexed pixels and pixels with
no eligible neighbours are NaN, rendered white and omitted from histograms.
No cleanup, hole filling, grain reconstruction, re-indexing, Gaussian image
smoothing, signal ratio or normalization is applied. Phase boundaries are excluded
by phase ID; same-phase high-angle pairs are excluded by the cutoff.

The method follows the [KAM definition and eligible-neighbour rules documented by
MTEX](https://mtex-toolbox.github.io/EBSDKAM.html); the implementation uses
[SciPy's proper rotation groups](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.transform.Rotation.create_group.html).
No MTEX code is copied or bundled.

Native display-image grid dimensions, origin and step must agree before the map
is registered with its electron image. Existing native scan calibration supplies
physical dimensions. The Overview images button opens a popup over a dimmed page and lists each saved site electron image with a marked-field
preview. Hover/focus enlarges the complete source image, preserving all pixels. Choose none, one, or several, and move them earlier/later to set the overview
column order. Default retains the first saved record: Lower Right (AB), Lower Right 4
(ST), and Lower Right 5 (STA). The seven choices at each G9 site include the separately
labelled SE and BSE images. Each chosen image uses its own stored origin, step and
matching coordinate frame to crop the same acquired field. Source labels remain
visible in the app, but are omitted from exported figures. Overview images retain every source pixel in compressed PNGs
(1024×768 for the supplied G9 images); they are not resampled to the 400×300 EBSD
grid or limited by the ordinary preview size cap. The browser and PNG renderer
apply the exact registered source rectangle when drawing. The export allocates
at least the registered overview's pixel dimensions per panel. The chooser and
comparison grid use those full-resolution images for cursor-centred 5× detail,
also available by keyboard focus/Enter and touch. The chooser's map-field outline
is a separate display overlay and is absent from the enlarged source detail.
Saved comparisons retain native paths and order; numerical
manifests retain source paths and crop geometry without embedding PNG data. If registration/calibration is unavailable, the comparison
retains pixel dimensions and does not invent a physical scale.

Shared colour limits default to 0–5° and remain editable; Independent uses each
map's P99 with a zero lower bound. New unspecified views default to **AZtec**, a blue–green–yellow–red ramp matching the supplied AZtec legend. **Spectrum** retains the original blue–cyan–green–yellow–red ramp, and **Viridis**, **Inferno**, **Greyscale** and **Cyan** are also available. Explicit saved palette choices are preserved. All map and legend renderers use the same colour stops. Preview and PNG KAM legends share a translucent dark backdrop, with the minimum beneath the left end and maximum beneath the right end of the ramp. Display limits
do not change numerical values. Histograms and exceedance curves use all finite KAM
pixels, including valid edge pixels. Compare maps with matching acquisition step size, neighbourhood,
cutoff and orientation processing state.

Choose **KAM**, **IPF**, or **IPF + KAM** columns beside the registered electron image.
In native mode, IPF X/Y/Z uses the full native saved RGBA display from the same
acquisition. H5OINA modes use its saved processed IPF colours for the requested axis.
Valid IPF colours are preserved, without recalculation. Missing native pixels
(transparent in the saved display) and unindexed H5OINA pixels are opaque white,
independently of whether that pixel has eligible KAM neighbours. Overview selection remains native.
Missing or ambiguous axes remain explicit unavailable panels.

**IPF legend** offers **Off / One map / All maps**, with a chosen acquisition or
the first available IPF map for One map. Hexagonal and Cubic switches independently
show/hide their keys; these affect annotations only. The default is One map with
both enabled. Only phase symmetries actually present in each native/processed
phase grid are included, with their recorded names. A missing explicitly chosen
map is reported rather than silently moving its legend. Choices persist with
named comparisons and project relocation, and follow normal/transposed PNG layouts.

Preview and export share a compact translucent dark key with white text. Negative
Miller indices use drawn overbars rather than font-dependent combining marks.
The colour fields retain the user's original AZtec artwork from
`G9 HT Figures.pptx` (`ppt/media/image57.png`). To avoid enlarging its baked white
fringe and pixelated outline, border pixels are padded from the nearest clean
interior colour sample and clipped to smooth vector outlines at output resolution.
This replaces the earlier binary transparency mask. The lower-right barred
indices have explicit clearance below the colour field.
`web/assets/ipf/reference.json` records the exact source hash, crops and processing.
Labels and overbars render separately at export resolution. The colour fields
themselves retain their original raster resolution; this is not a decoded or
reconstructed orientation-colouring algorithm. Validated keys currently
cover hexagonal 6/mmm and cubic m3m. Missing/unsupported phase definitions report
a legend error without preventing display of an otherwise valid saved H5OINA map.
A shared legend assumes the same colour convention and phase symmetries across
the maps it describes. The same crystal-direction key applies to X, Y and Z;
the selected specimen direction changes which crystal direction is coloured,
not the key itself. IPF X/Y/Z appears in the panel label, without a duplicate
legend heading. The supplied H5OINA files still provide Z only. See the
[MTEX reference-direction explanation](https://mtex-toolbox.github.io/EBSDIPFMap.html#choosing-the-reference-direction).

EBSD panels use the acquired map aspect ratio. **Transpose** swaps acquisition rows
and quantity columns without rotating image pixels, including in PNGs. Export labels,
label colours and spatial scale bars remain attached to their acquisitions. PNGs
use a white background by default. **Export maps PNG** saves the figure alone;
**Export PNG** beneath the distribution saves the selected histogram or exceedance chart
separately, with its current axis bounds, markers, label colours and PNG background.
Its width and height are four times the former distribution export (8 pixels per
chart layout unit, formerly 2); the SVG is rasterized at the output resolution,
including proportionally scaled text and strokes. The former PNG distribution
checkbox no longer applies.
Charts default to P10/P90 and use assigned export-label colours for their curves and
markers, with automatic acquisition colours as fallback. The chart sits to the left
of a KAM summary table containing the per-acquisition source/settings, mean, median, selected percentiles, maximum, valid
pixel count, no-data count/percentage and acquisition step.

The chart dropdown offers **KAM — histogram** and **KAM — exceedance**. Exceedance
is the percentage of included pixels strictly greater than the angle, evaluated
directly from pixels (not histogram bins) at 513 shared thresholds, including
zero and the largest included angle. Straight segments join the evaluated points;
the displayed curve is a bounded sampling of the empirical survival function.
Zero-valued pixels are included in the denominator, so the curve at zero need not
start at 100%. The vertical axis stays at 0–100%. Colours, statistical markers,
percentile selection and PNG distribution export apply to either chart style.
The chart choice persists with the comparison. **X min, °** and **X max, °** set
its displayed range for both chart styles and PNGs; blank means automatic and
**Auto** clears the overrides. Both chart styles use an Auto range from zero to the largest selected P99
angle, approximately 1% remaining above that threshold, rather than at the single
largest pixel. KAM uses 320 shared bins,
four times finer than the former 80. Values outside the chosen axis are only
clipped visually: percentages and statistics still use the full valid population.
Axes remain non-degenerate for constant/zero maps. Limit choices persist in
settings/comparisons. Disabled saved-mode calculation fields are visibly grey.

PNG figures omit the source/settings header and its reserved space. Map labels
are simply **KAM** and **IPF X/Y/Z**, without native/H5OINA/saved qualifiers; the
author can describe source and calculation settings in the figure caption.
Overview-image names such as Electron Image 1 or Lower Centre are also omitted.
Label text and badge padding scale with panel resolution: main labels use
18 pixels per 320-pixel panel (5.625% of panel width), preserving their proportions
when a full-resolution overview increases the export size. Source rasters retain
their resolution; higher export resolution does not shrink the annotations.
IPF/KAM enlargement uses discrete source pixels without colour interpolation in
the grid, hover detail and export. Electron-image and EDS rendering is unchanged.
The app still shows those details, and numerical ZIPs contain full KAM degree
grids and eligible-neighbour counts in `recalculated/` for calculated results.
Saved KAM uses `saved/` with no fabricated neighbour-count array. Manifests retain
OIPX acquisition identity, actual H5 source paths/snapshots where used, phase
symmetries, settings, unit interpretation, missing-value semantics and acquisition
step. Original sources remain read-only. KAM settings and selected
acquisitions use the existing independent comparison preferences and presets.

## G9 reference checks

`SEM EBSD G9-HT.oipx` (renamed `SEM EBSD AB-ST-STA.oipx` in
`SEM EDS & EBSD/2026.06.21 EBDS`) has three full maps (AB Map 2,
ST Map 4, STA Map 6), each 400×300 pixels at 0.1 µm spacing (40×30 µm field).
There are no saved KAM records in this OIPX database or its map companions.
The paired H5OINA exports contain both acquired and processed orientations and
saved `Data Processing/Analyses/KAM1` maps. The processed Euler arrays differ
from acquired orientations at 61,703 / 42,192 / 45,861 positions respectively.
Native KAM therefore must not be described as reproducing the processed exports.

The user's native-only source choice means OIPX rather than H5OINA at runtime;
it does not require acquired rather than processed orientations. Acquired data
are the currently decoded and validated native input. A read-only reinspection
on 25 November found three full orientation companions and three reduced
previews among all 63 companion files, with no separately identified full
processed orientation dataset or unlinked companion. Acquisition processing and
refinement metadata exist in the EBSD records, but have not been shown to
reproduce the exported post-processing changes. This inventory does not prove
that all possible native processing representations have been decoded.

All native phase IDs and Euler components match the exported **acquired** arrays
exactly. Recalculation from either acquired source gives identical KAM arrays,
including their missing-value masks. Native valid pixel counts with defaults are
116,810 (AB), 114,466 (ST), and 109,418 (STA).

To independently check the calculation against AZtec's saved results, run the
same calculation on each export's **processed** phase/Euler arrays with its saved
3×3 square, periphery-only and 5° cutoff settings:

| Sample | Compared finite pixels | Maximum difference, degrees | RMS difference, degrees |
| --- | ---: | ---: | ---: |
| AB | 118,606 | 0.008513 | 0.000835 |
| ST | 117,191 | 0.013580 | 0.001422 |
| STA | 113,282 | 0.013056 | 0.001207 |

These are close numerical agreement, not bitwise equality with the vendor KAM
calculation. No empirical correction or fitting is applied. The vendor fields
store zero at every position where this calculation has no eligible neighbour;
Recalculated modes preserve those positions as unavailable rather than zero
misorientation. Direct saved mode has the validity limitation described above.

### CSV and workbook comparison, 25 November 2026

The subsequently supplied `reports/*-KAM.csv` exports have 120,000 positions each,
with explicit micrometre coordinates and degree units. Indices and coordinates
match the native 400×300 row-major grids without flips, shifts or resampling.
Blank KAM cells are unavailable even though every `In Dataset` flag says Yes.
Finite zeros (63 ST and 127 STA pixels) remain valid values. The workbook
`KAM.xlsx`, `Sheet1!A3:C120002`, reproduces the CSV values within 9e-16° and has
identical blank masks; cached means, sample standard deviations and sample
variances in `F4:H6` reconcile to those inputs.

| Sample | AZtec CSV mean, ° | Native mean, ° | Native minus AZtec mean, % | Native valid | AZtec valid | Native/CSV paired RMS, ° |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AB | 0.3229963094 | 0.3251571795 | +0.6690 | 116,810 | 118,606 | 0.01033861 |
| ST | 0.2869487340 | 0.2868554225 | −0.0325 | 114,466 | 117,191 | 0.02854689 |
| STA | 0.3358892576 | 0.3373876039 | +0.4461 | 109,418 | 113,282 | 0.03891004 |

Means use each map's own finite-pixel population; paired errors use only pixels
finite in both. Every native-valid pixel is valid in the CSV. AZtec additionally
reports 1,796 / 2,725 / 3,864 valid pixels. Maximum paired differences are
0.890527 / 1.276783 / 3.025193°, so close means do not establish pixelwise equality.

Finite CSV values match the H5OINA saved **processed** KAM within 5e-7° (decimal
export rounding), and all CSV blanks correspond to H5 zero placeholders.
Recalculating from those processed phase/Euler arrays reproduces every CSV
finite/blank location and gives RMS errors 0.00083513 / 0.00142178 / 0.00120726°,
with maximum errors 0.00851267 / 0.01357912 / 0.01305519°. This isolates the
different acquired-versus-processed inputs as the main source of disagreement.
The smaller numerical residual remains; these files do not establish its exact
cause or the complete processing sequence. No production settings or calculation
were changed. Source hashes remained unchanged. The reproducible comparison,
full statistics and difference figure are under
`outputs/kam-export-comparison-20261125/` in the local checkout.

The saved KAM datasets declare `Unit=rad`, but their numbers agree with degrees.
Interpreting them as radians yields RMS differences of approximately 20.6°, 20.2°
and 23.2°, respectively. This is a reference-file metadata inconsistency established
by numerical comparison. The generic H5OINA reader retains the recorded units;
native KAM does not depend on that field. The dedicated saved-KAM mode records
its bounded unit correction explicitly, as described above.

Reproduce the read-only checks with:

```sh
python tools/validate_aztec_kam.py /path/to/project.oipx /path/to/h5oina
```

The tool verifies native/acquired array equality, phase symmetry identifiers,
independent processed-KAM agreement and unchanged source hashes. Synthetic tests
cover known angles, crystal-equivalent orientations, specimen rotation invariance,
phase/cutoff exclusion, image edges, larger kernels, missing values, unsupported
symmetry, changed companions, comparison geometry and exact numerical exports.

Maps use the same cursor-centred 5× detail renderer and edge-clamped card as Figures, with a saved Hover detail On/Off choice. Detail uses the displayed source pixels and brightness, including the current crop; native 400×300 maps are not given invented extra resolution. Mouse hover, keyboard focus/Enter and touch are supported. Leaving, scrolling, resizing, Escape, panning or changing views dismisses the card. Preview and PNG scale bars follow Figures’ nearest 1/2/5 length at 17% of the visible field, filled white bar with black surround and centred outlined label. Native calibration and crop remain authoritative.

Per-acquisition sources and exceedance were verified on the real AB/ST/STA data, including mixed inputs, saved-mode read-only settings, remembered chart/source choices, label colours and PNG/numerical exports. Synthetic checks also cover no-calculation saved reads, exact values, indexed zeros, source ambiguity/mismatch, changed exports and linked-array rejection.

### Palette verification, 25 November 2026

The user confirmed both applications were already displaying 0–3°. The visible
colour difference therefore cannot be attributed to mismatched colour limits.
The supplied screenshot has an embedded Display ICC profile; converting its
legend to sRGB before sampling confirms linear blue → green → yellow → red,
without the cyan stop in the original Workbench Spectrum. At 1° on a 0–3° range,
AZtec is green while the original Spectrum is green/cyan. The four-stop ramp
matches interior legend pixels to 0.70 RMS per 0–255 RGB channel; Spectrum gives
58.93 RMS, fitting only the screenshot's subpixel legend bounds. This validates
colour mapping, not full-map pixelwise equality. The measured result is retained
locally in `outputs/kam-sources-20261125/palette-validation.json`. No KAM values,
orientation processing or numerical statistics were changed to match colours.
