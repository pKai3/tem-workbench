"""Find and prepare the Python used by the Mac launcher, using only stdlib."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

MIN_VERSION = (3, 10)
CORE_IMPORTS = ('numpy', 'scipy.ndimage', 'scipy.optimize', 'PIL.Image')
PACKAGE_NAMES = {'numpy': 'NumPy', 'scipy.ndimage': 'SciPy',
                 'scipy.optimize': 'SciPy', 'PIL.Image': 'Pillow (PIL)',
                 'ncempy.io.dm': 'ncempy (DM4 reader)'}


def configured_python(root, environ):
    override = environ.get('TEM_WORKBENCH_PYTHON', '').strip()
    if override:
        return override
    config = Path(root) / '.tem-paths.json'
    if not config.is_file():
        return None
    try:
        value = json.loads(config.read_text()).get('python_executable')
        if value is not None and not isinstance(value, str):
            raise ValueError('python_executable must be a path or command name')
        return value.strip() if value and value.strip() else None
    except (ValueError, AttributeError, OSError) as error:
        raise RuntimeError(f'Cannot read {config}: {error}') from error


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
                           'Check TEM_WORKBENCH_PYTHON or python_executable in .tem-paths.json.')
    return result


def python_info(executable):
    try:
        result = subprocess.run([str(executable), '-c',
            'import json,sys; print(json.dumps({"version":list(sys.version_info[:2]),'
            '"venv":sys.prefix != sys.base_prefix}))'],
            check=True, text=True, capture_output=True, timeout=15)
        info = json.loads(result.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise RuntimeError(f'Could not run Python at {executable}. '
                           'Virtual environments cannot be copied between computers; recreate .venv on this Mac.') from error
    if tuple(info['version']) < MIN_VERSION:
        raise RuntimeError(f'{executable} is Python {".".join(map(str, info["version"]))}; '
                           'TEM Workbench needs Python 3.10 or newer (3.12 recommended).')
    return info


def discover_python(root, environ):
    # Finder does not inherit the interactive shell's Homebrew/python.org PATH.
    versions = ('3.12', '3.13', '3.14', '3.11', '3.10')
    candidates = []
    for version in versions:
        candidates += [f'python{version}', f'/opt/homebrew/bin/python{version}',
                       f'/usr/local/bin/python{version}',
                       f'/Library/Frameworks/Python.framework/Versions/{version}/bin/python{version}']
    candidates += ['python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', sys.executable]
    for candidate in dict.fromkeys(candidates):
        try:
            executable = executable_path(candidate, root, environ)
            python_info(executable)
            return executable
        except RuntimeError:
            continue
    raise RuntimeError('No Python 3.10 or newer was found. Install Python 3.12 from python.org, '
                       'then rerun Install TEM Workbench App.command. Apple’s system Python may be too old.')


def select_python(root, environ=None):
    root = Path(root).resolve()
    environ = os.environ if environ is None else environ
    override = configured_python(root, environ)
    local = root / '.venv/bin/python'
    if override:
        executable = executable_path(override, root, environ)
    elif local.exists() or local.is_symlink():
        executable = executable_path(str(local), root, environ)
    else:
        executable = discover_python(root, environ)
    python_info(executable)
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
                           'Rerun Install TEM Workbench App.command to install them. '
                           'For a custom Python, install requirements.txt into that same environment.')


def prepare_python(root, environ=None):
    root = Path(root).resolve()
    environ = os.environ if environ is None else environ
    override = configured_python(root, environ)
    local = root / '.venv/bin/python'
    if not override and not local.exists() and not local.is_symlink():
        if (root / '.venv').exists():
            raise RuntimeError('An incomplete .venv already exists. Move it aside and rerun the installer; '
                               'it has not been replaced.')
        base = discover_python(root, environ)
        print(f'Creating the app’s Python environment with {base}', flush=True)
        subprocess.run([base, '-m', 'venv', str(root / '.venv')], check=True)
    executable = select_python(root, environ)
    if not python_info(executable)['venv']:
        # A configured system Python is usable if already provisioned, but the
        # installer must not write packages into a global Python installation.
        check_dependencies(executable, include_dm4=True)
        print(f'Using configured Python: {executable}', flush=True)
        return executable
    print(f'Installing/checking NumPy, SciPy, Pillow and the DM4 reader in {executable}', flush=True)
    subprocess.run([executable, '-m', 'ensurepip', '--upgrade'], check=True)
    subprocess.run([executable, '-m', 'pip', 'install', '-r',
                    str(root / 'requirements-desktop.txt')], check=True)
    check_dependencies(executable, include_dm4=True)
    print('Python dependencies are ready.', flush=True)
    return executable


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check imports before launching')
    args = parser.parse_args()
    try:
        executable = select_python(Path(__file__).resolve().parents[1])
        if args.check:
            check_dependencies(executable)
        print(executable)
        return 0
    except RuntimeError as error:
        print(f'TEM Workbench could not start: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
