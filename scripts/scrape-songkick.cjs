#!/usr/bin/env node
/**
 * GigRadar Songkick Scraper
 *
 * Scrapes Songkick metro-area calendar pages using LD+JSON MusicEvent schema data.
 * No API key required — public HTML with structured data.
 *
 * Usage:
 *   node scripts/scrape-songkick.cjs
 *   node scripts/scrape-songkick.cjs --dry-run
 *   node scripts/scrape-songkick.cjs --resume
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
const PROGRESS_FILE = path.join(__dirname, 'songkick-progress.json');
const LOG_FILE      = path.join(__dirname, 'scrape-songkick-log.txt');

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// UK metro areas — Songkick IDs (verified via redirect scan)
const UK_METROS = [
  { id: 24426, name: 'London' },
  { id: 24475, name: 'Manchester' },
  { id: 24542, name: 'Birmingham' },
  { id: 24521, name: 'Bristol' },
  { id: 24473, name: 'Glasgow' },
  { id: 24495, name: 'Leeds' },
  { id: 24551, name: 'Edinburgh' },
  { id: 24554, name: 'Brighton' },
  { id: 24577, name: 'Newcastle' },
  { id: 24526, name: 'Liverpool' },
  { id: 24531, name: 'Sheffield' },
  { id: 24549, name: 'Nottingham' },
  { id: 24523, name: 'Belfast' },
  { id: 24486, name: 'Leicester' },
  { id: 24500, name: 'Oxford' },
  { id: 24480, name: 'Reading' },
  { id: 24478, name: 'Portsmouth' },
  { id: 24518, name: 'Norwich' },
  { id: 24474, name: 'Bournemouth' },
  { id: 24517, name: 'Derby' },
  { id: 24471, name: 'Swansea' },
  { id: 24530, name: 'Coventry' },
  { id: 24512, name: 'Wolverhampton' },
  { id: 24608, name: 'Dundee' },
  { id: 24612, name: 'Inverness' },
  { id: 24602, name: 'Chelmsford' },
  { id: 24622, name: 'York' },
  { id: 24536, name: 'Preston' },
  { id: 24498, name: 'Milton Keynes' },
  { id: 24544, name: 'Bradford' },
  { id: 24537, name: 'Stoke-on-Trent' },
  { id: 24528, name: 'Northampton' },
  { id: 25184, name: 'Canterbury' },
  { id: 24615, name: 'Newport' },
  { id: 24600, name: 'Blackpool' },
  { id: 24610, name: 'Gloucester' },
];

const SK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
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
  return { completedMetros: [] };
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

// ─── Fetch + parse one page ───────────────────────────────────────────────────

async function fetchPage(metroId, page) {
  const url = `https://www.songkick.com/metro-areas/${metroId}/calendar?page=${page}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: SK_HEADERS });
      if (r.status === 429) { await sleep(30000); continue; }
      if (r.status === 404) return { events: [], lastPage: true };
      if (!r.ok) { await sleep(3000 * attempt); continue; }
      const html = await r.text();
      const events = parseLdJson(html);
      // Detect last page: if no next-page link exists
      const hasNext = html.includes(`page=${page + 1}`) || html.includes('rel="next"');
      return { events, lastPage: !hasNext || events.length === 0 };
    } catch (e) {
      if (attempt === 3) return { events: [], lastPage: true };
      await sleep(2000 * attempt);
    }
  }
  return { events: [], lastPage: true };
}

function parseLdJson(html) {
  const events = [];
  const blocks = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const [, json] of blocks) {
    try {
      const d = JSON.parse(json);
      const arr = Array.isArray(d) ? d : [d];
      for (const item of arr) {
        if (item['@type'] === 'MusicEvent') events.push(item);
      }
    } catch {}
  }
  return events;
}

// ─── Auto-seed venue ──────────────────────────────────────────────────────────

const seededVenues = new Set();

async function autoSeedVenue(location, metroName) {
  const name = (location?.name || '').trim();
  const city = location?.address?.addressLocality || metroName;
  if (!name) return null;

  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const lat = location?.geo?.latitude  || null;
    const lon = location?.geo?.longitude || null;
    const addr = location?.address?.streetAddress || null;
    const pc   = location?.address?.postalCode    || null;

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
const JUNK_ARTIST = /^(tba|tbc|various artists?|support|residents?|live|open mic|dj set|doors?|to be confirmed)$/i;

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

// ─── Process one event ────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

async function processEvent(ev, metroName, gigsSaved, artistsSaved, venuesSaved) {
  const date = (ev.startDate || '').split('T')[0];
  if (!date || date < today) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const performers = Array.isArray(ev.performer) ? ev.performer : (ev.performer ? [ev.performer] : []);
  const artists = performers
    .map(p => (p.name || '').trim())
    .filter(n => n && n.length >= 2 && n.length <= 100 && !JUNK_ARTIST.test(n));

  if (artists.length === 0) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const canonicalVenueId = await autoSeedVenue(ev.location, metroName);
  if (!canonicalVenueId) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  let newVenues = 0;
  if (!venuesSaved.has(canonicalVenueId)) { venuesSaved.add(canonicalVenueId); newVenues++; }

  const venueName = (ev.location?.name || '').trim();
  const venueCity = ev.location?.address?.addressLocality || metroName;
  const ticketUrl = ev.url ? ev.url.split('?')[0] : 'https://www.songkick.com';

  // Extract Songkick event ID from URL (festivals use /id/, concerts use /concerts/)
  const skIdMatch = ev.url?.match(/\/(?:concerts|id)\/(\d+)/);
  const skEventId = skIdMatch?.[1] || normaliseName(ev.name || '').substring(0, 20) + date;

  let newGigs = 0, newArtists = 0;

  for (const artistName of artists) {
    const artistId = await autoSeedArtist(artistName);
    if (!artistId) continue;
    if (!artistsSaved.has(artistId)) { artistsSaved.add(artistId); newArtists++; }

    const gigId = `sk-${skEventId}-${artistId}`.replace(/[^a-z0-9-]/gi, '-').substring(0, 100);
    if (gigsSaved.has(gigId)) continue;

    const gig = {
      gigId,
      artistId,
      artistName,
      date,
      doorsTime:        null,
      venueName,
      venueCity,
      venueCountry:     'GB',
      canonicalVenueId,
      isSoldOut:        ev.eventStatus === 'https://schema.org/EventCancelled',
      minAge:           null,
      supportActs:      artists.filter(a => a !== artistName),
      tickets: [{
        seller:    'Songkick',
        url:       ticketUrl,
        available: true,
        price:     'See site',
      }],
      sources:     ['songkick'],
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
  console.log('=== GigRadar Songkick Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  if (!DRY_RUN) fs.writeFileSync(LOG_FILE, `=== Songkick Scraper — ${new Date().toISOString()} ===\n\n`);

  const progress      = loadProgress();
  const completedSet  = new Set(progress.completedMetros || []);
  const gigsSaved     = new Set();
  const artistsSaved  = new Set();
  const venuesSaved   = new Set();
  let totalGigs = 0, totalArtists = 0, totalVenues = 0;

  for (let mi = 0; mi < UK_METROS.length; mi++) {
    const { id: metroId, name: metroName } = UK_METROS[mi];
    if (RESUME && completedSet.has(metroId)) {
      process.stdout.write(`\r  [${mi + 1}/${UK_METROS.length}] ${metroName.padEnd(15)} — skipped   `);
      continue;
    }

    let metroGigs = 0, page = 1;

    while (true) {
      const { events, lastPage } = await fetchPage(metroId, page);
      for (const ev of events) {
        const { newGigs, newArtists, newVenues } = await processEvent(ev, metroName, gigsSaved, artistsSaved, venuesSaved);
        metroGigs    += newGigs;
        totalGigs    += newGigs;
        totalArtists += newArtists;
        totalVenues  += newVenues;
      }
      if (lastPage) break;
      page++;
      await sleep(500);
    }

    completedSet.add(metroId);
    if (!DRY_RUN) {
      saveProgress({ completedMetros: [...completedSet] });
      flushLog();
    }

    process.stdout.write(
      `\r  [${mi + 1}/${UK_METROS.length}] ${metroName.padEnd(15)} — +${metroGigs} gigs | Total: ${totalGigs} gigs, ${totalArtists} artists   `
    );
  }

  console.log('\n\n=== Complete ===');
  console.log(`Gigs saved     : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded : ${totalArtists.toLocaleString()}`);
  console.log(`Venues seeded  : ${totalVenues.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
