@echo off
setlocal
set "PYTHONUTF8=1"
set "tem_python=%~dp0.venv\Scripts\pythonw.exe"
if not exist "%tem_python%" goto missing
start "" "%tem_python%" "%~dp0tools\windows_app.py"
exit /b 0
:missing
echo Run Install TEM Workbench App.cmd first to prepare this computer.
pause
exit /b 1
