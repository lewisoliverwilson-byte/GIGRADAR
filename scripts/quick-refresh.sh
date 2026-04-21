#!/usr/bin/env bash
# GigRadar Quick Refresh
#
# Runs all 14 scrapers in --quick mode, then all enrichment in --quick/--resume mode.
# Designed to run every week via Windows Task Scheduler (Monday 3am).
# Typical runtime: ~60-90 minutes.
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

export TM_API_KEY="${TM_API_KEY:-ttdbtKPP936EBCBNnBPOwxvzIzYDoi8I}"
export RESEND_API_KEY="${RESEND_API_KEY:-}"   # set this once you have a Resend key
export SPOTIFY_CLIENT_ID="${SPOTIFY_CLIENT_ID:-9f4abb0eac5a45019b8d9a492daa41fc}"
export SPOTIFY_CLIENT_SECRET="${SPOTIFY_CLIENT_SECRET:-130c12d419064803bec3126cb3d4e411}"
export LASTFM_API_KEY="${LASTFM_API_KEY:-e2c0791c809dd2a81adde0158dd70c41}"
export SETLISTFM_KEY="${SETLISTFM_KEY:-LLwRhC7w4JhTvH-8tqOmnGz5SV18W-8wurAw}"  # 1440 req/day — cached 7d in DynamoDB

log() { echo "  [$1] $(date +%H:%M:%S) — $2"; }

echo "=== GigRadar Quick Refresh ==="
echo "Started: $(date)"
echo "Logs: $LOG_DIR"
echo ""

# ════════════════════════════════════════════════════════════════
# PHASE 1 — SCRAPING (new gigs, artists, venues)
# ════════════════════════════════════════════════════════════════

echo "▶ Wave 1 — TM + Songkick + Skiddle"
TM_API_KEY=$TM_API_KEY node "$ROOT/scripts/scrape-ticketmaster.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-ticketmaster.txt" 2>&1 &
node "$ROOT/scripts/scrape-songkick.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-songkick.txt" 2>&1 &
node "$ROOT/scripts/scrape-skiddle-events.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-skiddle.txt" 2>&1 &
wait; log "wave1" "done"

echo "▶ Wave 2 — DICE + Ticketline + RA + SeeTickets"
node "$ROOT/scripts/scrape-dice.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-dice.txt" 2>&1 &
node "$ROOT/scripts/scrape-ticketline.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-ticketline.txt" 2>&1 &
node "$ROOT/scripts/scrape-resident-advisor.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-ra.txt" 2>&1 &
node "$ROOT/scripts/scrape-seetickets.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-seetickets.txt" 2>&1 &
wait; log "wave2" "done"

echo "▶ Wave 3 — Gigantic + WGT + Fatsoma + Eventbrite"
node "$ROOT/scripts/scrape-gigantic.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-gigantic.txt" 2>&1 &
node "$ROOT/scripts/scrape-wegottickets.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-wgt.txt" 2>&1 &
node "$ROOT/scripts/scrape-fatsoma.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-fatsoma.txt" 2>&1 &
node "$ROOT/scripts/scrape-eventbrite.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-eventbrite.txt" 2>&1 &
wait; log "wave3" "done"

echo "▶ Wave 4 — Ents24 (URL-based, alone)"
node "$ROOT/scripts/scrape-ents24.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-ents24.txt" 2>&1
log "wave4" "done"

echo "▶ Wave 5 — Bandsintown (artists with upcoming gigs)"
BIT_APP_ID=gigradar node "$ROOT/scripts/scrape-bandsintown.cjs" --quick --resume $DRY \
  > "$LOG_DIR/${TS}-bandsintown.txt" 2>&1
log "wave5" "done"

echo "▶ Wave 6 — Venue-centric (Skiddle + Songkick per active venue)"
node "$ROOT/scripts/scrape-venue-gigs.cjs" --quick $DRY \
  > "$LOG_DIR/${TS}-venue-gigs.txt" 2>&1
log "wave6" "done"

# ════════════════════════════════════════════════════════════════
# PHASE 1b — GIG ALERTS (send after all scrapers finish)
# ════════════════════════════════════════════════════════════════
echo ""
echo "▶ Sending gig alerts to followers"
node "$ROOT/scripts/send-gig-alerts.cjs" $DRY \
  > "$LOG_DIR/${TS}-alerts.txt" 2>&1
log "alerts" "done"

# ════════════════════════════════════════════════════════════════
# PHASE 2 — CLEANUP
# ════════════════════════════════════════════════════════════════
echo ""
echo "▶ Cleanup — purge old gigs + update upcoming counts"
node "$ROOT/scripts/purge-old-gigs.cjs" $DRY \
  > "$LOG_DIR/${TS}-purge.txt" 2>&1
