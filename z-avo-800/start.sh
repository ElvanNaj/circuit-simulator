#!/usr/bin/env bash
# Z-AVO 800 — local launcher (Linux / macOS)
cd "$(dirname "$0")"
PORT="${1:-8124}"
echo "Z-AVO 800 — http://127.0.0.1:${PORT}/index.html"
echo "sim demo — http://127.0.0.1:${PORT}/sim-demo.html"
echo "Stop: Ctrl+C"
python3 start.py "$PORT"
