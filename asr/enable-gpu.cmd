@echo off
setlocal
if exist "%~dp0config.json" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-gpu.ps1" -InstallDir "%~dp0."
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-gpu.ps1" %*
)
if errorlevel 1 echo GPU setup did not finish. The CPU service remains available.
pause
