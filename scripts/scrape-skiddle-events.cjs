#!/usr/bin/env node
/**
 * GigRadar Skiddle Events Scraper
 *
 * Uses the Skiddle API (eventcode=LIVE) to scrape upcoming UK live music
 * events across all major cities. No headless browser required.
 *
 * Usage:
 *   node scripts/scrape-skiddle-events.cjs
 *   node scripts/scrape-skiddle-events.cjs --dry-run
 *   node scripts/scrape-skiddle-events.cjs --resume
 *   node scripts/scrape-skiddle-events.cjs --city London
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
const PROGRESS_FILE = path.join(__dirname, 'skiddle-events-progress.json');
const LOG_FILE      = path.join(__dirname, 'scrape-skiddle-events-log.txt');

const API_KEY  = '4e0a7a6dacf5930b9bf39ece1f9b456f';
const PAGE_SZ  = 100;

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}

const DRY_RUN    = process.argv.includes('--dry-run');
const RESUME     = process.argv.includes('--resume');
const QUICK      = process.argv.includes('--quick');  // limit to 3 pages per city
const CITY_ONLY  = arg('--city');
const sleep      = ms => new Promise(r => setTimeout(r, ms));

// UK cities with enough live music on Skiddle
const UK_CITIES = [
  'Liverpool', 'Manchester', 'Birmingham', 'Coventry', 'Wolverhampton',
  'London', 'Glasgow', 'Edinburgh', 'Sheffield', 'Nottingham', 'Leeds',
  'Derby', 'Sunderland', 'Preston', 'Newcastle', 'Bristol', 'Cardiff',
  'Brighton', 'Exeter', 'Southampton', 'Leicester', 'Middlesbrough',
  'Hull', 'Bath', 'Oxford', 'Aberdeen', 'Dundee', 'Belfast', 'Swansea',
  'Portsmouth', 'Norwich', 'Reading', 'Bournemouth', 'Cambridge', 'York',
  'Stoke-on-Trent',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const logLines = [];
function log(msg) { logLines.push(msg); }
function flushLog() {
  if (LOG_FILE) fs.appendFileSync(LOG_FILE, logLines.join('\n') + '\n');
  logLines.length = 0;
}

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

// Clean venue names Skiddle often appends "England", "UK" etc.
function cleanVenueName(name) {
  return (name || '').replace(/\s*,?\s*(England|Scotland|Wales|UK|United Kingdom)$/i, '').trim();
}

// Extract venue city — Skiddle's `town` field
function venueCity(ev) {
  return ev.venue?.town || ev.venue?.region || '';
}

// ─── Artist name extraction ───────────────────────────────────────────────────

const JUNK_WORDS = /^(tbc|tba|various artists?|support act|special guest|doors?|support|presents?|featuring|feat\.?|ft\.?|live music|open mic|dj set|resident dj|club night|tickets?|event|evening with|night of|a night|the night|free|free entry|sold out)$/i;

const NOISE_SUFFIXES = [
  / - ?(london|manchester|birmingham|glasgow|edinburgh|bristol|leeds|liverpool|sheffield|newcastle|nottingham|brighton|cardiff|edinburgh|uk|england|scotland|wales|tour|uk tour|live|ep launch|album launch|single launch|headline tour|headline|headline show|support tba|support acts?|plus support|plus guests?|special guests?|with support|with guests?|acoustic|the album|the tour|re-scheduled|\d{4})/i,
  / \((london|manchester|uk|sold out|18\+|16\+|14\+|all ages)\)$/i,
  /: (live|acoustic|headline|ep launch)$/i,
];

const NOISE_PREFIXES = [
  /^FREE:\s*/i,
  /^[A-Z][a-zA-Z ]+\s+presents?:\s*/i,  // "Label Presents: "
  /^[A-Z][a-zA-Z ]+\s+presents\s+/i,    // "Label presents "
];

const OBVIOUS_NON_ARTIST = /candlelight|motown|northern soul|soul night|80s|90s|2000s|karaoke|quiz night|open mic|jam night|tribute|christmas|halloween|new year|comedy|comedy night|cabaret|burlesque|drag|club night|ballroom|djs?:|resident dj|all-dayer|all dayer|dj night|set list|classical|orchestra|opera|ballet|choir|brass band|swing|jazz night|blues night|acoustic night|folk night|world music|afrobeats night/i;

