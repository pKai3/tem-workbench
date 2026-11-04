"""Compatibility entry point; managed desktop environments now live outside the checkout."""
import argparse
from pathlib import Path
import subprocess
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    action = 'setup' if args.prepare else 'check'
    command = ([str(root / 'tools/run_windows.bat'), action] if sys.platform == 'win32'
               else ['/bin/zsh', str(root / 'tools/run_macos.sh'), action if action == 'setup' else 'launch-check'])
    return subprocess.call(command, cwd=root)


if __name__ == '__main__':
    raise SystemExit(main())
