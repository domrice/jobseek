#!/usr/bin/env bash
# Double-click on macOS, or ./start.command on Linux. Runs setup on first launch, starts the
# server, opens the browser. Closing the window (or Ctrl-C) stops it.
set -euo pipefail
cd "$(dirname "$0")"

[ -d node_modules ] && [ -f data/jobseek.db ] || ./setup.sh

exec npm run dev -- --open   # nuxi opens the browser once the server listens
