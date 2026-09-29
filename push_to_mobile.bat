@echo off
setlocal
cd /d "%~dp0"
echo ======================================================
echo  Pushing Forest to Android Phone via ADB...
echo ======================================================
echo.

REM --- Find ADB ---
set "ADB="
where adb >nul 2>nul && set "ADB=adb" && goto :found_adb

if exist "C:\Program Files\Wonderland\WonderlandEngine\bin\adb.exe" (
  set "ADB=C:\Program Files\Wonderland\WonderlandEngine\bin\adb.exe"
  goto :found_adb
)
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
  set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
  goto :found_adb
)
if exist "C:\Program Files\Meta Quest Developer Hub\resources\bin\adb.exe" (
  set "ADB=C:\Program Files\Meta Quest Developer Hub\resources\bin\adb.exe"
  goto :found_adb
)
if exist "%LOCALAPPDATA%\Programs\Oculus Developer Hub\resources\bin\adb.exe" (
  set "ADB=%LOCALAPPDATA%\Programs\Oculus Developer Hub\resources\bin\adb.exe"
  goto :found_adb
)

echo [ERROR] Could not find adb.exe!
echo.
echo Install one of these:
echo   - Android SDK Platform Tools: https://developer.android.com/tools/releases/platform-tools
echo   - Meta Quest Developer Hub (has ADB bundled)
echo   - Or add adb.exe to your PATH
echo.
pause
exit /b 1

:found_adb
echo Using ADB: %ADB%
echo.

REM --- Check for connected device ---
echo Checking for connected Android devices...
"%ADB%" devices
echo.

"%ADB%" devices 2>nul | findstr /R "device$" >nul
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] No Android device detected!
  echo.
  echo Make sure:
  echo   1. USB Debugging is enabled in Developer Options
  echo   2. Your phone is plugged in via USB
  echo   3. You tapped "Allow" on the USB debugging prompt on your phone
  echo.
  echo To enable Developer Options:
  echo   Settings ^> About Phone ^> Tap "Build Number" 7 times
  echo   Settings ^> Developer Options ^> Enable USB Debugging
  echo.
  pause
  exit /b 1
)

REM --- Start local dev server if not already running ---
set "PORT=8000"
echo.
echo Checking if dev server is already running on port %PORT%...
netstat -an 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
  echo Dev server already running on http://localhost:%PORT%
) else (
  echo Starting dev server in background...
  start /min "Forest Dev Server" cmd /c "node launch_quest.js"
  timeout /t 2 /nobreak >nul
  echo Dev server started on http://localhost:%PORT%
)

REM --- Setup ADB reverse tunnel ---
echo.
echo Setting up ADB reverse port tunnel (tcp:%PORT% -^> tcp:%PORT%)...
"%ADB%" reverse tcp:%PORT% tcp:%PORT%
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Failed to create ADB reverse tunnel!
  pause
  exit /b 1
)
echo [OK] ADB reverse active: Phone can access http://localhost:%PORT%

REM --- Launch Chrome on the phone ---
echo.
echo Launching Chrome on your phone...
"%ADB%" shell am start -a android.intent.action.VIEW -d "http://localhost:%PORT%/forest.html" com.android.chrome
if %ERRORLEVEL% NEQ 0 (
  echo Chrome launch failed, trying default browser...
  "%ADB%" shell am start -a android.intent.action.VIEW -d "http://localhost:%PORT%/forest.html"
)

echo.
echo ======================================================
echo  PUSH SUCCESSFUL!
echo ======================================================
echo.
echo  Your phone should now be opening Forest in Chrome.
echo  The app is served from your PC via USB tunnel.
echo.
echo  Tips:
echo    - Keep USB connected while testing
echo    - Use chrome://inspect on PC to open DevTools
echo    - FPS counter is in the top-right panel
echo    - Press Ctrl+C in the server window to stop
echo.
pause
