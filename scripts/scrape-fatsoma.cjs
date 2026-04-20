#!/usr/bin/env node
/**
 * GigRadar Fatsoma Scraper
 *
 * Uses the Fatsoma public API to fetch UK gig events.
 * 15,600+ events, includes lineup (artist) and venue data.
 *
 * Usage:
 *   node scripts/scrape-fatsoma.cjs
 *   node scripts/scrape-fatsoma.cjs --dry-run
 *   node scripts/scrape-fatsoma.cjs --resume
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                            = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand }        = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'fatsoma-progress.json');
const LOG_FILE      = path.join(__dirname, 'scrape-fatsoma-log.txt');

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const sleep   = ms => new Promise(r => setTimeout(r, ms));

const API_KEY  = 'fk_ui_cust_aff50532-bbb5-45ed-9d0a-4ad144814b9f';
const BASE_URL = 'https://api.fatsoma.com/v1/events';
const PAGE_SIZE = 50;

const API_HEADERS = {
  'Accept': 'application/json',
  'X-API-Key': API_KEY,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}
function toVenueSlug(name, city) {
  const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return city ? `${slug(city)}-${slug(name)}` : slug(name);
}
function toArtistId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Extract artist name from headline event names like "ARTIST HEADLINE SHOW", "ARTIST LIVE", "ARTIST TOUR"
const HEADLINE_SUFFIXES = /\s+(headline show|live|uk tour|tour|at .+|[-–—].+|\| .+)$/i;
const JUNK_ARTIST = /^(tba|tbc|various artists?|support|residents?|live|open mic|dj set|doors?|to be confirmed|club night|presents|tickets?)$/i;

function extractArtistFromEventName(name) {
  if (!name) return null;
  // Remove common suffixes
  let cleaned = name.trim().replace(HEADLINE_SUFFIXES, '').trim();
  // Remove trailing punctuation
  cleaned = cleaned.replace(/[!:,\s]+$/, '').trim();
  // Must be reasonable length
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (JUNK_ARTIST.test(cleaned)) return null;
  return cleaned;
}

const logLines = [];
function log(msg) { logLines.push(msg); }
function flushLog() {
  if (logLines.length) {
    fs.appendFileSync(LOG_FILE, logLines.join('\n') + '\n');
    logLines.length = 0;
  }
}

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { completedPages: [] };
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

// ─── API fetch ────────────────────────────────────────────────────────────────

async function fetchPage(pageNum) {
  const url = `${BASE_URL}?category=gigs&country=gb&page%5Bsize%5D=${PAGE_SIZE}&page%5Bnumber%5D=${pageNum}&include=lineups,location`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: API_HEADERS });
      if (r.status === 429) { await sleep(30000); continue; }
      if (!r.ok) { await sleep(3000 * attempt); continue; }
      const d = await r.json();
      return d;
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

// ─── Auto-seed venue ──────────────────────────────────────────────────────────

const seededVenues = new Set();

async function autoSeedVenue(locAttrs) {
  const name = (locAttrs.name || '').trim();
  const city = (locAttrs.city || '').trim();
  if (!name || name === 'Various Venues' || name === 'Online' || !city) return null;

  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const lat = locAttrs.latitude  || null;
    const lon = locAttrs.longitude || null;
    const addr = locAttrs['address-line-1'] || null;
    const pc   = locAttrs['postal-code']    || null;

    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: `SET #n       = if_not_exists(#n,       :n),
        city        = if_not_exists(city,        :c),
        slug        = if_not_exists(slug,        :s),
        active      = if_not_exists(active,      :a),
        upcoming    = if_not_exists(upcoming,    :u),
        country     = if_not_exists(country,     :co),
        lastUpdated = :t
        ${lat  ? ', lat     = if_not_exists(lat,     :lat)' : ''}
        ${lon  ? ', lon     = if_not_exists(lon,     :lon)' : ''}
        ${addr ? ', address = if_not_exists(address, :addr)' : ''}
        ${pc   ? ', postcode = if_not_exists(postcode, :pc)' : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': toVenueSlug(name, city),
        ':a': true, ':u': 0, ':t': new Date().toISOString(), ':co': 'GB',
        ...(lat  ? { ':lat':  lat  } : {}),
        ...(lon  ? { ':lon':  lon  } : {}),
        ...(addr ? { ':addr': addr } : {}),
        ...(pc   ? { ':pc':   pc   } : {}),
      },
    })).catch(() => {});
    seededVenues.add(venueId);
  }
  return venueId;
}

// ─── Auto-seed artist ─────────────────────────────────────────────────────────

const seededArtists = new Set();

async function autoSeedArtist(artistName) {
  if (!artistName || artistName.length < 2 || artistName.length > 100) return null;
  if (JUNK_ARTIST.test(artistName.trim())) return null;
  const artistId = toArtistId(artistName);
  if (!artistId || artistId.length < 2 || DRY_RUN) return artistId;

  if (!seededArtists.has(artistId)) {
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: `SET #n = if_not_exists(#n, :n), upcoming = if_not_exists(upcoming, :u), lastUpdated = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': artistName, ':u': 0, ':t': new Date().toISOString() },
    })).catch(() => {});
    seededArtists.add(artistId);
  }
  return artistId;
}

// ─── Process one page of events ───────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

async function processPage(data, gigsSaved, artistsSaved, venuesSaved) {
  let newGigs = 0, newArtists = 0, newVenues = 0;

  // Build location lookup
  const locationById = {};
  for (const inc of (data.included || [])) {
    if (inc.type === 'locations') locationById[inc.id] = inc.attributes;
  }

  // Build lineup lookup: eventId → [artistName]
  const lineupsByEvent = {};
  for (const inc of (data.included || [])) {
    if (inc.type !== 'lineups') continue;
    if (!inc.attributes?.name) continue;
    for (const evRef of (inc.relationships?.events?.data || [])) {
      (lineupsByEvent[evRef.id] = lineupsByEvent[evRef.id] || []).push(inc.attributes.name.trim());
    }
  }

  for (const ev of (data.data || [])) {
    const attrs = ev.attributes;
    const date = (attrs['starts-at'] || '').split('T')[0];
    if (!date || date < today) continue;

    // Get venue
    const locId = ev.relationships?.location?.data?.id;
    const locAttrs = locId ? locationById[locId] : null;
    if (!locAttrs) continue;

    // Skip online events
    if (!locAttrs.city || locAttrs.country !== 'United Kingdom') continue;

    const canonicalVenueId = await autoSeedVenue(locAttrs);
    if (!canonicalVenueId) continue;

    if (!venuesSaved.has(canonicalVenueId)) { venuesSaved.add(canonicalVenueId); newVenues++; }

    // Determine artists: prefer lineups, fallback to event name
    let artists = (lineupsByEvent[ev.id] || []).filter(n => n.length >= 2 && n.length <= 100 && !JUNK_ARTIST.test(n));
    if (artists.length === 0) {
      const extracted = extractArtistFromEventName(attrs.name);
      if (extracted) artists = [extracted];
    }
    if (artists.length === 0) continue;

    const venueName = locAttrs.name;
    const venueCity = locAttrs.city;
    const ticketUrl = `https://www.fatsoma.com/e/${attrs['vanity-name'] || ev.id}`;
    const priceMin  = attrs['price-min'] ? `£${(attrs['price-min'] / 100).toFixed(2)}` : null;
    const priceMax  = attrs['price-max'] ? `£${(attrs['price-max'] / 100).toFixed(2)}` : null;
    const priceStr  = priceMin ? (priceMax && priceMax !== priceMin ? `${priceMin}–${priceMax}` : priceMin) : 'See site';

    for (const artistName of artists) {
      const artistId = await autoSeedArtist(artistName);
      if (!artistId) continue;
      if (!artistsSaved.has(artistId)) { artistsSaved.add(artistId); newArtists++; }

      const gigId = `fatsoma-${ev.id}-${artistId}`.replace(/[^a-z0-9-]/gi, '-').substring(0, 100);
      if (gigsSaved.has(gigId)) continue;

      const gig = {
        gigId,
        artistId,
        artistName,
        date,
        doorsTime: null,
        venueName,
        venueCity,
        venueCountry: 'GB',
        canonicalVenueId,
        isSoldOut: false,
        minAge: attrs['age-restrictions'] ? parseInt(attrs['age-restrictions']) || null : null,
        supportActs: artists.filter(a => a !== artistName),
        tickets: [{
          seller:    'Fatsoma',
          url:       ticketUrl,
          available: attrs['on-sale'] !== false,
          price:     priceStr,
        }],
        sources:     ['fatsoma'],
        lastUpdated: new Date().toISOString(),
      };

      if (!DRY_RUN) {
        await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig }))
          .catch(e => console.error(`  Gig save error ${gigId}:`, e.message));
      }
      gigsSaved.add(gigId);
      newGigs++;
      log(`  [${artistName}] @ ${venueName}, ${venueCity} — ${date}`);
    }
  }

  return { newGigs, newArtists, newVenues };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Fatsoma Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  if (!DRY_RUN) fs.writeFileSync(LOG_FILE, `=== Fatsoma Scraper — ${new Date().toISOString()} ===\n\n`);

  // Get total pages
  const first = await fetchPage(1);
  if (!first) { console.error('Failed to fetch first page'); process.exit(1); }
  const totalPages = first.meta?.['total-pages'] || Math.ceil((first.meta?.['total-count'] || 0) / PAGE_SIZE);
  console.log(`Total events: ${(first.meta?.['total-count'] || 0).toLocaleString()} across ${totalPages} pages\n`);

  const progress     = loadProgress();
  const completedSet = new Set(progress.completedPages || []);
  const gigsSaved    = new Set();
  const artistsSaved = new Set();
  const venuesSaved  = new Set();
  let totalGigs = 0, totalArtists = 0, totalVenues = 0;

  // Process first page (already fetched)
  if (!completedSet.has(1)) {
    const { newGigs, newArtists, newVenues } = await processPage(first, gigsSaved, artistsSaved, venuesSaved);
    totalGigs += newGigs; totalArtists += newArtists; totalVenues += newVenues;
    completedSet.add(1);
  }

  for (let page = 2; page <= totalPages; page++) {
    if (RESUME && completedSet.has(page)) {
      process.stdout.write(`\r  [${page}/${totalPages}] skipped   `);
      continue;
    }

    await sleep(300);
    const data = await fetchPage(page);
    if (!data) {
      console.error(`\nFailed to fetch page ${page}`);
      continue;
    }

    const { newGigs, newArtists, newVenues } = await processPage(data, gigsSaved, artistsSaved, venuesSaved);
    totalGigs += newGigs; totalArtists += newArtists; totalVenues += newVenues;
    completedSet.add(page);

    if (!DRY_RUN) {
      saveProgress({ completedPages: [...completedSet] });
      if (page % 10 === 0) flushLog();
    }

    process.stdout.write(
      `\r  [${page}/${totalPages}] +${newGigs} | Total: ${totalGigs.toLocaleString()} gigs, ${totalArtists.toLocaleString()} artists   `
    );
  }

  if (!DRY_RUN) flushLog();

  console.log('\n\n=== Complete ===');
  console.log(`Gigs saved     : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded : ${totalArtists.toLocaleString()}`);
  console.log(`Venues seeded  : ${totalVenues.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
