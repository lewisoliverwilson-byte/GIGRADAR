# GigRadar Live Stats — double-click to run
# Updates stats.csv every 90 seconds. Keep this window open.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$statsScript = Join-Path $scriptDir "live-stats.cjs"

Write-Host "=== GigRadar Live Stats ===" -ForegroundColor Cyan
Write-Host "Updating stats.csv every 90 seconds. Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host "CSV: $scriptDir\stats.csv`n" -ForegroundColor Gray

while ($true) {
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] Querying..." -NoNewline
    node $statsScript --once 2>$null
    Write-Host " done. Next update in 90s."
    Start-Sleep -Seconds 90
}
