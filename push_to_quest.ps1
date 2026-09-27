# Quick Push to Meta Quest Headset via ADB
$ErrorActionPreference = "Stop"

$PORT = 8000
$targetUrl = "http://localhost:$PORT/forest.html"

# Known locations for adb on Windows
$adbCandidates = @(
  "adb",
  "C:\Program Files\Wonderland\WonderlandEngine\bin\adb.exe",
  "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
  "$env:LOCALAPPDATA\Programs\Oculus Developer Hub\resources\bin\adb.exe",
  "C:\Program Files\Oculus Developer Hub\resources\bin\adb.exe",
  "C:\Program Files\Meta Quest Developer Hub\resources\bin\adb.exe",
  "$env:LOCALAPPDATA\Programs\SideQuest\resources\app.asar.unpacked\build\platform-tools\adb.exe"
)

$adb = $null
foreach ($cand in $adbCandidates) {
  try {
    & $cand version 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $adb = $cand
      break
    }
  } catch {}
}

if (-not $adb) {
  Write-Host "❌ Could not find adb.exe automatically!" -ForegroundColor Red
  Write-Host "Please ensure your Quest is in Developer Mode and ADB is installed." -ForegroundColor Yellow
  exit 1
}

Write-Host "Using ADB: $adb" -ForegroundColor Cyan
Write-Host "Checking connected Quest headsets..." -ForegroundColor Cyan

$devices = & $adb devices
$devicesOutput = ($devices -join "`n")
Write-Host $devicesOutput

if ($devicesOutput -notmatch "[\r\n][^\r\n]+\tdevice") {
  Write-Host "`n⚠️ No active Quest device detected via ADB!" -ForegroundColor Red
  Write-Host "Please plug in your Quest with USB (or connect via Wi-Fi) and allow USB Debugging in the headset." -ForegroundColor Yellow
  exit 1
}

Write-Host "`nConfiguring ADB reverse port tunnel (tcp:$PORT -> tcp:$PORT)..." -ForegroundColor Yellow
& $adb reverse tcp:$PORT tcp:$PORT
Write-Host "✅ ADB reverse active: Quest can access http://localhost:$PORT" -ForegroundColor Green

Write-Host "`nLaunching Oculus Browser on Quest to $targetUrl..." -ForegroundColor Cyan
& $adb shell am start -a android.intent.action.VIEW -d "$targetUrl" com.oculus.browser

Write-Host "`n======================================================" -ForegroundColor Green
Write-Host "🚀 PUSH SUCCESSFUL!" -ForegroundColor Green
Write-Host "Put on your Quest headset: Oculus Browser is now opening Forest!" -ForegroundColor Cyan
Write-Host "Click 'ENTER VR' at the bottom right to enter immersive VR." -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor Green
