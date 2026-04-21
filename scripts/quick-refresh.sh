#!/usr/bin/env bash
# GigRadar Quick Refresh
#
# Runs all 14 scrapers in --quick mode (next 4 weeks / 3 pages per location).
# Designed to run weekly via cron or Windows Task Scheduler.
# Typical runtime: ~30-45 minutes.
#
# Usage:
#   bash scripts/quick-refresh.sh
#   bash scripts/quick-refresh.sh --dry-run

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/scripts/logs"
mkdir -p "$LOG_DIR"
TS=$(date +%Y%m%d-%H%M)

DRY=""
[[ "$1" == "--dry-run" ]] && DRY="--dry-run"

TM_API_KEY="${TM_API_KEY:-ttdbtKPP936EBCBNnBPOwxvzIzYDoi8I}"

log() { echo "  [$1] $(date +%H:%M:%S) — $2"; }

echo "=== GigRadar Quick Refresh ==="
echo "Started: $(date)"
echo "Logs: $LOG_DIR"
echo ""

# ── Wave 1: Ticketmaster + Songkick + Skiddle (parallel) ─────────────────────
echo "▶ Wave 1 — TM + Songkick + Skiddle"
TM_API_KEY=$TM_API_KEY node "$ROOT/scripts/scrape-ticketmaster.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-ticketmaster.txt" 2>&1 &
node "$ROOT/scripts/scrape-songkick.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-songkick.txt" 2>&1 &
node "$ROOT/scripts/scrape-skiddle-events.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-skiddle.txt" 2>&1 &
wait
log "wave1" "done"

# ── Wave 2: DICE + Ticketline + Resident Advisor + SeeTickets (parallel) ─────
echo "▶ Wave 2 — DICE + Ticketline + RA + SeeTickets"
node "$ROOT/scripts/scrape-dice.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-dice.txt" 2>&1 &
node "$ROOT/scripts/scrape-ticketline.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-ticketline.txt" 2>&1 &
node "$ROOT/scripts/scrape-resident-advisor.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-ra.txt" 2>&1 &
node "$ROOT/scripts/scrape-seetickets.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-seetickets.txt" 2>&1 &
wait
log "wave2" "done"

# ── Wave 3: Gigantic + WeGotTickets + Fatsoma + Eventbrite (parallel) ────────
echo "▶ Wave 3 — Gigantic + WGT + Fatsoma + Eventbrite"
node "$ROOT/scripts/scrape-gigantic.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-gigantic.txt" 2>&1 &
node "$ROOT/scripts/scrape-wegottickets.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-wgt.txt" 2>&1 &
node "$ROOT/scripts/scrape-fatsoma.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-fatsoma.txt" 2>&1 &
node "$ROOT/scripts/scrape-eventbrite.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-eventbrite.txt" 2>&1 &
wait
log "wave3" "done"

# ── Wave 4: Ents24 alone (slower, URL-based) ─────────────────────────────────
echo "▶ Wave 4 — Ents24"
node "$ROOT/scripts/scrape-ents24.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-ents24.txt" 2>&1
log "wave4" "done"

# ── Wave 5: Bandsintown (artist-centric, runs after venues/artists seeded) ───
echo "▶ Wave 5 — Bandsintown (active artists only)"
BIT_APP_ID=gigradar node "$ROOT/scripts/scrape-bandsintown.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-bandsintown.txt" 2>&1
log "wave5" "done"

# ── Wave 6: Venue-centric scraper (Skiddle + Songkick per venue) ─────────────
echo "▶ Wave 6 — Venue gigs (active venues only)"
node "$ROOT/scripts/scrape-venue-gigs.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-venue-gigs.txt" 2>&1
log "wave6" "done"

echo ""
echo "▶ Post-scrape cleanup"

# Purge past gigs
node "$ROOT/scripts/purge-old-gigs.cjs" $DRY \
  > "$LOG_DIR/${TS}-purge.txt" 2>&1
log "purge" "done"

# Update upcoming counts (artists + venues)
node "$ROOT/scripts/update-upcoming-counts.cjs" $DRY \
  > "$LOG_DIR/${TS}-upcoming.txt" 2>&1
log "upcoming" "done"

# Genre denorm — resume mode (only re-processes artists not yet done this cycle)
node "$ROOT/scripts/update-gig-genres.cjs" --resume $DRY \
  > "$LOG_DIR/${TS}-genres.txt" 2>&1
log "genres" "done"

# Co-performer inference (fills gigs whose artist has no genres)
node "$ROOT/scripts/infer-gig-genres-from-coperformers.cjs" $DRY \
  > "$LOG_DIR/${TS}-infer-genres.txt" 2>&1
log "infer-genres" "done"

# Deduplicate (merges gigs from multiple scrapers)
node "$ROOT/scripts/deduplicate-gigs.cjs" $DRY \
  > "$LOG_DIR/${TS}-dedup.txt" 2>&1
log "dedup" "done"

# Stats snapshot
node "$ROOT/scripts/live-stats.cjs" --once \
  > "$LOG_DIR/${TS}-stats.txt" 2>&1
log "stats" "done"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Quick Refresh Complete ==="
echo "Finished: $(date)"
echo ""
echo "New gigs by source:"
for name in ticketmaster songkick skiddle dice ticketline ra seetickets gigantic wgt fatsoma eventbrite ents24 bandsintown venue-gigs; do
  f="$LOG_DIR/${TS}-${name}.txt"
  [ -f "$f" ] || continue
  saved=$(grep -oP 'Gigs saved\s*:\s*\K[\d,]+' "$f" 2>/dev/null | tail -1)
  new=$(grep -oP '\+\d+ gigs' "$f" 2>/dev/null | grep -oP '\d+' | tail -1)
  count="${saved:-${new:-(no data)}}"
  printf "  %-15s %s\n" "$name" "$count"
done
echo ""
cat "$LOG_DIR/${TS}-stats.txt" 2>/dev/null | grep -E 'Future|genres|Artists' | head -6
