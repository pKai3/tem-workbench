@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUNBUFFERED=1"
set "PYTHONDONTWRITEBYTECODE=1"
set "PYTHONUTF8=1"
set "tem_python=%~dp0.venv\Scripts\python.exe"
if not exist "%tem_python%" goto missing
"%tem_python%" "%~dp0tools\python_runtime.py" --check
if errorlevel 1 goto failed
echo Keep this window open while using TEM Workbench. Press Ctrl+C to stop.
"%tem_python%" "%~dp0server.py" --open --fallback-port %*
if errorlevel 1 goto failed
exit /b 0
:missing
echo Run Install TEM Workbench App.cmd first to prepare this computer.
:failed
echo TEM Workbench could not start or stopped with an error. See the message above.
pause
exit /b 1
