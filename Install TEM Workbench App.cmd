@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install_windows_app.ps1"
set "tem_status=%errorlevel%"
echo.
pause
exit /b %tem_status%
