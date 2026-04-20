#!/usr/bin/env node
/**
 * GigRadar Facebook Events Scraper
 *
 * Fetches public events from Facebook Pages for venues in gigradar-venues
 * that have a facebookPageId set.
 *
 * Requirements:
 *   - A Facebook User Access Token (from developers.facebook.com)
 *   - The token needs pages_read_engagement permission for non-owned pages,
 *     which requires Facebook App Review. For pages you own/admin, a basic
 *     User Token works immediately.
 *
 * How to get a token (no App Review needed for basic access):
 *   1. Go to https://developers.facebook.com/tools/explorer/
 *   2. Select your app (or create a free one)
 *   3. Click "Generate Access Token"
 *   4. Add permissions: pages_read_engagement (if available without review)
 *   5. Copy the token
 *
 * Note: For full venue page events access, apply for pages_read_engagement
 * via App Review at developers.facebook.com. This is the major unlock for
 * pub/grassroots gig data on Facebook.
 *
 * Usage:
 *   FB_TOKEN=xxxx node scripts/scrape-facebook-events.cjs
 *   FB_TOKEN=xxxx node scripts/scrape-facebook-events.cjs --dry-run
 *   FB_TOKEN=xxxx node scripts/scrape-facebook-events.cjs --resume
 *   FB_TOKEN=xxxx node scripts/scrape-facebook-events.cjs --token xxxx
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                                  = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand, ScanCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'facebook-progress.json');

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}

const DRY_RUN  = process.argv.includes('--dry-run');
const RESUME   = process.argv.includes('--resume');
const FB_TOKEN = process.env.FB_TOKEN || arg('--token');
const sleep    = ms => new Promise(r => setTimeout(r, ms));

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toArtistId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}

const JUNK_WORDS = /^(tbc|tba|various artists?|support act|special guest|doors?|support|presents?|featuring|feat\.?|ft\.?|live music|open mic|dj set|resident dj|club night|tickets?|event|evening with|night of|a night|the night)$/i;

function isValidArtist(name) {
  if (!name || name.length < 2 || name.length > 100) return false;
  if (JUNK_WORDS.test(name.trim())) return false;
  if (/^\d+$|^[^a-z]+$/i.test(name.trim())) return false;
  return true;
}

function extractArtistFromTitle(title) {
  if (!title) return null;
  let name = title
    .replace(/\s*[-–:]\s*(live|tour|at |presents|concert|tickets?|evening|night|show).*/i, '')
    .replace(/\s*@\s*.+$/, '')
    .replace(/\s*\+\s*.+$/, '')
    .replace(/\|.+$/, '')
    .trim();
  return name.length >= 2 && name.length <= 80 ? name : null;
}

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { processedVenues: [], gigs: 0, artists: 0 };
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p)); }

// ─── Load venues with Facebook page IDs ──────────────────────────────────────

async function loadVenuesWithFacebook() {
  console.log('Loading venues with Facebook page IDs from DynamoDB...');
  const venues = [];
  let lastKey;
  do {
    const params = {
      TableName: VENUES_TABLE,
      FilterExpression: 'attribute_exists(facebookPageId)',
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    venues.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  console.log(`  ${venues.length} venues with Facebook page IDs\n`);
  return venues;
}

// ─── Auto-seed artist ─────────────────────────────────────────────────────────

const seededArtists = new Set();

async function autoSeedArtist(name) {
  if (!isValidArtist(name)) return null;
  const artistId = toArtistId(name);
  if (!artistId || artistId.length < 2) return null;
  if (DRY_RUN) return { artistId, name };
  if (!seededArtists.has(artistId)) {
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: `SET #n = if_not_exists(#n, :n),
        isGrassroots = if_not_exists(isGrassroots, :gr),
        country = if_not_exists(country, :c),
        genres  = if_not_exists(genres,  :g),
        upcoming = if_not_exists(upcoming, :u),
        lastUpdated = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': name, ':gr': true, ':c': 'UK', ':g': [], ':u': 0, ':t': new Date().toISOString() },
    })).catch(() => {});
    seededArtists.add(artistId);
  }
  return { artistId, name };
}

// ─── Fetch Facebook page events ───────────────────────────────────────────────

async function fetchPageEvents(pageId) {
  const fields = 'id,name,start_time,place,ticket_uri,is_canceled';
  const since  = Math.floor(Date.now() / 1000);
  const until  = Math.floor((Date.now() + 365 * 864e5) / 1000);
  const url    = `${GRAPH_BASE}/${pageId}/events?fields=${fields}&since=${since}&until=${until}&limit=100&access_token=${FB_TOKEN}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url);
      const data = await r.json();

      if (data.error) {
        const code = data.error.code;
        // 10 = permissions, 100 = invalid param, 190 = expired token
        if (code === 190) {
          console.error('\n  Facebook token expired — please generate a new one at developers.facebook.com/tools/explorer/');
          process.exit(1);
        }
        if (code === 10 || code === 200) {
          // Permission error — this page needs App Review
          return { events: [], permissionError: true };
        }
        return { events: [], permissionError: false };
      }

      return { events: data.data || [], permissionError: false, nextCursor: data.paging?.cursors?.after };
    } catch (e) {
      if (attempt === 3) return { events: [], permissionError: false };
      await sleep(2000 * attempt);
    }
  }
  return { events: [], permissionError: false };
}

