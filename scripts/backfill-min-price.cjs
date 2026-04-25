/**
 * backfill-min-price.cjs
 *
 * Scans all gigs, parses the price string from tickets[0].price,
 * and writes a numeric minPrice field for filtering/sorting.
 *
 * Examples: "£15" → 15, "£15–£25" → 15, "$20" → 20, "£12.50" → 12.5
 *
 * Usage:
 *   node scripts/backfill-min-price.cjs --dry-run
 *   node scripts/backfill-min-price.cjs --live
 */
'use strict';

const path = require('path');
const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                      = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb      = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const GIGS     = 'gigradar-gigs';
const DRY_RUN  = !process.argv.includes('--live');
const sleep    = ms => new Promise(r => setTimeout(r, ms));

function parseMinPrice(priceStr) {
  if (!priceStr || priceStr === 'See site' || priceStr === 'Free') return null;
  // Strip currency symbols and extract first number
  const m = priceStr.replace(/[£$€]/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isNaN(n) ? null : n;
}

async function main() {
  console.log(`=== Backfill minPrice ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

  let lastKey;
  let total = 0, updated = 0, skipped = 0;

  do {
    const params = {
      TableName: GIGS,
      ProjectionExpression: 'gigId, tickets, minPrice',
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    const items = r.Items || [];
    lastKey = r.LastEvaluatedKey;
    total += items.length;

    for (const gig of items) {
      if (gig.minPrice != null) { skipped++; continue; }
      const priceStr = gig.tickets?.[0]?.price;
      const minPrice = parseMinPrice(priceStr);
      if (minPrice == null) { skipped++; continue; }

      if (!DRY_RUN) {
        await ddb.send(new UpdateCommand({
          TableName: GIGS,
          Key: { gigId: gig.gigId },
          UpdateExpression: 'SET minPrice = :p',
          ExpressionAttributeValues: { ':p': minPrice },
        })).catch(() => {});
        await sleep(10);
      }
      updated++;
    }

    process.stdout.write(`\r  Scanned: ${total.toLocaleString()} | Updated: ${updated.toLocaleString()} | Skipped: ${skipped.toLocaleString()}   `);
  } while (lastKey);

  console.log(`\n\n=== Complete ===`);
  console.log(`Total gigs scanned : ${total.toLocaleString()}`);
  console.log(`minPrice added     : ${updated.toLocaleString()}`);
  console.log(`Already set/no price: ${skipped.toLocaleString()}`);
  if (DRY_RUN) console.log('\nRe-run with --live to apply.');
}

main().catch(e => { console.error(e); process.exit(1); });
