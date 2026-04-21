#!/usr/bin/env node
/**
 * GigRadar Ents24 Scraper
 *
 * Downloads events from Ents24's events sitemap (~42k URLs), fetches each
 * page, evals the embedded Nuxt state to get structured event data including
 * lineup (headliner + support), venue, date, genres, and ticket status.
 *
 * Only saves events where genres include a music category.
 *
 * Usage:
 *   node scripts/scrape-ents24.cjs
 *   node scripts/scrape-ents24.cjs --dry-run
 *   node scripts/scrape-ents24.cjs --resume
 */

'use strict';

const path     = require('path');
const fs       = require('fs');
const vm       = require('vm');
const { execSync } = require('child_process');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'ents24-progress.json');
const LOG_FILE      = path.join(__dirname, 'scrape-ents24-log.txt');
const SITEMAP_URL   = 'https://www.ents24.com/sitemaps/ents24-events-0.xml';

const DRY_RUN  = process.argv.includes('--dry-run');
const RESUME   = process.argv.includes('--resume');
const QUICK    = process.argv.includes('--quick');  // skip events > 4 weeks out
const sleep   = ms => new Promise(r => setTimeout(r, ms));

const MUSIC_GENRES = new Set([
  'music', 'rock', 'pop', 'indie', 'alternative', 'metal', 'punk', 'jazz', 'blues',
  'soul', 'folk', 'country', 'classical', 'electronic', 'dance', 'rnb', 'r&b',
  'hip-hop', 'hiphop', 'reggae', 'ska', 'acoustic', 'world', 'ambient', 'experimental',
  'tribute', 'rock-pop', 'rocknroll', 'rnbandsoul', 'dj', 'rapper', 'singer',
]);

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

const JUNK_ARTIST = /^(tba|tbc|various artists?|support|residents?|live|open mic|dj set|doors?|to be confirmed|free entry|sold out|cancelled|tribute|special guest|guests)$/i;

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

// ─── Fetch ────────────────────────────────────────────────────────────────────

function fetchSync(url) {
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
      if (result.trim().length < 500) return null;
      return result;
    } catch (e) {
      if (attempt === 3) return null;
    }
  }
  return null;
}

// ─── Parse Nuxt state from Ents24 HTML ───────────────────────────────────────

