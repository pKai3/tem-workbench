# Compatibility entry point. Use the supported installer without changing execution policy.
& (Join-Path $PSScriptRoot 'run_windows.bat') 'install-app'
exit $LASTEXITCODE
