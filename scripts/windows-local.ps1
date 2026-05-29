# LUXCode — Windows local browser launcher (free local AI: Ollama, LM Studio, Hugging Face)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/windows-local.ps1
#    or: double-click start-luxcode.bat in the repo root

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

Write-Host @"

  _      _  _  ____
 | |    | || |/ ___|
 | |    | || | |
 | |___ | || | |___
 |_____| \__/ \____|

  luxCoder — Local AI Vibe Coding Studio
  The Lux Empire · https://aichatbot.thelux.app

"@ -ForegroundColor Magenta

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

if (-not (Test-Path "node_modules")) {
    Write-Step "Installing dependencies (first run)"
    if ($pm -eq "pnpm") {
        & pnpm install
    } else {
        & npm install
    }
}

Write-Step "Local AI status"
if (Test-OllamaRunning) {
    Write-Host "Ollama is running at http://127.0.0.1:11434" -ForegroundColor Green
    Write-Host "In the app: Settings > Providers > Local > enable Ollama, then pick a model." -ForegroundColor DarkGray
} else {
    Write-Host "Ollama is not running (optional)." -ForegroundColor Yellow
    Write-Host "  Install: https://ollama.com/download" -ForegroundColor DarkGray
    Write-Host "  Then run: ollama pull qwen2.5-coder" -ForegroundColor DarkGray
    Write-Host "  Or use LM Studio / Hugging Face in Settings > Providers." -ForegroundColor DarkGray
}

Write-Step "Stopping stale dev servers on 5173–5175"
& "$Root\scripts\stop-luxcode-dev.ps1"

Write-Step "Starting LUXCode dev server"
Write-Host "App URL: $Url" -ForegroundColor Green
Write-Host "Press Ctrl+C in this window to stop." -ForegroundColor DarkGray

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
                } catch { }
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
