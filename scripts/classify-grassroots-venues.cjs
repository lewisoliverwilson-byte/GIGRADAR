#!/usr/bin/env node
/**
 * GigRadar — Classify Grassroots Venues
 *
 * Classifies venues as grassroots based on:
 *   1. Capacity <= 1500 (UK Music Venue Trust standard)
 *   2. Venue name keywords (pub, bar, arts centre, etc.)
 *   3. Known large venues excluded (arenas, stadiums, etc.)
 *
 * Writes isGrassroots: true/false to every venue, then propagates
 * to gigs via canonicalVenueId.
 *
 * Usage:
 *   node scripts/classify-grassroots-venues.cjs
 *   node scripts/classify-grassroots-venues.cjs --dry-run
 */
'use strict';

const path = require('path');
const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb         = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const VENUES_TABLE = 'gigradar-venues';
const GIGS_TABLE   = 'gigradar-gigs';
const DRY_RUN      = process.argv.includes('--dry-run');

// Keywords that strongly suggest grassroots (matched on lowercase name)
const GRASSROOTS_KEYWORDS = [
  'pub', 'bar', 'tavern', 'inn', 'arms', 'ale house', 'alehouse',
  'arts centre', 'arts center', 'art centre', 'art center',
  'social club', 'working mens', "working men's",
  'community centre', 'community center', 'community hall',
  'village hall', 'town hall',
  'rehearsal', 'studio',
  'cellar', 'basement',
  'café', 'cafe',
  'record shop', 'record store',
  'bowling', 'snooker',
  'working club', 'miners', 'legion',
  'jazz club', 'jazz bar',
  'comedy club',
  'folk club',
  'music venue', 'music hall',
  'night club', 'nightclub',
  'the loft', 'the attic', 'the basement', 'the vault',
  'exchange', 'junction', 'junction',
  'rescue rooms', 'bodega', 'brudenell', 'gorilla', 'deaf institute',
  'soup kitchen', 'yes (', '(yes)', 'yes manchester',
  'shipping forecast', 'jimmy\'s', 'brudnell',
  'sticky mike', 'hope and ruin', 'prince albert',
  'hare and hounds', 'castle and falcon', 'the night owl',
  'nine bar', '1865',
];

// Keywords that strongly indicate NOT grassroots (arenas, stadiums, etc.)
const NOT_GRASSROOTS_KEYWORDS = [
  'arena', 'stadium', 'amphitheatre', 'amphitheater',
  'national bowl', 'crystal palace park',
  'o2 arena', 'utilita arena', 'co-op live', 'ao arena',
  'wembley', 'hyde park', 'victoria park',
  'racecourse', 'cricket ground', 'football ground',
  'motorpoint', 'first direct arena',
  'sse arena', 'sse hydro', 'ovo hydro',
  'glasgow sse', 'manchester arena', 'genting arena',
  'resorts world arena', 'bp summer stage',
];

// Capacity thresholds
const GRASSROOTS_MAX_CAPACITY  = 1500;
const DEFINITELY_NOT_GRASSROOTS = 5000;

function isGrassrootsVenue(venue) {
  const name = (venue.name || '').toLowerCase();
  const cap  = venue.capacity;

  // Explicit exclusions — large venues
  if (NOT_GRASSROOTS_KEYWORDS.some(k => name.includes(k))) return false;
  if (cap && cap >= DEFINITELY_NOT_GRASSROOTS) return false;

  // Capacity-based classification (most reliable)
  if (cap && cap <= GRASSROOTS_MAX_CAPACITY) return true;
  if (cap && cap > GRASSROOTS_MAX_CAPACITY) return false;

  // Keyword-based (no capacity data)
  if (GRASSROOTS_KEYWORDS.some(k => name.includes(k))) return true;

  return false;
}

