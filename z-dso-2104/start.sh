#!/usr/bin/env bash
# Z-DSO 2104 — local launcher (Linux / macOS)
# Menjalankan server lokal + membuka osiloskop di browser.
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  exec python3 start.py "$@"
elif command -v python >/dev/null 2>&1; then
  exec python start.py "$@"
else
  echo "Python tidak ditemukan. Buka index.html langsung di browser,"
  echo "atau jalankan: npx serve ."
  exit 1
fi
