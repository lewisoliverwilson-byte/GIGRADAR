'use strict';
const path = require('path');
const SDK = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient } = require(path.join(SDK, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand } = require(path.join(SDK, '@aws-sdk/lib-dynamodb'));
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

async function count(table, filter, vals, names) {
  let total = 0, lastKey;
  do {
    const p = { TableName: table, Select: 'COUNT' };
    if (filter) p.FilterExpression = filter;
    if (vals)   p.ExpressionAttributeValues = vals;
    if (names)  p.ExpressionAttributeNames  = names;
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p)).catch(e => { console.error(table, e.message); return { Count: 0 }; });
    total += r.Count || 0;
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return total;
}

(async () => {
  const today = new Date().toISOString().split('T')[0];
  console.log('Counting records in DynamoDB...\n');
  const [venues, activeVenues, artists, withImage, gigs, upcoming] = await Promise.all([
    count('gigradar-venues'),
    count('gigradar-venues', 'isActive = :a', { ':a': true }),
    count('gigradar-artists'),
    count('gigradar-artists', 'attribute_exists(imageUrl)'),
    count('gigradar-gigs'),
    count('gigradar-gigs', '#d >= :t', { ':t': today }, { '#d': 'date' }),
  ]);
  console.log('Venues (total)   :', venues.toLocaleString());
  console.log('Venues (active)  :', activeVenues.toLocaleString());
  console.log('Artists (total)  :', artists.toLocaleString());
  console.log('Artists w/ image :', withImage.toLocaleString());
  console.log('Gigs (total)     :', gigs.toLocaleString());
  console.log('Gigs (upcoming)  :', upcoming.toLocaleString());
})();
