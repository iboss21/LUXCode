# luxCoder - Windows local browser launcher
# Usage: powershell -ExecutionPolicy Bypass -File scripts/windows-local.ps1
#    or: double-click starter.bat / start-luxcode.bat
#
# KEEP THIS FILE PURE ASCII. Windows PowerShell 5.1 reads a BOM-less script as ANSI
# (code page 1252). A UTF-8 em dash or check mark then decodes to bytes that include a
# "smart quote" (0x93 / 0x94), which PowerShell treats as a string delimiter. That splits
# strings, unbalances the braces and produced the old
#   "Unexpected token '}' in expression or statement" at "} else {"
# error. starter.bat parse-checks this file before running it.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Port = if ($env:PORT) { [int]$env:PORT } else { 5173 }
$Url = "http://127.0.0.1:$Port"

$RegesBase = if ($env:REGES_API_BASE_URL) { $env:REGES_API_BASE_URL.TrimEnd('/') } else { "http://127.0.0.1:3000/v1" }
$OmniBase = "http://127.0.0.1:20128"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host ">> $Message" -ForegroundColor Cyan
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-EnvLocal {
    if (Test-Path ".env.local") {
        return
    }
    if (Test-Path ".env.free-local.example") {
        Copy-Item ".env.free-local.example" ".env.local"
        Write-Host "Created .env.local from .env.free-local.example" -ForegroundColor Green
        return
    }
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env.local"
        Write-Host "Created .env.local from .env.example" -ForegroundColor Yellow
    }
}

