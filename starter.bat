@echo off
setlocal EnableExtensions
title luxCoder - localhost launcher

REM luxCoder starter — one-command local Cursor-style experience
REM Double-click this file from the repo folder (The Lux Empire)

cd /d "%~dp0"

echo.
echo  ========================================
echo   luxCoder - Local AI Vibe Coding Studio
echo   The Lux Empire
echo  ========================================
echo.
echo  This launcher will:
echo    1. Install OmniRoute (if missing) — the Cursor-style local AI gateway
echo    2. Detect / start / configure OmniRoute automatically
echo    3. Prepare .env and defaults so luxCoder connects with model "auto"
echo    4. Install luxCoder dependencies (first run only)
echo    5. Launch the dev server and open your browser
echo.
echo  Target: http://127.0.0.1:5173
echo  When the page loads it should already show the green "OmniRoute" badge
echo  and model selector = "auto".
echo.
echo  Keep this window open. Press Ctrl+C here to stop everything.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-local.ps1"

if errorlevel 1 (
    echo.
    echo  Launch failed. Check Node.js is installed: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

endlocal
