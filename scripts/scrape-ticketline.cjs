#!/usr/bin/env node
/**
 * GigRadar Ticketline Scraper
 *
 * Scrapes ticketline.co.uk region pages using LD+JSON Event/MusicEvent schema.
 * Pagination uses dateFrom cursor (each page shows ~106 events from that date).
 * No API key required — public HTML with structured data.
 *
 * Usage:
 *   node scripts/scrape-ticketline.cjs
 *   node scripts/scrape-ticketline.cjs --dry-run
 *   node scripts/scrape-ticketline.cjs --resume
 *   node scripts/scrape-ticketline.cjs --city=manchester
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
const PROGRESS_FILE = path.join(__dirname, 'ticketline-progress.json');
const LOG_FILE      = path.join(__dirname, 'scrape-ticketline-log.txt');

const DRY_RUN   = process.argv.includes('--dry-run');
const RESUME    = process.argv.includes('--resume');
const QUICK     = process.argv.includes('--quick');  // stop after 4 weeks
const CITY_ONLY = process.argv.find(a => a.startsWith('--city='))?.split('=')[1];
const sleep     = ms => new Promise(r => setTimeout(r, ms));

// 22 UK regions available on Ticketline
const UK_REGIONS = [
  'london', 'manchester', 'birmingham', 'bristol', 'glasgow', 'leeds',
  'edinburgh', 'brighton', 'newcastle', 'liverpool', 'sheffield',
  'nottingham', 'belfast', 'cardiff', 'aberdeen', 'dundee', 'oxford',
  'norwich', 'peterborough', 'plymouth', 'worcester', 'bangor',
];

const TL_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeHtml(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
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
  return { completedRegions: [] };
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

// ─── Fetch + parse a Ticketline region page ───────────────────────────────────

async function fetchPage(region, dateFrom) {
  const url = `https://www.ticketline.co.uk/event/location/region/${region}${dateFrom ? `?dateFrom=${dateFrom}` : ''}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: TL_HEADERS });
      if (r.status === 429) { await sleep(30000); continue; }
      if (r.status === 404) return { events: [], lastPage: true };
      if (!r.ok) { await sleep(3000 * attempt); continue; }
      const html = await r.text();
      const events = parseLdJson(html);
      return { events, html };
    } catch (e) {
      if (attempt === 3) return { events: [], html: '' };
      await sleep(2000 * attempt);
    }
  }
  return { events: [], html: '' };
}

function parseLdJson(html) {
  const events = [];
  const blocks = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const [, json] of blocks) {
    try {
      const d = JSON.parse(json);
      const arr = Array.isArray(d) ? d : [d];
      for (const item of arr) {
        if (item['@type'] === 'Event' || item['@type'] === 'MusicEvent') {
          events.push(item);
        }
      }
    } catch {}
  }
  return events;
}

// ─── Artist name extraction ───────────────────────────────────────────────────

// Extract headliner from event title: "Artist A + Artist B" → ["Artist A", "Artist B"]
// Also handles: "Artist A / Artist B", "Artist A, Artist B", "Artist A presents..."
function extractArtists(eventName, performers) {
  const perfNames = (performers || [])
    .map(p => (p.name || '').trim())
    .filter(n => n && n.length >= 2 && n.length <= 100 && !JUNK_ARTIST.test(n));

  // Filter out obvious promoter/label names
  const realPerfs = perfNames.filter(n => !/(presents|records|productions|events|music|collective|festival)\b/i.test(n));

  // Prefer real performer names as they're the most reliable source
  if (realPerfs.length > 0) return realPerfs;

  // Fall back to parsing from event title
  const titleArtists = parseEventTitle(eventName);
  if (titleArtists.length > 0) return titleArtists;

  return perfNames.slice(0, 1);
}

function parseEventTitle(title) {
  if (!title) return [];
  // Remove common suffix patterns
  let t = title.replace(/\s*[-–—]\s*(tickets?|live|tour\d*|at .+|in .+)$/i, '').trim();
  // Split on + / , with guards against band names like "AC/DC"
  const parts = t.split(/\s+\+\s+|\s+\/\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
  return parts.filter(p => p.length >= 2 && p.length <= 100 && !JUNK_ARTIST.test(p));
}

const JUNK_ARTIST = /^(tba|tbc|various artists?|support|residents?|live|open mic|dj set|doors?|to be confirmed|free entry|sold out|cancelled)$/i;

// ─── Auto-seed venue ──────────────────────────────────────────────────────────

const seededVenues = new Set();

async function autoSeedVenue(location, regionName) {
  const name = decodeHtml((location?.name || '').trim());
  const city = decodeHtml((location?.address?.addressRegion || regionName || '').trim());
  if (!name) return null;

  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const lat  = location?.geo?.latitude  ? parseFloat(location.geo.latitude)  : null;
    const lon  = location?.geo?.longitude ? parseFloat(location.geo.longitude) : null;
    const addr = (location?.address?.streetAddress || '').replace(/\n/g, ', ').trim() || null;
    const pc   = location?.address?.postalCode || null;

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
        ${lat  ? ', lat      = if_not_exists(lat,      :lat)' : ''}
        ${lon  ? ', lon      = if_not_exists(lon,      :lon)' : ''}
        ${addr ? ', address  = if_not_exists(address,  :addr)' : ''}
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

// ─── Process one event ────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

async function processEvent(ev, regionName, gigsSaved, artistsSaved, venuesSaved) {
  const date = (ev.startDate || '').split('T')[0];
  if (!date || date < today) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const performers = Array.isArray(ev.performer) ? ev.performer : (ev.performer ? [ev.performer] : []);
  const artists = extractArtists(decodeHtml(ev.name), performers.map(p => ({ ...p, name: decodeHtml(p.name) })));
  if (artists.length === 0) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const canonicalVenueId = await autoSeedVenue(ev.location, regionName);
  if (!canonicalVenueId) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  let newVenues = 0;
  if (!venuesSaved.has(canonicalVenueId)) { venuesSaved.add(canonicalVenueId); newVenues++; }

  const venueName = decodeHtml((ev.location?.name || '').trim());
  const venueCity = decodeHtml((ev.location?.address?.addressRegion || regionName).trim());

  // Extract Ticketline event ID from URL slug for stable gigId
  const tlIdMatch = ev.url?.match(/\/tickets\/(\d+)\//);
  const tlEventId = tlIdMatch?.[1] || normaliseName(ev.name || '').substring(0, 20) + date;

  const ticketUrl  = ev.url || `https://www.ticketline.co.uk`;
  const price      = ev.offers?.[0]?.price ?? null;
  const available  = ev.offers?.[0]?.availability !== 'https://schema.org/SoldOut';
  const isSoldOut  = !available;

  let newGigs = 0, newArtists = 0;

  for (const artistName of artists) {
    const artistId = await autoSeedArtist(artistName);
    if (!artistId) continue;
    if (!artistsSaved.has(artistId)) { artistsSaved.add(artistId); newArtists++; }

    const gigId = `tl-${tlEventId}-${artistId}`.replace(/[^a-z0-9-]/gi, '-').substring(0, 100);
    if (gigsSaved.has(gigId)) continue;

    const gig = {
      gigId,
      artistId,
      artistName,
      date,
      doorsTime:        ev.startDate?.split('T')[1]?.substring(0, 5) || null,
      venueName,
      venueCity,
      venueCountry:     'GB',
      canonicalVenueId,
      isSoldOut,
      minAge:           null,
      supportActs:      artists.filter(a => a !== artistName),
      tickets: [{
        seller:    'Ticketline',
        url:       ticketUrl,
        available,
        price:     price != null ? `£${Number(price).toFixed(2)}` : 'See venue',
      }],
      sources:     ['ticketline'],
      lastUpdated: new Date().toISOString(),
    };

    if (!DRY_RUN) {
      await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig }))
        .catch(e => console.error(`  Save error ${gigId}:`, e.message));
    }
    gigsSaved.add(gigId);
    log(`  [${artistName}] @ ${venueName}, ${venueCity} — ${date}`);
    newGigs++;
  }

  return { newGigs, newArtists, newVenues };
}

// ─── Scrape one region (date-cursor pagination) ───────────────────────────────

async function scrapeRegion(region, progress) {
  let dateFrom   = today;
  let totalGigs  = 0, totalArtists = 0, totalVenues = 0;
  const gigsSaved    = new Set();
  const artistsSaved = new Set();
  const venuesSaved  = new Set();
  const seenDates    = new Set();
  let   emptyPages   = 0;

  while (true) {
    const { events } = await fetchPage(region, dateFrom);

    if (!events || events.length === 0) {
      emptyPages++;
      if (emptyPages >= 2) break;
      break;
    }

    let pageGigs = 0;
    for (const ev of events) {
      const { newGigs, newArtists, newVenues } = await processEvent(ev, region, gigsSaved, artistsSaved, venuesSaved);
      totalGigs    += newGigs;
      totalArtists += newArtists;
      totalVenues  += newVenues;
      pageGigs     += newGigs;
    }

    // Find the last date on this page to use as next cursor
    const dates = events
      .map(e => (e.startDate || '').split('T')[0])
      .filter(d => d >= today)
      .sort();
    const lastDate = dates[dates.length - 1];

    // Stop if we've already seen this date range (no new events)
    if (!lastDate || seenDates.has(lastDate)) break;
    seenDates.add(lastDate);

    // Advance cursor to day after last date
    const next = new Date(lastDate);
    next.setDate(next.getDate() + 1);
    const nextStr = next.toISOString().split('T')[0];

    // Stop based on date horizon
    const horizon = new Date();
    horizon.setMonth(horizon.getMonth() + (QUICK ? 0 : 6));
    if (!QUICK) horizon.setMonth(horizon.getMonth()); // 6 months full
    if (QUICK) horizon.setDate(horizon.getDate() + 28); // 4 weeks quick
    if (next > horizon) break;

    // Stop if this page had no new gigs (all already saved / past)
    if (pageGigs === 0 && events.length < 50) break;

    dateFrom = nextStr;
    flushLog();
    await sleep(300);
  }

  flushLog();
  return { totalGigs, totalArtists, totalVenues };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Ticketline Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  fs.appendFileSync(LOG_FILE, `\n=== Ticketline Scraper — ${new Date().toISOString()} ===\n`);

  const progress = loadProgress();
  const regions  = CITY_ONLY ? [CITY_ONLY] : UK_REGIONS;

  let totalGigs = 0, totalArtists = 0, totalVenues = 0;

  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri];
    if (!CITY_ONLY && progress.completedRegions.includes(region)) {
      process.stdout.write(`\r  [${ri + 1}/${regions.length}] ${region.padEnd(16)} — skipped   `);
      continue;
    }

    const { totalGigs: rg, totalArtists: ra, totalVenues: rv } = await scrapeRegion(region, progress);
    totalGigs    += rg;
    totalArtists += ra;
    totalVenues  += rv;

    if (!DRY_RUN) {
      progress.completedRegions.push(region);
      saveProgress(progress);
    }

    process.stdout.write(
      `\r  [${ri + 1}/${regions.length}] ${region.padEnd(16)} — +${rg} gigs | Total: ${totalGigs} gigs, ${totalArtists} artists   `
    );
    await sleep(500);
  }

  console.log('\n\n=== Complete ===');
  console.log(`Gigs saved     : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded : ${totalArtists.toLocaleString()}`);
  console.log(`Venues seeded  : ${totalVenues.toLocaleString()}`);
}

main().catch(console.error);
