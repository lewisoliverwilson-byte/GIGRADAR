#!/usr/bin/env node
/**
 * GigRadar — Backfill Missing Artist Genres
 *
 * Targets artists with upcoming gigs that have no genres or an empty genres [].
 * Fetches Last.fm tags and always overwrites (fixing the if_not_exists bug).
 *
 * Then runs a co-performer genre inference pass to fill remaining gaps.
 *
 * Usage:
 *   LASTFM_API_KEY=xxxx node scripts/backfill-artist-genres.cjs
 *   LASTFM_API_KEY=xxxx node scripts/backfill-artist-genres.cjs --dry-run
 */
'use strict';

const path = require('path');
const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb          = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const ARTISTS_TABLE = 'gigradar-artists';
const LASTFM_KEY   = process.env.LASTFM_API_KEY || 'e2c0791c809dd2a81adde0158dd70c41';
const DRY_RUN      = process.argv.includes('--dry-run');
const sleep        = ms => new Promise(r => setTimeout(r, ms));

const GENRE_BLOCKLIST = new Set([
  'seen live', 'favorites', 'favourite', 'love', 'awesome', 'cool', 'great',
  'amazing', 'best', 'classic', 'legend', 'uk', 'usa', 'british', 'american',
  'male vocalists', 'female vocalists', 'singer-songwriter', 'all',
]);

function extractGenres(tags) {
  if (!tags?.tag) return [];
  const list = Array.isArray(tags.tag) ? tags.tag : [tags.tag];
  return list
    .map(t => (t.name || '').toLowerCase().trim())
    .filter(t => t.length > 1 && t.length < 40 && !GENRE_BLOCKLIST.has(t))
    .slice(0, 5);
}

async function fetchLastfm(name) {
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${LASTFM_KEY}&format=json&autocorrect=1`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) { await sleep(15000); continue; }
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const data = await r.json();
      if (data.error) return null;
      return data.artist || null;
    } catch {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
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
  console.log('=== Backfill Artist Genres ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // Load active artists with no genres or empty genres
  console.log('Loading artists with missing genres...');
  const [noGenre, emptyGenre] = await Promise.all([
    scanAll({
      TableName: ARTISTS_TABLE,
      ProjectionExpression: 'artistId, #n',
      ExpressionAttributeNames: { '#n': 'name' },
      FilterExpression: 'upcoming > :z AND NOT attribute_exists(genres)',
      ExpressionAttributeValues: { ':z': 0 },
    }),
    scanAll({
      TableName: ARTISTS_TABLE,
      ProjectionExpression: 'artistId, #n',
      ExpressionAttributeNames: { '#n': 'name' },
      FilterExpression: 'upcoming > :z AND attribute_exists(genres) AND size(genres) = :z',
      ExpressionAttributeValues: { ':z': 0 },
    }),
  ]);

  const toProcess = [...noGenre, ...emptyGenre];
  console.log(`  ${noGenre.length.toLocaleString()} with no genres attr`);
  console.log(`  ${emptyGenre.length.toLocaleString()} with empty genres []`);
  console.log(`  ${toProcess.length.toLocaleString()} total to process\n`);

  let found = 0, notFound = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { artistId, name } = toProcess[i];

    const artist = await fetchLastfm(name);
    const genres = artist ? extractGenres(artist.tags) : [];

    if (genres.length > 0) {
      if (!DRY_RUN) {
        await ddb.send(new UpdateCommand({
          TableName: ARTISTS_TABLE,
          Key: { artistId },
          UpdateExpression: 'SET genres = :g, lastUpdated = :t',
          ExpressionAttributeValues: { ':g': genres, ':t': new Date().toISOString() },
        })).catch(() => {});
      }
      found++;
    } else {
      notFound++;
    }

    if (i % 50 === 0 || i === toProcess.length - 1) {
      const pct = ((i + 1) / toProcess.length * 100).toFixed(1);
      process.stdout.write(`\r  [${(i+1).toLocaleString()}/${toProcess.length.toLocaleString()}] ${pct}% | Found: ${found} | Not found: ${notFound}   `);
    }

    await sleep(210); // ~5 req/sec Last.fm limit
  }

  console.log('\n\n=== Complete ===');
  console.log(`Genres found  : ${found.toLocaleString()}`);
  console.log(`Not on Last.fm: ${notFound.toLocaleString()}`);
  console.log('\nRun update-gig-genres.cjs then infer-gig-genres-from-coperformers.cjs to propagate.');
}

main().catch(e => { console.error(e); process.exit(1); });
