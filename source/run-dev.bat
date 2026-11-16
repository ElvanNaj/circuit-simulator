@echo off
setlocal
cd /d "%~dp0"
title Circuit Simulator - dev mode

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not installed. Install LTS from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies - first run only, please wait...
  call npm install
  if errorlevel 1 (
    echo [X] npm install failed.
    pause
    exit /b 1
  )
)

start "circuit-sim-browser" /min cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3000"

echo Starting dev server on http://localhost:3000 ...
call npx next dev -p 3000
pause
