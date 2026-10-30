# Bootstrap with an installed Python, then prepare Workbench's private environment.
$ErrorActionPreference = 'Stop'
$temRoot = Split-Path -Parent $PSScriptRoot
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'
try {
    $temPython = $null
    $temCandidates = @()
    if ($env:TEM_WORKBENCH_PYTHON) {
        $temCandidates += $env:TEM_WORKBENCH_PYTHON
    }
    $temCandidates += (Join-Path $temRoot '.venv\Scripts\python.exe')
    foreach ($temName in @('py', 'python', 'python3')) {
        $temCommand = Get-Command $temName -CommandType Application -ErrorAction SilentlyContinue
        if ($temCommand) { $temCandidates += $temCommand.Source }
    }
    foreach ($temVersion in @('312', '313', '314', '311', '310', '315')) {
        $temCandidates += (Join-Path $env:LOCALAPPDATA "Programs\Python\Python$temVersion\python.exe")
        $temCandidates += (Join-Path $env:ProgramFiles "Python$temVersion\python.exe")
    }
    foreach ($temConda in @('anaconda3', 'miniconda3', 'miniforge3')) {
        $temCandidates += (Join-Path $env:USERPROFILE "$temConda\python.exe")
    }
    foreach ($temCandidate in $temCandidates) {
        if (-not (Test-Path -LiteralPath $temCandidate -PathType Leaf)) { continue }
        # This only bootstraps stdlib setup; python_runtime selects a compatible base.
        $temSelectors = @('')
        if ([IO.Path]::GetFileNameWithoutExtension($temCandidate) -eq 'py') {
            $temSelectors = @('-3.12', '-3.13', '-3.14', '-3.11', '-3.10', '-3')
        }
        foreach ($temSelector in $temSelectors) {
            $temArgs = @()
            if ($temSelector) { $temArgs += $temSelector }
            $temArgs += @('-c', 'import sys; sys.exit(1) if sys.version_info < (3, 10) else None; print(sys.executable)')
            try {
                $temResult = & $temCandidate @temArgs 2>$null
                if ($LASTEXITCODE -eq 0 -and $temResult) { $temPython = "$temResult".Trim(); break }
            } catch { continue }
        }
        if ($temPython) { break }
    }
    if (-not $temPython) {
        throw 'No Python found. Install 64-bit Python 3.12 from python.org (include the Python launcher), then rerun this installer. Python 3.10-3.14 are supported.'
    }
    Write-Host 'Preparing Python dependencies. The first installation needs an internet connection.'
    & $temPython (Join-Path $PSScriptRoot 'python_runtime.py') --prepare
    if ($LASTEXITCODE -ne 0) { throw 'Python setup failed. Resolve the error above and rerun this installer.' }
    & (Join-Path $temRoot '.venv\Scripts\python.exe') -c 'import tkinter; root = tkinter.Tk(); root.withdraw(); root.destroy()'
    if ($LASTEXITCODE -ne 0) { throw 'The control window needs Tcl/Tk. Modify your Python installation to include Tcl/Tk, then rerun this installer.' }
    try {
        $temShell = New-Object -ComObject WScript.Shell
        $temShortcut = $temShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'TEM Workbench.lnk'))
        $temShortcut.TargetPath = Join-Path $temRoot '.venv\Scripts\pythonw.exe'
        $temShortcut.Arguments = '"' + (Join-Path $temRoot 'tools\windows_app.py') + '"'
        $temShortcut.WorkingDirectory = $temRoot
        $temShortcut.IconLocation = (Join-Path $temRoot 'windows\TEMWorkbench.ico') + ',0'
        $temShortcut.Description = 'Start TEM Workbench in your browser'
        $temShortcut.Save()
        Write-Host 'Desktop shortcut created.'
    } catch {
        Write-Warning "Could not create a desktop shortcut: $_"
    }
    Write-Host 'Ready. Double-click Launch TEM Workbench.cmd or the desktop shortcut.'
    Write-Host 'The control window provides Start/Stop, Open Workbench and View log. Closing it stops its server.'
    exit 0
} catch {
    Write-Host "Could not install TEM Workbench: $_" -ForegroundColor Red
    exit 1
}
