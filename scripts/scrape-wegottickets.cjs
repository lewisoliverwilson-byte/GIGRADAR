#!/usr/bin/env node
/**
 * GigRadar WeGotTickets Scraper
 *
 * Fetches event URLs from WeGotTickets sitemap.txt, scrapes each
 * individual event page for LD+JSON MusicEvent data.
 *
 * sitemap.txt has ~13,668 event URLs in format /f/{id}
 *
 * Usage:
 *   node scripts/scrape-wegottickets.cjs
 *   node scripts/scrape-wegottickets.cjs --dry-run
 *   node scripts/scrape-wegottickets.cjs --resume
 */

'use strict';

const path     = require('path');
const fs       = require('fs');
const { execSync } = require('child_process');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'wegottickets-progress.json');
const LOG_FILE      = path.join(__dirname, 'scrape-wegottickets-log.txt');
const SITEMAP_URL   = 'https://wegottickets.com/sitemap.txt';
const BASE_URL      = 'https://wegottickets.com';

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const JUNK_ARTIST = /^(tba|tbc|various artists?|support|residents?|live|open mic|dj set|doors?|to be confirmed|free entry|sold out|cancelled)$/i;

const logLines = [];
function log(msg) { logLines.push(msg); }
function flushLog() {
  if (logLines.length) { fs.appendFileSync(LOG_FILE, logLines.join('\n') + '\n'); logLines.length = 0; }
}

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { done: [] };
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p)); }

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

function fetchSync(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = execSync(
        `curl -sL --max-time 15 --retry 0 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" -H "Accept-Language: en-GB,en;q=0.9" "${url}"`,
        { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      if (result.includes('Bot Check') || result.includes('Just a moment') || result.includes('Access Denied')) {
        if (attempt < 3) { execSync('sleep 5'); continue; }
        return null;
      }
      if (result.trim().length < 100) return null;
      return result;
    } catch (e) {
      if (attempt === 3) return null;
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
        const t = item['@type'];
        const isMusicEvent = t === 'MusicEvent' || (Array.isArray(t) && t.includes('MusicEvent'));
        if (isMusicEvent) events.push(item);
      }
    } catch {}
  }
  return events;
}

// WGT address is a flat string like "123 High St Brighton BN1 1AA" or "St|City|County|Post"
function extractCityFromAddress(addrStr) {
  if (!addrStr || typeof addrStr !== 'string') return '';
  // Pipe-separated: "Street|City|County|Postcode"
  if (addrStr.includes('|')) {
    const parts = addrStr.split('|').map(s => s.trim()).filter(Boolean);
    return parts[1] || parts[0] || '';
  }
  // Comma-separated: find last non-postcode, non-numeric segment
  if (addrStr.includes(',')) {
    const parts = addrStr.split(',').map(s => s.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i].replace(/\b[A-Z]{1,2}\d[\dA-Z]?\s+\d[A-Z]{2}\b/g, '').trim();
      if (p && !/^\d/.test(p)) return p;
    }
    return parts[0] || '';
  }
  // Plain string: strip postcode, take last word (the city)
  const withoutPostcode = addrStr.replace(/\b[A-Z]{1,2}\d[\dA-Z]?\s+\d[A-Z]{2}\b/g, '').trim();
  const words = withoutPostcode.split(/\s+/);
  return words[words.length - 1] || '';
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

const seededVenues  = new Set();
const seededArtists = new Set();

async function autoSeedVenue(location) {
  const name = (location?.name || '').trim();
  // WGT uses flat address string; other sources use structured {addressLocality}
  const addrRaw = location?.address;
  const city = typeof addrRaw === 'object'
    ? (addrRaw?.addressLocality || '').trim()
    : extractCityFromAddress(addrRaw);
  if (!name) return null;
  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const addr = typeof addrRaw === 'string' ? addrRaw.trim() || null
      : (addrRaw?.streetAddress || '').trim() || null;
    const pc   = location?.postalCode || addrRaw?.postalCode || null;
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: `SET #n = if_not_exists(#n,:n), city = if_not_exists(city,:c),
        slug = if_not_exists(slug,:s), active = if_not_exists(active,:a),
        upcoming = if_not_exists(upcoming,:u), country = if_not_exists(country,:co),
        lastUpdated = :t
        ${addr ? ', address  = if_not_exists(address,:addr)' : ''}
        ${pc   ? ', postcode = if_not_exists(postcode,:pc)'  : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': toVenueSlug(name, city),
        ':a': true, ':u': 0, ':t': new Date().toISOString(), ':co': 'GB',
        ...(addr ? { ':addr': addr } : {}),
        ...(pc   ? { ':pc': pc }    : {}),
      },
    })).catch(() => {});
    seededVenues.add(venueId);
  }
  return venueId;
}

async function autoSeedArtist(name) {
  if (!name || name.length < 2 || name.length > 100) return null;
  if (JUNK_ARTIST.test(name.trim())) return null;
  const artistId = toArtistId(name);
  if (!artistId || artistId.length < 2 || DRY_RUN) return artistId;

  if (!seededArtists.has(artistId)) {
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: `SET #n = if_not_exists(#n,:n), upcoming = if_not_exists(upcoming,:u), lastUpdated = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': name, ':u': 0, ':t': new Date().toISOString() },
    })).catch(() => {});
    seededArtists.add(artistId);
  }
  return artistId;
}

