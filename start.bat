@echo off
REM Double-click this file to start Subscription Search on http://localhost:8765/
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
pause
