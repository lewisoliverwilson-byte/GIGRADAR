# GigRadar Quick Refresh — run via Windows Task Scheduler or double-click
# Runs every week to pick up new gigs from all sources.

$ErrorActionPreference = 'Continue'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root      = Split-Path -Parent $scriptDir
$logDir    = Join-Path $scriptDir "logs"
$ts        = Get-Date -Format "yyyyMMdd-HHmm"
$logFile   = Join-Path $logDir "${ts}-quick-refresh.log"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

Write-Host "=== GigRadar Quick Refresh ===" -ForegroundColor Cyan
Write-Host "Started: $(Get-Date)" -ForegroundColor Yellow
Write-Host "Log: $logFile`n" -ForegroundColor Gray

# Run bash script via Git Bash
$bash = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $bash)) { $bash = "C:\Program Files\Git\usr\bin\bash.exe" }

$env:TM_API_KEY = "ttdbtKPP936EBCBNnBPOwxvzIzYDoi8I"

& $bash (Join-Path $scriptDir "quick-refresh.sh") 2>&1 | Tee-Object -FilePath $logFile

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Full log: $logFile"
