#!/usr/bin/env node
/**
 * GigRadar Gigantic Scraper
 *
 * Fetches event URLs from Gigantic's sitemap (events.xml), scrapes each
 * individual event page for LD+JSON MusicEvent data.
 *
 * Individual event pages are NOT bot-protected (only the main search is).
 * Sitemap has ~7k UK music event URLs.
 *
 * Usage:
 *   node scripts/scrape-gigantic.cjs
 *   node scripts/scrape-gigantic.cjs --dry-run
 *   node scripts/scrape-gigantic.cjs --resume
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
const PROGRESS_FILE = path.join(__dirname, 'gigantic-progress.json');
const LOG_FILE      = path.join(__dirname, 'scrape-gigantic-log.txt');
const SITEMAP_URL   = 'https://www.gigantic.com/sitemaps/events.xml';

const DRY_RUN  = process.argv.includes('--dry-run');
const RESUME   = process.argv.includes('--resume');
const QUICK    = process.argv.includes('--quick');  // skip events > 4 weeks out
const sleep   = ms => new Promise(r => setTimeout(r, ms));

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

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
// Use curl to bypass bot fingerprinting — Node.js fetch gets 403 from Gigantic

function fetchHtmlSync(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = execSync(
        `curl -sL --max-time 15 --retry 0 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" -H "Accept-Language: en-GB,en;q=0.9" "${url}"`,
        { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      if (result.includes('Bot Check') || result.includes('Just a moment')) {
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

async function fetchHtml(url) {
  return fetchHtmlSync(url);
}

function parseLdJson(html) {
  const events = [];
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(json);
      for (const item of (Array.isArray(d) ? d : [d])) {
        if (item['@type'] === 'MusicEvent') events.push(item);
      }
    } catch {}
  }
  return events;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

const seededVenues  = new Set();
const seededArtists = new Set();

async function autoSeedVenue(location) {
  const name = (location?.name || '').trim();
  const city = (location?.address?.addressLocality || '').trim();
  if (!name) return null;
  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const addr = (location?.address?.streetAddress || '').trim() || null;
    const pc   = location?.address?.postalCode || null;
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

const today     = new Date().toISOString().split('T')[0];
const quickCutoff = (() => { const d = new Date(); d.setDate(d.getDate() + 28); return d.toISOString().split('T')[0]; })();

async function processEvent(ev, gigsSaved) {
  const date = (ev.startDate || '').split('T')[0];
  if (!date || date < today) return 0;
  if (QUICK && date > quickCutoff) return 0;

  const performers = Array.isArray(ev.performer) ? ev.performer : (ev.performer ? [ev.performer] : []);
  const artists = performers
    .map(p => (p.name || '').trim())
    .filter(n => n && n.length >= 2 && n.length <= 100 && !JUNK_ARTIST.test(n));
  if (!artists.length) return 0;

  const canonicalVenueId = await autoSeedVenue(ev.location);
  if (!canonicalVenueId) return 0;

  const venueName  = (ev.location?.name || '').trim();
  const venueCity  = (ev.location?.address?.addressLocality || '').trim();
  const ticketUrl  = ev.url || '';
  const available  = ev.eventStatus !== 'https://schema.org/EventSoldOut';
  const isSoldOut  = !available;

  const ageStr = (ev.typicalAgeRange || '');
  const ageMatch = ageStr.match(/(\d+)\+/);
  const minAge = ageMatch ? parseInt(ageMatch[1]) : null;

  // Derive a stable ID from the URL slug
  const slugMatch = ticketUrl.match(/gigantic\.com\/([^/]+)\//);
  const slug = slugMatch?.[1] || normaliseName(ev.name || '').substring(0, 20) + date;

  let newGigs = 0;
  for (const artistName of artists) {
    const artistId = await autoSeedArtist(artistName);
    if (!artistId) continue;

    const gigId = `gg-${slug}-${artistId}`.replace(/[^a-z0-9-]/gi, '-').substring(0, 100);
    if (gigsSaved.has(gigId)) continue;

    const gig = {
      gigId, artistId, artistName, date,
      doorsTime:        ev.doorTime || null,
      venueName, venueCity, venueCountry: 'GB', canonicalVenueId,
      isSoldOut, minAge,
      supportActs: artists.filter(a => a !== artistName),
      tickets: [{ seller: 'Gigantic', url: ticketUrl, available, price: 'See site' }],
      sources:     ['gigantic'],
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
  console.log('=== GigRadar Gigantic Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  fs.appendFileSync(LOG_FILE, `\n=== Gigantic Scraper — ${new Date().toISOString()} ===\n`);

  // Load sitemap — download fresh or read from cached file
  console.log('Loading sitemap...');
  const SITEMAP_CACHE = path.join(__dirname, 'gigantic-sitemap.xml');
  let sitemapXml;
  if (fs.existsSync(SITEMAP_CACHE)) {
    sitemapXml = fs.readFileSync(SITEMAP_CACHE, 'utf8');
    console.log('  Loaded from cache');
  } else {
    sitemapXml = await fetchHtml(SITEMAP_URL);
    if (!sitemapXml) { console.error('Failed to fetch sitemap'); process.exit(1); }
    fs.writeFileSync(SITEMAP_CACHE, sitemapXml);
  }

  const urls = [...sitemapXml.matchAll(/<loc>(https:\/\/www\.gigantic\.com\/[^<]+)<\/loc>/g)]
    .map(([, url]) => url.trim());
  console.log(`  Found ${urls.length} event URLs\n`);

  const progress  = loadProgress();
  const doneSet   = new Set(progress.done || []);
  const gigsSaved = new Set();
  let totalGigs = 0, processed = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (doneSet.has(url)) {
      process.stdout.write(`\r  [${i + 1}/${urls.length}] skipped ${url.split('/')[3]?.substring(0, 25).padEnd(25)}   `);
      continue;
    }

    const html = await fetchHtml(url);
    if (!html) { await sleep(300); continue; }

    const events = parseLdJson(html);
    let pageGigs = 0;
    for (const ev of events) {
      pageGigs += await processEvent(ev, gigsSaved);
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
      `\r  [${i + 1}/${urls.length}] ${url.split('/')[3]?.substring(0, 25).padEnd(25)} — +${pageGigs} gigs | Total: ${totalGigs}   `
    );
    flushLog();
    await sleep(200);
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
