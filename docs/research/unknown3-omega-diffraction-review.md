# Unexplained reflections in Unknown 3

Literature review and image-specific analysis, 8 November 2026.

**Double diffraction is the strongest working explanation for the four profiles that match nominal omega absences.** Their geometry agrees with the fitted variants, and each can also be constructed closely from a pair of already observed, allowed reflections. The remaining unmatched detection falls on a printed annotation. These findings support investigating scattering pathways before adding orientations or relaxing every extinction rule. They do not independently establish the beta parent or prove a scattering mechanism.

## What the saved fit leaves unexplained

This analysis uses the archived 6 November replay `20261106_232659_Unknown_3_diffraction_886294.json`: 15 independent profiles after nine removal edits, with a 2.5–10 relative fitting band, smoothing 2 px and minimum contrast 9. Opposite spots form one profile. Profile numbers can change after editing or redetection, so they should not be equated directly with numbers from earlier screenshots. The image's absolute calibration is disregarded throughout.

The model has a [011] beta parent, symmetry-equivalent to the conventional ⟨110⟩ beta viewing family, and two supported omega variants. The program calls these omega3 and omega4; those identifiers need not correspond to the source figure's ω₁ and ω₂ labels.

| Evidence in the archived replay | Result |
| --- | --- |
| Allowed beta + omega reflections | 10/15 profiles, 66.7% coverage |
| Allowed-reflection positional RMS | 1.52% of the parent's shortest reciprocal reflection |
| Geometry including nominal omega absences | 14/15 profiles, 93.3% coverage |
| Positional RMS including those coincidences | 1.46% of the same parent spacing |
| Parent support | Two profiles, both shared with omega predictions |

The four extra geometric coincidences are systematically arranged:

| Saved profile | Variant | Three-index omega hkl | Four-index hkil | Position residual as % of parent spacing |
| --- | --- | --- | --- | ---: |
| 3 | omega4 | (100) | (10−10) | 1.61 |
| 5 | omega4 | (200) | (20−20) | 1.09 |
| 7 | omega3 | (100) | (10−10) | 1.33 |
| 8 | omega3 | (200) | (20−20) | 1.15 |

All four have detected opposite partners. Profile 15 has only one detected spot, at approximately **(815.05, 331.66) detector pixels**, measured from the upper-left corner. Inspection of the 1080 × 912 source image places this detection on the printed subscript **2** of an ω₂ annotation. It should be excluded as annotation contamination before interpreting coverage. Simply removing that record would make geometric coverage 14/14 and allowed coverage 10/14; those are arithmetic consequences, not results of a new fit.

The compact [evidence record](unknown3-omega-evidence.json) preserves the coordinates, image hash, fit summary and vector checks. This archived peak list may differ from the latest edited interface.

## Relevant primary literature

