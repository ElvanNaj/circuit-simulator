#!/bin/bash
# Circuit Simulator — macOS double-click launcher (delegates to start.sh)
cd "$(dirname "$0")" || exit 1
exec ./start.sh
