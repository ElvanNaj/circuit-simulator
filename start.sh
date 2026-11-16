#!/usr/bin/env bash
# Circuit Simulator — local one-click launcher (Linux / macOS)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo " [X] Node.js is not installed."
  echo "     Please install Node.js 20 LTS or newer from https://nodejs.org"
  echo "     then run this script again."
  echo ""
  sleep 30
  exit 1
fi

# ---- settings -------------------------------------------------
export PORT="${PORT:-3000}"
export HOSTNAME="127.0.0.1"
# ----------------------------------------------------------------

echo ""
echo " =================================================="
echo "   Circuit Simulator - local server"
echo "   URL : http://localhost:$PORT"
echo "   Keep this window open while using the app."
echo "   Press Ctrl+C here to stop the server."
echo " =================================================="
echo ""

( sleep 3
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"
  fi ) &

# 1) Prebuilt package (server.js at the repo root).
if [ -f server.js ]; then
  exec node server.js
fi

# 2) Already built from source.
if [ -f source/.next/standalone/server.js ]; then
  exec node source/.next/standalone/server.js
fi

# 3) Fresh clone: install dependencies and build once.
echo " [*] No build found - building from source/ (this may take a few minutes)..."
if [ ! -d source ]; then
  echo " [X] source/ folder not found."
  sleep 30
  exit 1
fi
if [ ! -d source/node_modules ]; then
  ( cd source && npm install --no-audit --no-fund ) || { sleep 30; exit 1; }
fi
( cd source && npm run build ) || { sleep 30; exit 1; }

exec node source/.next/standalone/server.js
