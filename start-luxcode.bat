@echo off
REM luxCoder — opens http://127.0.0.1:5173 (The Lux Empire local vibe coding studio)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-local.ps1"
if errorlevel 1 pause
