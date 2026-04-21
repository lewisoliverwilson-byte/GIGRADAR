#!/usr/bin/env node
/**
 * GigRadar Eventbrite Scraper
 *
 * Scrapes Eventbrite's public UK music browse pages (no API key needed).
 * Eventbrite removed their public search API in 2023, so we scrape
 * eventbrite.co.uk/d/united-kingdom/music--events/ directly.
 *
 * Usage:
 *   node scripts/scrape-eventbrite.cjs
 *   node scripts/scrape-eventbrite.cjs --dry-run
 *   node scripts/scrape-eventbrite.cjs --resume
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand }  = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'eb-progress.json');

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const QUICK   = process.argv.includes('--quick');  // limit to 5 pages per city
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// UK city slugs — Eventbrite new URL format: /b/{location}/music/
const UK_LOCATIONS = [
  'united-kingdom',          // broad sweep first
  'london--england',
  'manchester--england',
  'birmingham--england',
  'bristol--england',
  'leeds--england',
  'sheffield--england',
  'liverpool--england',
  'newcastle-upon-tyne--england',
  'edinburgh--scotland',
  'glasgow--scotland',
  'cardiff--wales',
  'nottingham--england',
  'brighton--england',
  'oxford--england',
  'cambridge--england',
  'bath--england',
  'bournemouth--england',
  'reading--england',
  'coventry--england',
  'hull--england',
  'exeter--england',
  'york--england',
  'norwich--england',
  'derby--england',
  'aberdeen--scotland',
  'dundee--scotland',
  'belfast--northern-ireland',
];

const EB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
function toArtistId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const JUNK_WORDS = /^(tbc|tba|various artists?|support act|special guest|doors?|support|presents?|featuring|feat\.?|ft\.?|live music|open mic|dj set|resident dj|club night|tickets?|event|evening with|night of|a night|the night)$/i;

function isValidArtist(name) {
  if (!name || name.length < 2 || name.length > 100) return false;
  if (JUNK_WORDS.test(name.trim())) return false;
  if (/^\d+$|^[^a-z]+$/i.test(name.trim())) return false;
  return true;
}

function extractArtist(title) {
  if (!title) return null;
  let name = title
    .replace(/\s*[-–:]\s*(live|tour|uk tour|at |presents|concert|tickets?|show|night|evening|in concert).*/i, '')
    .replace(/\s*@\s*.+$/, '')
    .replace(/\s*\+\s*(?:support|more|guests?|special).*/i, '')
    .replace(/\|.+$/, '')
    .trim();
  return name.length >= 2 && name.length <= 80 ? name : null;
}

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { completedLocations: {}, gigs: 0, artists: 0, venues: 0 };
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p)); }

// ─── Auto-seed helpers ────────────────────────────────────────────────────────

const seededArtists = new Set();
const seededVenues  = new Set();

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
        genres  = if_not_exists(genres, :g),
        upcoming = if_not_exists(upcoming, :u),
        lastUpdated = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': name, ':gr': false, ':c': 'UK', ':g': [], ':u': 0, ':t': new Date().toISOString() },
    })).catch(() => {});
    seededArtists.add(artistId);
  }
  return { artistId, name };
}