const MULTI_ARTIST_SPLIT = /\s*(?:(?:\/\/+)|(?:\s*;\s*)|(?:\s*&amp;\s*))\s*/;

function stripNoiseSuffixes(name) {
  let n = name;
  for (const re of NOISE_SUFFIXES) n = n.replace(re, '');
  return n.trim();
}

function stripNoisePrefixes(name) {
  let n = name;
  for (const re of NOISE_PREFIXES) n = n.replace(re, '');
  return n.trim();
}

function extractArtists(eventName) {
  if (!eventName) return [];
  if (OBVIOUS_NON_ARTIST.test(eventName)) return [];

  let name = eventName;
  name = stripNoisePrefixes(name);

  // Multi-artist events: "A // B // C" or "A; B"
  if (MULTI_ARTIST_SPLIT.test(name)) {
    const parts = name.split(MULTI_ARTIST_SPLIT).map(p => stripNoiseSuffixes(p.trim()).replace(/^FREE:\s*/i, ''));
    return parts.filter(p => p.length >= 2 && !JUNK_WORDS.test(p) && p.length <= 80);
  }

  // "A + B" — headliner + support
  if (/ \+ /.test(name)) {
    const parts = name.split(' + ').map(p => stripNoiseSuffixes(p.trim()));
    return parts.filter(p => p.length >= 2 && !JUNK_WORDS.test(p) && p.length <= 80);
  }

  name = stripNoiseSuffixes(name);
  if (!name || name.length < 2 || name.length > 100) return [];
  if (JUNK_WORDS.test(name)) return [];

  return [name];
}

// ─── Auto-seed venue ──────────────────────────────────────────────────────────

const seededVenues = new Set();

async function autoSeedVenue(skiddleVenue) {
  const rawName = skiddleVenue.name || '';
  const name    = cleanVenueName(rawName);
  const city    = skiddleVenue.town || skiddleVenue.region || '';
  if (!name || !city) return null;

  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const lat = parseFloat(skiddleVenue.latitude)  || null;
    const lon = parseFloat(skiddleVenue.longitude) || null;
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: `SET #n = if_not_exists(#n, :n),
        city        = if_not_exists(city,        :c),
        slug        = if_not_exists(slug,        :s),
        active      = if_not_exists(active,      :a),
        upcoming    = if_not_exists(upcoming,    :u),
        country     = if_not_exists(country,     :co),
        lastUpdated = :t
        ${lat ? ', lat = if_not_exists(lat, :lat)' : ''}
        ${lon ? ', lon = if_not_exists(lon, :lon)' : ''}
        ${skiddleVenue.postcode ? ', postcode = if_not_exists(postcode, :pc)' : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': toVenueSlug(name, city),
        ':a': true, ':u': 0, ':t': new Date().toISOString(), ':co': 'GB',
        ...(lat ? { ':lat': lat } : {}),
        ...(lon ? { ':lon': lon } : {}),
        ...(skiddleVenue.postcode ? { ':pc': skiddleVenue.postcode } : {}),
      },
    })).catch(() => {});
    seededVenues.add(venueId);
  }
  return venueId;
}

// ─── Auto-seed artist ─────────────────────────────────────────────────────────

const seededArtists = new Set();

async function autoSeedArtist(artistName) {
  const artistId = toArtistId(artistName);
  if (!artistId || DRY_RUN) return artistId;
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

// ─── Fetch Skiddle events page ────────────────────────────────────────────────

async function fetchPage(city, page) {
  const url = `https://www.skiddle.com/api/v1/events/?api_key=${API_KEY}&eventcode=LIVE&city=${encodeURIComponent(city)}&limit=${PAGE_SZ}&page=${page}&order=date`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'GigRadar/1.0' } });
      if (r.status === 429) { await sleep(30000); continue; }
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const d = await r.json();
      return { events: d.results || [], total: parseInt(d.totalcount || '0', 10) };
    } catch (e) {
      if (attempt === 3) return { events: [], total: 0 };
      await sleep(2000 * attempt);
    }
  }
  return { events: [], total: 0 };
}

// ─── Process one event ────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

