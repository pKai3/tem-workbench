# TEM Workbench 1.0.4

- Fix the Mac update window failing to open when the analysis environment uses Homebrew Python without Tk. The window can use an existing Tk-capable Python 3.14 while preserving the active analysis environment.
- If no suitable window runtime exists, explain how to install the missing component.

- Keep typed fitting-radius changes local to the image, and restore shared limits when switching to an image without a saved override.
