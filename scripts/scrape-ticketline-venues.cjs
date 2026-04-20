#!/usr/bin/env node
/**
 * GigRadar Ticketline Venue Scraper
 *
 * Deeper Ticketline coverage: scrapes per-venue event pages which show
 * up to 9 months of events (vs 3 months on regional pages).
 *
 * Pass 1: Collect all venue slugs from regional pages.
 * Pass 2: Scrape each venue's full event listing.
 *
 * Usage:
 *   node scripts/scrape-ticketline-venues.cjs
 *   node scripts/scrape-ticketline-venues.cjs --dry-run
 *   node scripts/scrape-ticketline-venues.cjs --resume
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
const PROGRESS_FILE = path.join(__dirname, 'ticketline-venues-progress.json');
const LOG_FILE      = path.join(__dirname, 'scrape-ticketline-venues-log.txt');

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const sleep   = ms => new Promise(r => setTimeout(r, ms));

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
  if (logLines.length) { fs.appendFileSync(LOG_FILE, logLines.join('\n') + '\n'); logLines.length = 0; }
}

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { venuesDone: [] };
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p)); }

// ─── Fetch HTML ───────────────────────────────────────────────────────────────

async function fetchHtml(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: TL_HEADERS });
      if (r.status === 429) { await sleep(30000); continue; }
      if (r.status === 404) return null;
      if (!r.ok) { await sleep(3000 * attempt); continue; }
      return await r.text();
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

function parseLdJson(html) {
  const events = [];
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(json);
      for (const item of (Array.isArray(d) ? d : [d])) {
        if (item['@type'] === 'Event' || item['@type'] === 'MusicEvent') events.push(item);
      }
    } catch {}
  }
  return events;
}

// Extract all unique venue slugs from a regional page
function extractVenueSlugs(html) {
  const slugs = new Set();
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(json);
      for (const item of (Array.isArray(d) ? d : [d])) {
        const venueUrl = item?.location?.url || '';
        const m = venueUrl.match(/ticketline\.co\.uk\/venue\/([a-z0-9-]+)/);
        if (m) slugs.add(m[1]);
      }
    } catch {}
  }
  return [...slugs];
}

// ─── Artist extraction ────────────────────────────────────────────────────────

const JUNK_ARTIST = /^(tba|tbc|various artists?|support|residents?|live|open mic|dj set|doors?|to be confirmed|free entry|sold out|cancelled)$/i;

function extractArtists(eventName, performers) {
  const perfNames = (performers || [])
    .map(p => decodeHtml((p.name || '').trim()))
    .filter(n => n && n.length >= 2 && n.length <= 100 && !JUNK_ARTIST.test(n));
  const realPerfs = perfNames.filter(n => !/(presents|records|productions|events|music|collective|festival)\b/i.test(n));
  if (realPerfs.length > 0) return realPerfs;
  const titleArtists = parseEventTitle(decodeHtml(eventName));
  return titleArtists.length > 0 ? titleArtists : perfNames.slice(0, 1);
}

function parseEventTitle(title) {
  if (!title) return [];
  let t = title.replace(/\s*[-–—]\s*(tickets?|live|tour\d*|at .+|in .+)$/i, '').trim();
  const parts = t.split(/\s+\+\s+|\s+\/\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
  return parts.filter(p => p.length >= 2 && p.length <= 100 && !JUNK_ARTIST.test(p));
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

const seededVenues  = new Set();
const seededArtists = new Set();

async function autoSeedVenue(location, fallbackCity) {
  const name = decodeHtml((location?.name || '').trim());
  const city = decodeHtml((location?.address?.addressRegion || fallbackCity || '').trim());
  if (!name) return null;

  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const lat  = location?.geo?.latitude  ? parseFloat(location.geo.latitude)  : null;
    const lon  = location?.geo?.longitude ? parseFloat(location.geo.longitude) : null;
    const addr = decodeHtml((location?.address?.streetAddress || '').replace(/\n/g, ', ').trim()) || null;
    const pc   = location?.address?.postalCode || null;

    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: `SET #n = if_not_exists(#n,:n), city = if_not_exists(city,:c),
        slug = if_not_exists(slug,:s), active = if_not_exists(active,:a),
        upcoming = if_not_exists(upcoming,:u), country = if_not_exists(country,:co),
        lastUpdated = :t
        ${lat  ? ', lat      = if_not_exists(lat,:lat)' : ''}
        ${lon  ? ', lon      = if_not_exists(lon,:lon)' : ''}
        ${addr ? ', address  = if_not_exists(address,:addr)' : ''}
        ${pc   ? ', postcode = if_not_exists(postcode,:pc)' : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': toVenueSlug(name, city),
        ':a': true, ':u': 0, ':t': new Date().toISOString(), ':co': 'GB',
        ...(lat  ? { ':lat': lat }   : {}),
        ...(lon  ? { ':lon': lon }   : {}),
        ...(addr ? { ':addr': addr } : {}),
        ...(pc   ? { ':pc': pc }     : {}),
      },
    })).catch(() => {});
    seededVenues.add(venueId);
  }
  return venueId;
}

async function autoSeedArtist(artistName) {
  if (!artistName || artistName.length < 2 || artistName.length > 100) return null;
  if (JUNK_ARTIST.test(artistName.trim())) return null;
  const artistId = toArtistId(artistName);
  if (!artistId || artistId.length < 2 || DRY_RUN) return artistId;

  if (!seededArtists.has(artistId)) {
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: `SET #n = if_not_exists(#n,:n), upcoming = if_not_exists(upcoming,:u), lastUpdated = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': artistName, ':u': 0, ':t': new Date().toISOString() },
    })).catch(() => {});
    seededArtists.add(artistId);
  }
  return artistId;
}

// ─── Process one event ────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

async function processEvent(ev, venueSlug, gigsSaved) {
  const date = (ev.startDate || '').split('T')[0];
  if (!date || date < today) return 0;

  const performers = Array.isArray(ev.performer) ? ev.performer : (ev.performer ? [ev.performer] : []);
  const artists = extractArtists(ev.name, performers);
  if (!artists.length) return 0;

  const canonicalVenueId = await autoSeedVenue(ev.location, '');
  if (!canonicalVenueId) return 0;

  const venueName  = decodeHtml((ev.location?.name || '').trim());
  const venueCity  = decodeHtml((ev.location?.address?.addressRegion || '').trim());
  const tlIdMatch  = ev.url?.match(/\/tickets\/(\d+)\//);
  const tlEventId  = tlIdMatch?.[1] || normaliseName(decodeHtml(ev.name || '')).substring(0, 20) + date;
  const ticketUrl  = ev.url || `https://www.ticketline.co.uk/venue/${venueSlug}`;
  const price      = ev.offers?.[0]?.price ?? null;
  const available  = ev.offers?.[0]?.availability !== 'https://schema.org/SoldOut';

  let newGigs = 0;
  for (const artistName of artists) {
    const artistId = await autoSeedArtist(artistName);
    if (!artistId) continue;

    const gigId = `tlv-${tlEventId}-${artistId}`.replace(/[^a-z0-9-]/gi, '-').substring(0, 100);
    if (gigsSaved.has(gigId)) continue;

    const gig = {
      gigId, artistId, artistName, date,
      doorsTime:        ev.startDate?.split('T')[1]?.substring(0, 5) || null,
      venueName, venueCity, venueCountry: 'GB', canonicalVenueId,
      isSoldOut: !available,
      minAge: null,
      supportActs: artists.filter(a => a !== artistName),
      tickets: [{ seller: 'Ticketline', url: ticketUrl, available, price: price != null ? `£${Number(price).toFixed(2)}` : 'See venue' }],
      sources:     ['ticketline-venue'],
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
  return newGigs;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Ticketline Venue Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  fs.appendFileSync(LOG_FILE, `\n=== Ticketline Venue Scraper — ${new Date().toISOString()} ===\n`);

  // Pass 1: Collect venue slugs from all regional pages
  console.log('Pass 1: Collecting venue slugs from regional pages...');
  const allVenueSlugs = new Set();
  for (let ri = 0; ri < UK_REGIONS.length; ri++) {
    const region = UK_REGIONS[ri];
    const html = await fetchHtml(`https://www.ticketline.co.uk/event/location/region/${region}`);
    if (html) {
      const slugs = extractVenueSlugs(html);
      slugs.forEach(s => allVenueSlugs.add(s));
    }
    process.stdout.write(`\r  [${ri + 1}/${UK_REGIONS.length}] ${region.padEnd(16)} — ${allVenueSlugs.size} venues so far   `);
    await sleep(300);
  }

  const venueSlugs = [...allVenueSlugs];
  console.log(`\n  Found ${venueSlugs.length} unique venues\n`);

  // Pass 2: Scrape each venue's event page
  console.log('Pass 2: Scraping venue event pages...');
  const progress  = loadProgress();
  const gigsSaved = new Set();
  let totalGigs = 0, totalArtists = 0, totalVenues = 0;
  let venueCount = 0;

  for (let vi = 0; vi < venueSlugs.length; vi++) {
    const slug = venueSlugs[vi];
    if (progress.venuesDone.includes(slug)) {
      process.stdout.write(`\r  [${vi + 1}/${venueSlugs.length}] ${slug.substring(0, 30).padEnd(30)} — skipped   `);
      continue;
    }

    const html = await fetchHtml(`https://www.ticketline.co.uk/venue/${slug}`);
    if (!html) { await sleep(300); continue; }

    const events = parseLdJson(html);
    let venueGigs = 0;
    for (const ev of events) {
      venueGigs += await processEvent(ev, slug, gigsSaved);
    }

    totalGigs    += venueGigs;
    totalArtists  = seededArtists.size;
    totalVenues   = seededVenues.size;
    venueCount++;

    if (!DRY_RUN) {
      progress.venuesDone.push(slug);
      if (venueCount % 10 === 0) saveProgress(progress);
    }

    process.stdout.write(
      `\r  [${vi + 1}/${venueSlugs.length}] ${slug.substring(0, 30).padEnd(30)} — +${venueGigs} gigs | Total: ${totalGigs} gigs   `
    );
    flushLog();
    await sleep(300);
  }

  if (!DRY_RUN) saveProgress(progress);
  flushLog();

  console.log('\n\n=== Complete ===');
  console.log(`Venues scraped : ${venueCount.toLocaleString()}`);
  console.log(`Gigs saved     : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded : ${totalArtists.toLocaleString()}`);
}

main().catch(console.error);
