#!/usr/bin/env bash
# Circuit Simulator — development mode with hot reload (source/ folder)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[X] Node.js is not installed. Install LTS from https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only), please wait..."
  npm install || { echo "[X] npm install failed."; exit 1; }
fi

echo "Starting dev server on http://localhost:3000 ..."
( sleep 6
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:3000" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "http://localhost:3000"
  fi ) &
exec npx next dev -p 3000
