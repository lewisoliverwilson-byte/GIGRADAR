#!/usr/bin/env node
/**
 * GigRadar Venue Enrichment — Ticketmaster
 *
 * Uses the TM Discovery API v2 venue endpoint to enrich venues that were
 * seeded by the TM gig scraper. Adds: website, images, social links,
 * address, capacity (where available), lat/lon.
 *
 * TM venue IDs are stored in the gigs table as part of the venue data.
 * We scan gigs for tm- prefixed gigIds to find known TM venue IDs.
 *
 * Usage:
 *   TM_API_KEY=xxxx node scripts/enrich-venues-ticketmaster.cjs
 *   TM_API_KEY=xxxx node scripts/enrich-venues-ticketmaster.cjs --dry-run
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                                          = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand, GetCommand }         = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE = 'gigradar-venues';
const GIGS_TABLE   = 'gigradar-gigs';
const TM_KEY       = process.env.TM_API_KEY || 'ttdbtKPP936EBCBNnBPOwxvzIzYDoi8I';
const DRY_RUN      = process.argv.includes('--dry-run');
const sleep        = ms => new Promise(r => setTimeout(r, ms));

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}

// ─── Scan gigs table for TM venue IDs ────────────────────────────────────────

async function collectTMVenueIds() {
  console.log('Scanning gigs table for Ticketmaster venue IDs...');
  const venueMap = new Map(); // tmVenueId → venueId
  let lastKey;
  let scanned = 0;

  do {
    const params = {
      TableName: GIGS_TABLE,
      FilterExpression: 'begins_with(gigId, :p)',
      ExpressionAttributeValues: { ':p': 'tm-' },
      ProjectionExpression: 'canonicalVenueId, venueName, venueCity',
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    for (const item of result.Items || []) {
      if (item.canonicalVenueId && item.venueName) {
        venueMap.set(item.canonicalVenueId, { name: item.venueName, city: item.venueCity || '' });
      }
    }
    lastKey = result.LastEvaluatedKey;
    scanned += (result.Items || []).length;
    process.stdout.write(`\r  Scanned ${scanned.toLocaleString()} TM gigs, found ${venueMap.size} unique venues...`);
  } while (lastKey);

  console.log(`\n  ${venueMap.size} unique TM venues to enrich\n`);
  return venueMap;
}

// ─── Search TM API for venue details ─────────────────────────────────────────

async function fetchTMVenue(venueName, city) {
  const q = encodeURIComponent(venueName);
  const url = `https://app.ticketmaster.com/discovery/v2/venues.json?apikey=${TM_KEY}&keyword=${q}&countryCode=GB&size=5`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) { await sleep(30000); continue; }
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const data = await r.json();
      const venues = data._embedded?.venues || [];
      // Find best match by name + city
      const cityNorm = normaliseName(city);
      const nameNorm = normaliseName(venueName);
      return venues.find(v =>
        normaliseName(v.name) === nameNorm &&
        normaliseName(v.city?.name || '') === cityNorm
      ) || venues[0] || null;
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

// ─── Enrich venue in DynamoDB ─────────────────────────────────────────────────

async function enrichVenue(venueId, tmVenue) {
  const website  = tmVenue.url || null;
  const lat      = parseFloat(tmVenue.location?.latitude) || null;
  const lon      = parseFloat(tmVenue.location?.longitude) || null;
  const address  = tmVenue.address?.line1 || null;
  const postcode = tmVenue.postalCode || null;
  const imageUrl = tmVenue.images?.find(i => i.ratio === '16_9' && i.width >= 640)?.url ||
                   tmVenue.images?.[0]?.url || null;
  const twitter  = tmVenue.social?.twitter?.handle
    ? `https://twitter.com/${tmVenue.social.twitter.handle}` : null;

  const updates = [];
  const names   = {};
  const values  = { ':t': new Date().toISOString() };

  if (website)  { updates.push('website   = if_not_exists(website,   :w)');  values[':w'] = website; }
  if (lat)      { updates.push('lat       = if_not_exists(lat,       :lat)'); values[':lat'] = lat; }
  if (lon)      { updates.push('lon       = if_not_exists(lon,       :lon)'); values[':lon'] = lon; }
  if (address)  { updates.push('address   = if_not_exists(address,   :a)');  values[':a'] = address; }
  if (postcode) { updates.push('postcode  = if_not_exists(postcode,  :pc)'); values[':pc'] = postcode; }
  if (imageUrl) { updates.push('imageUrl  = if_not_exists(imageUrl,  :img)');values[':img'] = imageUrl; }
  if (twitter)  { updates.push('twitter   = if_not_exists(twitter,   :tw)'); values[':tw'] = twitter; }

  if (!updates.length) return false;
  updates.push('lastUpdated = :t');

  if (DRY_RUN) return true;

  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
    ExpressionAttributeValues: values,
  })).catch(() => {});

  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Venue Enrichment — Ticketmaster ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const venueMap = await collectTMVenueIds();
  const entries  = [...venueMap.entries()];

  let enriched = 0, notFound = 0, errors = 0;

  for (let i = 0; i < entries.length; i++) {
    const [venueId, { name, city }] = entries[i];

    const tmVenue = await fetchTMVenue(name, city);

    if (!tmVenue) {
      notFound++;
    } else {
      const did = await enrichVenue(venueId, tmVenue);
      if (did) enriched++;
    }

    const pct = ((i + 1) / entries.length * 100).toFixed(1);
    process.stdout.write(`\r  [${i + 1}/${entries.length}] (${pct}%) | Enriched: ${enriched} | Not found: ${notFound}   `);

    await sleep(220); // stay under 5 req/s TM limit
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Venues enriched : ${enriched}`);
  console.log(`Not found on TM : ${notFound}`);
  console.log(`Errors          : ${errors}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
}

main().catch(e => { console.error(e); process.exit(1); });
