#!/usr/bin/env node
/**
 * Phase 1 supplement — Seed gigradar-venues with UK venues from Skiddle API
 *
 * Skiddle specialises in UK grassroots venues and returns venue website URLs
 * directly in their event API response. We paginate through all UK live music
 * events (past year + upcoming year) to collect every unique venue.
 *
 * Usage (from project root):
 *   node scripts/seed-venues-skiddle.cjs
 *   node scripts/seed-venues-skiddle.cjs --dry-run
 */

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                              = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const SKIDDLE_KEY  = process.env.SKIDDLE_KEY || '4e0a7a6dacf5930b9bf39ece1f9b456f';
const VENUES_TABLE = 'gigradar-venues';
const CACHE_FILE   = path.join(__dirname, 'venues-skiddle.json');
const DRY_RUN      = process.argv.includes('--dry-run');
const sleep        = ms => new Promise(r => setTimeout(r, ms));

// ─── Helpers (same as scraper) ───────────────────────────────────────────────

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}
function toVenueSlug(name, city) {
  const slugify = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return city ? `${slugify(city)}-${slugify(name)}` : slugify(name);
}

// ─── Fetch all UK events from Skiddle and collect unique venues ───────────────

async function collectVenuesFromEvents() {
  const venueMap = new Map(); // skiddle venue id → venue object
  const today    = new Date().toISOString().split('T')[0];
  const yearAgo  = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];
  const yearAhead = new Date(Date.now() + 365 * 864e5).toISOString().split('T')[0];

  // Two passes: upcoming events + past year events
  const passes = [
    { label: 'upcoming', startdate: today,   enddate: yearAhead },
    { label: 'past',     startdate: yearAgo, enddate: today     },
  ];

  for (const pass of passes) {
    console.log(`\nFetching ${pass.label} events...`);
    let page  = 1;
    let total = 1;

    while (page <= Math.ceil(total / 100) && page <= 100) {
      try {
        const url = `https://www.skiddle.com/api/v1/events/search/?api_key=${SKIDDLE_KEY}` +
          `&country=GB&eventcode=LIVE&startdate=${pass.startdate}&enddate=${pass.enddate}` +
          `&limit=100&page=${page}&order=date`;

        const res  = await fetch(url, { headers: { 'User-Agent': 'GigRadar/1.0 (venue seeding)' } });

        if (res.status === 429) {
          console.log('  Rate limited — waiting 10s...');
          await sleep(10000);
          continue;
        }
        if (!res.ok) { console.error(`  HTTP ${res.status} on page ${page}`); break; }

        const data   = await res.json();
        total        = parseInt(data?.totalcount || '1', 10);
        const events = data?.results || [];
        if (!events.length) break;

        for (const ev of events) {
          const v = ev.venue;
          if (!v?.id || !v?.name) continue;
          if (venueMap.has(v.id)) continue;

          venueMap.set(v.id, {
            skiddleId: v.id,
            name:      v.name,
            city:      v.town || v.location || '',
            address:   v.address || '',
            postcode:  v.postcode || '',
            website:   v.website  || null,
            facebook:  null, // not in event response
            lat:       parseFloat(v.lat)  || null,
            lon:       parseFloat(v.long) || null,
            skiddleUrl: v.link || null,
          });
        }

        process.stdout.write(`\r  Page ${page}/${Math.ceil(total/100)} — ${venueMap.size} unique venues so far`);
        page++;
        await sleep(400); // stay well within rate limit
      } catch (e) {
        console.error(`\n  Error on page ${page}:`, e.message);
        break;
      }
    }
    console.log(''); // newline after progress
  }

  return [...venueMap.values()];
}

// ─── For venues still missing a website, try the Skiddle venue detail API ────

