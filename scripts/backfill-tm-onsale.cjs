/**
 * backfill-tm-onsale.cjs
 *
 * For existing Ticketmaster gigs without onSaleDate, fetches the TM event
 * detail to get the public sale start date, then stores it and updates
 * minPrice while we're at it.
 *
 * Processes upcoming TM gigs only (gigId starts with "tm-").
 * Rate: ~3 req/s (within TM's rate limit of ~5/s).
 *
 * Usage:
 *   node scripts/backfill-tm-onsale.cjs --dry-run
 *   node scripts/backfill-tm-onsale.cjs --live
 */
'use strict';

const path = require('path');
const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                      = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb     = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const GIGS    = 'gigradar-gigs';
const TM_KEY  = process.env.TM_API_KEY || 'VCBCnHJ5oWFmHqGRxJJPeECG49bSDkHN';
const DRY_RUN = !process.argv.includes('--live');
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const today   = new Date().toISOString().split('T')[0];

function currSym(c) { return c === 'GBP' ? '£' : c === 'USD' ? '$' : c === 'EUR' ? '€' : '£'; }

async function fetchTmEvent(tmId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://app.ticketmaster.com/discovery/v2/events/${tmId}.json?apikey=${TM_KEY}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 429) {
        const wait = parseInt(r.headers.get('Retry-After') || '30');
        await sleep(wait * 1000);
        continue;
      }
      if (!r.ok) return null;
      const ev = await r.json();
      if (ev.errors) return null;
      const onSaleDate = ev.sales?.public?.startDateTime?.split('T')[0] || null;
      const pr = ev.priceRanges?.[0];
      const minPrice = pr?.min != null ? pr.min : null;
      return { onSaleDate, minPrice };
    } catch {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

async function main() {
  console.log(`=== TM onSaleDate Backfill ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

  // Scan for TM gigs without onSaleDate, future only
  console.log('Loading TM gigs without onSaleDate...');
  const gigs = [];
  let lastKey;
  do {
    const params = {
      TableName: GIGS,
      FilterExpression: 'begins_with(gigId, :pfx) AND attribute_not_exists(onSaleDate) AND #d >= :today',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':pfx': 'tm-', ':today': today },
      ProjectionExpression: 'gigId, #d, minPrice, onSaleDate',
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    gigs.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
    process.stdout.write(`\r  Loaded: ${gigs.length.toLocaleString()}   `);
  } while (lastKey);
  console.log(`\n  ${gigs.length.toLocaleString()} TM gigs to update\n`);

  let updated = 0, noData = 0;

  for (let i = 0; i < gigs.length; i++) {
    const gig = gigs[i];
    const tmId = gig.gigId.replace(/^tm-/, '');
    const data = await fetchTmEvent(tmId);

    if (data && (data.onSaleDate || data.minPrice != null)) {
      if (!DRY_RUN) {
        const sets = [];
        const vals = {};
        if (data.onSaleDate)        { sets.push('onSaleDate = :d'); vals[':d'] = data.onSaleDate; }
        if (data.minPrice != null && gig.minPrice == null) { sets.push('minPrice = :p'); vals[':p'] = data.minPrice; }
        if (sets.length) {
          await ddb.send(new UpdateCommand({
            TableName: GIGS,
            Key: { gigId: gig.gigId },
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeValues: vals,
          })).catch(() => {});
        }
      }
      updated++;
    } else {
      noData++;
    }

    if (i % 50 === 0) {
      const pct = ((i + 1) / gigs.length * 100).toFixed(1);
      process.stdout.write(`\r  [${(i+1).toLocaleString()}/${gigs.length.toLocaleString()}] ${pct}% | Updated: ${updated} | No data: ${noData}   `);
    }

    await sleep(350); // ~3 req/s
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Updated  : ${updated.toLocaleString()}`);
  console.log(`No data  : ${noData.toLocaleString()}`);
  if (DRY_RUN) console.log('\nRe-run with --live to apply.');
}

main().catch(e => { console.error(e); process.exit(1); });
