# Parallel analysis: initial measurements

30 October 2026 · branch `perf/parallel-analysis`

The implementation parallelizes complete real-space regions using spawned processes and independent direct-diffraction smoothing scales using threads. It does not change the detector thresholds, candidate library, fitting objective, automatic strength selection or phase criteria.

## Grid results

Machine: Apple M3 Pro, 11 logical CPUs, 18 GiB RAM; Python 3.12.2, NumPy 2.5.4, SciPy 1.18.1. Input: ST1203, 4096 × 4096 pixels. HCP and BCC enabled, automatic minimum strength, overall-scale/HCP c/a mode, 3–10 nm⁻¹ fitting band, default 0.10 scoring weights. The full settings and result fingerprints are in the [measurement record](benchmarks/parallel-2026-10-30.json).

| Workload | 1 worker | 2 workers | 4 workers | Speedup, 1 → 4 |
| --- | ---: | ---: | ---: | ---: |
| Uniform 10 × 10, 100 regions | 118.30 s | 67.38 s | 38.07 s | 3.11× |
| Adaptive 4 × 4, passing-region checks, 5 nm minimum | 103.93 s | 60.56 s | 33.17 s | 3.13× |

Every worker count produced identical result fingerprints after excluding timing, engine-version metadata and private compressed caches. This comparison includes detected peaks, candidate scores, classifications, region IDs, leaf flags and adaptive decisions. The adaptive workload analysed 80 regions and retained 61 map regions. A second uniform run in reversed worker-count order reproduced the result and timing (38.07 / 118.30 s versus the initial 38.73 / 118.28 s).

These timings include copying the loaded source into a temporary mapped file, worker startup, analysis and pool shutdown; file loading is excluded. The baseline uses one process through the same coordinator, rather than the previous in-server loop. These are short local measurements, not a guarantee for other machines or images. Eight-worker execution has not been benchmarked; Auto therefore caps at four.

A manual ST1203 region with automatic strength enabled returned in **0.624 s while a four-worker grid was running**. Cancelling that grid completed in **0.432 s**. Cancellation can take longer if a current fitting trial is expensive.

## Direct diffraction

STA1096 was analysed from a fresh detector cache for every run, including the starting-centre and refined-centre detector passes. The loaded detector pixels were reused; file loading and preview creation are excluded.

| Smoothing threads | Cold analysis time | Detected spots |
| --- | ---: | ---: |
| 1 | 12.28 / 12.08 s | 18 |
| 2 | 9.03 / 8.79 s | 18 |
| 4 | 7.83 s | 18 |

All runs returned identical analysis fingerprints. The selectable Auto default is **two** threads (the Direct diffraction controls also offer 1 / 2 / 4 / 8) to limit temporary-array memory and leave capacity for interactive/grid work. It improves this example by about 1.37×. The fitting stage remains sequential.

## Resource use and lifecycle

- One 4096² float32 source occupies 64 MiB in a temporary `.npy` file. Workers map it read-only; it is not sent with each ROI. Normal pool shutdown removes it.
- A short four-worker run on 512² regions sampled up to 99.3 MiB resident per worker and 391.8 MiB summed worker RSS, excluding the backend. Shared mapped pages can be counted repeatedly in RSS. This is not a peak bound: larger ROIs, fitting bands and candidate pools can require more memory.
- At most one task per worker is submitted ahead of ordered publication. Numeric library threads are capped to avoid multiplying BLAS/OpenMP pools, and grid FFTs use one internal worker each.
- Cooperative cancellation is checked between automatic-strength trials. A parent remains visible until all four child results can be published together. Unprocessed initial cells remain uncovered, and incomplete trial children are excluded from map totals.
- A normal SIGTERM shutdown of the isolated test backend left no surviving workers or resource tracker. A separate abrupt-parent-exit check also left no surviving workers. Hard termination can leave the temporary source file in the OS temp folder; this is a cache, not saved analysis.
- Spawn is used on macOS and Windows. Windows workers select the environment's `pythonw.exe` when available to avoid extra console windows. Native Windows end-to-end validation is still required; the measured runs and live UI checks were on macOS.

## Validation and reproduction

All 100 automated tests passed. New checks compare direct serial analysis with actual spawned workers and cached reweighting, compare sequential/threaded detector output, and exercise cancellation, worker errors and adaptive coverage. Existing launcher/storage tests also passed. Browser checks confirmed worker preference persistence, progress, cancellation, cached reweight eligibility and interactive analysis during a grid, with no JavaScript errors.

From the repository, using its Python environment:

```sh
python tools/benchmark_parallel.py --file ST/Gatan/1MX_OneView_ST_1203.dm4 --count 10 --auto-strength --workers 1 2 4 --output uniform-benchmark.json
python tools/benchmark_parallel.py --file ST/Gatan/1MX_OneView_ST_1203.dm4 --count 4 --adaptive --check-passing --minimum-nm 5 --auto-strength --workers 1 2 4 --output adaptive-benchmark.json
```

Use `--data-root` for another collection and `--settings` for a JSON settings dictionary. The script prints elapsed time, map counts and fingerprints, fails if worker counts change results, and does not save project/analysis state. Run performance comparisons without other analysis jobs competing for the CPU.
