# Optional TEM demo packs

Images are hosted separately, keeping GitHub source downloads small. Each pack contains **unchanged original DM4 files**, a PNG preview beside each one, and `pack.json` listing image IDs, filenames and SHA-256 checksums. The DM4 preserves its microscope metadata and calibration. No pixel conversion is applied.

The current examples are ST1221 (real-space FFT inspection), ST1144 (direct diffraction) and ST1203 (a strong BCC candidate example). These are inspection examples, not confirmed phase-identification standards.

## Download

Open **Optional demo images**, paste a pack link and click **Download demo images**. Dropbox shared folders are supported: Dropbox creates a ZIP when downloading, and the app accepts its enclosing folder. A direct HTTPS ZIP link from another host also works. Nothing downloads until requested. Progress and cancellation are available; failed downloads leave existing demos intact.

Installed images are in `demo/packs/`, ignored by Git, and appear in the **Demo** group. They use the normal DM4 reader (`ncempy`, included by the desktop installer). A source-only installation can install it with `python -m pip install ncempy`. Retain `demo/packs/` when moving an installation to avoid downloading again. Legacy NPZ demos remain readable for existing installations.

## Build and host

Create a folder for Dropbox to zip on download:

```sh
python tools/build_demo_pack.py --folder "/path/to/TEM Demo Images" /path/to/image.dm4 /path/to/another.dm4
```

Or create a portable ZIP:

```sh
python tools/build_demo_pack.py /path/to/tem-demo-images.zip /path/to/image.dm4 /path/to/another.dm4
```

The builder copies original DM4 bytes and generates 1400-pixel greyscale PNG previews (log intensity for direct diffraction). The previews never replace analysis data. Duplicate IDs and existing output paths are rejected.

Share the output folder or ZIP. Keep `pack.json` and the listed files together. To add examples, rebuild in a new location using the existing DM4s plus the new ones, then replace the hosted contents with the new files and manifest. The app remembers the link; download again to install the expanded pack. IDs such as `demo/st1221` remain stable, preserving saved-region references.

Checksums detect incomplete or corrupted downloads; use a trusted hosting link. The app verifies all files before making a pack available. No data images or previews need to be committed to Git.
