#!/usr/bin/env node
/**
 * GigRadar See Tickets Scraper
 *
 * Scrapes seetickets.com music event listings for UK events.
 * No API key required — uses their public search/browse pages.
 *
 * Usage:
 *   node scripts/scrape-seetickets.cjs
 *   node scripts/scrape-seetickets.cjs --dry-run
 *   node scripts/scrape-seetickets.cjs --resume
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'seetickets-progress.json');

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// See Tickets genre/category slugs that contain live music
const ST_GENRES = [
  'rock-pop',
  'indie',
  'alternative',
  'dance-electronic',
  'r-b-hip-hop',
  'jazz-blues-soul',
  'classical',
  'folk-country-roots',
  'metal-punk',
  'comedy', // often co-billed with music
];

const ST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Referer': 'https://www.seetickets.com',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}
function toVenueSlug(name, city) {
  const slugify = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return city ? `${slugify(city)}-${slugify(name)}` : slugify(name);
}
function toArtistId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const JUNK_WORDS = /^(tbc|tba|various artists?|support act|special guest|doors?|support|presents?|featuring|feat\.?|ft\.?|live music|open mic|dj set|resident dj|club night|tickets?|event|evening with|night of|a night|the night)$/i;

function isValidArtist(name) {
  if (!name || name.length < 2 || name.length > 100) return false;
  if (JUNK_WORDS.test(name.trim())) return false;
  if (/^\d+$|^[^a-z]+$/i.test(name.trim())) return false;
  return true;
}

// Extract artist from event title (See Tickets uses "Artist - Tour Name" format)
function extractArtist(title) {
  if (!title) return null;
  let name = title
    .replace(/\s*[-–:]\s*(the |live|tour|uk tour|headline|at |presents|concert|tickets?|show|night|evening).*/i, '')
    .replace(/\s*@\s*.+$/, '')
    .replace(/\s*\+\s*.+$/, '') // "Artist + Support" → "Artist"
    .replace(/\|.+$/, '')
    .trim();
  return name.length >= 2 && name.length <= 80 ? name : title.substring(0, 60).trim();
}

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { completedGenres: {}, gigs: 0, artists: 0, venues: 0 };
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p)); }

// ─── Auto-seed helpers ────────────────────────────────────────────────────────

const seededArtists = new Set();
const seededVenues  = new Set();

async function autoSeedArtist(name) {
  if (!isValidArtist(name)) return null;
  const artistId = toArtistId(name);
  if (!artistId || artistId.length < 2) return null;
  if (DRY_RUN) return { artistId, name };
  if (!seededArtists.has(artistId)) {
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: `SET #n = if_not_exists(#n, :n),
        isGrassroots = if_not_exists(isGrassroots, :gr),
        country = if_not_exists(country, :c),
        genres  = if_not_exists(genres, :g),
        upcoming = if_not_exists(upcoming, :u),
        lastUpdated = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': name, ':gr': false, ':c': 'UK', ':g': [], ':u': 0, ':t': new Date().toISOString() },
    })).catch(() => {});
    seededArtists.add(artistId);
  }
  return { artistId, name };
}

async function autoSeedVenue(name, city) {
  if (!name) return null;
  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;
  if (!seededVenues.has(venueId)) {
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: `SET #n = if_not_exists(#n, :n),
        city     = if_not_exists(city,     :c),
        slug     = if_not_exists(slug,     :s),
        isActive = if_not_exists(isActive, :a),
        upcoming = if_not_exists(upcoming, :u),
        lastUpdated = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': toVenueSlug(name, city),
        ':a': true, ':u': 0, ':t': new Date().toISOString(),
      },
    })).catch(() => {});
    seededVenues.add(venueId);
  }
  return venueId;
}

// ─── Fetch See Tickets page ───────────────────────────────────────────────────

async function fetchPage(genre, page) {
  // See Tickets list URL: /list/{genre}?page={n}
  // Also try search URL for broader coverage
  const url = `https://www.seetickets.com/list/${genre}?page=${page}&location=uk`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: ST_HEADERS });
      if (r.status === 429) { await sleep(30000); continue; }
      if (r.status === 404) return null; // genre doesn't exist
      if (!r.ok) { await sleep(3000 * attempt); continue; }
      return await r.text();
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

// ─── Parse See Tickets HTML ───────────────────────────────────────────────────

