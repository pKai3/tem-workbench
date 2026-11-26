# AZtec lab export checklist

Prepared 26 November 2026. **Collection pending. Prioritise items 1–2.** Tracked under “AZtec lab reference exports” in the [implementation plan](implementation-plan.md).

Current root: `Thesis/Papers/G9 HT/G9 Package/3 AZtec/`. Project/acquisition names verified in the native files on 26 November 2026.

| Key | Exact project file relative to that folder | Name that may appear on the lab computer |
| --- | --- | --- |
| A | `2026.06.16 EDS AB/2026.06.16 EDS AB.oipx` | `705_AB_Michael_Bermingham.oipx`; internal project name `705_AB_Michael_Bermingham` |
| B | `2026.06.21 EBDS/SEM EBSD AB-ST-STA.oipx` | Previously `SEM EBSD G9-HT.oipx`; internal project name `AB` |
| C | `2026.10.27 TEM EDS/20261027 TEM ST and STA.oipx` | Internal project name `Project 1` |

**Every set:** keep the saved OIPX + complete `data` folder + matching exports together; close AZtec before copying. Record software version, acquisition, processing state and binning; screenshot settings. Prefer H5OINA 8.0; record any other version. Preserve numerical values and missing cells.

## 1 Validate the SEM composition maps

**Project A → Specimen 1 → Site 1 → Map Data 1 → SEM Map Quant Results.**

- [ ] H5OINA including quantified maps.
- [ ] Numerical **wt% and at% maps for Al/Ti/V/Fe**, at the existing **512 × 384** grid/binning; CSV or equivalent if available.
- [ ] Available fitted intensity/Peak Area and error/uncertainty maps with labels/units; quantification settings and element list.

Checks composition decoding and two unidentified fields. Sum-spectrum quantification cannot replace pixel maps.

## 2 Isolate EBSD processing changes

**Project B: AB → Site 1 → Map Data 2 first.** Then **ST → Site 1 → Map Data 4** and **STA → Site 1 → Map Data 6** if time permits. Full maps: **400 × 300, 0.1 µm steps**; exclude Map Data 1/3/5 previews.

- [ ] Acquired/unprocessed baseline: separate native copy + H5OINA with phase/Euler arrays and phase definitions. Confirm the state in AZtec, not from an “uncleaned” folder name.
- [ ] On a working copy, apply cleanup/refinement **one step at a time**. Save native + H5OINA after each step in separate folders (`AB_00_acquired`, `AB_01_operation`, etc.); record operation order/parameters.
- [ ] Each state: **KAM CSV with coordinates/blanks**, plus saved KAM in H5OINA. Use **3 × 3 square, periphery only, maximum 5°**, minimum 0° if configurable. Record actual settings or an unavailable minimum control.

Checks native processed storage and KAM differences. CSV blanks matter: H5OINA sometimes stores unavailable KAM as zero.

## 3 Complete the processed IPF references

**Project B → the same full acquisitions and final processed states as item 2.**

- [ ] **IPF X/Y/Z** colours in H5OINA if selectable; existing exports have Z only.
- [ ] Lossless images for each direction: **boundaries off**, then **boundaries on**. Record direction, boundary settings, legend and output size.

Separates colour and boundary-rendering comparisons; images do not replace orientation arrays.

## 4 Check one genuine point spectrum

**Project C → ST → Site 5 → Spectrum 1.**

- [ ] Point H5OINA if supported; otherwise numerical channel/count spectrum.
- [ ] Energy calibration, live/real time, and saved quantification table/settings if available.

Checks point counts/calibration. Choose Spectrum 1, not Preview or Line Sum Spectrum.

## 5 Add controlled map region spectra if time permits

**Project C → STA → Overview → Map Data 1.**

- [ ] Full raw-spectrum H5OINA + map sum spectrum; reuse the existing export if unchanged.
- [ ] Unsmoothed numerical spectra from **one pixel and one small rectangle**. Record coordinates/bounds/origin, binning, sum-versus-average and live-time handling. Screenshot selections; retain matching native copy.

Checks raw-to-binned coordinates and region extraction. No bulk repeat of already verified line spectra needed.

## Handoff when the files return

- [ ] Record visit date, export folder and completed/unavailable items here; update the implementation plan.
- [ ] Match identities/states, compare numerical grids/units/missing masks and update decoding notes. Collection is not completed validation or authorization for new implementation.

Stable identifiers for renamed sources: Project A `fca8a70d-3447-4f77-9d32-2e4b325c254f`, quantification record `b144be5c-7a87-47ff-b9a4-d8849573fdf3`; Project B `5bd629a7-e711-4d04-ba72-11fbcfdcaebf`; Project C `f3d90713-c34c-43c4-bdcb-59997b3ee9b9`, Spectrum 1 `1da2ab83-8a67-44bd-b9d4-c58db7cff506`.

Evidence: [native reader](aztec.md), [composition](aztec-quantification.md), [KAM](aztec-kam.md). Local comparison artifacts: `outputs/kam-export-comparison-20261125/`; update their old source-folder paths before reuse.
