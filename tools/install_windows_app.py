"""Install per-user Windows shortcuts using the existing external environment."""
import base64
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from workbench_environment import (child_environment, environment_folder, require_runtime,
                                   validate_environment_location)
from workbench_updates import POINTER, write_json

APP_FILES = ('tools/windows_app.py', 'tools/windows_server.py', 'tools/windows_process.py',
             'tools/update_bridge.py', 'tools/update_workbench.py', 'workbench_updates.py',
             'VERSION', 'windows/TEMWorkbench.ico')

# Paths are passed as environment data, never interpolated into PowerShell code.
# Inline commands do not require changing the user's script execution policy.
SHORTCUT_OWNERSHIP_SCRIPT = r'''
function Test-WorkbenchShortcut($shortcut) {
    if ($shortcut.Description -eq 'TEM Workbench desktop launcher') { return $true }
    # The previous installer used this description and a checkout-local venv.
    # Require its complete target/arguments/root before migrating it.
    $legacyPython = Join-Path $env:TW_SHORTCUT_ROOT '.venv\Scripts\pythonw.exe'
    $legacyArguments = '"' + (Join-Path $env:TW_SHORTCUT_ROOT 'tools\windows_app.py') + '"'
    return ($shortcut.Description -eq 'Start TEM Workbench in your browser' -and
            $shortcut.TargetPath -eq $legacyPython -and
            $shortcut.Arguments -eq $legacyArguments -and
            $shortcut.WorkingDirectory -eq $env:TW_SHORTCUT_ROOT)
}
'''

SHORTCUT_SCRIPT = SHORTCUT_OWNERSHIP_SCRIPT + r'''
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
try {
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$description = 'TEM Workbench desktop launcher'
$destinations = @(
    (Join-Path ($shell.SpecialFolders.Item('Desktop')) 'TEM Workbench.lnk'),
    (Join-Path ($shell.SpecialFolders.Item('Programs')) 'TEM Workbench.lnk')
)
foreach ($path in $destinations) {
    if (Test-Path -LiteralPath $path) {
        $existing = $shell.CreateShortcut($path)
        if (-not (Test-WorkbenchShortcut $existing)) {
            throw "An unrelated shortcut already exists at $path. Rename it before installing."
        }
    }
}
foreach ($path in $destinations) {
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $env:TW_SHORTCUT_PYTHON
    $shortcut.Arguments = $env:TW_SHORTCUT_ARGUMENTS
    $shortcut.WorkingDirectory = $env:TW_SHORTCUT_ROOT
    $shortcut.IconLocation = $env:TW_SHORTCUT_ICON + ',0'
    $shortcut.Description = $description
    $shortcut.Save()
    Write-Output "Installed $path"
}
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
'''


def shortcut_environment(root, folder, environ=None):
    root, folder = Path(root).resolve(), Path(folder).resolve()
    validate_environment_location(folder, root)
    for name in APP_FILES:
        if not (root / name).is_file():
            raise RuntimeError('Missing ' + name + '. Extract the complete repository before installing.')
    python = folder / 'Scripts/pythonw.exe'
    if not python.is_file():
        raise RuntimeError('The windowed Python launcher is missing. Run 1 - Install TEM Workbench - Windows.bat first.')
    env = dict(os.environ if environ is None else environ)
    env.update(TW_SHORTCUT_ROOT=str(root), TW_SHORTCUT_PYTHON=str(python),
               TW_SHORTCUT_ICON=str(root / 'windows/TEMWorkbench.ico'),
               TW_SHORTCUT_ARGUMENTS=subprocess.list2cmdline([
                   str(root / 'tools/windows_app.py'), '--environment', str(folder)]))
    return env


def install(root=ROOT, folder=None):
    require_runtime()
    if sys.platform != 'win32':
        raise RuntimeError('Use 1 - Install TEM Workbench - macOS.command on macOS.')
    folder = folder or environment_folder(root)
    env = shortcut_environment(root, folder)
    # Tcl/Tk belongs to the Python installation, not a package downloaded by pip.
    try:
        subprocess.run([str(Path(folder) / 'Scripts/python.exe'), '-c',
                        'import tkinter as tk; w = tk.Tk(); w.withdraw(); w.destroy()'],
                       cwd=root, env=child_environment(folder), check=True)
    except subprocess.CalledProcessError as error:
        raise RuntimeError('Python could not open the desktop interface. Use the complete '
                           'Python 3.14 installer with Tcl/Tk, then rerun this installer.') from error
    encoded = base64.b64encode(SHORTCUT_SCRIPT.encode('utf-16-le')).decode('ascii')
    try:
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            cwd=root, env=env, check=True, capture_output=True, encoding='utf-8', errors='replace')
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or 'PowerShell could not create the shortcuts.').strip()
        raise RuntimeError('Shortcut creation failed: ' + detail) from error
    if result.stdout:
        print(result.stdout.strip(), flush=True)
    # A refreshed custom installation must also update the selection used by
    # older pinned shortcuts. They may still carry the previous --environment.
    if (Path(root) / POINTER).exists():
        write_json(Path(root) / POINTER, {'schema_version': 1, 'environment': str(Path(folder).resolve())})
    print('Ready. Open TEM Workbench from your desktop or Start menu.\n'
          'The control window has Start/Stop, Open Workbench and a live View log.\n'
          'Keep the code folder in place; rerun this installer if you move it.', flush=True)


if __name__ == '__main__':
    try:
        install()
    except Exception as error:
        print('Could not install the Windows app:', error, file=sys.stderr)
        print('See SETUP.md for help.', file=sys.stderr)
        raise SystemExit(1)
