"""Shared Mac/Windows setup and launch. Never read or process research data."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import struct
import subprocess
import sys
import sysconfig
import venv

ROOT = Path(__file__).resolve().parent
PYTHON_VERSION = (3, 14)
ENVIRONMENT_TAG = 'py314'


def check_project_files(root):
    if (root / '.tem-update.lock').exists():
        raise RuntimeError('An update is in progress or needs recovery. Open Check for updates '
                           'in the desktop launcher to restore the previous version before starting.')
    required = ('server.py', 'analysis_core.py', 'web/index.html', 'web/app.js',
                'requirements.txt', 'requirements-desktop.txt', 'workbench_environment.py')
    unavailable = []
    for name in required:
        try:
            info = (root / name).stat()
            if not stat.S_ISREG(info.st_mode):
                unavailable.append(name + ' (not a file)')
            elif getattr(info, 'st_flags', 0) & getattr(stat, 'SF_DATALESS', 0):
                unavailable.append(name + ' (online-only)')
        except FileNotFoundError:
            unavailable.append(name + ' (missing)')
    if unavailable:
        raise RuntimeError('Restore/download these workbench files before continuing: '
                           + ', '.join(unavailable))


def require_runtime():
    supported = {'win32': ('amd64', 'x86_64'), 'darwin': ('arm64', 'aarch64', 'x86_64'), 'linux': ('x86_64', 'aarch64', 'arm64')}
    if (sys.platform not in supported or sys.version_info[:2] != PYTHON_VERSION
            or struct.calcsize('P') != 8 or sysconfig.get_config_var('Py_GIL_DISABLED')
            or platform.machine().lower() not in supported[sys.platform]):
        raise RuntimeError('Use standard 64-bit Python 3.14: Windows x86-64, or Mac Apple Silicon/Intel. '
                           'See SETUP.md. Free-threaded Python is not supported.')


def python_in(folder, system):
    return folder / ('Scripts/python.exe' if system == 'win32' else 'bin/python')


def environment_folder(root=ROOT, system=None, environ=None, user_home=None):
    system = system or sys.platform
    environ = os.environ if environ is None else environ
    if environ.get('TEM_ENV_DIR'):
        folder = Path(environ['TEM_ENV_DIR']).expanduser()
        if not folder.is_absolute():
            raise ValueError('TEM_ENV_DIR must be an absolute path outside the project and cloud storage.')
        return folder
    pointer = Path(root) / '.tem-environment.json'
    if pointer.is_file():
        try:
            value = json.loads(pointer.read_bytes())
            folder = Path(value['environment']).expanduser()
            if value.get('schema_version') != 1 or not folder.is_absolute():
                raise ValueError('invalid environment path')
            validate_environment_location(folder, Path(root), environ)
        except (ValueError, KeyError, TypeError) as error:
            raise RuntimeError('The saved update environment is invalid. Use update recovery or rerun the app installer.') from error
        return folder
    if system == 'darwin':
        base = Path(user_home or Path.home()) / 'Library/Application Support/TEM Workbench'
    elif system == 'win32' and environ.get('LOCALAPPDATA'):
        base = Path(environ['LOCALAPPDATA']) / 'TEMWorkbench'
    elif system == 'linux':
        base = Path(environ.get('XDG_DATA_HOME', Path(user_home or Path.home()) / '.local/share')) / 'tem-workbench'
    else:
        raise RuntimeError('Windows LOCALAPPDATA is missing, or this platform is unsupported. See SETUP.md.')
    # Python environments cannot be upgraded by moving/copying them. Keep the
    # previous interpreter and its caches intact and build this version beside it.
    key = hashlib.sha256(os.path.normcase(str(Path(root).resolve())).encode()).hexdigest()[:16]
    return base / 'installations' / key / ENVIRONMENT_TAG / 'venv'


def validate_environment_location(folder, root=ROOT, environ=None):
    """Refuse project/cloud environments; never move or delete an existing one."""
    environ = os.environ if environ is None else environ
    target, code = folder.resolve(), root.resolve()
    if target == code or target.is_relative_to(code) or code.is_relative_to(target):
        raise ValueError('The Python environment must be separate from the workbench code folder.')
    parts = [part.casefold() for part in target.parts]
    if any(part == 'cloudstorage' or part.startswith(('onedrive', 'dropbox'))
           or part in ('mobile documents', 'google drive', 'googledrive', 'icloud drive') for part in parts):
        raise ValueError('The Python environment must be outside OneDrive and other cloud-synced folders.')
    for name in ('OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'):
        if environ.get(name) and target.is_relative_to(Path(environ[name]).expanduser().resolve()):
            raise ValueError('The Python environment must be outside OneDrive.')


def child_environment(folder):
    env = os.environ.copy()
    for name in ('PYTHONHOME', 'PYTHONPATH', 'PYTHONPYCACHEPREFIX'):
        env.pop(name, None)
    env.update(PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1',
               PYTHONUNBUFFERED='1')
    return env


# Check the target before pip can make any changes, even with a custom location.
RUNTIME_CHECK = r'''
import sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root))
from workbench_environment import require_runtime
require_runtime()
if sys.prefix == sys.base_prefix or Path(sys.prefix).resolve() != Path(sys.argv[2]).resolve():
    raise RuntimeError('Expected an isolated virtual environment, not system Python.')
'''

# Ordinary launch validates installed versions and definitions without importing the
# numerical/UI stack in a throwaway process before the server imports it again.
PREFLIGHT_CHECK = RUNTIME_CHECK + r'''
import importlib.metadata
from packaging.requirements import Requirement
for name in ('requirements.txt', 'requirements-desktop.txt'):
    for line in (root / name).read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith(('#', '-r ')):
            continue
        requirement = Requirement(line)
        if requirement.marker and not requirement.marker.evaluate():
            continue
        actual = importlib.metadata.version(requirement.name)
        if actual not in requirement.specifier:
            raise RuntimeError(f'{requirement.name} {actual} does not satisfy {requirement}; rerun the app installer.')
'''
QUICK_CHECK = PREFLIGHT_CHECK + "\nprint('Dependencies OK. No data processed.', flush=True)\n"
CHECK = PREFLIGHT_CHECK + r'''
import importlib
for module in ('numpy', 'scipy.ndimage', 'scipy.optimize', 'PIL.Image', 'h5py', 'ncempy.io.dm'):
    importlib.import_module(module)
print('Dependencies and imports OK. No data processed.', flush=True)
'''


def run(command, root, env):
    return subprocess.run([str(part) for part in command], cwd=root, env=env, check=True)


def verify(python, root, env, full=True):
    run([python, '-c', CHECK if full else QUICK_CHECK, root, python.parent.parent], root, env)


def setup(folder, root=ROOT, system=None):
    system = system or sys.platform
    validate_environment_location(folder, root)
    python = python_in(folder, system)
    env = child_environment(folder)
    print('Setting up TEM Workbench. Stop any running Workbench analysis first.', flush=True)
    print('Environment:', folder, flush=True)
    if not python.is_file():
        if folder.exists() and any(folder.iterdir()):
            raise RuntimeError('An incomplete or broken environment already exists at ' + str(folder)
                               + '. It was not overwritten. See SETUP.md for recovery.')
        print('Creating an environment outside the project folder...', flush=True)
        venv.EnvBuilder(with_pip=True).create(folder)
    else:
        print('Reusing the existing environment; no duplicate will be created.', flush=True)
    run([python, '-c', RUNTIME_CHECK, root, folder], root, env)
    # Keep compatible packages; do not retain a download cache or compile wheels.
    run([python, '-m', 'pip', 'install', '--no-cache-dir', '--only-binary=:all:',
         '-r', root / 'requirements-desktop.txt'], root, env)
    run([python, '-m', 'pip', 'check'], root, env)
    verify(python, root, env)
    installed = subprocess.check_output([str(python), '-m', 'pip', 'freeze'],
                                        cwd=root, env=env, text=True)
    (folder.parent / 'installed-packages.txt').write_text(installed, encoding='utf-8')
    (folder.parent / 'setup-complete.json').write_text(json.dumps({
        'completed': datetime.now().astimezone().isoformat(),
        'requirements_sha256': hashlib.sha256((root / 'requirements.txt').read_bytes()).hexdigest(),
        'environment': str(folder),
    }, indent=2) + '\n', encoding='utf-8')
    from workbench_updates import POINTER, write_json
    write_json(root / POINTER, {'schema_version': 1, 'environment': str(folder.resolve())})
    print('\nEnvironment ready. The app installer creates the desktop launcher.', flush=True)


def main(argv=None, root=None):
    root = Path(root or ROOT).resolve()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('setup', 'launch', 'check', 'install-app', 'desktop'))
    action = parser.parse_args(argv).action
    require_runtime()
    check_project_files(root)
    folder = environment_folder(root)
    validate_environment_location(folder, root)
    if action in ('install-app', 'desktop') and sys.platform != 'win32':
        raise RuntimeError('Use 1 - Install TEM Workbench - macOS.command for the Mac app.')
    if action in ('setup', 'install-app'):
        setup(folder, root)
        if action == 'install-app':
            run([python_in(folder, 'win32'), root / 'tools/install_windows_app.py'], root, child_environment(folder))
        return 0
    python = python_in(folder, sys.platform)
    if not python.is_file():
        raise RuntimeError('The workbench environment was not found. Run Install TEM Workbench App.'
                           + ('cmd' if sys.platform == 'win32' else 'command') + ' first. See SETUP.md.')
    print('Using environment:', folder, flush=True)
    env = child_environment(folder)
    if action == 'desktop':
        pythonw = folder / 'Scripts/pythonw.exe'
        launcher = root / 'tools/windows_app.py'
        if not pythonw.is_file() or not launcher.is_file():
            raise RuntimeError('Run 1 - Install TEM Workbench - Windows.bat first.')
        # The control window performs preflight in its managed child and shows errors.
        subprocess.Popen([str(pythonw), str(launcher), '--environment', str(folder)],
                         cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, close_fds=True,
                         creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return 0
    verify(python, root, env, full=action == 'check')
    if action == 'launch':
        print('The web app opens automatically. '
              + ('Use the Dock app to view logs or stop the server.' if os.environ.get('TEM_DESKTOP_APP') == '1'
                 else 'Leave this window open; Ctrl-C stops the server.'), flush=True)
        os.execve(str(python), [str(python), str(root / 'server.py'), '--fallback-port', '--open'], env)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print('\nStopped.')
        raise SystemExit(130)
    except Exception as error:
        print('\nCould not complete setup/launch:', error, file=sys.stderr)
        print('See SETUP.md. No research data or plots were processed.', file=sys.stderr)
        raise SystemExit(1)