// ─── Process one event ────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

async function processEvent(ev, gigsSaved, wgtId) {
  const date = (ev.startDate || '').split('T')[0];
  if (!date || date < today) return 0;

  const performers = Array.isArray(ev.performer) ? ev.performer : (ev.performer ? [ev.performer] : []);
  const artists = performers
    .map(p => (p.name || '').trim())
    .filter(n => n && n.length >= 2 && n.length <= 100 && !JUNK_ARTIST.test(n));
  if (!artists.length) return 0;

  const canonicalVenueId = await autoSeedVenue(ev.location);
  if (!canonicalVenueId) return 0;

  const venueName  = (ev.location?.name || '').trim();
  const addrRaw    = ev.location?.address;
  const venueCity  = typeof addrRaw === 'object'
    ? (addrRaw?.addressLocality || '').trim()
    : extractCityFromAddress(addrRaw);
  const ticketUrl  = ev.url || `${BASE_URL}/f/${wgtId}`;
  const available  = ev.eventStatus !== 'https://schema.org/EventSoldOut';
  const isSoldOut  = !available;

  // Get lowest available price from offers
  const offers = Array.isArray(ev.offers) ? ev.offers : (ev.offers ? [ev.offers] : []);
  const availOffers = offers.filter(o => o.availability === 'https://schema.org/InStock' && o.price);
  const minPrice = availOffers.length ? `£${Math.min(...availOffers.map(o => o.price))}` : 'See site';

  let newGigs = 0;
  for (const artistName of artists) {
    const artistId = await autoSeedArtist(artistName);
    if (!artistId) continue;

    const gigId = `wgt-${wgtId}-${artistId}`.replace(/[^a-z0-9-]/gi, '-').substring(0, 100);
    if (gigsSaved.has(gigId)) continue;

    const gig = {
      gigId, artistId, artistName, date,
      doorsTime:        ev.doorTime || null,
      venueName, venueCity, venueCountry: 'GB', canonicalVenueId,
      isSoldOut,
      supportActs: artists.filter(a => a !== artistName),
      tickets: [{ seller: 'WeGotTickets', url: ticketUrl, available, price: minPrice }],
      sources:     ['wegottickets'],
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
  console.log('=== GigRadar WeGotTickets Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  fs.appendFileSync(LOG_FILE, `\n=== WeGotTickets Scraper — ${new Date().toISOString()} ===\n`);

  // Load sitemap — download fresh or use cached file
  console.log('Loading sitemap...');
  const SITEMAP_CACHE = path.join(__dirname, 'wegottickets-sitemap.txt');
  let sitemapText;
  if (fs.existsSync(SITEMAP_CACHE)) {
    sitemapText = fs.readFileSync(SITEMAP_CACHE, 'utf8');
    console.log('  Loaded from cache');
  } else {
    sitemapText = fetchSync(SITEMAP_URL);
    if (!sitemapText) { console.error('Failed to fetch sitemap'); process.exit(1); }
    fs.writeFileSync(SITEMAP_CACHE, sitemapText);
  }

  // sitemap.txt is one URL per line: https://wegottickets.com/f/NNNNN
  const urls = sitemapText.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('http') && l.includes('/f/'));
  console.log(`  Found ${urls.length} event URLs\n`);

  const progress  = loadProgress();
  const doneSet   = new Set(progress.done || []);
  const gigsSaved = new Set();
  let totalGigs = 0, processed = 0, skipped = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const wgtId = url.split('/f/')[1]?.trim();
    if (!wgtId) continue;

    if (doneSet.has(url)) {
      skipped++;
      process.stdout.write(`\r  [${i + 1}/${urls.length}] skipped ${wgtId.padEnd(8)}   `);
      continue;
    }

    const html = fetchSync(url);
    if (!html) { await sleep(300); continue; }

    const events = parseLdJson(html);
    let pageGigs = 0;
    for (const ev of events) {
      pageGigs += await processEvent(ev, gigsSaved, wgtId);
    }

    totalGigs += pageGigs;
    processed++;

    if (!DRY_RUN) {
      doneSet.add(url);
      if (processed % 50 === 0) {
        progress.done = [...doneSet];
        saveProgress(progress);
      }
    }

    process.stdout.write(
      `\r  [${i + 1}/${urls.length}] f/${wgtId.padEnd(8)} — +${pageGigs} gigs | Total: ${totalGigs}   `
    );
    flushLog();
    await sleep(150);
  }

  if (!DRY_RUN) {
    progress.done = [...doneSet];
    saveProgress(progress);
  }
  flushLog();

  console.log('\n\n=== Complete ===');
  console.log(`Events processed : ${processed.toLocaleString()}`);
  console.log(`Gigs saved       : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded   : ${seededArtists.size.toLocaleString()}`);
  console.log(`Venues seeded    : ${seededVenues.size.toLocaleString()}`);
}

main().catch(console.error);