async function scanAll(params) {
  const items = [];
  let lastKey;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params));
    items.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function main() {
  console.log('=== Classify Grassroots Venues ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  console.log('Loading venues...');
  const venues = await scanAll({
    TableName: VENUES_TABLE,
    ProjectionExpression: 'venueId, #n, #c, isGrassroots',
    ExpressionAttributeNames: { '#n': 'name', '#c': 'capacity' },
  });
  console.log(`  ${venues.length.toLocaleString()} venues loaded\n`);

  const toMark    = venues.filter(v => isGrassrootsVenue(v));
  const toUnmark  = venues.filter(v => !isGrassrootsVenue(v) && v.isGrassroots === true);

  console.log(`Grassroots venues found : ${toMark.length.toLocaleString()}`);
  console.log(`Previously marked, now clearing: ${toUnmark.length}`);
  console.log('\nSample grassroots venues:');
  toMark.slice(0, 15).forEach(v => console.log(`  ${v.name} (cap: ${v.capacity || 'unknown'})`));
  console.log('');

  if (DRY_RUN) return;

  // Write isGrassroots to venues
  console.log('Writing isGrassroots to venues...');
  const allToUpdate = [
    ...toMark.map(v => ({ venueId: v.venueId, isGrassroots: true })),
    ...toUnmark.map(v => ({ venueId: v.venueId, isGrassroots: false })),
  ];

  const CONCURRENCY = 20;
  let done = 0;
  for (let i = 0; i < allToUpdate.length; i += CONCURRENCY) {
    const batch = allToUpdate.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(({ venueId, isGrassroots }) =>
      ddb.send(new UpdateCommand({
        TableName: VENUES_TABLE,
        Key: { venueId },
        UpdateExpression: 'SET isGrassroots = :g, lastUpdated = :t',
        ExpressionAttributeValues: { ':g': isGrassroots, ':t': new Date().toISOString() },
      })).catch(() => {})
    ));
    done += batch.length;
    process.stdout.write(`\r  ${done}/${allToUpdate.length} venues updated`);
  }
  console.log('\n  Done.\n');

  // Build set of grassroots venue IDs
  const grassrootsIds = new Set(toMark.map(v => v.venueId));

  // Propagate to gigs
  console.log('Loading gigs to propagate isGrassroots...');
  const today = new Date().toISOString().split('T')[0];
  const gigs = await scanAll({
    TableName: GIGS_TABLE,
    ProjectionExpression: 'gigId, canonicalVenueId',
    FilterExpression: '#d >= :today AND attribute_exists(canonicalVenueId)',
    ExpressionAttributeNames: { '#d': 'date' },
    ExpressionAttributeValues: { ':today': today },
  });
  console.log(`  ${gigs.length.toLocaleString()} future gigs loaded`);

  const gigsToMark   = gigs.filter(g => grassrootsIds.has(g.canonicalVenueId));
  const gigsToUnmark = gigs.filter(g => g.canonicalVenueId && !grassrootsIds.has(g.canonicalVenueId));
  console.log(`  Marking ${gigsToMark.length.toLocaleString()} gigs as grassroots`);
  console.log(`  Clearing ${gigsToUnmark.length.toLocaleString()} gigs`);

  const gigUpdates = [
    ...gigsToMark.map(g => ({ gigId: g.gigId, val: true })),
    ...gigsToUnmark.map(g => ({ gigId: g.gigId, val: false })),
  ];

  let gigsDone = 0;
  for (let i = 0; i < gigUpdates.length; i += CONCURRENCY) {
    const batch = gigUpdates.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(({ gigId, val }) =>
      ddb.send(new UpdateCommand({
        TableName: GIGS_TABLE,
        Key: { gigId },
        UpdateExpression: 'SET #ig = :g',
        ExpressionAttributeNames: { '#ig': '_isGrassroots' },
        ExpressionAttributeValues: { ':g': val },
      })).catch(() => {})
    ));
    gigsDone += batch.length;
    if (gigsDone % 1000 === 0 || gigsDone === gigUpdates.length)
      process.stdout.write(`\r  ${gigsDone.toLocaleString()}/${gigUpdates.length.toLocaleString()} gigs updated`);
  }
  console.log('\n');

  console.log('=== Complete ===');
  console.log(`Grassroots venues : ${toMark.length.toLocaleString()}`);
  console.log(`Grassroots gigs   : ${gigsToMark.length.toLocaleString()}`);
}

main().catch(e => { console.error(e); process.exit(1); });
