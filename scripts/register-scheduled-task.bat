@echo off
:: Run this file as Administrator to register the weekly GigRadar refresh task
:: Right-click → "Run as administrator"

echo Registering GigRadar Weekly Quick Refresh...

powershell.exe -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NonInteractive -ExecutionPolicy Bypass -File ""C:\GIGSITE\scripts\run-quick-refresh.ps1""'; $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '03:00AM'; $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew -StartWhenAvailable; Register-ScheduledTask -TaskName 'GigRadar Weekly Quick Refresh' -Action $action -Trigger $trigger -Settings $settings -Description 'Scrapes all gig sources for new events in next 4 weeks, then deduplicates and updates genres.' -RunLevel Highest -Force; Write-Host 'Done. Task registered to run every Monday at 3am.'"

pause
