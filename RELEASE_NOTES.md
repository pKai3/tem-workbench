# TEM Workbench 1.0.8

- Restore 2.5–10 nm⁻¹ fitting limits in both modes for images without overrides; ignore contaminated legacy shared limits. FFT Reset defaults uses the same band.


- Fix the Mac update window failing to open when the analysis environment uses Homebrew Python without Tk. The window can use an existing Tk-capable Python 3.14 while preserving the active analysis environment.
- If no suitable window runtime exists, explain how to install the missing component.

- Keep typed fitting-radius changes local to the image, and restore shared limits when switching to an image without a saved override.

- Show reflection-derived cell dimensions beside vector distances in the bottom-left overlay key, including PNG/GIF exports.
- Add Fitted planes vector options alongside Measured planes and A/B/C, retaining enabled-phase filtering and saved selection.
- Show the fitted HCP c/a ratio beside the zone axis in vector keys, including exports; retain unconstrained status when c is not observable.
- Show a for mixed HCP vector reflections using the fitted c/a ratio, with its dependency explained on hover.
- Rename candidate Scale Δ to Cell Δ and display real-space a/b/c changes: positive means larger than reference. Keep the real c/a change convention unchanged.
- Put Fitted planes above Measured planes; measured HCP c/a and mixed-reflection dimensions now use the displayed measured pair rather than the fitted ratio.
- Label plane vectors directly with phase and reflection indices instead of P1/P2, respecting HCP three/four-index notation.
- Fix FFT Reset defaults omitting fitting limits: restore and remember central 3 / outer 10 nm⁻¹ while retaining explicit saved image overrides.
