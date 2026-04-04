#!/usr/bin/env node
/**
 * Phase 1 — Seed gigradar-venues with UK music venues from OpenStreetMap
 *
 * Queries the Overpass API for all UK venues tagged as music venues, concert
 * halls, etc. Extracts name, city, website URL, and coordinates. Cross-
 * references with existing DynamoDB records and upserts.
 *
 * Usage (from project root):
 *   node scripts/seed-venues-osm.js            — full run (query OSM + write to DynamoDB)
 *   node scripts/seed-venues-osm.js --dry-run  — query OSM, save JSON, skip DynamoDB
 *   node scripts/seed-venues-osm.js --import   — skip OSM query, import from saved JSON
 */

const fs   = require('fs');
const path = require('path');

// Use AWS SDK from the scraper Lambda's node_modules (already installed)
const SDK_PATH   = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                            = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand }       = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE = 'gigradar-venues';
const CACHE_FILE   = path.join(__dirname, 'venues-osm.json');
const DRY_RUN      = process.argv.includes('--dry-run');
const IMPORT_ONLY  = process.argv.includes('--import');

// ─── Name / ID helpers (same logic as scraper) ──────────────────────────────

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

// ─── Overpass query ──────────────────────────────────────────────────────────

// UK bounding box: (south, west, north, east)
const BB = '49.9,-10.5,61.0,2.0';

const OVERPASS_QUERY = `
[out:json][timeout:300];
(
  node["amenity"="music_venue"](${BB});
  way["amenity"="music_venue"](${BB});
  relation["amenity"="music_venue"](${BB});
  node["venue"="music"](${BB});
  way["venue"="music"](${BB});
  relation["venue"="music"](${BB});
  node["venue"="concert_hall"](${BB});
  way["venue"="concert_hall"](${BB});
  node["venue"="auditorium"](${BB});
  way["venue"="auditorium"](${BB});
  node["amenity"="theatre"]["live_music"="yes"](${BB});
  way["amenity"="theatre"]["live_music"="yes"](${BB});
  node["amenity"="arts_centre"]["live_music"="yes"](${BB});
  way["amenity"="arts_centre"]["live_music"="yes"](${BB});
  node["amenity"="pub"]["live_music"="yes"](${BB});
  way["amenity"="pub"]["live_music"="yes"](${BB});
  node["amenity"="bar"]["live_music"="yes"](${BB});
  way["amenity"="bar"]["live_music"="yes"](${BB});
  node["amenity"="pub"]["live_music"="only"](${BB});
  way["amenity"="pub"]["live_music"="only"](${BB});
  node["amenity"="nightclub"]["live_music"="yes"](${BB});
  way["amenity"="nightclub"]["live_music"="yes"](${BB});
  node["amenity"="community_centre"]["live_music"="yes"](${BB});
  way["amenity"="community_centre"]["live_music"="yes"](${BB});
  node["leisure"="music_venue"](${BB});
  way["leisure"="music_venue"](${BB});
  node["building"="music_venue"](${BB});
  way["building"="music_venue"](${BB});
);
out center tags;
`.trim();

async function queryOverpass() {
  console.log('Querying OpenStreetMap Overpass API...');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'GigRadar/1.0 (venue seeding)' },
    body:    `data=${encodeURIComponent(OVERPASS_QUERY)}`,
  });
  if (!res.ok) throw new Error(`Overpass API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  console.log(`Overpass returned ${data.elements?.length || 0} raw elements`);
  return data.elements || [];
}

// ─── Parse OSM elements into clean venue records ─────────────────────────────

function parseElements(elements) {
  const venues = [];
  const seen   = new Set();

  for (const el of elements) {
    const tags = el.tags || {};
    const name = (tags.name || '').trim();
    if (!name) continue;

    // Get coordinates — nodes have lat/lon directly; ways/relations use center
    const lat  = el.lat ?? el.center?.lat;
    const lon  = el.lon ?? el.center?.lon;

    // City — try multiple OSM address tags in order of preference
    const city = (
      tags['addr:city'] ||
      tags['addr:town'] ||
      tags['addr:village'] ||
      tags['addr:suburb'] ||
      ''
    ).trim();

    // Website — check multiple common OSM keys
    const website = (
      tags.website ||
      tags['contact:website'] ||
      tags.url ||
      tags['contact:url'] ||
      ''
    ).trim().replace(/\/$/, '');

    // Social media — normalise to full URLs where possible
    const rawFb = tags['contact:facebook'] || tags.facebook || '';
    const facebook = rawFb
      ? (rawFb.startsWith('http') ? rawFb : `https://www.facebook.com/${rawFb.replace(/^\//, '')}`)
      : null;

    const rawIg = tags['contact:instagram'] || tags.instagram || '';
    const instagram = rawIg
      ? (rawIg.startsWith('http') ? rawIg : `https://www.instagram.com/${rawIg.replace(/^@/, '').replace(/^\//, '')}`)
      : null;

    const postcode = (tags['addr:postcode'] || '').trim();
    const capacity = parseInt(tags.capacity || tags['capacity:persons'] || 0, 10) || null;

    const venueId = toVenueId(name, city);
    if (seen.has(venueId)) continue;
    seen.add(venueId);

    venues.push({
      venueId,
      name,
      city,
      postcode:  postcode   || null,
      website:   website    || null,
      facebook:  facebook   || null,
      instagram: instagram  || null,
      capacity:  capacity   || null,
      lat:       lat        || null,
      lon:       lon        || null,
      osmId:     `${el.type}/${el.id}`,
      slug:      toVenueSlug(name, city),
      isActive:  true,
      upcoming:  0,
      source:    'osm',
    });
  }

  return venues;
}

