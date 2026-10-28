# ST1221 demo

Full-resolution image 400kX_OneView_ST_1221 from the Grade 9 titanium ST specimen.
The bundled image contains all original 4096 × 4096 float32 pixels, with the
stored calibration of 0.02953336201608181 nm/pixel along both axes. This is a
worked example for FFT inspection, not a labelled phase-identification standard.

`st1221.npz` uses lossless ZIP compression after grouping the four byte positions
of each little-endian float32 pixel into separate planes. It does not quantize,
denoise, crop or resize the image. `demo_data.py` reverses that grouping and
checks the reconstructed pixel SHA-256 against `st1221.json`. The manifest
contains calibration and provenance without local computer paths.

The demo is loaded by the application without ncempy or the original DM4 file.
To decode directly:

```python
from demo_data import load
pixels, metadata = load()
```
