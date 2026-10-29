"""Prepare and launch Workbench's own Python environment, using only stdlib."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

MIN_VERSION = (3, 10)
MAX_VERSION = (3, 15)  # Exclusive: desktop dependencies need wheels for this Python.
CORE_IMPORTS = ('numpy', 'scipy.ndimage', 'scipy.optimize', 'PIL.Image')
PACKAGE_NAMES = {'numpy': 'NumPy', 'scipy.ndimage': 'SciPy',
                 'scipy.optimize': 'SciPy', 'PIL.Image': 'Pillow (PIL)',
                 'ncempy.io.dm': 'ncempy (DM4 reader)'}


def executable_path(value, root, environ):
    path = Path(value).expanduser()
    if path.is_absolute() or len(path.parts) > 1:
        path = path if path.is_absolute() else Path(root) / path
        # Resolving the python symlink would bypass its virtual environment.
        result = str(path.absolute())
    else:
        result = shutil.which(value, path=environ.get('PATH', os.defpath))
    if not result or not os.access(result, os.X_OK):
        raise RuntimeError(f'Python executable not found: {value}. '
                           'Check TEM_WORKBENCH_PYTHON, which selects the installer’s base Python.')
    return result


def python_info(executable):
    try:
        result = subprocess.run([str(executable), '-c',
            'import json,sys; print(json.dumps({"version":list(sys.version_info[:2]),'
            '"venv":sys.prefix != sys.base_prefix,"prefix":sys.prefix}))'],
            check=True, text=True, capture_output=True, timeout=15)
        info = json.loads(result.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise RuntimeError(f'Could not run Python at {executable}. '
                           'Virtual environments cannot be copied between computers; recreate .venv on this Mac.') from error
    return info


def compatible(info):
    return MIN_VERSION <= tuple(info['version']) < MAX_VERSION


def require_compatible(executable, info):
    if not compatible(info):
        raise RuntimeError(f'{executable} is Python {".".join(map(str, info["version"]))}; '
                           'TEM Workbench currently supports Python 3.10–3.14 (3.12 preferred). '
                           'Rerun Install TEM Workbench App.command to prepare a compatible .venv.')


def discover_python(root, environ):
    # Finder does not inherit the interactive shell's Homebrew/python.org PATH.
    versions = ('3.12', '3.13', '3.14', '3.11', '3.10')
    candidates = []
    for version in versions:
        candidates += [f'python{version}', f'/opt/homebrew/bin/python{version}',
                       f'/usr/local/bin/python{version}',
                       f'/Library/Frameworks/Python.framework/Versions/{version}/bin/python{version}']
    # Conda installs are often absent from Finder's PATH, but can seed a venv.
    for name in ('anaconda3', 'miniconda3', 'miniforge3', 'mambaforge'):
        candidates += [str(Path.home() / name / 'bin/python3'), f'/opt/{name}/bin/python3']
    candidates += ['python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', sys.executable]
    for candidate in dict.fromkeys(candidates):
        try:
            executable = executable_path(candidate, root, environ)
            require_compatible(executable, python_info(executable))
            return executable
        except RuntimeError:
            continue
    raise RuntimeError('No compatible Python 3.10–3.14 was found. Install Python 3.12 from python.org '
                       'or Homebrew (brew install python@3.12), then rerun Install TEM Workbench App.command.')


def local_python(root):
    """Reject external environments before the installer can modify packages."""
    root = Path(root).resolve()
    environment = root / '.venv'
    if environment.is_symlink():
        raise RuntimeError('Workbench needs its own .venv directory, not a link to another environment. '
                           'Remove the link and rerun Install TEM Workbench App.command.')
    local = environment / 'bin/python'
    if not local.exists():
        raise RuntimeError('Workbench’s .venv is missing or incomplete. '
                           'Run Install TEM Workbench App.command to prepare it. '
                           'If an incomplete .venv directory exists, move it aside first.')
    executable = str(local)
    info = python_info(executable)
    if not info['venv'] or Path(info['prefix']).resolve() != environment.resolve():
        raise RuntimeError('The .venv Python belongs to a different environment. '
                           'Move .venv aside and rerun Install TEM Workbench App.command.')
    return executable, info


def select_python(root):
    # Launch never follows legacy config, an environment override, or PATH.
    executable, info = local_python(root)
    require_compatible(executable, info)
    return executable


def check_dependencies(executable, include_dm4=False):
    modules = (*CORE_IMPORTS, 'ncempy.io.dm') if include_dm4 else CORE_IMPORTS
    probe = '''import importlib,json,sys
failures = {}
for name in json.loads(sys.argv[1]):
    try:
        importlib.import_module(name)
    except Exception as error:
        failures[name] = str(error)
print(json.dumps(failures))
'''
    try:
        result = subprocess.run([str(executable), '-c', probe, json.dumps(modules)],
                                check=True, text=True, capture_output=True, timeout=60)
        failures = json.loads(result.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise RuntimeError(f'Python dependency check failed for {executable}. '
                           'Rerun Install TEM Workbench App.command to repair the environment.') from error
    if failures:
        details = '; '.join(f'{PACKAGE_NAMES[name]}: {message}' for name, message in failures.items())
        raise RuntimeError(f'Python dependencies are missing or broken in {executable}: {details}. '
                           'Rerun Install TEM Workbench App.command to install them into .venv.')


def prepare_python(root, environ=None):
    root = Path(root).resolve()
    environ = os.environ if environ is None else environ
    environment = root / '.venv'
    replacement = False
    if environment.exists() or environment.is_symlink():
        _, info = local_python(root)
        replacement = not compatible(info)
    if not environment.exists() or replacement:
        # The override only seeds a NEW local venv; it is never a package target.
        override = environ.get('TEM_WORKBENCH_PYTHON', '').strip()
        base = executable_path(override, root, environ) if override else discover_python(root, environ)
        require_compatible(base, python_info(base))
        if replacement:
            previous = root / '.venv.previous'
            if previous.exists() or previous.is_symlink():
                raise RuntimeError('Move .venv.previous aside before replacing the incompatible .venv.')
            environment.rename(previous)
            print(f'Previous incompatible environment kept at {previous}', flush=True)
        print(f'Creating the app’s Python environment with {base}', flush=True)
        subprocess.run([base, '-m', 'venv', str(environment)], check=True)
    executable = select_python(root)
    print(f'Installing/checking NumPy, SciPy, Pillow and the DM4 reader in {executable}', flush=True)
    subprocess.run([executable, '-m', 'ensurepip', '--upgrade'], check=True)
    subprocess.run([executable, '-m', 'pip', 'install', '--only-binary=numpy,scipy,h5py,pillow', '-r',
                    str(root / 'requirements-desktop.txt')], check=True)
    check_dependencies(executable, include_dm4=True)
    print('Python dependencies are ready.', flush=True)
    return executable


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check imports before launching')
    parser.add_argument('--prepare', action='store_true', help='Create/repair the local .venv without building the Dock app')
    args = parser.parse_args()
    try:
        root = Path(__file__).resolve().parents[1]
        executable = prepare_python(root) if args.prepare else select_python(root)
        if args.check:
            check_dependencies(executable)
        print(executable)
        return 0
    except RuntimeError as error:
        print(f'TEM Workbench could not start: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
