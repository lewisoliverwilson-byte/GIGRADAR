#!/usr/bin/env node
/**
 * GigRadar Bandsintown Scraper
 *
 * Uses the Bandsintown REST API to fetch upcoming UK events for every artist
 * already seeded in gigradar-artists. Since Bandsintown is artist-centric,
 * this runs AFTER other scrapers have seeded artists.
 *
 * Free app_id: register at https://bandsintown.com/api/artist_api
 * (or any short string — Bandsintown uses it for attribution only)
 *
 * Usage:
 *   BIT_APP_ID=gigradar node scripts/scrape-bandsintown.cjs
 *   BIT_APP_ID=gigradar node scripts/scrape-bandsintown.cjs --dry-run
 *   BIT_APP_ID=gigradar node scripts/scrape-bandsintown.cjs --resume
 *   BIT_APP_ID=gigradar node scripts/scrape-bandsintown.cjs --app-id gigradar
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                                  = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand, ScanCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'bandsintown-progress.json');

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const QUICK   = process.argv.includes('--quick');  // only artists with upcoming gigs
const APP_ID  = process.env.BIT_APP_ID || arg('--app-id') || 'gigradar';
const sleep   = ms => new Promise(r => setTimeout(r, ms));

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

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { processedArtists: [], gigs: 0, venues: 0 };
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p)); }

// ─── Load all seeded artists from DynamoDB ────────────────────────────────────

async function loadArtists() {
  console.log(`Loading artists from DynamoDB${QUICK ? ' (quick: upcoming only)' : ''}...`);
  const artists = [];
  let lastKey;
  do {
    const params = { TableName: ARTISTS_TABLE };
    // In quick mode only fetch artists that have upcoming gigs — far fewer to process
    if (QUICK) {
      params.FilterExpression = 'upcoming > :z';
      params.ExpressionAttributeValues = { ':z': 0 };
    }
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    artists.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  console.log(`  ${artists.length.toLocaleString()} artists loaded\n`);
  return artists;
}

// ─── Auto-seed venue ──────────────────────────────────────────────────────────

const seededVenues = new Set();

async function autoSeedVenue(bitVenue) {
  const name = bitVenue.name || '';
  const city = bitVenue.city || '';
  if (!name) return null;
  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;
  if (!seededVenues.has(venueId)) {
    const lat = parseFloat(bitVenue.latitude)  || null;
    const lon = parseFloat(bitVenue.longitude) || null;
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
        ${lon ? ', lon = if_not_exists(lon, :lon)' : ''}
        ${bitVenue.country ? ', country = if_not_exists(country, :co)' : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': toVenueSlug(name, city),
        ':a': true, ':u': 0, ':t': new Date().toISOString(),
        ...(lat ? { ':lat': lat } : {}),
        ...(lon ? { ':lon': lon } : {}),
        ...(bitVenue.country ? { ':co': bitVenue.country } : {}),
      },
    })).catch(() => {});
    seededVenues.add(venueId);
  }
  return venueId;
}

// ─── Fetch artist events from Bandsintown ─────────────────────────────────────

async function fetchArtistEvents(artistName) {
  const encoded = encodeURIComponent(artistName);
  const url = `https://rest.bandsintown.com/artists/${encoded}/events?app_id=${APP_ID}&date=upcoming`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'GigRadar/1.0' }
      });
      if (r.status === 404) return []; // artist not found on BIT
      if (r.status === 429) { await sleep(30000); continue; }
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const data = await r.json();
      if (!Array.isArray(data)) return [];
      return data;
    } catch (e) {
      if (attempt === 3) return [];
      await sleep(2000 * attempt);
    }
  }
  return [];
}

// ─── Process events for an artist ────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

async function processArtistEvents(artist, events, gigsSaved, venuesSaved) {
  let newGigs = 0, newVenues = 0;

  for (const ev of events) {
    const venue = ev.venue;
    if (!venue) continue;

    // UK only
    const country = venue.country || '';
    if (country && country !== 'United Kingdom' && country !== 'GB' && country !== 'England' &&
        country !== 'Scotland' && country !== 'Wales' && country !== 'Northern Ireland') continue;

    const date = (ev.datetime || '').split('T')[0];
    if (!date || date < today) continue;

    const canonicalVenueId = await autoSeedVenue(venue);
    if (!canonicalVenueId) continue;
    if (!venuesSaved.has(canonicalVenueId)) { venuesSaved.add(canonicalVenueId); newVenues++; }

    // Support acts
    const supportActs = (ev.lineup || [])
      .filter(n => n !== artist.name)
      .filter(n => n && n.length > 1);

    const offers   = ev.offers || [];
    const ticketUrl = offers[0]?.url || `https://www.bandsintown.com/e/${ev.id}`;
    const isFree   = offers[0]?.type === 'free' || false;
    const price    = isFree ? 'Free' : (offers[0]?.url ? 'See site' : 'See site');

    const gigId = `bit-${ev.id || `${artist.artistId}-${date}-${normaliseName(venue.name)}`}`;
    if (gigsSaved.has(gigId)) continue;

    const gig = {
      gigId,
      artistId:         artist.artistId,
      artistName:       artist.name,
      date,
      doorsTime:        null,
      venueName:        venue.name,
      venueCity:        venue.city || '',
      venueCountry:     'GB',
      canonicalVenueId,
      isSoldOut:        false,
      minAge:           null,
      supportActs,
      tickets: [{
        seller:    'Bandsintown',
        url:       ticketUrl,
        available: true,
        price,
      }],
      sources:     ['bandsintown'],
      lastUpdated: new Date().toISOString(),
    };

    if (!DRY_RUN) {
      await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig }))
        .catch(e => console.error(`  Gig save error ${gig.gigId}:`, e.message));
    }
    gigsSaved.add(gigId);
    newGigs++;
  }

  return { newGigs, newVenues };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Bandsintown Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');
  console.log(`App ID: ${APP_ID}\n`);

  const progress   = loadProgress();
  const processed  = new Set(progress.processedArtists || []);
  const gigsSaved  = new Set();
  const venuesSaved = new Set();

  const artists = await loadArtists();
  const toProcess = RESUME ? artists.filter(a => !processed.has(a.artistId)) : artists;

  console.log(`Processing ${toProcess.length.toLocaleString()} artists${RESUME ? ` (${processed.size} already done)` : ''}\n`);

  let totalGigs = 0, totalVenues = 0, errors = 0, notFound = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const artist = toProcess[i];
    if (!artist.name || !artist.artistId) continue;

    const events = await fetchArtistEvents(artist.name);

    if (events.length === 0) {
      notFound++;
    } else {
      const { newGigs, newVenues } = await processArtistEvents(artist, events, gigsSaved, venuesSaved);
      totalGigs  += newGigs;
      totalVenues += newVenues;
    }

    processed.add(artist.artistId);

    if (i % 50 === 0 || i === toProcess.length - 1) {
      if (!DRY_RUN) saveProgress({ processedArtists: [...processed], gigs: totalGigs, venues: totalVenues });
      const pct = ((i + 1) / toProcess.length * 100).toFixed(1);
      process.stdout.write(
        `\r  Artist ${i + 1}/${toProcess.length} (${pct}%) | Gigs: ${totalGigs.toLocaleString()} | Venues: ${totalVenues} | Not on BIT: ${notFound}   `
      );
    }

    await sleep(200); // 5 req/s max
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Gigs saved     : ${totalGigs.toLocaleString()}`);
  console.log(`Venues seeded  : ${totalVenues.toLocaleString()}`);
  console.log(`Not on BIT     : ${notFound.toLocaleString()}`);
  console.log(`Errors         : ${errors}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
