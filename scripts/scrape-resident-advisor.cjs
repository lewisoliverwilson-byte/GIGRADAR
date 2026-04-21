#!/usr/bin/env node
/**
 * GigRadar Resident Advisor Scraper
 *
 * Uses the RA GraphQL API to scrape upcoming UK electronic/club events.
 * No API key required — RA's public GraphQL endpoint.
 *
 * Usage:
 *   node scripts/scrape-resident-advisor.cjs
 *   node scripts/scrape-resident-advisor.cjs --dry-run
 *   node scripts/scrape-resident-advisor.cjs --days 180
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
const LOG_FILE      = path.join(__dirname, 'scrape-ra-log.txt');

const RA_URL   = 'https://ra.co/graphql';
const PAGE_SZ  = 100;
const QUICK    = process.argv.includes('--quick');  // 28 days instead of 180
const DAYS     = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || (QUICK ? '28' : '180'), 10);
const DRY_RUN  = process.argv.includes('--dry-run');
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// RA UK area IDs
const UK_AREAS = [
  { id: 13,  name: 'London' },
  { id: 344, name: 'Manchester' },
  { id: 340, name: 'Glasgow' },
  { id: 341, name: 'Edinburgh' },
  { id: 345, name: 'Newcastle' },
  { id: 446, name: 'Bristol' },
  { id: 346, name: 'Leeds' },
  { id: 343, name: 'Liverpool' },
  { id: 520, name: 'Sheffield' },
  { id: 535, name: 'Brighton' },
  { id: 544, name: 'Nottingham' },
  { id: 534, name: 'Belfast' },
  { id: 516, name: 'Birmingham' },
  { id: 518, name: 'Cardiff' },
  { id: 342, name: 'Aberdeen' },
  { id: 539, name: 'Dundee' },
  { id: 685, name: 'Southampton' },
];

const RA_HEADERS = {
  'Content-Type': 'application/json',
  'Accept':       'application/json',
  'Origin':       'https://ra.co',
  'Referer':      'https://ra.co/events/uk',
  'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const logLines = [];
function log(msg) { logLines.push(msg); }
function flushLog() {
  fs.appendFileSync(LOG_FILE, logLines.join('\n') + '\n');
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

// ─── GraphQL query ────────────────────────────────────────────────────────────

function buildQuery(areaId, dateFrom, dateTo, page) {
  return `{ eventListings(filters: { areas: { eq: ${areaId} } listingDate: { gte: "${dateFrom}" lte: "${dateTo}" } } pageSize: ${PAGE_SZ} page: ${page}) { data { id event { id title date venue { name address area { name } country { isoCode } location { latitude longitude } } artists { name } contentUrl } } totalResults } }`;
}

async function fetchPage(areaId, dateFrom, dateTo, page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(RA_URL, {
        method: 'POST',
        headers: RA_HEADERS,
        body: JSON.stringify({ query: buildQuery(areaId, dateFrom, dateTo, page) }),
      });
      if (r.status === 429) { await sleep(30000); continue; }
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const d = await r.json();
      if (d.errors?.length) { await sleep(1000 * attempt); continue; }
      const listings = d.data?.eventListings;
      return { events: listings?.data || [], total: listings?.totalResults || 0 };
    } catch (e) {
      if (attempt === 3) return { events: [], total: 0 };
      await sleep(2000 * attempt);
    }
  }
  return { events: [], total: 0 };
}

// ─── Auto-seed venue ──────────────────────────────────────────────────────────

const seededVenues = new Set();

async function autoSeedVenue(raVenue, areaName) {
  const name = (raVenue.name || '').trim();
  const city = raVenue.area?.name || areaName;
  if (!name) return null;

  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const lat = raVenue.location?.latitude || null;
    const lon = raVenue.location?.longitude || null;
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
        ${raVenue.address ? ', address = if_not_exists(address, :addr)' : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': toVenueSlug(name, city),
        ':a': true, ':u': 0, ':t': new Date().toISOString(), ':co': 'GB',
        ...(lat ? { ':lat': lat } : {}),
        ...(lon ? { ':lon': lon } : {}),
        ...(raVenue.address ? { ':addr': raVenue.address } : {}),
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

// ─── Process one listing ──────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

const JUNK_ARTIST = /^(tba|tbc|various artists?|support|residents?|live)$/i;

async function processListing(listing, areaName, gigsSaved, artistsSaved, venuesSaved) {
  const ev = listing.event;
  if (!ev?.venue) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  // UK only
  const iso = ev.venue.country?.isoCode;
  if (iso && iso !== 'GB' && iso !== 'GBR') return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const date = (ev.date || '').split('T')[0];
  if (!date || date < today) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const artists = (ev.artists || []).map(a => a.name).filter(n => n && n.length >= 2 && n.length <= 80 && !JUNK_ARTIST.test(n));
  if (artists.length === 0) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  const canonicalVenueId = await autoSeedVenue(ev.venue, areaName);
  if (!canonicalVenueId) return { newGigs: 0, newArtists: 0, newVenues: 0 };

  let newVenues = 0;
  if (!venuesSaved.has(canonicalVenueId)) { venuesSaved.add(canonicalVenueId); newVenues++; }

  const venueName = (ev.venue.name || '').trim();
  const venueCity = ev.venue.area?.name || areaName;
  const ticketUrl = ev.contentUrl ? `https://ra.co${ev.contentUrl}` : `https://ra.co/events/uk/${areaName.toLowerCase()}`;

  let newGigs = 0, newArtists = 0;

  for (const artistName of artists) {
    const artistId = await autoSeedArtist(artistName);
    if (!artistId) continue;
    if (!artistsSaved.has(artistId)) { artistsSaved.add(artistId); newArtists++; }

    const gigId = `ra-${ev.id}-${artistId}`.replace(/[^a-z0-9-]/gi, '-');
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
      isSoldOut:        false,
      minPrice:         null,
      minAge:           null,
      supportActs:      artists.filter(a => a !== artistName),
      tickets: [{
        seller:    'Resident Advisor',
        url:       ticketUrl,
        available: true,
        price:     'See site',
      }],
      sources:     ['resident-advisor'],
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
  console.log('=== GigRadar Resident Advisor Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  if (!DRY_RUN) fs.writeFileSync(LOG_FILE, `=== RA Scraper — ${new Date().toISOString()} ===\n\n`);

  const dateFrom = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  const dateTo   = new Date(Date.now() + DAYS * 86400000).toISOString().replace(/\.\d{3}Z$/, '');

  const gigsSaved    = new Set();
  const artistsSaved = new Set();
  const venuesSaved  = new Set();
  let totalGigs = 0, totalArtists = 0, totalVenues = 0;

  for (let ci = 0; ci < UK_AREAS.length; ci++) {
    const { id: areaId, name: areaName } = UK_AREAS[ci];
    let areaGigs = 0, page = 1, total = Infinity;

    while ((page - 1) * PAGE_SZ < total) {
      const { events: listings, total: tot } = await fetchPage(areaId, dateFrom, dateTo, page);
      total = tot;
      if (listings.length === 0) break;

      for (const listing of listings) {
        const { newGigs, newArtists, newVenues } = await processListing(listing, areaName, gigsSaved, artistsSaved, venuesSaved);
        areaGigs     += newGigs;
        totalGigs    += newGigs;
        totalArtists += newArtists;
        totalVenues  += newVenues;
      }

      page++;
      await sleep(300);
    }

    if (!DRY_RUN) flushLog();

    process.stdout.write(
      `\r  [${ci + 1}/${UK_AREAS.length}] ${areaName.padEnd(15)} — +${areaGigs} gigs | Total: ${totalGigs} gigs, ${totalArtists} artists   `
    );
  }

  console.log('\n\n=== Complete ===');
  console.log(`Gigs saved     : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded : ${totalArtists.toLocaleString()}`);
  console.log(`Venues seeded  : ${totalVenues.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
}

main().catch(e => { console.error(e); process.exit(1); });