async function autoSeedVenue(name, city, lat, lon) {
  if (!name) return null;
  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;
  if (!seededVenues.has(venueId)) {
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: `SET #n = if_not_exists(#n, :n),
        city     = if_not_exists(city,     :c),
        slug     = if_not_exists(slug,     :s),
        isActive = if_not_exists(isActive, :a),
        upcoming = if_not_exists(upcoming, :u),
        lastUpdated = :t
        ${lat ? ', lat = if_not_exists(lat, :lat)' : ''}
        ${lon ? ', lon = if_not_exists(lon, :lon)' : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': toVenueSlug(name, city),
        ':a': true, ':u': 0, ':t': new Date().toISOString(),
        ...(lat ? { ':lat': lat } : {}),
        ...(lon ? { ':lon': lon } : {}),
      },
    })).catch(() => {});
    seededVenues.add(venueId);
  }
  return venueId;
}

// ─── Fetch Eventbrite page ────────────────────────────────────────────────────

async function fetchPage(location, page) {
  const url = `https://www.eventbrite.co.uk/b/${location}/music/?page=${page}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: EB_HEADERS });
      if (r.status === 429) { await sleep(30000); continue; }
      if (r.status === 404) return null;
      if (!r.ok) { await sleep(3000 * attempt); continue; }
      return await r.text();
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

// ─── Parse Eventbrite HTML ────────────────────────────────────────────────────

function parseEvents(html) {
  if (!html) return { events: [], hasMore: false };
  const events = [];

  // Eventbrite new browse pages use a single JSON-LD ItemList block
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ldMatch) {
    try {
      const data = JSON.parse(ldMatch[1]);
      // ItemList format: { itemListElement: [{ item: EventObject }, ...] }
      const listItems = data.itemListElement || [];
      for (const li of listItems) {
        const item = li.item || li;
        if (!item['@type'] || !['Event','MusicEvent'].includes(item['@type'])) continue;
        const loc     = item.location || {};
        const address = loc.address   || {};
        events.push({
          title:    item.name || '',
          venue:    loc.name  || '',
          city:     address.addressLocality || address.addressRegion || '',
          date:     (item.startDate || '').split('T')[0],
          doorsTime: null,
          url:      item.url || '',
          price:    item.isAccessibleForFree ? 'Free' : null,
          isFree:   item.isAccessibleForFree || false,
          lat:      parseFloat(loc.geo?.latitude)  || null,
          lon:      parseFloat(loc.geo?.longitude) || null,
        });
      }
    } catch {}
  }

  // Eventbrite returns exactly 8 events per page when more exist; fewer = last page
  const hasMore = events.length >= 8;

  return { events, hasMore };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Eventbrite Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const progress   = loadProgress();
  const completedL = progress.completedLocations || {};
  const gigsSaved  = new Set();
  const today      = new Date().toISOString().split('T')[0];

  let totalGigs = 0, totalArtists = 0, totalVenues = 0, errors = 0;

  for (let li = 0; li < UK_LOCATIONS.length; li++) {
    const location = UK_LOCATIONS[li];
    let startPage  = RESUME && completedL[location] ? completedL[location] + 1 : 1;
    let page       = startPage;
    let hasMore    = true;
    let locGigs    = 0;

    while (hasMore && page <= (QUICK ? 5 : 50)) {
      const html = await fetchPage(location, page);
      if (!html) { errors++; break; }

      const { events, hasMore: more } = parseEvents(html);
      hasMore = more;

      let pageNewGigs = 0;
      for (const ev of events) {
        if (!ev.date || ev.date < today) continue;

        const artistName = extractArtist(ev.title);
        if (!artistName) continue;

        const artist = await autoSeedArtist(artistName);
        if (!artist) continue;

        const canonicalVenueId = ev.venue
          ? await autoSeedVenue(ev.venue, ev.city, ev.lat, ev.lon)
          : null;

        const gigId = `eb-${normaliseName(artistName)}-${ev.date}-${normaliseName(ev.venue || 'tbc')}`;
        if (gigsSaved.has(gigId)) continue;

        const gig = {
          gigId,
          artistId:         artist.artistId,
          artistName:       artist.name,
          date:             ev.date,
          doorsTime:        ev.doorsTime || null,
          venueName:        ev.venue || 'TBC',
          venueCity:        ev.city  || '',
          venueCountry:     'GB',
          canonicalVenueId: canonicalVenueId || null,
          isSoldOut:        false,
          minAge:           null,
          supportActs:      [],
          tickets: [{
            seller:    'Eventbrite',
            url:       ev.url || 'https://www.eventbrite.co.uk',
            available: true,
            price:     ev.price || (ev.isFree ? 'Free' : 'See site'),
          }],
          sources:     ['eventbrite'],
          lastUpdated: new Date().toISOString(),
        };

        if (!DRY_RUN) {
          await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig }))
            .catch(e => console.error(`  Gig save error:`, e.message));
        }
        gigsSaved.add(gigId);
        locGigs++;
        pageNewGigs++;
        totalGigs++;
        totalArtists = seededArtists.size;
        totalVenues  = seededVenues.size;
      }

      completedL[location] = page;
      if (!DRY_RUN) saveProgress({ completedLocations: completedL, gigs: totalGigs, artists: totalArtists, venues: totalVenues });

      process.stdout.write(
        `\r  [${li + 1}/${UK_LOCATIONS.length}] ${location.substring(0, 30).padEnd(30)} p${page} — +${locGigs} gigs | Total: ${totalGigs.toLocaleString()} gigs, ${totalArtists} artists   `
      );

      if (events.length === 0 || pageNewGigs === 0) break;
      page++;
      await sleep(700);
    }
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Gigs saved     : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded : ${totalArtists.toLocaleString()}`);
  console.log(`Venues seeded  : ${totalVenues.toLocaleString()}`);
  console.log(`Errors         : ${errors}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