async function processEvent(ev, gigsSaved, artistsSaved, venuesSaved) {
  if (!ev.venue || ev.cancelled === '1') return { newGigs: 0, newArtists: 0, newVenues: 0 };

  // UK only
  if (ev.venue.country && ev.venue.country !== 'GB') return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const date = (ev.date || '').split('T')[0];
  if (!date || date < today) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const artists = extractArtists(ev.eventname);
  if (artists.length === 0) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const canonicalVenueId = await autoSeedVenue(ev.venue);
  if (!canonicalVenueId) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  let newVenues = 0;
  if (!venuesSaved.has(canonicalVenueId)) { venuesSaved.add(canonicalVenueId); newVenues++; }

  const venueName = cleanVenueName(ev.venue.name || '');
  const venueCity = ev.venue.town || ev.venue.region || '';

  const minPrice = ev.ticketpricing?.minPrice || null;
  const maxPrice = ev.ticketpricing?.maxPrice || null;
  const priceStr = minPrice != null ? (maxPrice && maxPrice !== minPrice ? `£${minPrice}–£${maxPrice}` : `£${minPrice}`) : 'See site';

  const ticketUrl = ev.link || `https://www.skiddle.com/whats-on/${encodeURIComponent(venueCity)}/${encodeURIComponent(venueName.replace(/\s+/g, '-'))}/`;

  let newGigs = 0, newArtists = 0;

  for (const artistName of artists) {
    const artistId = await autoSeedArtist(artistName);
    if (!artistId) continue;
    if (!artistsSaved.has(artistId)) { artistsSaved.add(artistId); newArtists++; }

    const gigId = `skiddle-${ev.id}-${artistId}`.replace(/[^a-z0-9-]/gi, '-');
    if (gigsSaved.has(gigId)) continue;

    const doorsTime = ev.openingtimes?.doorsopen || null;

    const gig = {
      gigId,
      artistId,
      artistName,
      date,
      doorsTime,
      venueName,
      venueCity,
      venueCountry: 'GB',
      canonicalVenueId,
      isSoldOut: false,
      minAge:    ev.minage ? parseInt(ev.minage, 10) || null : null,
      supportActs: artists.filter(a => a !== artistName),
      tickets: [{
        seller:    'Skiddle',
        url:       ticketUrl,
        available: ev.tickets === true,
        price:     priceStr,
      }],
      sources:     ['skiddle'],
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

  return { newGigs, newArtists, newVenues };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Skiddle Events Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  // Clear log
  if (!DRY_RUN) fs.writeFileSync(LOG_FILE, `=== Skiddle Events Scraper — ${new Date().toISOString()} ===\n\n`);

  const progress = RESUME && fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    : { doneCities: [] };
  const doneCities = new Set(progress.doneCities || []);

  const cities = CITY_ONLY ? [CITY_ONLY] : UK_CITIES;

  const gigsSaved    = new Set();
  const artistsSaved = new Set();
  const venuesSaved  = new Set();
  let totalGigs = 0, totalArtists = 0, totalVenues = 0;

  for (let ci = 0; ci < cities.length; ci++) {
    const city = cities[ci];
    if (RESUME && doneCities.has(city) && !CITY_ONLY) {
      process.stdout.write(`\r  [${ci + 1}/${cities.length}] ${city.padEnd(20)} — skipped   `);
      continue;
    }

    let cityGigs = 0, page = 1, total = Infinity;
    const maxPages = QUICK ? 3 : Infinity;
    while ((page - 1) * PAGE_SZ < total && page <= maxPages) {
      const { events, total: tot } = await fetchPage(city, page);
      total = tot;
      if (events.length === 0) break;

      for (const ev of events) {
        const { newGigs, newArtists, newVenues } = await processEvent(ev, gigsSaved, artistsSaved, venuesSaved);
        cityGigs    += newGigs;
        totalGigs   += newGigs;
        totalArtists += newArtists;
        totalVenues  += newVenues;
      }

      page++;
      await sleep(250); // ~4 req/s
    }

    doneCities.add(city);
    if (!DRY_RUN) {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ doneCities: [...doneCities] }));
      flushLog();
    }

    process.stdout.write(
      `\r  [${ci + 1}/${cities.length}] ${city.padEnd(20)} — +${cityGigs} gigs | Total: ${totalGigs} gigs, ${totalArtists} artists   `
    );
  }

  console.log('\n\n=== Complete ===');
  console.log(`Gigs saved     : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded : ${totalArtists.toLocaleString()}`);
  console.log(`Venues seeded  : ${totalVenues.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (!DRY_RUN && fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
