#!/usr/bin/env node
/**
 * Enriches every venue in DynamoDB with its Ticketmaster venue ID.
 * Run once (or periodically) to enable venue-direct TM event queries.
 *
 * Usage: TICKETMASTER_API_KEY=xxx node scripts/enrich-venues-tm-ids.cjs
 *    or: node scripts/enrich-venues-tm-ids.cjs --api-key xxx
 *
 * Writes: tmVenueId field to each gigradar-venues record
 */
'use strict';

const path = require('path');
const SDK  = p => require(path.join(__dirname, '../lambda/scraper/node_modules', p));

const { DynamoDBClient }                                    = SDK('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = SDK('@aws-sdk/lib-dynamodb');

const ddb    = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const argVal = flag => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; };
const TM_KEY = process.env.TICKETMASTER_API_KEY || argVal('--api-key');
const TABLE    = 'gigradar-venues';
const BATCH    = parseInt(process.env.BATCH_SIZE || '500', 10);
const DELAY_MS = 250; // ~4 req/s within TM rate limit

if (!TM_KEY) { console.error('TICKETMASTER_API_KEY not set'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}

function nameSim(a, b) {
  const na = normaliseName(a), nb = normaliseName(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Levenshtein distance / max length
  const la = na.length, lb = nb.length;
  if (!la || !lb) return 0;
  const dp = Array.from({ length: la + 1 }, (_, i) => [i]);
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++)
    for (let j = 1; j <= lb; j++)
      dp[i][j] = na[i-1] === nb[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return 1 - dp[la][lb] / Math.max(la, lb);
}

async function findTMVenueId(venueName, venueCity) {
  const keyword = venueCity ? `${venueName} ${venueCity}` : venueName;
  const url = `https://app.ticketmaster.com/discovery/v2/venues.json?keyword=${encodeURIComponent(keyword)}&countryCode=GB&size=5&apikey=${TM_KEY}`;
  try {
    const res = await fetch(url);
    if (res.status === 429) { await sleep(5000); return null; }
    if (!res.ok) return null;
    const data     = await res.json();
    const venues   = data?._embedded?.venues || [];
    if (!venues.length) return null;

    // Score each result: name similarity × city match bonus
    let best = null, bestScore = 0;
    for (const v of venues) {
      const tmCity  = (v.city?.name || '').toLowerCase();
      const ourCity = (venueCity || '').toLowerCase();
      const nameSc  = nameSim(venueName, v.name);
      const citySc  = ourCity && tmCity ? (tmCity.includes(ourCity) || ourCity.includes(tmCity) ? 0.2 : 0) : 0;
      const score   = nameSc + citySc;
      if (score > bestScore) { bestScore = score; best = v; }
    }
    // Only accept if name is at least 70% similar
    if (bestScore < 0.7) return null;
    return best?.id || null;
  } catch (e) {
    console.error(`TM lookup "${venueName}":`, e.message);
    return null;
  }
}

async function loadAllVenues() {
  const venues = [];
  let lastKey;
  do {
    const params = {
      TableName: TABLE,
      ProjectionExpression: 'venueId, #n, city, tmVenueId',
      ExpressionAttributeNames: { '#n': 'name' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(e => { console.error(e.message); return { Items: [] }; });
    venues.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return venues;
}

(async () => {
  console.log('Loading venues from DynamoDB…');
  const all    = await loadAllVenues();
  const todo   = all.filter(v => !v.tmVenueId && v.name).slice(0, BATCH);
  const alread = all.filter(v => v.tmVenueId).length;
  console.log(`Total: ${all.length}  Already enriched: ${alread}  To process: ${todo.length}`);

  let found = 0, notFound = 0;
  for (let i = 0; i < todo.length; i++) {
    const venue = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] ${venue.name} (${venue.city || '?'}) → `);
    const tmId = await findTMVenueId(venue.name, venue.city);
    if (tmId) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { venueId: venue.venueId },
        UpdateExpression: 'SET tmVenueId = :id',
        ExpressionAttributeValues: { ':id': tmId },
      })).catch(e => console.error(' DDB error:', e.message));
      console.log(`✓ ${tmId}`);
      found++;
    } else {
      console.log('not found');
      notFound++;
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. Found: ${found}  Not found: ${notFound}`);
})();
