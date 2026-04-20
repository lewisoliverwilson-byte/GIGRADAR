#!/usr/bin/env node
/**
 * GigRadar Venue Enrichment — MusicBrainz Places
 *
 * Queries MusicBrainz for UK venues to get official website URLs,
 * Wikidata links, and capacity data for notable venues.
 *
 * Rate limit: 1 req/sec (MusicBrainz policy)
 *
 * Usage:
 *   node scripts/enrich-venues-musicbrainz.cjs
 *   node scripts/enrich-venues-musicbrainz.cjs --dry-run
 */

'use strict';

const path = require('path');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                                  = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand }              = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE = 'gigradar-venues';
const DRY_RUN      = process.argv.includes('--dry-run');
const sleep        = ms => new Promise(r => setTimeout(r, ms));

const MB_HEADERS = {
  'User-Agent': 'GigRadar/1.0 (gigradar.co.uk)',
  'Accept': 'application/json',
};

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}

// ─── Load venues from DynamoDB that don't have a website yet ─────────────────

async function loadVenuesWithoutWebsite() {
  console.log('Loading venues without website from DynamoDB...');
  const venues = [];
  let lastKey;
  do {
    const params = {
      TableName: VENUES_TABLE,
      FilterExpression: 'attribute_not_exists(website) OR website = :null',
      ExpressionAttributeValues: { ':null': null },
      ProjectionExpression: 'venueId, #n, city',
      ExpressionAttributeNames: { '#n': 'name' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    venues.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  console.log(`  ${venues.length.toLocaleString()} venues without website\n`);
  return venues;
}

// ─── Search MusicBrainz for a venue ──────────────────────────────────────────

async function searchMBPlace(name, city) {
  const query = encodeURIComponent(`place:"${name}" AND country:GB`);
  const url   = `https://musicbrainz.org/ws/2/place/?query=${query}&limit=5&fmt=json`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: MB_HEADERS });
      if (r.status === 503) { await sleep(5000 * attempt); continue; }
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const data = await r.json();
      const places = data.places || [];

      // Find best match by name
      const nameNorm = normaliseName(name);
      const cityNorm = normaliseName(city);
      return places.find(p => {
        const pName = normaliseName(p.name);
        const pCity = normaliseName(p.area?.name || '');
        return pName === nameNorm && (!cityNorm || pCity === cityNorm);
      }) || places.find(p => normaliseName(p.name) === nameNorm) || null;
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

// ─── Fetch place details including URL relations ──────────────────────────────

async function fetchMBPlaceDetails(mbid) {
  const url = `https://musicbrainz.org/ws/2/place/${mbid}?inc=url-rels&fmt=json`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: MB_HEADERS });
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      return await r.json();
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

function extractWebsite(place) {
  const relations = place.relations || [];
  // Prefer official homepage, then any website
  const official = relations.find(r => r.type === 'official homepage');
  if (official) return official.url?.resource || null;
  const website  = relations.find(r => r.url?.resource?.match(/^https?:\/\/(?!(?:www\.)?(facebook|twitter|instagram|wikipedia))/));
  return website?.url?.resource || null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Venue Enrichment — MusicBrainz ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const venues  = await loadVenuesWithoutWebsite();
  let enriched = 0, notFound = 0;

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    if (!venue.name) continue;

    const place = await searchMBPlace(venue.name, venue.city || '');
    await sleep(1100); // MusicBrainz: 1 req/sec

    if (!place) { notFound++; continue; }

    const details = await fetchMBPlaceDetails(place.id);
    await sleep(1100);

    if (!details) { notFound++; continue; }

    const website  = extractWebsite(details);
    const capacity = details.capacity || null;

    if (!website && !capacity) { notFound++; continue; }

    if (!DRY_RUN) {
      const updates = ['lastUpdated = :t'];
      const values  = { ':t': new Date().toISOString() };
      if (website)  { updates.push('website  = if_not_exists(website,  :w)'); values[':w'] = website; }
      if (capacity) { updates.push('capacity = if_not_exists(capacity, :c)'); values[':c'] = capacity; }

      await ddb.send(new UpdateCommand({
        TableName: VENUES_TABLE,
        Key: { venueId: venue.venueId },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeValues: values,
      })).catch(() => {});
    }

    enriched++;
    process.stdout.write(`\r  [${i + 1}/${venues.length}] Enriched: ${enriched} | Not found: ${notFound}   `);
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Venues enriched : ${enriched}`);
  console.log(`Not found on MB : ${notFound}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
}

main().catch(e => { console.error(e); process.exit(1); });
