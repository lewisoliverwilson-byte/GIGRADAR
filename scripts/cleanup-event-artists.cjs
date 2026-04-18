#!/usr/bin/env node
/**
 * Cleanup script: removes artist records that are actually event titles, not real artists.
 *
 * Targets artists that:
 *   - Have no imageUrl (never found on Deezer/Spotify)
 *   - Have ≤1 upcoming gig
 *   - Name matches event title patterns (Presents:, @ venue, 3+ acts via +, too long, festival)
 *
 * Usage:
 *   node scripts/cleanup-event-artists.cjs --dry-run    (preview only)
 *   node scripts/cleanup-event-artists.cjs              (delete for real)
 */

'use strict';

const path = require('path');
const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                         = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand }     = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb    = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const DRY    = process.argv.includes('--dry-run');
const sleep  = ms => new Promise(r => setTimeout(r, ms));

const ARTISTS_TABLE = 'gigradar-artists';

function isEventTitle(name) {
  if (!name) return false;
  const n = name.trim();
  if (n.length > 60) return true;
  if (/\bpresents[:\-]/i.test(n)) return true;
  if (/ @ /.test(n)) return true;
  if (/\bfestival\b/i.test(n)) return true;
  if ((n.match(/ \+ /g) || []).length >= 2) return true;
  return false;
}

async function main() {
  console.log(`=== Cleanup Event-Title Artists${DRY ? ' [DRY RUN]' : ''} ===\n`);

  const candidates = [];
  let lastKey;
  do {
    const params = {
      TableName: ARTISTS_TABLE,
      FilterExpression: '(attribute_not_exists(imageUrl) OR imageUrl = :n) AND (attribute_not_exists(upcoming) OR upcoming <= :one)',
      ExpressionAttributeValues: { ':n': null, ':one': 1 },
      ProjectionExpression: 'artistId, #nm, upcoming',
      ExpressionAttributeNames: { '#nm': 'name' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    for (const item of (r.Items || [])) {
      if (isEventTitle(item.name)) candidates.push(item);
    }
    lastKey = r.LastEvaluatedKey;
    process.stdout.write(`\r  Scanned... ${candidates.length} candidates found`);
  } while (lastKey);

  console.log(`\n\nFound ${candidates.length} event-title artists to remove.\n`);

  if (candidates.length === 0) { console.log('Nothing to do.'); return; }

  console.log('Sample (first 20):');
  candidates.slice(0, 20).forEach(a => console.log(`  [${a.upcoming ?? 0} gigs] ${a.name}`));

  if (DRY) { console.log('\n[DRY RUN] No deletions made.'); return; }

  console.log('\nDeleting...');
  let deleted = 0;
  for (const artist of candidates) {
    await ddb.send(new DeleteCommand({ TableName: ARTISTS_TABLE, Key: { artistId: artist.artistId } })).catch(() => {});
    deleted++;
    if (deleted % 100 === 0) process.stdout.write(`\r  Deleted ${deleted}/${candidates.length}`);
    await sleep(20);
  }
  console.log(`\n\nDone. Deleted ${deleted} event-title artist records.`);
}

main().catch(console.error);
