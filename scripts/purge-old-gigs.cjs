#!/usr/bin/env node
/**
 * GigRadar — Purge past gigs
 *
 * Deletes gig records older than CUTOFF_DAYS from the gigs table.
 * Leaves recent past gigs (default: last 30 days) in case of late scrapers.
 *
 * Usage:
 *   node scripts/purge-old-gigs.cjs
 *   node scripts/purge-old-gigs.cjs --dry-run
 *   node scripts/purge-old-gigs.cjs --days 60
 */

'use strict';

const path = require('path');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const GIGS_TABLE  = 'gigradar-gigs';
const DRY_RUN     = process.argv.includes('--dry-run');
const sleep       = ms => new Promise(r => setTimeout(r, ms));

const daysIdx = process.argv.indexOf('--days');
const CUTOFF_DAYS = daysIdx !== -1 ? parseInt(process.argv[daysIdx + 1], 10) : 30;

function getCutoffDate() {
  const d = new Date();
  d.setDate(d.getDate() - CUTOFF_DAYS);
  return d.toISOString().split('T')[0];
}

async function batchDelete(keys) {
  // DynamoDB BatchWrite: max 25 items per request
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [GIGS_TABLE]: chunk.map(k => ({ DeleteRequest: { Key: k } })),
      },
    })).catch(e => console.error('  Batch delete error:', e.message));
    if (i + 25 < keys.length) await sleep(50);
  }
}

async function main() {
  const cutoff = getCutoffDate();
  console.log(`=== Purge Old Gigs ===`);
  console.log(`Cutoff: ${cutoff} (gigs older than ${CUTOFF_DAYS} days)`);
  if (DRY_RUN) console.log('[DRY RUN — no deletes]\n');
  else console.log();

  let lastKey;
  let scanned = 0;
  let toDelete = [];
  let deleted  = 0;

  do {
    const params = {
      TableName: GIGS_TABLE,
      ProjectionExpression: 'gigId, #d',
      ExpressionAttributeNames: { '#d': 'date' },
      FilterExpression: '#d < :cutoff',
      ExpressionAttributeValues: { ':cutoff': cutoff },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const r = await ddb.send(new ScanCommand(params));
    for (const item of (r.Items || [])) {
      toDelete.push({ gigId: item.gigId });
      scanned++;
    }
    lastKey = r.LastEvaluatedKey;

    // Delete in chunks as we scan to avoid huge in-memory accumulation
    if (toDelete.length >= 500) {
      if (!DRY_RUN) await batchDelete(toDelete);
      deleted += toDelete.length;
      toDelete = [];
    }

    process.stdout.write(`\r  Scanned ${scanned.toLocaleString()} old gigs to delete...`);
  } while (lastKey);

  // Final flush
  if (toDelete.length > 0) {
    if (!DRY_RUN) await batchDelete(toDelete);
    deleted += toDelete.length;
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Gigs ${DRY_RUN ? 'found' : 'deleted'}: ${deleted.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing deleted]');
}

main().catch(e => { console.error(e); process.exit(1); });