function Set-EnvLocalValue([string]$Key, [string]$Value) {
    # Adds KEY=value to .env.local only when the key is missing (never overwrites existing values)
    $envPath = ".env.local"
    $lines = @()
    if (Test-Path $envPath) {
        $lines = @(Get-Content $envPath -ErrorAction SilentlyContinue)
    }
    $pattern = "^" + [regex]::Escape($Key) + "="
    if (-not ($lines | Where-Object { $_ -match $pattern })) {
        $lines += "$Key=$Value"
        # UTF-8 without BOM (a BOM would corrupt the first key for dotenv)
        [System.IO.File]::WriteAllText((Join-Path (Get-Location) $envPath), (($lines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
        return $true
    }
    return $false
}

function Test-OllamaRunning {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-RegesRunning {
    try {
        $r = Invoke-WebRequest -Uri "$RegesBase/models" -UseBasicParsing -TimeoutSec 3 -Headers @{ Authorization = "Bearer reges" }
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-OmniRouteCli {
    return [bool](Get-Command "omniroute" -ErrorAction SilentlyContinue)
}

function Test-OmniRouteRunning {
    $keysToTry = @("luxcoder-local", "omniroute", "")
    foreach ($k in $keysToTry) {
        try {
            $headers = @{}
            if ($k) { $headers["Authorization"] = "Bearer $k" }
            $r = Invoke-WebRequest -Uri "$OmniBase/v1/models" -UseBasicParsing -TimeoutSec 2 -Headers $headers
            if ($r.StatusCode -eq 200) { return $true }
        } catch {
            # try next key
        }
    }
    return $false
}

function Ensure-OmniRoute {
    Write-Step "OmniRoute (fallback local AI gateway)"

    # 1. Install the CLI if missing
    if (-not (Test-OmniRouteCli)) {
        Write-Host "OmniRoute not found. Installing globally with $pm ..." -ForegroundColor Yellow
        & $pm install -g omniroute
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Global install of omniroute failed. Try manually later: $pm install -g omniroute" -ForegroundColor Red
        } else {
            Write-Host "OmniRoute CLI installed." -ForegroundColor Green
        }
    }

    # 2. Already healthy?
    if (Test-OmniRouteRunning) {
        Write-Host "OmniRoute is already running at $OmniBase" -ForegroundColor Green
        return $true
    }

    # 3. Start it in its own window so its logs stay visible
    Write-Host "Starting OmniRoute in a new PowerShell window..." -ForegroundColor Cyan
    try {
        $null = Start-Process powershell -ArgumentList '-NoExit', '-Command', 'omniroute' -WindowStyle Normal -PassThru
    } catch {
        Write-Host "Could not launch OmniRoute. Start it yourself with: omniroute" -ForegroundColor Yellow
        return $false
    }

    # 4. Poll until the gateway answers
    $deadline = (Get-Date).AddSeconds(50)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-OmniRouteRunning) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 900
    }

    if ($ready) {
        Write-Host "OmniRoute is responding." -ForegroundColor Green
    } else {
        Write-Host "OmniRoute did not become ready in time. luxCoder will still launch and retry from the UI." -ForegroundColor Yellow
    }
    return $ready
}

Write-Host ""
Write-Host "  luxCoder - Local AI Vibe Coding Studio" -ForegroundColor Magenta
Write-Host "  The Lux Empire - https://aichatbot.thelux.app" -ForegroundColor Magenta
Write-Host ""

Write-Step "Checking Node.js (18+)"
if (-not (Test-Command "node")) {
    Write-Host "Node.js is not installed. Install LTS from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
$nodeVersion = node -p "process.versions.node"
Write-Host "Node $nodeVersion"

Write-Step "Checking package manager"
$pm = $null
if (Test-Command "pnpm") {
    $pm = "pnpm"
} elseif (Test-Command "npm") {
    $pm = "npm"
    Write-Host "pnpm not found; using npm. Install pnpm for faster installs: npm install -g pnpm" -ForegroundColor Yellow
} else {
    Write-Host "npm not found. Install Node.js LTS from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

Write-Step "Environment file"
Ensure-EnvLocal

# ---------------------------------------------------------------------------
# AI gateway: Reges harness first (RegesCore-Ai, http://127.0.0.1:3000/v1).
# OmniRoute is only installed / started when Reges is not reachable.
# ---------------------------------------------------------------------------
Write-Step "AI gateway - Reges harness (default), OmniRoute (fallback)"

$null = Set-EnvLocalValue "REGES_API_BASE_URL" "http://127.0.0.1:3000/v1"
$null = Set-EnvLocalValue "REGES_API_KEY" "reges"

if (Test-RegesRunning) {
    Write-Host "[OK] Reges harness is running at $RegesBase" -ForegroundColor Green
    Write-Host "     luxCoder will default to provider=Reges, model=reges/auto-cheap." -ForegroundColor DarkGray
} else {
    Write-Host "Reges harness is not reachable at $RegesBase - trying OmniRoute." -ForegroundColor Yellow
    $null = Set-EnvLocalValue "OMNIROUTE_API_BASE_URL" "$OmniBase/v1"
    $null = Set-EnvLocalValue "OMNIROUTE_API_KEY" "luxcoder-local"
    $null = Ensure-OmniRoute
}

if (-not (Test-Path "node_modules")) {
    Write-Step "Installing dependencies (first run)"
    if ($pm -eq "pnpm") {
        & pnpm install
    } else {
        & npm install
    }
}

if (Test-OllamaRunning) {
    Write-Host "Ollama is running at http://127.0.0.1:11434" -ForegroundColor Green
} else {
    Write-Host "Ollama is not running (optional)." -ForegroundColor DarkGray
}

Write-Step "Stopping stale dev servers on ports 5173-5175"
& "$Root\scripts\stop-luxcode-dev.ps1"

Write-Step "Starting luxCoder dev server"
Write-Host "App URL: $Url" -ForegroundColor Green
Write-Host "Press Ctrl+C in this window to stop the dev server." -ForegroundColor DarkGray

$browserJob = Start-Job -ScriptBlock {
    param($PreferredPort)
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        foreach ($port in @($PreferredPort, 5173, 5174, 5175)) {
            foreach ($hostName in @("127.0.0.1", "localhost")) {
                $tryUrl = "http://${hostName}:$port/"
                try {
                    $null = Invoke-WebRequest -Uri $tryUrl -UseBasicParsing -TimeoutSec 2
                    Start-Process $tryUrl
                    return
                } catch {
                    # server not ready yet
                }
            }
        }
        Start-Sleep -Seconds 1
    }
} -ArgumentList $Port

try {
    # vite.config.ts reads PORT from the environment
    $env:PORT = "$Port"
    if ($pm -eq "pnpm") {
        & pnpm run dev
    } else {
        & npm run dev
    }
} finally {
    if ($browserJob.State -eq "Running") {
        Stop-Job -Job $browserJob
    }
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
}