function parseNuxtState(html) {
  // window.__NUXT__=(function(a,b,c,...){return {...}}(val1,val2,...));
  const match = html.match(/window\.__NUXT__=(\(function\([^)]+\)\{return [\s\S]+?\}\([^)]*\)\));/);
  if (!match) return null;
  try {
    const sandbox = {};
    vm.runInNewContext(`__result__ = ${match[1]}`, sandbox, { timeout: 5000 });
    return sandbox.__result__;
  } catch (e) {
    return null;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

const seededVenues  = new Set();
const seededArtists = new Set();

async function autoSeedVenue(venueObj) {
  const name = (venueObj?.name || '').trim();
  const city = (venueObj?.town || '').trim();
  if (!name) return null;
  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const addr = [venueObj?.address1, venueObj?.address2].filter(Boolean).join(', ') || null;
    const pc   = venueObj?.postcode || null;
    const lat  = venueObj?.lat || null;
    const lon  = venueObj?.lon || null;
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: `SET #n = if_not_exists(#n,:n), city = if_not_exists(city,:c),
        slug = if_not_exists(slug,:s), active = if_not_exists(active,:a),
        upcoming = if_not_exists(upcoming,:u), country = if_not_exists(country,:co),
        lastUpdated = :t
        ${addr ? ', address  = if_not_exists(address,:addr)' : ''}
        ${pc   ? ', postcode = if_not_exists(postcode,:pc)'  : ''}
        ${lat  ? ', lat = if_not_exists(lat,:lat)'           : ''}
        ${lon  ? ', lon = if_not_exists(lon,:lon)'           : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': toVenueSlug(name, city),
        ':a': true, ':u': 0, ':t': new Date().toISOString(), ':co': 'GB',
        ...(addr ? { ':addr': addr } : {}),
        ...(pc   ? { ':pc': pc }    : {}),
        ...(lat  ? { ':lat': lat }  : {}),
        ...(lon  ? { ':lon': lon }  : {}),
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

// ─── Process one Ents24 event page ───────────────────────────────────────────

const today       = new Date().toISOString().split('T')[0];
const quickCutoff = (() => { const d = new Date(); d.setDate(d.getDate() + 28); return d.toISOString().split('T')[0]; })();

async function processPage(html, eventId, gigsSaved) {
  const nuxt = parseNuxtState(html);
  if (!nuxt) return 0;

  const ev = nuxt.state?.event;
  if (!ev) return 0;

  // Check if this is a music event
  const eventGenres = (ev.genres || []).map(g => (g.tag || g.name || '').toLowerCase());
  const isMusic = eventGenres.some(g => MUSIC_GENRES.has(g));
  if (!isMusic) return 0;

  // Get date from <time> element (more reliable than parsing Nuxt state)
  const dateMatch = html.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"/);
  const date = dateMatch?.[1] || ev.startDate || null;
  if (!date || date < today) return 0;
  if (QUICK && date > quickCutoff) return 0;

  // Get lineup
  const lineup = ev.lineup || [];
  const headliners = lineup.filter(a => a.roster?.isHeadliner !== false).map(a => a.name?.trim()).filter(Boolean);
  const supports = lineup.filter(a => !a.roster?.isHeadliner).map(a => a.name?.trim()).filter(Boolean);
  const allArtists = lineup.map(a => a.name?.trim()).filter(n => n && n.length >= 2 && n.length <= 100 && !JUNK_ARTIST.test(n));
  if (!allArtists.length) return 0;

  const venueObj = ev.venue;
  if (!venueObj?.name) return 0;

  const canonicalVenueId = await autoSeedVenue(venueObj);
  if (!canonicalVenueId) return 0;

  const venueName = venueObj.name;
  const venueCity = venueObj.town || '';
  const isSoldOut = ev.status === 'sold-out' || ev.status === 'tickets-unavailable';

  // Extract price
  const priceMatch = html.match(/£[\d,.]+/);
  const price = priceMatch ? priceMatch[0] : 'See site';

  const ticketUrl = `https://www.ents24.com${ev.uri || `/uk/event/${eventId}`}`;

  let newGigs = 0;
  for (const artistName of allArtists) {
    const artistId = await autoSeedArtist(artistName);
    if (!artistId) continue;

    const gigId = `e24-${eventId}-${artistId}`.replace(/[^a-z0-9-]/gi, '-').substring(0, 100);
    if (gigsSaved.has(gigId)) continue;

    const otherArtists = allArtists.filter(a => a !== artistName);
    const priceNum = priceMatch ? parseFloat(priceMatch[0].replace('£', '').replace(',', '')) || null : null;
    const gig = {
      gigId, artistId, artistName, date,
      doorsTime:        null,
      venueName, venueCity, venueCountry: 'GB', canonicalVenueId,
      isSoldOut,
      minPrice:  priceNum,
      supportActs: otherArtists,
      tickets: [{ seller: 'Ents24', url: ticketUrl, available: !isSoldOut, price }],
      sources:     ['ents24'],
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
  console.log('=== GigRadar Ents24 Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  fs.appendFileSync(LOG_FILE, `\n=== Ents24 Scraper — ${new Date().toISOString()} ===\n`);

  // Download sitemap
  console.log('Loading sitemap...');
  const SITEMAP_CACHE = path.join(__dirname, 'ents24-sitemap.xml');
  let sitemapXml;
  if (fs.existsSync(SITEMAP_CACHE)) {
    sitemapXml = fs.readFileSync(SITEMAP_CACHE, 'utf8');
    console.log('  Loaded from cache');
  } else {
    sitemapXml = fetchSync(SITEMAP_URL);
    if (!sitemapXml) { console.error('Failed to fetch sitemap'); process.exit(1); }
    fs.writeFileSync(SITEMAP_CACHE, sitemapXml);
  }

  const urls = [...sitemapXml.matchAll(/<loc>(https:\/\/www\.ents24\.com\/[^<]+)<\/loc>/g)]
    .map(([, url]) => url.trim())
    .filter(url => !url.includes('/festival/') && url.includes('-events/')); // skip festivals
  console.log(`  Found ${urls.length} non-festival event URLs\n`);

  const progress  = loadProgress();
  const doneSet   = new Set(progress.done || []);
  const gigsSaved = new Set();
  let totalGigs = 0, processed = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const eventId = url.split('/').pop();

    if (doneSet.has(url)) {
      process.stdout.write(`\r  [${i + 1}/${urls.length}] skipped ${eventId.substring(0, 10).padEnd(10)}   `);
      continue;
    }

    const html = fetchSync(url);
    if (!html) { await sleep(300); continue; }

    const pageGigs = await processPage(html, eventId, gigsSaved);
    totalGigs += pageGigs;
    processed++;

    if (!DRY_RUN) {
      doneSet.add(url);
      if (processed % 100 === 0) {
        progress.done = [...doneSet];
        saveProgress(progress);
      }
    }

    process.stdout.write(
      `\r  [${i + 1}/${urls.length}] ${eventId.substring(0, 10).padEnd(10)} — +${pageGigs} | Total: ${totalGigs}   `
    );
    flushLog();
    await sleep(120); // slightly faster than Gigantic — Ents24 hasn't blocked us yet
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
