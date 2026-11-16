@echo off
rem Z-DSO 2104 - local launcher (Windows)
rem Menjalankan server lokal + membuka osiloskop di browser default.
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  python start.py %1
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 start.py %1
  goto :eof
)
echo Python tidak ditemukan. Buka index.html langsung di browser,
echo atau install Python dari https://www.python.org/
pause