async function enrichWithVenueDetails(venues) {
  const noWebsite = venues.filter(v => !v.website && v.skiddleId);
  if (!noWebsite.length) return venues;
  console.log(`\nFetching venue details for ${noWebsite.length} venues without websites...`);

  // Skiddle allows up to 20 venue IDs per request
  const chunks = [];
  for (let i = 0; i < noWebsite.length; i += 20) chunks.push(noWebsite.slice(i, i + 20));

  let enriched = 0;
  for (const chunk of chunks) {
    try {
      const ids = chunk.map(v => `venue_ids[]=${v.skiddleId}`).join('&');
      const url = `https://www.skiddle.com/api/v1/venues/?api_key=${SKIDDLE_KEY}&${ids}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'GigRadar/1.0' } });
      if (res.status === 429) { await sleep(10000); continue; }
      if (!res.ok) continue;
      const data = await res.json();
      for (const detail of (data?.results || [])) {
        const v = noWebsite.find(x => x.skiddleId === String(detail.id));
        if (!v) continue;
        if (detail.website) { v.website = detail.website; enriched++; }
        if (detail.facebook && !v.facebook) v.facebook = detail.facebook;
        if (detail.twitter)  v.twitter  = detail.twitter;
        if (detail.description) v.description = detail.description;
      }
    } catch (e) { console.error('Venue detail error:', e.message); }
    await sleep(400);
    process.stdout.write(`\r  Enriched ${enriched} websites so far`);
  }
  console.log('');
  return venues;
}

// ─── Load existing DynamoDB venues ───────────────────────────────────────────

async function loadExistingVenues() {
  const existing = new Map();
  let lastKey;
  do {
    const params = { TableName: VENUES_TABLE };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    for (const item of (result.Items || [])) existing.set(item.venueId, item);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return existing;
}

// ─── Upsert to DynamoDB ───────────────────────────────────────────────────────

async function upsertVenue(venue) {
  const venueId = toVenueId(venue.name, venue.city);
  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId },
    UpdateExpression: `SET #n        = if_not_exists(#n,        :n),
                           city       = if_not_exists(city,       :c),
                           slug       = if_not_exists(slug,       :s),
                           isActive   = if_not_exists(isActive,   :a),
                           upcoming   = if_not_exists(upcoming,   :u),
                           website    = if_not_exists(website,    :w),
                           facebook   = if_not_exists(facebook,   :fb),
                           skiddleId  = if_not_exists(skiddleId,  :sid),
                           skiddleUrl = if_not_exists(skiddleUrl, :surl),
                           lat        = if_not_exists(lat,        :lat),
                           lon        = if_not_exists(lon,        :lon),
                           postcode   = if_not_exists(postcode,   :pc),
                           lastUpdated = :t`,
    ExpressionAttributeNames: { '#n': 'name' },
    ExpressionAttributeValues: {
      ':n':    venue.name,
      ':c':    venue.city      || '',
      ':s':    toVenueSlug(venue.name, venue.city),
      ':a':    true,
      ':u':    0,
      ':w':    venue.website   || null,
      ':fb':   venue.facebook  || null,
      ':sid':  venue.skiddleId || null,
      ':surl': venue.skiddleUrl || null,
      ':lat':  venue.lat       || null,
      ':lon':  venue.lon       || null,
      ':pc':   venue.postcode  || null,
      ':t':    new Date().toISOString(),
    },
  }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Venue Seeder — Skiddle ===\n');

  // Collect venues from events
  let venues = await collectVenuesFromEvents();
  console.log(`\nTotal unique Skiddle venues: ${venues.length}`);

  // Enrich with venue detail API for those missing websites
  venues = await enrichWithVenueDetails(venues);

  const withWebsite  = venues.filter(v => v.website).length;
  const withFacebook = venues.filter(v => v.facebook).length;
  console.log(`\nVenues with website  : ${withWebsite} / ${venues.length}`);
  console.log(`Venues with Facebook : ${withFacebook} / ${venues.length}`);

  // Save to JSON
  fs.writeFileSync(CACHE_FILE, JSON.stringify(venues, null, 2));
  console.log(`Saved to ${CACHE_FILE}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: skipping DynamoDB writes');
    console.log('\nSample venues:');
    venues.slice(0, 10).forEach(v =>
      console.log(`  ${v.name.padEnd(40)} ${(v.city||'').padEnd(20)} ${v.website || '(no website)'}`)
    );
    return;
  }

  // Load existing to report new vs updated
  const existing = await loadExistingVenues();
  let newCount = 0, updateCount = 0;

  console.log('\nWriting to DynamoDB...');
  for (const venue of venues) {
    if (!venue.name) continue;
    const venueId = toVenueId(venue.name, venue.city);
    if (existing.has(venueId)) updateCount++; else newCount++;
    await upsertVenue(venue);
    await sleep(15);
  }

  console.log(`\n✓ Done`);
  console.log(`  New venues created : ${newCount}`);
  console.log(`  Existing updated   : ${updateCount}`);
  console.log(`  Total              : ${venues.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