log "purge" "done"

node "$ROOT/scripts/update-upcoming-counts.cjs" $DRY \
  > "$LOG_DIR/${TS}-upcoming.txt" 2>&1
log "upcoming-counts" "done"

# ════════════════════════════════════════════════════════════════
# PHASE 3 — ENRICHMENT (--quick + --resume = only new/active artists)
# All run in parallel pairs where rate limits allow
# ════════════════════════════════════════════════════════════════
echo ""
echo "▶ Enrichment — Spotify + Last.fm (parallel, quick mode)"
SPOTIFY_CLIENT_ID=$SPOTIFY_CLIENT_ID SPOTIFY_CLIENT_SECRET=$SPOTIFY_CLIENT_SECRET \
  node "$ROOT/scripts/enrich-artists-spotify.cjs" --quick --resume $DRY \
  > "$LOG_DIR/${TS}-enrich-spotify.txt" 2>&1 &
LASTFM_API_KEY=$LASTFM_API_KEY \
  node "$ROOT/scripts/enrich-artists-lastfm.cjs" --quick --resume $DRY \
  > "$LOG_DIR/${TS}-enrich-lastfm.txt" 2>&1 &
wait; log "enrich-spotify+lastfm" "done"

echo "▶ Enrichment — MusicBrainz (quick, 1 req/sec — runs in background)"
node "$ROOT/scripts/enrich-artists-musicbrainz.cjs" --quick --resume $DRY \
  > "$LOG_DIR/${TS}-enrich-mb.txt" 2>&1 &
MB_PID=$!
log "enrich-mb" "started PID $MB_PID (will complete in background)"

echo "▶ Enrichment — Wikipedia bios (quick, resume)"
node "$ROOT/scripts/enrich-artists-wikipedia.cjs" --quick --resume $DRY \
  > "$LOG_DIR/${TS}-enrich-wiki.txt" 2>&1
log "enrich-wiki" "done"

echo "▶ Enrichment — Venue genres (fast, always full pass)"
node "$ROOT/scripts/enrich-venues-genres.cjs" $DRY \
  > "$LOG_DIR/${TS}-enrich-venue-genres.txt" 2>&1
log "enrich-venue-genres" "done"

# ════════════════════════════════════════════════════════════════
# PHASE 4 — GENRE PROPAGATION
# ════════════════════════════════════════════════════════════════
echo ""
echo "▶ Genre propagation — artist → gigs + co-performer inference"
node "$ROOT/scripts/update-gig-genres.cjs" $DRY \
  > "$LOG_DIR/${TS}-update-gig-genres.txt" 2>&1
log "update-gig-genres" "done"

node "$ROOT/scripts/infer-gig-genres-from-coperformers.cjs" $DRY \
  > "$LOG_DIR/${TS}-infer-genres.txt" 2>&1
log "infer-genres" "done"

# ════════════════════════════════════════════════════════════════
# PHASE 5 — DEDUP + STATS
# ════════════════════════════════════════════════════════════════
echo ""
echo "▶ Deduplication"
node "$ROOT/scripts/deduplicate-gigs.cjs" $DRY \
  > "$LOG_DIR/${TS}-dedup.txt" 2>&1
log "dedup" "done"

echo "▶ Stats snapshot"
node "$ROOT/scripts/live-stats.cjs" --once \
  > "$LOG_DIR/${TS}-stats.txt" 2>&1
log "stats" "done"

echo "▶ Sitemap regeneration"
node "$ROOT/scripts/generate-sitemap.cjs" \
  > "$LOG_DIR/${TS}-sitemap.txt" 2>&1
log "sitemap" "done"

# Wait for MusicBrainz to finish (if still running)
if kill -0 $MB_PID 2>/dev/null; then
  echo "  [mb] still running — waiting..."
  wait $MB_PID
  log "enrich-mb" "done"
fi

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
echo "Enrichment:"
for name in enrich-spotify enrich-lastfm enrich-mb enrich-wiki enrich-venue-genres; do
  f="$LOG_DIR/${TS}-${name}.txt"
  [ -f "$f" ] || continue
  enriched=$(grep -oP 'Enriched\s*:\s*\K[\d,]+' "$f" 2>/dev/null | tail -1)
  [ -n "$enriched" ] && printf "  %-25s %s artists\n" "$name" "$enriched"
done
echo ""
cat "$LOG_DIR/${TS}-stats.txt" 2>/dev/null | grep -E 'Future|genres|Artists|With genres' | head -8
