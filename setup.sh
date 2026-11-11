#!/usr/bin/env bash
# One-time setup. macOS and Linux. Safe to re-run: every step is idempotent.
set -euo pipefail
cd "$(dirname "$0")"

npm ci                            # .npmrc engine-strict: refuses Node < 26
npm rebuild better-sqlite3        # .npmrc sets ignore-scripts=true
npm run prepare
npm run db:migrate                # creates data/jobseek.db

# LLM scoring is optional — the app is fully usable without it, so a missing Ollama is a note,
# not a failure. Both tiers are pulled: the fast model for `Pre-Score all`, the 31B (~20GB) for
# `Deep-Score`.
FAST=gemma4:26b-a4b-it-qat
DEEP=gemma4:31b-it-qat
if command -v ollama >/dev/null; then
  ollama pull "$FAST"
  ollama pull "$DEEP"
  grep -qs '^LLM_MODEL=' .env || printf '\nLLM_MODEL=%s\n' "$FAST" >> .env
else
  echo
  echo "Ollama not found — job scoring will use keywords only."
  echo "For AI scoring: install from https://ollama.com, then re-run ./setup.sh"
fi

echo
echo "Done. Start it with ./start.command (or double-click it)."
echo "Tip: drag JobSeek.app onto the Dock for a one-click launcher."
