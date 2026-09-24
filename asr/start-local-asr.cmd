@echo off
setlocal
cd /d "%~dp0"
set "HF_HOME=%~dp0cache\huggingface"
"%~dp0.venv\Scripts\python.exe" "%~dp0server.py" --home .
if errorlevel 1 pause
