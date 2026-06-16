# Stop luxCoder dev servers stuck on ports 5173-5175
foreach ($port in 5173, 5174, 5175) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" -ErrorAction SilentlyContinue
            if ($proc.CommandLine -match 'vite:dev|LUXCode|bolt') {
                Write-Host "Stopping PID $($_.OwningProcess) on port $port"
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
}

Write-Host "Done. Run start-luxcode.bat or pnpm run dev to start again."
