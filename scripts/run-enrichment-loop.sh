#!/usr/bin/env bash
# Runs enrichment scripts in a loop with --resume until complete
# Usage: bash scripts/run-enrichment-loop.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../logs"
mkdir -p "$LOG_DIR"

run_until_done() {
  local name="$1"
  local cmd="$2"
  local log="$LOG_DIR/${name}.log"

  echo "[$(date)] Starting $name" >> "$log"
  while true; do
    eval "$cmd" >> "$log" 2>&1
    EXIT=$?
    tail -1 "$log" | grep -qE "=== Complete ===" && break
    echo "[$(date)] $name timed out or crashed (exit $EXIT), resuming..." >> "$log"
    sleep 2
  done
  echo "[$(date)] $name DONE" >> "$log"
}

# Run both in parallel
SPOTIFY_CLIENT_ID=9f4abb0eac5a45019b8d9a492daa41fc \
SPOTIFY_CLIENT_SECRET=130c12d419064803bec3126cb3d4e411 \
run_until_done "spotify" "node '$SCRIPT_DIR/enrich-artists-spotify.cjs' --resume" &

run_until_done "images" "node '$SCRIPT_DIR/enrich-artists-images.cjs' --resume" &

wait
echo "[$(date)] All enrichment complete"
