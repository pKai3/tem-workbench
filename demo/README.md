# Bundled TEM examples

The **Demo** image group includes two Grade 9 titanium specimens in the solution-treated (ST) condition:

| Example | Purpose | Stored calibration |
| --- | --- | --- |
| ST1221 (`400kX_OneView_ST_1221.dm4`) | Real-space image for local FFT inspection | 0.02953336201608181 nm/pixel on both axes |
| ST1144 (`400X_OneView_ST_1144.dm4`) | Recorded diffraction spot pattern | 0.011518612504005432 nm⁻¹/pixel on both axes |

Both contain all original **4096 × 4096 float32 pixels**. They are worked examples for inspection, not labelled phase-identification standards. ST1144 opens directly in diffraction mode, without taking an FFT of the detector image.

The `.npz` archives use lossless ZIP compression after grouping the four byte positions of each little-endian float32 pixel into separate planes. There is no quantization, denoising, cropping or resizing. `demo_data.py` reverses that grouping and verifies the reconstructed pixel SHA-256 against each JSON manifest. The manifests contain calibration and provenance without local computer paths.

The application loads both examples without ncempy or the original DM4 files. To decode directly:

```python
from demo_data import load, DIFFRACTION_ID
image, image_metadata = load()
diffraction, diffraction_metadata = load(DIFFRACTION_ID)
```
