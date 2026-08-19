#!/usr/bin/env bash
# Start backend + frontend together. Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  echo ""
  echo "[dev] stopping..."
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev] backend  -> http://localhost:4002"
( cd "$ROOT/backend/app" && npm run dev ) &

echo "[dev] frontend -> http://localhost:3000"
( cd "$ROOT/frontend" && npm run dev ) &

wait
