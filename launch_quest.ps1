# PowerShell Dev Launcher for Quest
Set-Location -Path $PSScriptRoot
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "Launching Forest on Meta Quest via ADB..." -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
node launch_quest.js