| Study | Finding relevant to Unknown 3 | Implication |
| --- | --- | --- |
| **Chu, Jones and Wu, 2011**, *Beta Phase Decomposition during Ageing in Beta Ti Alloy with and without Carbon Additions*, Proceedings of the 12th World Conference on Titanium, p. 801 and Fig. 2. [Full paper](https://cdn.ymaws.com/titanium.org/resource/resmgr/ZZ-WCTP2011-VOL1/2011_Vol.1-4-Beta_Phase_Deco.pdf) | In their Ti–13Cr study, the authors explicitly attribute the nominally forbidden omega (10−10) and (20−20) reflections to double diffraction. The third order, (30−30), is allowed and coincides with beta {112}. Their Ti–15–3 discussion also identifies alpha double diffraction as a source of omega-like extra spots. | This addresses the first-, second- and third-order rows directly. A fractional-position spot alone does not identify the phase. |
| **George et al., 2017**, *Transmission electron microscopy studies and modeling of 3D reciprocal space of ω forming alloy*, **Micron 102**, 73–87. [DOI](https://doi.org/10.1016/j.micron.2017.08.004); [accepted manuscript](https://cusat.ac.in/naac/criteria3/3.7.1/dop/collaboration429.pdf), §3.2.1 and Fig. 3 | For quenched Ti–15 wt.% Mo viewed along [110]β, they combine the parent and four partially collapsed omega variants. Adding double diffraction brings the calculated primary and secondary maxima into agreement with experiment. Diffuse arcs and faint spots on them remain outside that explanation. Their [102] analysis also considers higher-order Laue-zone reflections. | A union of single-scattering lattices can leave real reflections unmatched. Discrete maxima and diffuse intensity need separate explanations; even the expanded model is not universal. |
| **McCabe and Sass, 1971**, *The initial stages of the omega phase transformation in Ti–V alloys*, **Philosophical Magazine 23**, 957–970. [DOI](https://doi.org/10.1080/14786437108216998); [public reproduction of the article](https://www.scribd.com/document/410249806/Mccabe-1971), pp. 963–964, 969 | They examine forbidden first/second-order omega spots using different reciprocal sections and tilt sequences. Their Ti–V results support double diffraction. They also discuss alloy-dependent cases in which ordering could make nominally absent reflections genuine single-scattering contributions. | Tilt dependence is more discriminating than one zone-axis image. The interpretation cannot be transferred indiscriminately between Ti–V, Ti–Nb and an unidentified alloy. |
| **Li and Min, 2020**, *Origin of ω-phase formation in metastable β-type Ti–Mo alloys: cluster structure and stacking fault*, **Scientific Reports 10**, 8664. [Full paper](https://www.nature.com/articles/s41598-020-65254-z.pdf), especially Figs. 3–4 | Atomic imaging and calculations support partially collapsed omega in Mo-depleted regions. Complete and partial collapse correspond to different atomic structures, while the parent relationship allows four crystallographic variants. | An ideal fully collapsed basis is a simplification. Partial collapse must be tested through its actual structure factor; it is not a blanket explanation for every forbidden spot. |
| **Sass, 1971**, *Double diffraction between Bragg reflections and planes of diffuse intensity observed with high energy electron diffraction*, **Journal of Applied Crystallography 4**, 252–254. [Publisher abstract](https://journals.iucr.org/paper?buy=yes&cnor=a08518) | The abstract reports spurious intensity lines produced by double diffraction between strong Bragg reflections and diffuse planes in an omega-containing Ti–Nb alloy. | Diffuse features can also involve multiple scattering. This is supporting context for streaks, rather than direct identification of Unknown 3's discrete spots. |

The first four entries were examined beyond their abstracts; the Sass short communication was available here only as an abstract. The original publication, alloy and heat treatment for Unknown 3 remain unidentified. None of these papers is asserted to be the source of the image.

## Why the ideal template excludes these positions

For an ideal omega basis with identical scattering factors at `(0,0,0)`, `(2/3,1/3,1/2)` and `(1/3,2/3,1/2)`, the single-scattering structure factor is

\[
F_{hkl}/f = 1 + (-1)^l\left[e^{2\pi i(2h+k)/3}+e^{2\pi i(h+2k)/3}\right].
\]

When `l` is even and `h−k` is not divisible by three, the terms cancel. Thus (100) and (200) are absent in this ideal calculation, while (300) is allowed. This is an atomic-basis cancellation; the reciprocal positions still exist geometrically. The current program's rule is consistent with that calculation, but it does not describe every contribution in electron diffraction.

**A restriction on the partial-collapse hypothesis follows directly from this equation.** Moving the two interior atoms only along omega's c axis changes their z coordinates. For `l = 0`, those coordinates do not enter the phase factors, so this displacement alone cannot restore (100) or (200). Unequal site scattering factors, basal displacements or a more complex structure could alter the result. This is a structure-factor deduction for the stated basis, not a conclusion that all trigonal omega reflections behave identically.

## Double-diffraction paths supported by the measured geometry

In double diffraction an electron undergoes two scattering events. Their reciprocal vectors add, so an allowed pair can produce intensity at a position with zero single-scattering structure factor. In the fitted omega indexing, examples are

\[
(20\bar{1})+(\bar{1}01)=(100),\qquad
(101)+(10\bar{1})=(200).
\]

Each constituent has odd `l` and is allowed by the ideal omega basis. The second vector in each expression is also at a beta/omega shared reflection in this fit. Consequently these geometric paths could involve omega alone or a beta/omega sequence; the positions do not distinguish those alternatives.

The following check uses the **measured** profile vectors, rather than sums of ideal predictions. Let `qₙ` be the signed representative vector stored for profile n. Its opposite has vector `−qₙ`. The normalization is the fitted parent's shortest reciprocal spacing; absolute calibration cancels.

| Target | Measured vector construction | Error as % of parent spacing |
| --- | --- | ---: |
| Profile 3, omega4 (100) | q₂ − q₁₄ | 0.485 |
| Profile 5, omega4 (200) | q₁₂ + q₁₄ | 0.665 |
| Profile 7, omega3 (100) | q₁ + q₁₄ | 0.507 |
| Profile 8, omega3 (200) | q₁₁ − q₁₄ | 0.507 |

These small discrepancies make double diffraction a concrete hypothesis for all four nominal absences. They are positional consistency checks, not independent statistical confirmation: related points on a lattice will satisfy many vector relations. A physical intensity calculation would also need excitation conditions, thickness and the scattering geometry. No such simulation has been performed here.

## What remains uncertain

The beta parent is supported by only two shared profiles in this replay, and competing beta-only fits have similar heuristic scores. Neither a high geometric coverage nor the image's printed phase labels resolve that ambiguity independently.

Several relevant spot intensities are near the top of the image's 8-bit range, approximately 247–254 out of 255. Together with annotations and unknown image processing, this makes the screenshot unsuitable for quantitative intensity ratios, phase fractions or a strong rule that beta must always be brighter than omega. A beta brightness expectation can be tested as a soft preference on suitable raw data; it should not decide the present interpretation.

Other hypotheses remain conditional: altered site occupations or atomic positions could lift basis cancellation; a different phase could produce overlapping spots; diffuse or off-zone scattering might explain features beyond the selected sharp profiles. None is required by the four positional discrepancies alone. The exact first/second-order correspondence and observed sum vectors make double diffraction the first mechanism to test.

## Proposed next investigation

1. **Freeze a clean measured peak set.** Mask printed labels, including the residual ω₂ subscript, and preserve detector coordinates alongside IDs. Recheck the centre and parent geometry using the bright beta spots and independent nonparallel omega evidence.
2. **Add an explicit double-diffraction diagnostic before changing ranking.** Generate bounded sums of physically allowed beta/omega vectors, retain the contributing reflection identities and distinguish same-variant, parent/variant and cross-variant paths. Restrict support using observed intermediate reflections and the three-dimensional orientation relationship; arbitrary two-dimensional vector coincidences are insufficient.
3. **Keep separate evidence totals.** Report single-scattering matches, nominal-absence coincidences with candidate multiple-scattering paths, and remaining unexplained detections. Do not count the same shared spot twice or silently convert all forbidden positions into allowed ones. Compare alternative parent models against the same fixed peak set.
4. **Test competing physical explanations where the data can discriminate.** If provenance or additional diffraction images are available, use tilt-dependent disappearance, changes in thickness/region, and dark-field imaging from an allowed omega reflection. Compare an explicit partially collapsed/ordered basis or parent-related alpha only when independent evidence supports it. Quantitative discrimination would require appropriate dynamical simulations and experimental metadata.

These are research proposals. This review changes neither the indexing implementation nor the user's saved image settings.

Implementation follow-up, 9 November 2026: observed two-step path identification is now available for all selected phases and the linked beta/omega model, with separate candidate reporting. See the [implementation plan](../implementation-plan.md) for the implemented scope and validation. The measurements above retain the original review snapshot.
