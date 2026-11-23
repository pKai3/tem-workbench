# Native quantified composition maps

The version-2 `QuantMapData` reader decodes stored weight-percent and atomic-percent
planes. It does not calculate a new EDS quantification. The selected record opens
an element grid with a units selector, pixel readouts, pixel means and full-resolution
CSV downloads. Compare maps offers **Intensity**, **Weight %** and **Atomic %** as
separate families, including cross-file comparisons, saved comparisons, smoothing,
ratios, shared scales and original/processed numerical exports. Composition ratios
divide stored concentrations; intensity channels remain in their original family.

## Verified structure

The reference is `705_AB_Michael_Bermingham.oipx`, OIPX 200.0, record
`b144be5c-7a87-47ff-b9a4-d8849573fdf3` (SEM Map Quant Results). Its root
[NBFX binary-text](https://learn.microsoft.com/en-us/openspecs/windows_protocols/mc-nbfx/94c66ea1-e79a-4364-af88-1fa7fef2cc33)
payload contains a version, record UUID, instance marker, label, setup reference,
atomic-number and X-ray-family vectors, a field-ID vector, dimensions, spatial
binning and a repeated data UUID. The reader bounds lengths, verifies identities,
and accepts only the inspected header variant. No .NET objects are deserialized.

The header specifies a 512-column × 384-row grid, atomic numbers 13, 22, 23 and
26, and stored fields `[3, 0, 1, 4]`. Each `<UUID>_<atomic-number>.dat` companion
contains four complete little-endian float32 planes, in field-vector order:
3,145,728 bytes per element. They are planar, not interleaved. Fields 0 and 1
are the decoded wt% and at% maps. Fields 3 and 4 have unverified meanings/units
and remain identified in metadata; they are not passed off as concentrations,
uncertainties or fitted intensities.

## Evidence and scientific limits

All 196,608 pixels were checked across all four elements. Both composition fields
sum to 100% per pixel to float32 precision (maximum absolute deviation about
0.00002 percentage points). Weight/atomic ratios recover the element mass ratios
relative to titanium: Al 0.5632985, V 1.0635073 and Fe 1.1659081, consistent with
the rounded atomic masses Al 26.982, Ti 47.90, V 50.942 and Fe 55.847. Converting
every wt% pixel using those masses reproduces the stored at% to within 0.000016
percentage points. This establishes the
two fields' meanings independently of the picture's appearance. The file has no
paired H5OINA composition export available for a cell-for-cell vendor-export check;
the decoder's evidence must not be described as such a comparison.

The stored pixel means for this record are:

| Element | wt% | at% |
| --- | ---: | ---: |
| Al | 2.890833 | 5.013728 |
| Ti | 84.991674 | 84.077907 |
| V | 5.747773 | 5.383344 |
| Fe | 6.369720 | 5.525020 |

These are means of individually quantified pixels, not the result of quantifying
the summed spectrum. The composition decoder does not assess the validity of the
original peak fit, matrix correction, counting statistics or phase interpretation.
Its unit mapping is not inferred afresh from arbitrary arrays whose totals happen
to be near 100. Unknown header versions retain the metadata fallback; the verified
layout is required before these units are assigned.

## Data integrity and comparison

Only exact UUID/atomic-number companions in the project's `data` folder are opened.
Linked companions are refused; missing or wrong-sized files have visible errors.
Source identities are captured at inventory and checked around reads. A changed
source requires reopening. Reads are bounded, original files are read-only, and
non-finite pixels remain missing in numerical output. Preview colour stretching
does not change pixel values or exports.

Comparison channels have distinct `QuantMapImages` (wt%) and `AtomicMapImages`
(at%) catalogue paths referencing the original `QuantMapData` record and field ID.
These are decoded views of stored planes, not additional objects in the database.
They inherit the native acquisition's registration and field size where decoded.
New composition comparisons start with concentrations and pixel smoothing, so
files without a decoded physical calibration can still be compared. Physical
smoothing remains available where calibration permits it. Smoothing and
ratios operate on full stored arrays before display scaling. Original numerical
exports retain the stored values and units; processed exports record the selected
operations. The unverified fields never enter comparison calculations.

## Physical calibration follow-up

The SEM overview’s scale is now decoded from its own 4:3 scan calibration:
128.60754186269608 mm at unit magnification, divided by the saved 5,000×
magnification. Its field is 25.721508 × 19.291131 µm, with 25.1186605 nm
overview pixels (1024 × 768) and 50.2373210 nm map pixels (512 × 384).
The previous decoder rejected non-square scan frames even when their data was valid.
The same 4:3 variant at 3,000× agrees with all three AB/ST/STA SEM H5OINA
electron-image bounding boxes (42.86918 × 32.151886 µm) and pixel steps
(41.864432 nm). These exports validate calibration only; there is still no
paired vendor-export validation of this record’s composition values.
