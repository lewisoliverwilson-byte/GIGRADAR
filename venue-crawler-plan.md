# Venue Website Crawler — Implementation Plan

**Goal:** Scrape every UK music venue website to discover and profile every band playing in the UK, including tiny local and student acts with no ticketing platform presence.

**Status key:** ☐ To do · ✅ Done

---

## Phase 1 — Venue URL Seeding (OpenStreetMap)

*Get a database of UK venue website URLs to crawl.*

- ✅ Write a one-time Node script to query the OpenStreetMap Overpass API for all UK music venues
  - Tags queried: `amenity=music_venue`, `venue=music`, `venue=concert_hall`, `amenity=pub/bar/nightclub/arts_centre` with `live_music=yes`, etc.
  - Extract: name, city, website URL (where present), OSM ID, lat/lng
- ✅ Clean and deduplicate the results (300 unique venues parsed)
- ✅ Cross-reference with existing `gigradar-venues` table
- ✅ Bulk-write new venue records to `gigradar-venues` DynamoDB table — 300 written, 175 with website URLs
  - New fields added: `website`, `osmId`, `lat`, `lon`, `postcode`
- ☐ Add venue URL editing to admin dashboard (`/admin`) — so missing/wrong URLs can be fixed manually over time

**Actual yield: 300 venues, 175 with website URLs** (OSM tagging is incomplete — more will be added via Music Venue Trust in Phase 7)

> Note: `crawlUrl` and `lastCrawled`/`crawlStatus` fields will be added in Phase 2 when the probe script runs.

---

## Phase 2 — Crawl URL Discovery

*For each venue, find the specific page that lists their upcoming gigs.*

- ✅ Write `scripts/probe-crawl-urls.cjs` — tries 15 common event page paths per venue, detects event signals (dates, "tickets", "doors", etc.), falls back to homepage link scanning
- ✅ Run the probe across all 175 venues with website URLs — 129 confirmed crawl URLs stored in DynamoDB
- ✅ Flag unreachable (21) and no-event-page (25) venues with `crawlStatus` in DynamoDB

**Actual yield: 129 / 175 venues with confirmed crawl URLs ready for Phase 4**

---

## Phase 3 — ECS Fargate Infrastructure

*Set up the container environment that runs the crawler. Lambda can't reliably run Puppeteer, so we use ECS Fargate — a managed container that spins up on a schedule.*

- ☐ Write `crawler/Dockerfile`:
  - Base: `node:20-slim`
  - Install Chromium + Puppeteer dependencies
  - Copy crawler source files
- ☐ Create Amazon ECR repository (`gigradar-venue-crawler`)
- ☐ Build and push Docker image to ECR
- ☐ Create ECS cluster (`gigradar-cluster`, Fargate)
- ☐ Create ECS task definition:
  - Image: ECR image
  - CPU: 1 vCPU, Memory: 2GB (Puppeteer needs headroom)
  - IAM role with DynamoDB read/write permissions
  - Environment variables: `AWS_REGION`, `LASTFM_API_KEY`
- ☐ Create EventBridge schedule rule to trigger the crawler daily (e.g. 03:00 UTC)
- ☐ Test: run the ECS task manually and confirm it starts, connects to DynamoDB, and exits cleanly

**Cost when running:** ~£0.40 per full crawl run (~£12/month at daily frequency)

---

## Phase 4 — Crawler Implementation

*The actual scraping logic. Handles 4 different types of venue website.*

### 4a — Core crawler (`crawler/index.js`)
- ☐ Load all venues from DynamoDB that have a `crawlUrl` and haven't been crawled in the last 24h
- ☐ Crawl each venue: try cheerio (fast, no browser) first; fall back to Puppeteer for JS-rendered sites
- ☐ After each successful crawl: update `lastCrawled` timestamp and `crawlStatus` in DynamoDB
- ☐ Log summary: venues crawled, events found, new artists created

### 4b — Parsers

- ☐ **JSON-LD / Schema.org parser** — look for `<script type="application/ld+json">` with `@type: MusicEvent` or `Event`; extract name, date, location, performer, ticket URL (same approach used for Songkick)
- ☐ **Generic HTML parser** — regex/cheerio patterns for common event listing layouts; look for date + band name patterns near each other in the DOM
- ☐ **Ticket Tailor embed parser** — detect `tickettailor.com` iframes or widgets; call Ticket Tailor's public widget API to get event data without rendering
- ☐ **TicketWeb parser** — detect `ticketweb.uk` iframes; parse their embed endpoint
- ☐ **Universe.com parser** — detect Universe embeds; parse accordingly

### 4c — Artist pipeline
- ☐ For each event found: extract the headline act name
- ☐ Filter with existing `isGenericName()` and `isTributeAct()` functions
- ☐ Call `autoSeedArtist()` logic (same as scraper) to create/find artist record
- ☐ Create gig record with source `venue-crawler`, link to venue by `canonicalVenueId`
- ☐ Handle support acts where the venue listing includes them

---

## Phase 5 — Admin Dashboard Updates

*Allow manual management of venue URLs and crawl monitoring.*

- ☐ Add **Venues tab** to `/admin` dashboard:
  - List all venues with their `website` and `crawlUrl` fields
  - Editable inline — admin can add/correct a URL and save
  - Show `lastCrawled` timestamp and `crawlStatus` per venue
  - Manual "Re-crawl now" button per venue (calls a Lambda trigger)
- ☐ Add crawl stats to admin home: total venues with URLs, crawled in last 24h, new artists discovered this week

---

## Phase 6 — Testing & Launch

- ☐ Test manually on 10 known UK venues:
  - GLive (Guildford) — `glive.co.uk`
  - The Fleece (Bristol) — `thefleece.co.uk`
  - Rough Trade (London/Bristol/Nottingham)
  - Brudenell Social Club (Leeds)
  - The Haunt (Brighton)
  - Fibbers (York)
  - The Deaf Institute (Manchester)
  - Exeter Phoenix
  - Guildhall (Southampton)
  - A student union venue
- ☐ Validate: are artist records being created correctly? Are gigs linking to the right venue?
- ☐ Check for false positives (generic event names slipping through the filter)
- ☐ Monitor CloudWatch logs from first full crawl run
- ☐ Review quality of first ~100 grassroots artist profiles created

---

## Phase 7 — Ongoing Expansion

*Once the system is running, keep adding more venues.*

- ☐ Add Music Venue Trust's ~900 GMV (grassroots music venue) list as a second seeding pass
- ☐ Assess whether Google Places API is needed to fill remaining gaps
- ☐ Set up automated alerting (CloudWatch alarm) if the crawler task fails
- ☐ Add student union venues specifically (NUS list of ~600 UK student unions)

---

## Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Venue URL seeding (OpenStreetMap) | ✅ |
| 2 | Crawl URL discovery | ☐ |
| 3 | ECS Fargate infrastructure | ☐ |
| 4 | Crawler implementation | ☐ |
| 5 | Admin dashboard updates | ☐ |
| 6 | Testing & launch | ☐ |
| 7 | Ongoing expansion | ☐ |
