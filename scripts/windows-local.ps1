# luxCoder - Windows local browser launcher
# Usage: powershell -ExecutionPolicy Bypass -File scripts/windows-local.ps1
#    or: double-click starter.bat / start-luxcode.bat

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Port = if ($env:PORT) { [int]$env:PORT } else { 5173 }
$Url = "http://127.0.0.1:$Port"

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
        Write-Host "Tip: use .env.free-local.example for Ollama-only setup." -ForegroundColor Yellow
    }
}

function Test-OllamaRunning {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2
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
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:20128/v1/models" -UseBasicParsing -TimeoutSec 2 -Headers $headers
            if ($r.StatusCode -eq 200) { return $true }
        } catch {
            # try next key
        }
    }
    return $false
}

function Ensure-OmniRoute {
    Write-Step "OmniRoute (Cursor-style local AI gateway for luxCoder)"

    # 1. Auto-install the CLI if missing (no prompts — fully automatic)
    if (-not (Test-OmniRouteCli)) {
        Write-Host "OmniRoute not found. Installing globally with $pm ..." -ForegroundColor Yellow
        & $pm install -g omniroute
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Global install of omniroute failed. You can try manually later: $pm install -g omniroute" -ForegroundColor Red
        } else {
            Write-Host "OmniRoute CLI installed successfully." -ForegroundColor Green
        }
    }

    # 2. If already healthy, we're good. Open its dashboard for visibility.
    if (Test-OmniRouteRunning) {
        Write-Host "OmniRoute is already running and responding at http://127.0.0.1:20128" -ForegroundColor Green
        try { Start-Process "http://127.0.0.1:20128/home" -ErrorAction SilentlyContinue } catch {}
        return $true
    }

    # 3. Start a fresh instance in its own window so you can watch its logs
    Write-Host "Starting OmniRoute in a new PowerShell window..." -ForegroundColor Cyan
    try {
        $null = Start-Process powershell -ArgumentList '-NoExit', '-Command', 'omniroute' -WindowStyle Normal -PassThru
        Write-Host "OmniRoute launched. Waiting for it to become ready (this can take 5-20s the first time)..." -ForegroundColor DarkGray
    } catch {
        Write-Host "Could not launch OmniRoute process automatically. Start it yourself with: omniroute" -ForegroundColor Yellow
        return $false
    }

    # 4. Poll until the gateway answers (with the luxcoder-local key or no key)
    $deadline = (Get-Date).AddSeconds(50)
    $ready = $false
    $dots = 0
    while ((Get-Date) -lt $deadline) {
        if (Test-OmniRouteRunning) {
            $ready = $true
            break
        }
        $dots++
        if ($dots % 4 -eq 0) { Write-Host "." -NoNewline -ForegroundColor DarkGray }
        Start-Sleep -Milliseconds 900
    }
    if ($dots -gt 0) { Write-Host "" }

    if ($ready) {
        Write-Host "OmniRoute is now responding. Dashboard will open." -ForegroundColor Green
        try { Start-Process "http://127.0.0.1:20128/home" -ErrorAction SilentlyContinue } catch {}
        return $true
    } else {
        Write-Host "OmniRoute did not become ready in time. luxCoder will still launch and keep retrying from the UI." -ForegroundColor Yellow
        Write-Host "Open http://127.0.0.1:20128/home yourself and ensure you have added at least one backend (Ollama recommended)." -ForegroundColor DarkGray
        return $false
    }
}

function Ensure-OmniRouteEnv {
    # Make sure .env.local has the values so server-side routes and discovery also see OmniRoute
    $envPath = ".env.local"
    $lines = @()
    if (Test-Path $envPath) {
        $lines = Get-Content $envPath -ErrorAction SilentlyContinue
    }

    $hasBase = $lines | Where-Object { $_ -match '^OMNIROUTE_API_BASE_URL=' }
    $hasKey  = $lines | Where-Object { $_ -match '^OMNIROUTE_API_KEY=' }

    $changed = $false

    if (-not $hasBase) {
        $lines += "OMNIROUTE_API_BASE_URL=http://127.0.0.1:20128/v1"
        $changed = $true
    }
    if (-not $hasKey) {
        $lines += "OMNIROUTE_API_KEY=luxcoder-local"
        $changed = $true
    }

    if ($changed) {
        Set-Content -Path $envPath -Value ($lines -join "`r`n") -Encoding UTF8
        Write-Host "Configured .env.local for OmniRoute (server-side auto-connect)." -ForegroundColor Green
    }
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

# ─────────────────────────────────────────────────────────────────────────────
# FULLY AUTOMATIC OmniRoute setup (install → detect → start → configure)
# Runs early so the user sees progress before the (long) npm/pnpm install.
Write-Step "Local AI gateway — install / detect / start / configure"

# These two calls do the full auto-install/start/configure.
# The functions themselves print clear success/failure messages.
$null = Ensure-OmniRoute
Ensure-OmniRouteEnv

# (The web app will still auto-select OmniRoute + "auto" model on first load
#  even if the launcher could not fully confirm OmniRoute was ready.)
# ─────────────────────────────────────────────────────────────────────────────

Write-Step "Environment file"
Ensure-EnvLocal

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
    Write-Host "In the app: Settings > Providers > Local > enable Ollama, then pick a model." -ForegroundColor DarkGray
} else {
    Write-Host "Ollama is not running (optional)." -ForegroundColor Yellow
    Write-Host "  Install: https://ollama.com/download" -ForegroundColor DarkGray
    Write-Host "  Then run: ollama pull qwen2.5-coder" -ForegroundColor DarkGray
    Write-Host "  Or use LM Studio / Hugging Face in Settings > Providers." -ForegroundColor DarkGray
}

Write-Step "Stopping stale dev servers on ports 5173-5175"
& "$Root\scripts\stop-luxcode-dev.ps1"

Write-Step "Starting luxCoder dev server"
Write-Host "App URL: $Url" -ForegroundColor Green
Write-Host ""
Write-Host "  ✓ OmniRoute install/see/connect/configure should be complete." -ForegroundColor Green
Write-Host "  ✓ Browser will open to luxCoder with OmniRoute + 'auto' model pre-selected." -ForegroundColor Green
Write-Host "  ✓ Just type a request like 'create a simple RedM resource' — it will code like Cursor." -ForegroundColor Green
Write-Host ""
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
    if ($pm -eq "pnpm") {
        & pnpm run dev
    } else {
        & npm run dev
    }
} finally {
    if ($browserJob.State -eq "Running") {
        Stop-Job -Job $browserJob -Force
    }
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
}
