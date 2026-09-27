@echo off
setlocal
cd /d "%~dp0"
echo ======================================================
echo Pushing Forest to Meta Quest Headset via ADB...
echo ======================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push_to_quest.ps1"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Push failed. Make sure your Quest is plugged in with Developer Mode enabled.
)
pause
