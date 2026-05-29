# Pull Ollama models tuned for vibe coding (LUXCode / luxCoder)
# Good default for ~12 GB VRAM + plenty of system RAM (e.g. RTX 4070 Super, 80 GB RAM)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-vibe-coding-models.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/setup-vibe-coding-models.ps1 -Profile balanced

param(
    [ValidateSet('quick', 'balanced', 'max')]
    [string]$Profile = 'balanced'
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "Ollama is not installed." -ForegroundColor Red
    Write-Host "Download: https://ollama.com/download" -ForegroundColor Yellow
    Write-Host "Then run this script again." -ForegroundColor Yellow
    exit 1
}

$sets = @{
    quick = @(
        @{ Name = 'qwen2.5-coder:7b'; Note = 'Fast daily driver — fits fully on 12 GB GPU' }
    )
    balanced = @(
        @{ Name = 'qwen2.5-coder:7b'; Note = 'Fast iterations' }
        @{ Name = 'qwen2.5-coder:14b'; Note = 'Best quality/speed on 12 GB VRAM (recommended default)' }
        @{ Name = 'deepseek-coder-v2:16b'; Note = 'Strong alternative for complex refactors' }
    )
    max = @(
        @{ Name = 'qwen2.5-coder:14b'; Note = 'Primary GPU model' }
        @{ Name = 'qwen2.5-coder:32b'; Note = 'Heavier — uses RAM offload; slower but smarter' }
        @{ Name = 'deepseek-coder-v2:16b'; Note = 'Secondary coding model' }
    )
}

$models = $sets[$Profile]

Write-Host ""
Write-Host "  Vibe coding model setup — profile: $Profile" -ForegroundColor Magenta
Write-Host "  GPU ~12 GB VRAM: prefer 7b–14b for speed; 32b uses your 80 GB RAM." -ForegroundColor DarkGray
Write-Host ""

foreach ($m in $models) {
    Write-Host ">> Pulling $($m.Name) — $($m.Note)" -ForegroundColor Cyan
    & ollama pull $m.Name
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   Failed: $($m.Name)" -ForegroundColor Red
    } else {
        Write-Host "   OK: $($m.Name)" -ForegroundColor Green
    }
    Write-Host ""
}

Write-Host "Done. In LUXCode:" -ForegroundColor Green
Write-Host "  Settings > Providers > Local > Ollama > enable" -ForegroundColor DarkGray
Write-Host "  Pick qwen2.5-coder:14b for best results on your GPU." -ForegroundColor DarkGray
Write-Host "  Start app: double-click start-luxcode.bat" -ForegroundColor DarkGray
Write-Host ""
