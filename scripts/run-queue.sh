#!/usr/bin/env bash
# GigRadar Post-Scrape Queue
#
# Waits for the venue gig scraper to finish, then runs in order:
#   1. Bandsintown   — cross-references all seeded artists against BIT API
#   2. Lambda scraper locally — Last.fm artist import + Deezer image enrichment
#   3. OSM venue enrichment  — website, capacity, lat/lon from OpenStreetMap
#   4. TM venue enrichment   — images, website, social from Ticketmaster
#   5. MusicBrainz enrichment — website, capacity from MusicBrainz Places
#
# Usage:
#   bash scripts/run-queue.sh
#   bash scripts/run-queue.sh --skip-wait   (skip waiting, run immediately)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR"
VENUE_GIGS_LOG="$LOG_DIR/scrape-venue-gigs-log.txt"
TM_KEY="ttdbtKPP936EBCBNnBPOwxvzIzYDoi8I"

step() { echo ""; echo "════════════════════════════════════════"; echo "  $1"; echo "════════════════════════════════════════"; echo ""; }

# ─── 0. Wait for venue gig scraper to finish ─────────────────────────────────

if ! echo "$@" | grep -q '\-\-skip-wait'; then
  step "Waiting for venue gig scraper to finish..."
  echo "  Watching: $VENUE_GIGS_LOG"
  echo "  Polling every 60s..."
  while true; do
    if grep -qE "=== Complete ===|✓ Done" "$VENUE_GIGS_LOG" 2>/dev/null; then
      echo "  Venue gig scraper finished!"
      break
    fi
    LAST_MOD=$(stat "$VENUE_GIGS_LOG" 2>/dev/null | grep Modify | awk '{print $2, $3}')
    echo "  Still running... (last update: $LAST_MOD)"
    sleep 60
  done
fi

# Bandsintown API returns 403 for all requests — skipped

# ─── 1. Lambda scraper (local) — Last.fm + Deezer image enrichment ───────────

step "Step 1/4: Lambda artist scraper (Last.fm + Deezer images)"
echo "  Running Lambda scraper handler locally..."
LASTFM_API_KEY="${LASTFM_API_KEY:-}" \
TICKETMASTER_API_KEY="$TM_KEY" \
SKIDDLE_API_KEY="${SKIDDLE_API_KEY:-}" \
LASTFM_API_KEY="${LASTFM_API_KEY:-}" \
TICKETMASTER_API_KEY="$TM_KEY" \
node "$SCRIPT_DIR/run-lambda-scraper.cjs" 2>&1 | tee "$LOG_DIR/scrape-lambda-artist-log.txt"

# ─── 3. OSM venue enrichment ─────────────────────────────────────────────────

step "Step 2/4: OpenStreetMap venue enrichment"
echo "  Adding website, capacity, lat/lon from OpenStreetMap..."
node "$SCRIPT_DIR/seed-venues-osm.cjs" 2>&1 | tee "$LOG_DIR/enrich-venues-osm-log.txt"

# ─── 4. Ticketmaster venue enrichment ────────────────────────────────────────

step "Step 3/4: Ticketmaster venue enrichment"
echo "  Adding images, website, social links from Ticketmaster API..."
TM_API_KEY="$TM_KEY" node "$SCRIPT_DIR/enrich-venues-ticketmaster.cjs" 2>&1 | tee "$LOG_DIR/enrich-venues-tm-log.txt"

# ─── 5. MusicBrainz venue enrichment ─────────────────────────────────────────

step "Step 4/4: MusicBrainz venue enrichment"
echo "  Adding website, capacity from MusicBrainz Places..."
node "$SCRIPT_DIR/enrich-venues-musicbrainz.cjs" 2>&1 | tee "$LOG_DIR/enrich-venues-mb-log.txt"

# ─── Done ─────────────────────────────────────────────────────────────────────

step "Queue complete!"
echo "  All steps finished. Summary:"
echo ""
grep -h "Gigs saved\|Artists seeded\|Venues seeded\|Venues enriched\|Enriched" \
  "$LOG_DIR/scrape-bandsintown-log.txt" \
  "$LOG_DIR/enrich-venues-osm-log.txt" \
  "$LOG_DIR/enrich-venues-tm-log.txt" \
  "$LOG_DIR/enrich-venues-mb-log.txt" 2>/dev/null | sed 's/^/  /'
echo ""
