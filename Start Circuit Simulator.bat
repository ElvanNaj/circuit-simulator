@echo off
setlocal
cd /d "%~dp0"
title Circuit Simulator

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [X] Node.js is not installed.
  echo      Install Node.js 20 LTS or newer from https://nodejs.org
  echo      then run this file again.
  echo.
  pause
  exit /b 1
)

set "NODE_MAJOR=0"
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 20 (
  echo.
  echo  [X] Node.js 20 or newer is required. Found:
  node -v
  echo      Download the LTS installer from https://nodejs.org
  echo.
  pause
  exit /b 1
)

rem ---- settings -------------------------------------------------
if "%PORT%"=="" set "PORT=3000"
if "%HOSTNAME%"=="" set "HOSTNAME=127.0.0.1"
rem ---------------------------------------------------------------

set "RUN_DIR=%~dp0"
set "SERVER="

if exist "server.js" (
  set "SERVER=server.js"
) else if exist "source\.next\standalone\server.js" (
  set "RUN_DIR=%~dp0source\.next\standalone"
  set "SERVER=server.js"
)

if defined SERVER goto :ready

echo.
echo  [*] No build found - setting up the app from source/ ...
echo      First run only: installs dependencies and builds. Please wait.
echo.

if not exist "source\package.json" (
  echo  [X] source\package.json not found. Keep this launcher in the project folder.
  pause
  exit /b 1
)

call npm --prefix source install --no-audit --no-fund
if errorlevel 1 goto :fail

call npm --prefix source run build
if errorlevel 1 goto :fail

if not exist "source\.next\standalone\server.js" (
  echo  [X] Build finished but source\.next\standalone\server.js is missing.
  goto :fail
)

set "RUN_DIR=%~dp0source\.next\standalone"

:ready
echo.
echo  ==================================================
echo    Circuit Simulator - local server
echo    URL : http://localhost:%PORT%
echo    Keep this window open while using the app.
echo    Press Ctrl+C or close this window to stop.
echo  ==================================================
echo.

start "circuit-sim-browser" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"

pushd "%RUN_DIR%"
node server.js
popd

echo.
echo  Server stopped.
pause
exit /b 0

:fail
echo.
echo  [X] Setup failed. Copy the messages above when asking for help.
pause
exit /b 1