// ─── Process Facebook events for a venue ─────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

async function processVenueEvents(venue, events, gigsSaved) {
  let newGigs = 0, newArtists = 0;

  for (const ev of events) {
    if (ev.is_canceled) continue;
    const date = (ev.start_time || '').split('T')[0];
    if (!date || date < today) continue;

    const artistName = extractArtistFromTitle(ev.name);
    if (!artistName) continue;

    const artist = await autoSeedArtist(artistName);
    if (!artist) continue;

    const gigId = `fb-${ev.id}`;
    if (gigsSaved.has(gigId)) continue;

    const gig = {
      gigId,
      artistId:         artist.artistId,
      artistName:       artist.name,
      date,
      doorsTime:        ev.start_time?.split('T')[1]?.substring(0, 5) || null,
      venueName:        venue.name,
      venueCity:        venue.city || '',
      venueCountry:     'GB',
      canonicalVenueId: venue.venueId || toVenueId(venue.name, venue.city),
      isSoldOut:        false,
      minAge:           null,
      supportActs:      [],
      tickets: [{
        seller:    'Facebook',
        url:       ev.ticket_uri || `https://www.facebook.com/${venue.facebookPageId}/events`,
        available: true,
        price:     'See site',
      }],
      sources:     ['facebook'],
      lastUpdated: new Date().toISOString(),
    };

    if (!DRY_RUN) {
      await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig }))
        .catch(e => console.error(`  Gig save error ${gig.gigId}:`, e.message));
    }
    gigsSaved.add(gigId);
    newGigs++;
    if (!seededArtists.has(artist.artistId)) newArtists++;
  }

  return { newGigs, newArtists };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!FB_TOKEN) {
    console.error('Error: Facebook access token required.');
    console.error('');
    console.error('  How to get a token:');
    console.error('  1. Go to https://developers.facebook.com/tools/explorer/');
    console.error('  2. Create a free app (or use existing)');
    console.error('  3. Click "Generate Access Token"');
    console.error('  4. Copy token and run:');
    console.error('     FB_TOKEN=xxxx node scripts/scrape-facebook-events.cjs');
    console.error('');
    console.error('  Note: For full venue coverage, apply for pages_read_engagement');
    console.error('  permission via App Review at developers.facebook.com');
    process.exit(1);
  }

  console.log('=== GigRadar Facebook Events Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const venues = await loadVenuesWithFacebook();

  if (venues.length === 0) {
    console.log('No venues with Facebook page IDs found.');
    console.log('Facebook page IDs are discovered when scraping venue websites (source 3).');
    console.log('Run scrape-venue-gigs.cjs with --source website after getting website URLs via Google Places.');
    return;
  }

  const progress    = loadProgress();
  const processed   = new Set(progress.processedVenues || []);
  const gigsSaved   = new Set();
  const toProcess   = RESUME ? venues.filter(v => !processed.has(v.venueId)) : venues;

  console.log(`Processing ${toProcess.length} venues\n`);

  let totalGigs = 0, totalArtists = 0, permErrors = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const venue = toProcess[i];
    const pageId = venue.facebookPageId;
    if (!pageId) continue;

    const { events, permissionError } = await fetchPageEvents(pageId);

    if (permissionError) {
      permErrors++;
    } else {
      const { newGigs, newArtists } = await processVenueEvents(venue, events, gigsSaved);
      totalGigs    += newGigs;
      totalArtists += newArtists;
    }

    processed.add(venue.venueId);

    if (i % 25 === 0 || i === toProcess.length - 1) {
      if (!DRY_RUN) saveProgress({ processedVenues: [...processed], gigs: totalGigs, artists: totalArtists });
      const pct = ((i + 1) / toProcess.length * 100).toFixed(1);
      process.stdout.write(
        `\r  Venue ${i + 1}/${toProcess.length} (${pct}%) | Gigs: ${totalGigs.toLocaleString()} | Permission errors: ${permErrors}   `
      );
    }

    await sleep(300);
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Gigs saved      : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded  : ${totalArtists.toLocaleString()}`);
  console.log(`Permission errors: ${permErrors} venues (need App Review for full access)`);
  if (permErrors > 0) {
    console.log('\n  To fix permission errors:');
    console.log('  → Apply for pages_read_engagement at https://developers.facebook.com/docs/pages/access-tokens');
  }
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
