#!/usr/bin/env node
/**
 * GigRadar — Update upcoming counts
 *
 * Scans the entire gigs table, counts future gigs per artistId and
 * canonicalVenueId, then batch-updates artist.upcoming and venue.upcoming.
 *
 * Usage:
 *   node scripts/update-upcoming-counts.cjs
 *   node scripts/update-upcoming-counts.cjs --dry-run
 */

'use strict';

const path = require('path');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }          = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const GIGS_TABLE    = 'gigradar-gigs';
const ARTISTS_TABLE = 'gigradar-artists';
const VENUES_TABLE  = 'gigradar-venues';

const DRY_RUN = process.argv.includes('--dry-run');
const today   = new Date().toISOString().split('T')[0];

async function main() {
  console.log('=== Update Upcoming Counts ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // ── Step 1: Scan all future gigs ────────────────────────────────────────────
  console.log('Scanning gigs table...');
  const artistCounts = new Map();
  const venueCounts  = new Map();

  let lastKey;
  let totalGigs = 0;
  do {
    const params = {
      TableName: GIGS_TABLE,
      ProjectionExpression: 'artistId, canonicalVenueId, #d',
      ExpressionAttributeNames: { '#d': 'date' },
      FilterExpression: '#d >= :today',
      ExpressionAttributeValues: { ':today': today },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const r = await ddb.send(new ScanCommand(params));
    for (const item of (r.Items || [])) {
      if (item.artistId) {
        artistCounts.set(item.artistId, (artistCounts.get(item.artistId) || 0) + 1);
      }
      if (item.canonicalVenueId) {
        venueCounts.set(item.canonicalVenueId, (venueCounts.get(item.canonicalVenueId) || 0) + 1);
      }
      totalGigs++;
    }
    lastKey = r.LastEvaluatedKey;
    process.stdout.write(`\r  Scanned ${totalGigs.toLocaleString()} future gigs...`);
  } while (lastKey);

  console.log(`\n  Done. ${artistCounts.size.toLocaleString()} artists, ${venueCounts.size.toLocaleString()} venues\n`);

  // ── Step 2: Update artist upcoming counts ────────────────────────────────────
  console.log('Updating artist upcoming counts...');
  let artistsDone = 0;
  const artistEntries = [...artistCounts.entries()];
  for (const [artistId, count] of artistEntries) {
    if (!DRY_RUN) {
      await ddb.send(new UpdateCommand({
        TableName: ARTISTS_TABLE,
        Key: { artistId },
        UpdateExpression: 'SET upcoming = :c, lastUpdated = :t',
        ExpressionAttributeValues: { ':c': count, ':t': new Date().toISOString() },
      })).catch(() => {});
    }
    artistsDone++;
    if (artistsDone % 500 === 0) {
      process.stdout.write(`\r  ${artistsDone.toLocaleString()}/${artistEntries.length.toLocaleString()} artists updated...`);
    }
  }
  console.log(`\r  ${artistsDone.toLocaleString()} artists updated.         `);

  // ── Step 3: Update venue upcoming counts ────────────────────────────────────
  console.log('Updating venue upcoming counts...');
  let venuesDone = 0;
  const venueEntries = [...venueCounts.entries()];
  for (const [venueId, count] of venueEntries) {
    if (!DRY_RUN) {
      await ddb.send(new UpdateCommand({
        TableName: VENUES_TABLE,
        Key: { venueId },
        UpdateExpression: 'SET upcoming = :c, lastUpdated = :t',
        ExpressionAttributeValues: { ':c': count, ':t': new Date().toISOString() },
      })).catch(() => {});
    }
    venuesDone++;
    if (venuesDone % 200 === 0) {
      process.stdout.write(`\r  ${venuesDone.toLocaleString()}/${venueEntries.length.toLocaleString()} venues updated...`);
    }
  }
  console.log(`\r  ${venuesDone.toLocaleString()} venues updated.          `);

  console.log('\n=== Complete ===');
  console.log(`Future gigs scanned : ${totalGigs.toLocaleString()}`);
  console.log(`Artists updated     : ${artistsDone.toLocaleString()}`);
  console.log(`Venues updated      : ${venuesDone.toLocaleString()}`);
}

main().catch(console.error);
