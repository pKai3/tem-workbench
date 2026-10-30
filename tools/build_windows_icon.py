"""Regenerate the checked-in Windows icon from the original macOS vector artwork.

Run on macOS with Apple Command Line Tools and Pillow installed.
Windows users use the generated ICO; they do not need these build tools.
"""
from pathlib import Path
import subprocess
import tempfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix='tem-icon-') as directory:
        build = Path(directory)
        binary = build / 'make-icon'
        subprocess.run(['/usr/bin/xcrun', 'swiftc', '-module-cache-path',
                        str(build / 'module-cache'), '-framework', 'AppKit',
                        str(ROOT / 'macos/Icon.swift'), '-o', str(binary)], check=True)
        iconset = build / 'iconset'
        subprocess.run([str(binary), str(iconset)], check=True)
        destination = ROOT / 'windows/TEMWorkbench.ico'
        destination.parent.mkdir(exist_ok=True)
        with Image.open(iconset / 'icon_512x512@2x.png') as source:
            source.save(destination, format='ICO',
                        sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
        print(destination)


if __name__ == '__main__':
    main()
