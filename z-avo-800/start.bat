@echo off
REM Z-AVO 800 - local launcher (Windows)
cd /d "%~dp0"
set PORT=%1
if "%PORT%"=="" set PORT=8124
echo Z-AVO 800 - http://127.0.0.1:%PORT%/index.html
echo sim demo - http://127.0.0.1:%PORT%/sim-demo.html
echo Stop: Ctrl+C
python start.py %PORT%
