#!/usr/bin/env node
/**
 * GigRadar — Infer gig genres from co-performers
 *
 * For gigs that still have no genres (their artist has no genres),
 * looks at all other artists playing the same venue on the same date.
 * If any co-performer has genres, copies them to the ungenred gig.
 *
 * This is a best-effort inference — genres are tagged as inferred.
 *
 * Usage:
 *   node scripts/infer-gig-genres-from-coperformers.cjs
 *   node scripts/infer-gig-genres-from-coperformers.cjs --dry-run
 */
'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb          = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const GIGS_TABLE   = 'gigradar-gigs';
const ARTISTS_TABLE= 'gigradar-artists';
const DRY_RUN      = process.argv.includes('--dry-run');
const today        = new Date().toISOString().split('T')[0];
const sleep        = ms => new Promise(r => setTimeout(r, ms));

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
  console.log('=== Infer Gig Genres from Co-performers ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // Load all future gigs
  console.log('Loading future gigs...');
  const allGigs = await scanAll({
    TableName: GIGS_TABLE,
    ProjectionExpression: 'gigId, artistId, canonicalVenueId, #d, genres',
    ExpressionAttributeNames: { '#d': 'date' },
    FilterExpression: '#d >= :today AND attribute_exists(canonicalVenueId)',
    ExpressionAttributeValues: { ':today': today },
  });
  console.log(`  ${allGigs.length.toLocaleString()} future gigs with a venue\n`);

  // Split into ungenred and genred
  const ungenred = allGigs.filter(g => !g.genres?.length);
  const genred   = allGigs.filter(g => g.genres?.length > 0);
  console.log(`  Ungenred gigs: ${ungenred.length.toLocaleString()}`);
  console.log(`  Genred gigs  : ${genred.length.toLocaleString()}\n`);

  // Build lookup: "venueId|date" → genres[]
  // Multiple gigs at same venue+date may have different genres — union them
  const venueDate2Genres = new Map();
  for (const g of genred) {
    const key = `${g.canonicalVenueId}|${g.date}`;
    const existing = venueDate2Genres.get(key) || new Set();
    for (const genre of g.genres) existing.add(genre);
    venueDate2Genres.set(key, existing);
  }
  console.log(`  ${venueDate2Genres.size.toLocaleString()} unique venue+date combos with genres\n`);

  // For each ungenred gig, check if co-performers have genres
  let updated = 0, skipped = 0;
  const CONCURRENCY = 5;
  const queue = [...ungenred];

  async function processGig(g) {
    const key = `${g.canonicalVenueId}|${g.date}`;
    const genreSet = venueDate2Genres.get(key);
    if (!genreSet || genreSet.size === 0) { skipped++; return; }

    const inferredGenres = [...genreSet].slice(0, 5);

    if (!DRY_RUN) {
      await ddb.send(new UpdateCommand({
        TableName: GIGS_TABLE,
        Key: { gigId: g.gigId },
        UpdateExpression: 'SET genres = :g, genresInferred = :t',
        ConditionExpression: 'attribute_not_exists(genres) OR size(genres) = :z',
        ExpressionAttributeValues: { ':g': inferredGenres, ':t': true, ':z': 0 },
      })).catch(() => {});
    }
    updated++;
  }

  console.log(`Processing ${ungenred.length.toLocaleString()} ungenred gigs...`);
  let i = 0;
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(batch.map(processGig));
    i += batch.length;
    if (i % 500 === 0 || queue.length === 0) {
      process.stdout.write(`\r  [${i}/${ungenred.length}] Updated: ${updated} | No co-performer data: ${skipped}   `);
    }
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Gigs updated with inferred genres: ${updated.toLocaleString()}`);
  console.log(`Gigs skipped (no co-performer data): ${skipped.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written]');
}

main().catch(e => { console.error(e); process.exit(1); });
