#!/usr/bin/env bash
# GigRadar Weekly Refresh
# Run from the GIGSITE root: bash scripts/weekly-refresh.sh
# Runs all scrapers sequentially, then cleans + refreshes counts/genres.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/scripts/logs"
mkdir -p "$LOG_DIR"
TS=$(date +%Y%m%d-%H%M)

run() {
  local name="$1"; shift
  echo ""
  echo "━━━ [$name] starting at $(date +%H:%M:%S) ━━━"
  node "$@" 2>&1 | tee "$LOG_DIR/${TS}-${name}.txt"
  echo "━━━ [$name] done ━━━"
}

echo "=== GigRadar Weekly Refresh ==="
echo "Started: $(date)"
echo "Logs: $LOG_DIR"

# ── Scrapers (parallelised in 3 waves) ───────────────────────────────────────

echo ""
echo "▶ Wave 1: Ticketmaster + Songkick + Skiddle (parallel)"
TM_API_KEY=${TM_API_KEY:-ttdbtKPP936EBCBNnBPOwxvzIzYDoi8I}
node "$ROOT/scripts/scrape-ticketmaster.cjs"   > "$LOG_DIR/${TS}-ticketmaster.txt"   2>&1 &
node "$ROOT/scripts/scrape-songkick.cjs"        > "$LOG_DIR/${TS}-songkick.txt"        2>&1 &
node "$ROOT/scripts/scrape-skiddle-events.cjs"  > "$LOG_DIR/${TS}-skiddle.txt"         2>&1 &
wait
echo "  Wave 1 done"

echo ""
echo "▶ Wave 2: DICE + Gigantic + Ticketline (parallel)"
node "$ROOT/scripts/scrape-dice.cjs"            > "$LOG_DIR/${TS}-dice.txt"            2>&1 &
node "$ROOT/scripts/scrape-gigantic.cjs"        > "$LOG_DIR/${TS}-gigantic.txt"        2>&1 &
node "$ROOT/scripts/scrape-ticketline.cjs"      > "$LOG_DIR/${TS}-ticketline.txt"      2>&1 &
wait
echo "  Wave 2 done"

echo ""
echo "▶ Wave 3: WeGotTickets + Resident Advisor + Fatsoma (parallel)"
node "$ROOT/scripts/scrape-wegottickets.cjs"    > "$LOG_DIR/${TS}-wgt.txt"             2>&1 &
node "$ROOT/scripts/scrape-resident-advisor.cjs" > "$LOG_DIR/${TS}-ra.txt"             2>&1 &
node "$ROOT/scripts/scrape-fatsoma.cjs"         > "$LOG_DIR/${TS}-fatsoma.txt"        2>&1 &
wait
echo "  Wave 3 done"

echo ""
echo "▶ Wave 4: Ents24 (slow — runs alone)"
node "$ROOT/scripts/scrape-ents24.cjs"          > "$LOG_DIR/${TS}-ents24.txt"          2>&1
echo "  Wave 4 done"

echo ""
echo "▶ Wave 5: SeeTickets + Eventbrite (parallel)"
node "$ROOT/scripts/scrape-seetickets.cjs"      > "$LOG_DIR/${TS}-seetickets.txt"      2>&1 &
node "$ROOT/scripts/scrape-eventbrite.cjs"      > "$LOG_DIR/${TS}-eventbrite.txt"      2>&1 &
wait
echo "  Wave 5 done"

echo ""
echo "▶ Wave 6: Bandsintown (artist-centric — runs after all others)"
BIT_APP_ID=gigradar node "$ROOT/scripts/scrape-bandsintown.cjs" > "$LOG_DIR/${TS}-bandsintown.txt" 2>&1
echo "  Wave 6 done"

echo ""
echo "▶ Wave 7: Venue-centric gig scraper"
node "$ROOT/scripts/scrape-venue-gigs.cjs"      > "$LOG_DIR/${TS}-venue-gigs.txt"      2>&1
echo "  Wave 7 done"

# ── Post-scrape cleanup & enrichment ─────────────────────────────────────────

run "purge-old-gigs"          "$ROOT/scripts/purge-old-gigs.cjs"
run "update-upcoming"         "$ROOT/scripts/update-upcoming-counts.cjs"
run "update-gig-genres"       "$ROOT/scripts/update-gig-genres.cjs"
run "infer-gig-genres"        "$ROOT/scripts/infer-gig-genres-from-coperformers.cjs"
run "deduplicate"             "$ROOT/scripts/deduplicate-gigs.cjs"
run "stats"                   "$ROOT/scripts/live-stats.cjs" --once

# ── Print summary ─────────────────────────────────────────────────────────────

echo ""
echo "=== Weekly Refresh Complete ==="
echo "Finished: $(date)"
echo ""
echo "Gig counts by scraper:"
for f in "$LOG_DIR/${TS}"-*.txt; do
  name=$(basename "$f" | sed "s/${TS}-//" | sed 's/\.txt//')
  saved=$(grep -oP 'Gigs saved\s*:\s*\K[\d,]+' "$f" 2>/dev/null | tail -1)
  [ -n "$saved" ] && echo "  $name: $saved gigs"
done
