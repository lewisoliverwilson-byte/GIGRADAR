#!/usr/bin/env node
/**
 * GigRadar — Backfill genre onto gigs from artist record
 *
 * Scans every gig that has no genre set, looks up the artist's genres,
 * and writes them onto the gig. Single biggest lever for genre coverage.
 *
 * Usage:
 *   node scripts/backfill-gig-genres.cjs
 *   node scripts/backfill-gig-genres.cjs --dry-run
 *   node scripts/backfill-gig-genres.cjs --future-only   (only upcoming gigs)
 */

'use strict';

const path = require('path');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                                  = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const ARTISTS_TABLE  = 'gigradar-artists';
const GIGS_TABLE     = 'gigradar-gigs';
const DRY_RUN        = process.argv.includes('--dry-run');
const FUTURE_ONLY    = process.argv.includes('--future-only');
const CONCURRENCY    = 20;
const today          = new Date().toISOString().split('T')[0];

// Cache artist genres so we only fetch each artist once
const artistCache = new Map();

async function getArtistGenres(artistId) {
  if (artistCache.has(artistId)) return artistCache.get(artistId);
  try {
    const r = await ddb.send(new GetCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      ProjectionExpression: 'genres',
    }));
    const genres = r.Item?.genres || [];
    artistCache.set(artistId, genres);
    return genres;
  } catch {
    artistCache.set(artistId, []);
    return [];
  }
}

async function loadGigsWithoutGenre() {
  console.log(`Scanning gigs table for records without genre${FUTURE_ONLY ? ' (future only)' : ''}...`);
  const gigs = [];
  let lastKey;
  let page = 0;
  do {
    const p = {
      TableName: GIGS_TABLE,
      FilterExpression: 'attribute_not_exists(genre) OR genre = :empty',
      ExpressionAttributeValues: { ':empty': [] },
      ProjectionExpression: 'gigId, artistId, #d',
      ExpressionAttributeNames: { '#d': 'date' },
    };
    if (FUTURE_ONLY) {
      p.FilterExpression += ' AND #d >= :today';
      p.ExpressionAttributeValues[':today'] = today;
    }
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p)).catch(() => ({ Items: [] }));
    gigs.push(...(r.Items || []).filter(g => g.artistId));
    lastKey = r.LastEvaluatedKey;
    page++;
    if (page % 5 === 0) process.stdout.write(`\r  ${gigs.length.toLocaleString()} gigs loaded...`);
  } while (lastKey);
  console.log(`\r  ${gigs.length.toLocaleString()} gigs need genre backfill`);
  return gigs;
}

async function processBatch(batch) {
  return Promise.all(batch.map(async gig => {
    const genres = await getArtistGenres(gig.artistId);
    if (!genres.length) return { skipped: true };

    if (!DRY_RUN) {
      await ddb.send(new UpdateCommand({
        TableName: GIGS_TABLE,
        Key: { gigId: gig.gigId },
        UpdateExpression: 'SET genre = :g, lastUpdated = :t',
        ConditionExpression: 'attribute_not_exists(genre) OR genre = :empty',
        ExpressionAttributeValues: { ':g': genres, ':empty': [], ':t': new Date().toISOString() },
      })).catch(() => {}); // ignore ConditionCheckFailedException
    }
    return { updated: true, genres };
  }));
}

async function main() {
  console.log('=== GigRadar Genre Backfill — Gigs from Artists ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const gigs = await loadGigsWithoutGenre();
  if (!gigs.length) { console.log('Nothing to do!'); return; }

  let updated = 0, skipped = 0, i = 0;

  while (i < gigs.length) {
    const batch = gigs.slice(i, i + CONCURRENCY);
    const results = await processBatch(batch);
    for (const r of results) {
      if (r.updated) updated++;
      else skipped++;
    }
    i += batch.length;

    const pct = Math.round(i / gigs.length * 100);
    process.stdout.write(`\r  ${i.toLocaleString()}/${gigs.length.toLocaleString()} (${pct}%) — ${updated.toLocaleString()} updated, ${skipped.toLocaleString()} skipped (no artist genres)`);
  }

  console.log(`\n\nDone!`);
  console.log(`  Updated: ${updated.toLocaleString()} gigs`);
  console.log(`  Skipped: ${skipped.toLocaleString()} (artist has no genres yet)`);
  console.log(`  Artists cached: ${artistCache.size.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — no DB writes made]');
}

main().catch(e => { console.error(e); process.exit(1); });
