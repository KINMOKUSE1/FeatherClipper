@echo off
setlocal
chcp 65001 >nul
title Vid2Notes Installer
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_extension.ps1" %*
set "VID2NOTES_INSTALL_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %VID2NOTES_INSTALL_EXIT%
