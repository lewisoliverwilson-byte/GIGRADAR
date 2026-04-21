#!/usr/bin/env node
/**
 * GigRadar DICE Scraper
 *
 * Scrapes dice.fm browse pages (Next.js __NEXT_DATA__) for UK music events
 * by city. No API key required — uses public browse pages.
 *
 * If __NEXT_DATA__ is empty (client-side rendering), run with --browse to use
 * headless Chrome (requires gstack browse binary).
 *
 * Usage:
 *   node scripts/scrape-dice.cjs
 *   node scripts/scrape-dice.cjs --dry-run
 *   node scripts/scrape-dice.cjs --resume
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { execSync } = require('child_process');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'dice-progress.json');

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const QUICK   = process.argv.includes('--quick');  // limit to 3 pages per city/filter
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// UK cities available on DICE — slug format is {perm_name}-{hex_id}
// Also scrape /music/gig and /music/dj sub-filters for more coverage
const UK_CITIES = [
  { slug: 'london-54d8a23438fe5d27d500001c',         name: 'London' },
  { slug: 'birmingham-56430c071b1e7311084a134d',      name: 'Birmingham' },
  { slug: 'bn-5665ad1ae3ff13adb15e0ca6',             name: 'Brighton' },
  { slug: 'bristol-54d8a21638fe5d27d5000016',         name: 'Bristol' },
  { slug: 'chelmsford-5eb9799ae1727402966007e1',      name: 'Chelmsford' },
  { slug: 'high_wycombe-695e2c87736f6c2b4517c0c3',   name: 'High Wycombe' },
  { slug: 'leeds-55f0381d5e0c39b48e8928fd',           name: 'Leeds' },
  { slug: 'liverpool-560e9ed74053e1fcd2f0080e',       name: 'Liverpool' },
  { slug: 'man-54d8a22538fe5d27d5000019',             name: 'Manchester' },
  { slug: 'norwich-5e5fe01ab806185546cf16c2',         name: 'Norwich' },
  { slug: 'nottingham-5e281d08a98d98026aed2e80',      name: 'Nottingham' },
  { slug: 'sheffield-5744619e6bc0a48a3d4c676b',       name: 'Sheffield' },
  { slug: 'southampton-58aeb28a30b3996024da53e0',     name: 'Southampton' },
];

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
function dedupKey(artistId, date, venueName) {
  return `${artistId}|${date}|${normaliseName(venueName)}`;
}

const JUNK_WORDS = /^(tbc|tba|various artists?|support act|special guest|doors?|support|presents?|featuring|feat\.?|ft\.?|live music|open mic|dj set|resident dj|club night|tickets?|event|evening with|night of|a night|the night)$/i;

function isValidArtist(name) {
  if (!name || name.length < 2 || name.length > 100) return false;
  if (JUNK_WORDS.test(name.trim())) return false;
  if (/^\d+$|^[^a-z]+$/i.test(name.trim())) return false;
  return true;
}

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { completedCities: [], gigs: 0, artists: 0, venues: 0 };
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
        genres  = if_not_exists(genres,  :g),
        upcoming = if_not_exists(upcoming, :u),
        lastUpdated = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': name, ':gr': false, ':c': 'UK', ':g': [], ':u': 0, ':t': new Date().toISOString() },
    })).catch(() => {});
    seededArtists.add(artistId);
  }
  return { artistId, name };
}

async function autoSeedVenue(venueName, cityName, lat, lon) {
  if (!venueName) return null;
  const venueId = toVenueId(venueName, cityName);
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
        lastUpdated = :t
        ${lat ? ', lat = if_not_exists(lat, :lat)' : ''}
        ${lon ? ', lon = if_not_exists(lon, :lon)' : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': venueName, ':c': cityName, ':s': toVenueSlug(venueName, cityName),
        ':a': true, ':u': 0, ':t': new Date().toISOString(),
        ...(lat ? { ':lat': lat } : {}),
        ...(lon ? { ':lon': lon } : {}),
      },
    })).catch(() => {});
    seededVenues.add(venueId);
  }
  return venueId;
}

// ─── Fetch DICE city page ─────────────────────────────────────────────────────

const DICE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
};

// Fetches a DICE browse page (SSR Next.js) and returns { events, nextCursor }
async function fetchDicePage(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: DICE_HEADERS });
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const html = await r.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) return { events: [], nextCursor: null };
      const pp = JSON.parse(m[1])?.props?.pageProps;
      return {
        events:     Array.isArray(pp?.events) ? pp.events : [],
        nextCursor: pp?.nextCursor || null,
      };
    } catch (e) {
      if (attempt === 3) return { events: [], nextCursor: null };
      await sleep(2000 * attempt);
    }
  }
  return { events: [], nextCursor: null };
}

// Sub-filters to scrape per city for more events
const DICE_FILTERS = ['', '/music/gig', '/music/dj', '/music/party'];

// ─── Parse event objects ──────────────────────────────────────────────────────

async function processEvent(ev, gigsSaved, artistsSaved, venuesSaved) {
  // DICE __NEXT_DATA__ event structure (confirmed from live data):
  // ev.name = event title (often headliner)
  // ev.summary_lineup.top_artists[0].name = headliner name
  // ev.venues[0].name = venue name
  // ev.venues[0].city.name = city name
  // ev.dates.event_start_date = ISO datetime
  // ev.price.amount_from = price in pence
  // ev.status = 'sold-out' | 'on_sale' | etc.
  // ev.perm_name = for building URL

  const topArtist = ev.summary_lineup?.top_artists?.find(a => a.is_headliner) ||
                    ev.summary_lineup?.top_artists?.[0];
  const artistName = topArtist?.name || ev.name || null;

  const venue = ev.venues?.[0];
  const venueName = venue?.name || null;
  const cityName  = venue?.city?.name || '';

  const dateStr = ev.dates?.event_start_date || '';
  const date    = dateStr.split('T')[0] || null;
  const doorsTime = dateStr.includes('T') ? dateStr.split('T')[1]?.substring(0, 5) : null;

  const priceRaw = ev.price?.amount_from;
  const price    = priceRaw != null ? `£${(priceRaw / 100).toFixed(2)}` : null;
  const isSoldOut = ev.status === 'sold-out' || ev.status === 'cancelled';
  const ticketUrl = ev.perm_name
    ? `https://dice.fm/event/${ev.perm_name}`
    : 'https://dice.fm';

  if (!artistName || !date || !venueName) return false;

  const artist = await autoSeedArtist(artistName);
  if (!artist) return false;

  const venueLat = parseFloat(venue?.location?.lat) || null;
  const venueLon = parseFloat(venue?.location?.lng) || null;
  const canonicalVenueId = await autoSeedVenue(venueName, cityName, venueLat, venueLon);

  const gigId = `dice-${normaliseName(artistName)}-${date}-${normaliseName(venueName)}`;
  if (gigsSaved.has(gigId)) return false;

  const gig = {
    gigId,
    artistId:         artist.artistId,
    artistName:       artist.name,
    date,
    doorsTime:        doorsTime || null,
    venueName,
    venueCity:        cityName,
    venueCountry:     'GB',
    canonicalVenueId,
    isSoldOut:        isSoldOut,
    minAge:           null,
    supportActs:      [],
    tickets: [{
      seller:    'DICE',
      url:       ticketUrl,
      available: !isSoldOut,
      price:     price || 'See site',
    }],
    sources:     ['dice'],
    lastUpdated: new Date().toISOString(),
  };

  if (!DRY_RUN) {
    await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig }))
      .catch(e => console.error(`  Gig save error ${gig.gigId}:`, e.message));
  }
  gigsSaved.add(gigId);
  if (!artistsSaved.has(artist.artistId)) { artistsSaved.add(artist.artistId); }
  if (canonicalVenueId && !venuesSaved.has(canonicalVenueId)) { venuesSaved.add(canonicalVenueId); }
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar DICE Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const progress     = loadProgress();
  const completedC   = new Set(progress.completedCities || []);
  const gigsSaved    = new Set();
  const artistsSaved = new Set();
  const venuesSaved  = new Set();

  let totalGigs = 0, totalArtists = 0, totalVenues = 0, errors = 0;

  for (let ci = 0; ci < UK_CITIES.length; ci++) {
    const city = UK_CITIES[ci];
    if (completedC.has(city.slug)) {
      process.stdout.write(`\r  [${ci + 1}/${UK_CITIES.length}] ${city.name.padEnd(15)} — skipped   `);
      continue;
    }

    let cityGigs = 0;

    for (const filter of DICE_FILTERS) {
      const baseUrl = `https://dice.fm/browse/${city.slug}${filter}`;
      let cursor = null;
      let page   = 0;

      do {
        const url = cursor ? `${baseUrl}?after=${encodeURIComponent(cursor)}` : baseUrl;
        const { events, nextCursor } = await fetchDicePage(url);
        cursor = nextCursor;
        page++;

        const today = new Date().toISOString().split('T')[0];
        for (const ev of events) {
          const dateStr = ev.dates?.event_start_date || '';
          if (!dateStr || dateStr.split('T')[0] < today) continue;
          const saved = await processEvent(ev, gigsSaved, artistsSaved, venuesSaved);
          if (saved) {
            cityGigs++;
            totalGigs++;
            totalArtists = artistsSaved.size;
            totalVenues  = venuesSaved.size;
          }
        }

        if (events.length === 0) break;
        await sleep(500);
      } while (cursor && page < (QUICK ? 3 : 20));

      await sleep(300);
    }

    process.stdout.write(
      `\r  [${ci + 1}/${UK_CITIES.length}] ${city.name.padEnd(15)} — +${cityGigs} gigs | Total: ${totalGigs} gigs, ${totalArtists} artists   `
    );

    completedC.add(city.slug);
    if (!DRY_RUN) saveProgress({ completedCities: [...completedC], gigs: totalGigs, artists: totalArtists, venues: totalVenues });

    await sleep(500);
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