// ─── Load existing venues from DynamoDB ──────────────────────────────────────

async function loadExistingVenues() {
  const existing = new Map();
  let lastKey;
  do {
    const params = { TableName: VENUES_TABLE };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    for (const item of (result.Items || [])) {
      existing.set(item.venueId, item);
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  console.log(`Existing DynamoDB venues: ${existing.size}`);
  return existing;
}

// ─── Upsert venues to DynamoDB ───────────────────────────────────────────────

async function upsertVenue(venue) {
  // Only set website/osmId/lat/lon/postcode/capacity if not already present
  // Never overwrite name, city, or upcoming count with OSM data
  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: venue.venueId },
    UpdateExpression: `SET #n       = if_not_exists(#n,        :n),
                           city      = if_not_exists(city,      :c),
                           slug      = if_not_exists(slug,      :s),
                           isActive  = if_not_exists(isActive,  :a),
                           upcoming  = if_not_exists(upcoming,  :u),
                           website   = if_not_exists(website,   :w),
                           facebook  = if_not_exists(facebook,  :fb),
                           instagram = if_not_exists(instagram, :ig),
                           osmId     = if_not_exists(osmId,     :oid),
                           lat       = if_not_exists(lat,       :lat),
                           lon       = if_not_exists(lon,       :lon),
                           postcode  = if_not_exists(postcode,  :pc),
                           lastUpdated = :t`,
    ExpressionAttributeNames: { '#n': 'name' },
    ExpressionAttributeValues: {
      ':n':   venue.name,
      ':c':   venue.city      || '',
      ':s':   venue.slug,
      ':a':   true,
      ':u':   0,
      ':w':   venue.website   || null,
      ':fb':  venue.facebook  || null,
      ':ig':  venue.instagram || null,
      ':oid': venue.osmId,
      ':lat': venue.lat,
      ':lon': venue.lon,
      ':pc':  venue.postcode  || null,
      ':t':   new Date().toISOString(),
    },
  }));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Venue Seeder — OpenStreetMap ===\n');

  let osmVenues;

  if (IMPORT_ONLY) {
    // Load from previously saved JSON
    if (!fs.existsSync(CACHE_FILE)) {
      console.error(`No cache file found at ${CACHE_FILE}. Run without --import first.`);
      process.exit(1);
    }
    osmVenues = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Loaded ${osmVenues.length} venues from cache`);
  } else {
    // Query Overpass API
    const elements = await queryOverpass();
    osmVenues      = parseElements(elements);
    console.log(`Parsed ${osmVenues.length} unique venues`);

    // Save to JSON for review / re-import
    fs.writeFileSync(CACHE_FILE, JSON.stringify(osmVenues, null, 2));
    console.log(`Saved to ${CACHE_FILE}`);
  }

  // Stats
  const withWebsite   = osmVenues.filter(v => v.website).length;
  const withFacebook  = osmVenues.filter(v => v.facebook).length;
  const withInstagram = osmVenues.filter(v => v.instagram).length;
  const withAnySocial = osmVenues.filter(v => v.website || v.facebook || v.instagram).length;
  const withCity      = osmVenues.filter(v => v.city).length;
  console.log(`\nVenues with website URL : ${withWebsite} / ${osmVenues.length}`);
  console.log(`Venues with Facebook    : ${withFacebook} / ${osmVenues.length}`);
  console.log(`Venues with Instagram   : ${withInstagram} / ${osmVenues.length}`);
  console.log(`Venues with any contact : ${withAnySocial} / ${osmVenues.length}`);
  console.log(`Venues with city        : ${withCity} / ${osmVenues.length}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: skipping DynamoDB writes');
    console.log('\nSample venues:');
    osmVenues.slice(0, 10).forEach(v =>
      console.log(`  ${v.name.padEnd(35)} ${(v.city || '').padEnd(20)} ${v.website || '(no website)'}`)
    );
    return;
  }

  // Cross-reference with existing DynamoDB records
  const existing  = await loadExistingVenues();
  let newCount    = 0;
  let updateCount = 0;
  let skipCount   = 0;

  console.log('\nWriting to DynamoDB...');
  for (const venue of osmVenues) {
    const ex = existing.get(venue.venueId);
    if (ex && ex.website && !venue.website) {
      // Already in DB with a website — nothing to add
      skipCount++;
      continue;
    }
    await upsertVenue(venue);
    if (ex) updateCount++;
    else    newCount++;

    // Throttle slightly to avoid DynamoDB burst
    await new Promise(r => setTimeout(r, 10));
  }

  console.log(`\n✓ Done`);
  console.log(`  New venues created  : ${newCount}`);
  console.log(`  Existing updated    : ${updateCount}`);
  console.log(`  Already complete    : ${skipCount}`);
  console.log(`  Total OSM venues    : ${osmVenues.length}`);
  console.log(`\nVenues with website URLs are now ready for Phase 2 (crawl URL discovery).`);
}

main().catch(err => { console.error(err); process.exit(1); });
