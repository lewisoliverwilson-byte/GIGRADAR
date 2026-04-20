#!/usr/bin/env node
/**
 * GigRadar — Denormalise genres onto gig records
 *
 * 1. Scans gigradar-artists for all artists with non-empty genres
 * 2. For each such artist, queries the date-index GSI to find their gigs
 * 3. Batch-updates each gig with genres from the artist record
 *
 * Usage:
 *   node scripts/update-gig-genres.cjs
 *   node scripts/update-gig-genres.cjs --dry-run
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }          = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const GIGS_TABLE    = 'gigradar-gigs';
const ARTISTS_TABLE = 'gigradar-artists';
const PROGRESS_FILE = path.join(__dirname, 'update-gig-genres-progress.json');

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const today   = new Date().toISOString().split('T')[0];
const sleep   = ms => new Promise(r => setTimeout(r, ms));

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); } catch {}
  }
  return new Set();
}
function saveProgress(done) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done])); }

async function main() {
  console.log('=== Denormalise Genres onto Gigs ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // ── Step 1: Scan artists with genres ────────────────────────────────────────
  console.log('Loading artists with genres...');
  const artistGenres = new Map(); // artistId → string[]
  let lastKey;
  do {
    const p = {
      TableName: ARTISTS_TABLE,
      ProjectionExpression: 'artistId, genres',
      FilterExpression: 'attribute_exists(genres)',
    };
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p));
    for (const a of (r.Items || [])) {
      if (a.genres?.length) artistGenres.set(a.artistId, a.genres);
    }
    lastKey = r.LastEvaluatedKey;
    process.stdout.write(`\r  Scanned ${artistGenres.size.toLocaleString()} artists with genres...`);
  } while (lastKey);
  console.log(`\n  ${artistGenres.size.toLocaleString()} artists with genres.\n`);

  // ── Step 2: For each artist, find & update their gigs ────────────────────────
  // The gigs table has artistId as a field but we need to find gigs by artistId.
  // Since the GSI is date-index (HASH=date), we need to scan with a filter,
  // OR use a local approach: scan gigs once and group by artistId.

  console.log('Scanning all future gigs and grouping by artistId...');
  const gigsByArtist = new Map(); // artistId → [{gigId, date}]
  lastKey = undefined;
  let totalGigs = 0;
  do {
    const p = {
      TableName: GIGS_TABLE,
      ProjectionExpression: 'gigId, artistId, #d',
      ExpressionAttributeNames: { '#d': 'date' },
      FilterExpression: '#d >= :today AND attribute_exists(artistId)',
      ExpressionAttributeValues: { ':today': today },
    };
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p));
    for (const gig of (r.Items || [])) {
      if (!artistGenres.has(gig.artistId)) continue; // skip artists without genres
      if (!gigsByArtist.has(gig.artistId)) gigsByArtist.set(gig.artistId, []);
      gigsByArtist.get(gig.artistId).push(gig.gigId);
      totalGigs++;
    }
    lastKey = r.LastEvaluatedKey;
    process.stdout.write(`\r  Scanned gigs, found ${totalGigs.toLocaleString()} to update...`);
  } while (lastKey);
  console.log(`\n  ${totalGigs.toLocaleString()} gigs across ${gigsByArtist.size.toLocaleString()} artists need genre updates.\n`);

  // ── Step 3: Update gigs ─────────────────────────────────────────────────────
  const done = loadProgress();
  console.log('Updating gig records...');
  let updated = 0, skipped = 0;
  const allArtists = [...gigsByArtist.entries()];

  for (let i = 0; i < allArtists.length; i++) {
    const [artistId, gigIds] = allArtists[i];
    if (done.has(artistId)) { skipped += gigIds.length; continue; }

    const genres = artistGenres.get(artistId);
    for (const gigId of gigIds) {
      if (!DRY_RUN) {
        await ddb.send(new UpdateCommand({
          TableName: GIGS_TABLE,
          Key: { gigId },
          UpdateExpression: 'SET genres = :g, lastUpdated = :t',
          ExpressionAttributeValues: { ':g': genres, ':t': new Date().toISOString() },
        })).catch(() => {});
      }
      updated++;
    }

    done.add(artistId);
    if (!DRY_RUN && (i + 1) % 200 === 0) saveProgress(done);

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r  [${i + 1}/${allArtists.length}] ${updated.toLocaleString()} gigs updated...`);
    }
  }

  if (!DRY_RUN) saveProgress(done);
  console.log(`\r  ${updated.toLocaleString()} gigs updated.                          `);

  console.log('\n=== Complete ===');
  console.log(`Gigs updated  : ${updated.toLocaleString()}`);
  console.log(`Artists done  : ${allArtists.length.toLocaleString()}`);
}

main().catch(console.error);