function parseEventsFromHtml(html) {
  if (!html) return { events: [], hasMore: false };

  const events = [];

  // See Tickets uses structured data (JSON-LD) and/or microdata
  // Try JSON-LD first
  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const block of ldBlocks) {
    try {
      const data = JSON.parse(block[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'MusicEvent' || item['@type'] === 'Event') {
          const performer = Array.isArray(item.performer) ? item.performer[0] : item.performer;
          const location  = item.location || {};
          events.push({
            title:       performer?.name || item.name || '',
            venue:       location.name || '',
            city:        location.address?.addressLocality || location.address?.addressRegion || '',
            date:        (item.startDate || '').split('T')[0],
            doorsTime:   item.startDate?.includes('T') ? item.startDate.split('T')[1]?.substring(0, 5) : null,
            url:         item.offers?.[0]?.url || item.url || '',
            price:       item.offers?.[0]?.price != null ? `£${item.offers[0].price}` : null,
            isSoldOut:   item.offers?.[0]?.availability?.includes('SoldOut') || false,
          });
        }
      }
    } catch {}
  }

  if (events.length > 0) {
    // Check for next page
    const hasMore = html.includes('rel="next"') || html.includes('?page=') && html.includes('Next');
    return { events, hasMore };
  }

  // Fallback: parse HTML event cards
  // See Tickets event cards: <div class="event-item"> or similar
  const eventMatches = [...html.matchAll(
    /href="(https?:\/\/www\.seetickets\.com\/[^"]+)"\s[^>]*>([^<]+)<\/a>[\s\S]{0,500}?(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/gi
  )];

  for (const [, url, title, dateStr] of eventMatches) {
    if (!title.trim() || title.length > 100) continue;
    events.push({
      title: title.trim(),
      venue: '',
      city: '',
      date: parseDateStr(dateStr),
      url,
      price: null,
      isSoldOut: false,
    });
  }

  const hasMore = html.includes('rel="next"') ||
                  /page=(\d+)/.test(html) && html.includes('Next');
  return { events, hasMore };
}

function parseDateStr(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    return d.toISOString().split('T')[0];
  } catch { return null; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar See Tickets Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const progress     = loadProgress();
  const completedG   = progress.completedGenres || {};
  const gigsSaved    = new Set();
  const today        = new Date().toISOString().split('T')[0];

  let totalGigs = 0, totalArtists = 0, totalVenues = 0, errors = 0;

  for (let gi = 0; gi < ST_GENRES.length; gi++) {
    const genre = ST_GENRES[gi];
    let startPage = RESUME && completedG[genre] ? completedG[genre] + 1 : 1;
    let page = startPage;
    let hasMore = true;
    let genreGigs = 0;

    while (hasMore && page <= 500) { // safety cap
      const html = await fetchPage(genre, page);
      if (!html) { errors++; break; }

      const { events, hasMore: more } = parseEventsFromHtml(html);
      hasMore = more;

      for (const ev of events) {
        if (!ev.date || ev.date < today) continue;

        const artistName = extractArtist(ev.title);
        if (!artistName) continue;

        const artist = await autoSeedArtist(artistName);
        if (!artist) continue;

        const canonicalVenueId = ev.venue
          ? await autoSeedVenue(ev.venue, ev.city)
          : null;

        const gigId = `st-${normaliseName(artistName)}-${ev.date}-${normaliseName(ev.venue || 'unknown')}`;
        if (gigsSaved.has(gigId)) continue;

        const gig = {
          gigId,
          artistId:         artist.artistId,
          artistName:       artist.name,
          date:             ev.date,
          doorsTime:        ev.doorsTime || null,
          venueName:        ev.venue || 'TBC',
          venueCity:        ev.city || '',
          venueCountry:     'GB',
          canonicalVenueId: canonicalVenueId || null,
          isSoldOut:        ev.isSoldOut || false,
          minAge:           null,
          supportActs:      [],
          tickets: [{
            seller:    'See Tickets',
            url:       ev.url || 'https://www.seetickets.com',
            available: !ev.isSoldOut,
            price:     ev.price || 'See site',
          }],
          sources:     ['seetickets'],
          lastUpdated: new Date().toISOString(),
        };

        if (!DRY_RUN) {
          await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig }))
            .catch(e => console.error(`  Gig save error:`, e.message));
        }
        gigsSaved.add(gigId);
        genreGigs++;
        totalGigs++;
        totalArtists = seededArtists.size;
        totalVenues  = seededVenues.size;
      }

      completedG[genre] = page;
      if (!DRY_RUN) saveProgress({ completedGenres: completedG, gigs: totalGigs, artists: totalArtists, venues: totalVenues });

      process.stdout.write(
        `\r  Genre ${gi + 1}/${ST_GENRES.length} [${genre.padEnd(25)}] p${page} — +${genreGigs} gigs | Total: ${totalGigs.toLocaleString()}   `
      );

      if (events.length === 0) break;
      page++;
      await sleep(600);
    }
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Gigs saved     : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded : ${totalArtists.toLocaleString()}`);
  console.log(`Venues seeded  : ${totalVenues.toLocaleString()}`);
  console.log(`Errors         : ${errors}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
