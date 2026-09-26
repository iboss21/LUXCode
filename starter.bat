@echo off
setlocal EnableExtensions
title luxCoder - localhost launcher

REM luxCoder starter - one-command local Cursor-style experience
REM Double-click this file from the repo folder (The Lux Empire)

cd /d "%~dp0"

echo.
echo  ========================================
echo   luxCoder - Local AI Vibe Coding Studio
echo   The Lux Empire
echo  ========================================
echo.
echo  This launcher will:
echo    1. Use the Reges harness (127.0.0.1:3000) - or install OmniRoute as a fallback
echo    2. If Reges is offline: detect / start / configure OmniRoute
echo    3. Prepare .env.local so luxCoder connects (Reges model: reges/auto-cheap)
echo    4. Install luxCoder dependencies (first run only)
echo    5. Launch the dev server and open your browser
echo.
echo  Target: http://127.0.0.1:5173
echo  When the page loads the provider should already be "Reges"
echo  (or "OmniRoute" with model "auto" when Reges is offline).
echo.
echo  Keep this window open. Press Ctrl+C here to stop everything.
echo.

REM Parse-check the launcher first so a syntax error is reported clearly (file + line)
powershell -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText('%~dp0scripts\windows-local.ps1',[Text.Encoding]::Default),[ref]$null,[ref]$e); if ($e.Count) { $e | %% { 'Launcher syntax error: ' + $_.Message + ' @ line ' + $_.Extent.StartLineNumber }; exit 1 }"
if errorlevel 1 (
    echo.
    echo  scripts\windows-local.ps1 has a syntax error - see above. Keep that file pure ASCII.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-local.ps1"

if errorlevel 1 (
    echo.
    echo  Launch failed. Check Node.js is installed: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

endlocal
