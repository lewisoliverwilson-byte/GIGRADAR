#!/usr/bin/env node
/**
 * GigRadar — Derive venue genres from their gigs
 *
 * For each venue, tallies up all the genres from upcoming gigs played there,
 * picks the top 5, and writes them to the venue record as `genres`.
 *
 * Usage:
 *   node scripts/enrich-venues-genres.cjs
 *   node scripts/enrich-venues-genres.cjs --dry-run
 */
'use strict';

const path = require('path');
const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb        = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const GIGS_TABLE = 'gigradar-gigs';
const VENUES_TABLE = 'gigradar-venues';
const DRY_RUN    = process.argv.includes('--dry-run');
const today      = new Date().toISOString().split('T')[0];

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
  console.log('=== Enrich Venue Genres ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  console.log('Loading future gigs with genres and canonicalVenueId...');
  const gigs = await scanAll({
    TableName: GIGS_TABLE,
    ProjectionExpression: 'canonicalVenueId, genres, #d',
    ExpressionAttributeNames: { '#d': 'date' },
    FilterExpression: '#d >= :today AND attribute_exists(canonicalVenueId) AND attribute_exists(genres)',
    ExpressionAttributeValues: { ':today': today },
  });
  console.log(`  ${gigs.length.toLocaleString()} gigs with genres\n`);

  // Tally genres per venue
  const venueGenreCounts = new Map();
  for (const g of gigs) {
    if (!g.canonicalVenueId || !g.genres?.length) continue;
    if (!venueGenreCounts.has(g.canonicalVenueId)) venueGenreCounts.set(g.canonicalVenueId, new Map());
    const counts = venueGenreCounts.get(g.canonicalVenueId);
    for (const genre of g.genres) counts.set(genre, (counts.get(genre) || 0) + 1);
  }
  console.log(`  ${venueGenreCounts.size.toLocaleString()} venues with genre data\n`);

  let updated = 0;
  const CONCURRENCY = 10;
  const entries = [...venueGenreCounts.entries()];

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async ([venueId, counts]) => {
      const topGenres = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([g]) => g);

      if (!DRY_RUN) {
        await ddb.send(new UpdateCommand({
          TableName: VENUES_TABLE,
          Key: { venueId },
          UpdateExpression: 'SET genres = :g, lastUpdated = :t',
          ExpressionAttributeValues: { ':g': topGenres, ':t': new Date().toISOString() },
        })).catch(() => {});
      }
      updated++;
    }));

    if ((i + CONCURRENCY) % 500 === 0 || i + CONCURRENCY >= entries.length) {
      process.stdout.write(`\r  Updated ${updated.toLocaleString()}/${entries.length.toLocaleString()} venues...`);
    }
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Venues updated with genres: ${updated.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written]');
}

main().catch(e => { console.error(e); process.exit(1); });
