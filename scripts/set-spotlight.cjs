#!/usr/bin/env node
/**
 * GigRadar — Set/Remove Venue Spotlight
 *
 * Run after confirming Stripe payment to activate a Spotlight badge.
 * Run with --remove to deactivate (cancellation, chargeback, non-renewal).
 *
 * Usage:
 *   node scripts/set-spotlight.cjs <venueId>
 *   node scripts/set-spotlight.cjs <venueId> --remove
 *
 * Steps to find venueId:
 *   - Open the venue page on GigRadar and check the URL slug
 *   - Or query DynamoDB: aws dynamodb scan --table-name gigradar-venues --filter-expression "slug = :s" ...
 */
'use strict';

const path = require('path');
const DDB_SDK = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }           = require(path.join(DDB_SDK, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, GetCommand, ScanCommand } = require(path.join(DDB_SDK, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE = 'gigradar-venues';

async function main() {
  const args    = process.argv.slice(2);
  const remove  = args.includes('--remove');
  const venueId = args.find(a => !a.startsWith('--'));

  if (!venueId) {
    console.error('Usage: node scripts/set-spotlight.cjs <venueId> [--remove]');
    process.exit(1);
  }

  // Verify venue exists
  const res = await ddb.send(new GetCommand({ TableName: VENUES_TABLE, Key: { venueId } }));
  if (!res.Item) {
    // Try lookup by slug
    const scan = await ddb.send(new ScanCommand({
      TableName: VENUES_TABLE,
      FilterExpression: 'slug = :s',
      ExpressionAttributeValues: { ':s': venueId },
    }));
    if (!scan.Items?.length) {
      console.error(`Venue not found: ${venueId}`);
      process.exit(1);
    }
    // Use the found venueId
    const found = scan.Items[0];
    return applySpotlight(found.venueId, found.name, remove);
  }

  return applySpotlight(venueId, res.Item.name, remove);
}

async function applySpotlight(venueId, venueName, remove) {
  const action = remove ? 'REMOVING' : 'SETTING';
  console.log(`${action} Spotlight for: ${venueName} (${venueId})`);

  if (remove) {
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: 'REMOVE isSpotlight SET spotlightRemovedAt = :t',
      ExpressionAttributeValues: { ':t': new Date().toISOString() },
    }));
    console.log('Done. Spotlight badge removed.');
  } else {
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: 'SET isSpotlight = :t, spotlightActivatedAt = :ts',
      ExpressionAttributeValues: { ':t': true, ':ts': new Date().toISOString() },
    }));
    console.log('Done. Spotlight badge activated.');
    console.log(`Check: https://gigradar.co.uk/venues/${venueId}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
