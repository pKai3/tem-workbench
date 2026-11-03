# Methods manuscript draft

[Read the paper draft](tem-workbench-manuscript.pdf) · [Editable manuscript](tem-workbench-manuscript.md) · [Workflow figure](workflow.svg) · [Architecture atlas](../architecture/README.md)

Prepared 4 November 2026 against implementation `64118d8`. This is a methods-first draft, with sixteen equations, a workflow figure, documented development checks and references to prior indexing and local-FFT decomposition work. Historical benchmarks are labelled by date; their values are not presented as current-release measurements. No new numerical analysis or phase-identification validation was performed for this document.

The PCA/NMF section is a **proposal**, not implemented behaviour or a demonstrated improvement. The implementation still matches windows independently before spatial aggregation. Candidate support and factor loadings must not be described as measured phase fractions.

## Before submission

- Confirm authorship, affiliations, contributions, funding and the journal's required AI-assistance disclosure.
- Establish independent ground truth, evaluation groups and held-out validation; repeated zooms and overlapping windows are not independent samples.
- Add authorized experimental images, acquisition conditions and a released evaluation dataset.
- Complete comparisons with existing methods and finalize the novelty statement from the evidence.
- Check final bibliographic formatting and update the implementation snapshot for the release being reported.

## Rebuild

Documentation-only dependencies: ReportLab and a Unicode TrueType font (DejaVu Sans recommended). These are not added to the application runtime requirements.

```sh
python tools/render_paper.py --font /path/to/DejaVuSans.ttf
```

The renderer reads the Markdown manuscript and writes the PDF and editable SVG workflow. Explicit page-break and figure comments control layout. Inspect every rendered page after edits. Durable figure changes belong in `tools/render_paper.py`.

## Implementation traceability

| Methods topic | Main sources |
| --- | --- |
| Signal extraction and geometry | `analysis_core.py`, `diffraction.py` |
| Crystal library and metric fitting | `crystal_templates.py`, `orthorhombic.py`, `scale_fitting.py`, `materials.py` |
| Peak evidence and competing explanations | `peak_evidence.py`, `phase_comparison.py` |
| Automatic strength and request isolation | `engine.py`, `server.py` |
| Adaptive, overlapping and batch maps | `adaptive_refinement.py`, `overlap_maps.py`, `batch_grids.py`, `window_size_probe.py` |
| Parallel execution | `parallel_execution.py`, `docs/parallel-performance.md` |
| Recorded regressions | `docs/reviews/2026-11-03-follow-up.md` |

References were checked on 4 November 2026 against original papers, author manuscripts or official documentation. The draft credits established methods rather than claiming invention of automatic indexing, local Fourier mapping or decomposition.
