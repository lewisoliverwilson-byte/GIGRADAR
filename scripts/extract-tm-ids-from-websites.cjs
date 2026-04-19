#!/usr/bin/env node
/**
 * Extracts Ticketmaster venue IDs from the website field where the stored
 * "website" is actually a Ticketmaster venue URL (e.g. ticketmaster.co.uk/venue/452833).
 * Saves the extracted ID to tmVenueId and clears the website field.
 */
'use strict';
const path = require('path');
const SDK = p => require(path.join(__dirname, '../lambda/scraper/node_modules', p));
const { DynamoDBClient } = SDK('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = SDK('@aws-sdk/lib-dynamodb');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE = 'gigradar-venues';

(async () => {
  const all = [];
  let lastKey;
  do {
    const params = {
      TableName: TABLE,
      FilterExpression: 'contains(website, :tm)',
      ExpressionAttributeValues: { ':tm': 'ticketmaster' },
      ProjectionExpression: 'venueId, #n, website, tmVenueId',
      ExpressionAttributeNames: { '#n': 'name' }
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    all.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  console.log(`Found ${all.length} venues with ticketmaster website URLs`);
  let extracted = 0, skipped = 0;

  for (const v of all) {
    const m = v.website?.match(/\/venue\/(\d+)/);
    if (!m) { skipped++; continue; }
    const tmId = m[1];
    if (v.tmVenueId === tmId) { skipped++; continue; }

    // Save tmVenueId, clear website (it wasn't a real website)
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { venueId: v.venueId },
      UpdateExpression: 'SET tmVenueId = :tm REMOVE website',
      ExpressionAttributeValues: { ':tm': tmId },
    })).catch(e => console.error(`  ERR ${v.name}: ${e.message}`));

    console.log(`✓ ${v.name} → tmVenueId=${tmId}`);
    extracted++;
  }

  console.log(`\nDone. Extracted: ${extracted}, Skipped: ${skipped}`);
})();
