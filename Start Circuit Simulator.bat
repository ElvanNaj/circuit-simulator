@echo off
setlocal
cd /d "%~dp0"
title Circuit Simulator

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [X] Node.js is not installed.
  echo      Please install Node.js 20 LTS or newer from https://nodejs.org
  echo      then run this file again.
  echo.
  pause
  exit /b 1
)

rem ---- settings -------------------------------------------------
set PORT=3000
set HOSTNAME=127.0.0.1
rem ---------------------------------------------------------------

set "SERVER=server.js"
if not exist "%SERVER%" set "SERVER=source\.next\standalone\server.js"

if not exist "%SERVER%" (
  echo.
  echo  [*] No build found - building from source/ ^(this may take a few minutes^)...
  echo.
  if not exist "source" (
    echo  [X] source\ folder not found.
    pause
    exit /b 1
  )
  if not exist "source\node_modules" (
    call npm --prefix source install --no-audit --no-fund
    if errorlevel 1 goto :fail
  )
  call npm --prefix source run build
  if errorlevel 1 goto :fail
  set "SERVER=source\.next\standalone\server.js"
)

echo.
echo  ==================================================
echo    Circuit Simulator - local server
echo    URL : http://localhost:%PORT%
echo    Keep this window open while using the app.
echo    Press Ctrl+C or close this window to stop.
echo  ==================================================
echo.

start "circuit-sim-browser" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"

node "%SERVER%"

echo.
echo  Server stopped.
pause
exit /b 0

:fail
echo.
echo  [X] Build failed. See the messages above.
pause
exit /b 1
