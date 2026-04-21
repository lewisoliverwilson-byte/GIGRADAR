#!/usr/bin/env node
/**
 * GigRadar Ticketmaster Scraper
 *
 * Uses the Ticketmaster Discovery API v2 to bulk-fetch all UK music events.
 * Writes gigs to gigradar-gigs, auto-seeds venues to gigradar-venues,
 * and auto-seeds artists to gigradar-artists.
 *
 * Free API key: https://developer.ticketmaster.com (register, get Consumer Key)
 * Rate limit: 5 req/s — we use 250ms delay, well within limits.
 * Daily limit: 5,000 calls — weekly ranges use ~10-50 calls/week = ~600-2600 total.
 *
 * Usage:
 *   TM_API_KEY=xxxx node scripts/scrape-ticketmaster.cjs
 *   TM_API_KEY=xxxx node scripts/scrape-ticketmaster.cjs --dry-run
 *   TM_API_KEY=xxxx node scripts/scrape-ticketmaster.cjs --resume
 *   TM_API_KEY=xxxx node scripts/scrape-ticketmaster.cjs --api-key xxxx
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                             = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand }         = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'tm-progress.json');
const CACHE_FILE    = path.join(__dirname, 'tm-gigs-cache.json');

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const QUICK   = process.argv.includes('--quick');  // only fetch next 4 weeks
const TM_KEY  = process.env.TM_API_KEY || arg('--api-key');
const sleep   = ms => new Promise(r => setTimeout(r, ms));

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
function dedupKey(artistId, date, venueName) {
  return `${artistId}|${date}|${normaliseName(venueName)}`;
}

const JUNK_WORDS = /^(tbc|tba|various artists?|support act|special guest|doors?|support|presents?|featuring|feat\.?|ft\.?|live music|open mic|dj set|resident dj|club night|tickets?|event|evening with|night of|a night|the night)$/i;
const JUNK_PATTERN = /^\d+$|^[^a-z]+$/i;

function isValidArtist(name) {
  if (!name || name.length < 2 || name.length > 100) return false;
  if (JUNK_WORDS.test(name.trim())) return false;
  if (JUNK_PATTERN.test(name.trim())) return false;
  return true;
}

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { completedWeeks: [], gigs: 0, artists: 0, venues: 0 };
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

// ─── Weekly date ranges ───────────────────────────────────────────────────────
// Splits date range into ISO week ranges to stay well under TM's 1,000 result cap

function weeklyRanges(startDate, endDate) {
  const ranges = [];
  const cur = new Date(startDate);
  const end = new Date(endDate);
  while (cur < end) {
    const from = cur.toISOString();
    cur.setDate(cur.getDate() + 7);
    const to = new Date(Math.min(cur, end)).toISOString();
    ranges.push({ from, to });
  }
  return ranges;
}

// ─── Ticketmaster API fetch ───────────────────────────────────────────────────

async function fetchTMPage(startDT, endDT, page) {
  // Strip milliseconds — TM rejects .000Z format
  const start = startDT.replace(/\.\d{3}Z$/, 'Z');
  const end   = endDT.replace(/\.\d{3}Z$/, 'Z');
  // Build URL manually — URLSearchParams encodes comma in sort=date,asc to %2C which TM rejects
  const urlStr = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(TM_KEY)}&countryCode=GB&classificationName=Music&size=200&page=${page}&startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&sort=date,asc`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(urlStr);
      if (r.status === 429) {
        console.log(`  Rate limited — waiting 30s...`);
        await sleep(30000);
        continue;
      }
      if (r.status === 401) {
        console.error('\n  401 Unauthorized — check your TM_API_KEY');
        process.exit(1);
      }
      if (!r.ok) {
        if (r.status === 400 && attempt === 1) {
          const body = await r.json().catch(() => ({}));
          console.error(`\n  400 error: ${JSON.stringify(body).substring(0, 200)}`);
        }
        await sleep(3000 * attempt);
        continue;
      }
      return await r.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(2000 * attempt);
    }
  }
  return null;
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
        country      = if_not_exists(country, :c),
        genres       = if_not_exists(genres,  :g),
        upcoming     = if_not_exists(upcoming, :u),
        lastUpdated  = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':gr': false, ':c': 'UK', ':g': [], ':u': 0,
        ':t': new Date().toISOString(),
      },
    })).catch(() => {});
    seededArtists.add(artistId);
  }
  return { artistId, name };
}

// ─── Auto-seed venue ──────────────────────────────────────────────────────────

const seededVenues = new Set();

async function autoSeedVenue(tmVenue) {
  const name = tmVenue.name || '';
  const city = tmVenue.city?.name || '';
  if (!name) return null;

  const venueId = toVenueId(name, city);
  if (DRY_RUN) return venueId;

  if (!seededVenues.has(venueId)) {
    const slug = toVenueSlug(name, city);
    const lat  = parseFloat(tmVenue.location?.latitude)  || null;
    const lon  = parseFloat(tmVenue.location?.longitude) || null;

    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId },
      UpdateExpression: `SET #n       = if_not_exists(#n,       :n),
        city        = if_not_exists(city,        :c),
        slug        = if_not_exists(slug,        :s),
        isActive    = if_not_exists(isActive,    :a),
        upcoming    = if_not_exists(upcoming,    :u),
        lastUpdated = :t
        ${lat ? ', lat = if_not_exists(lat, :lat)' : ''}
        ${lon ? ', lon = if_not_exists(lon, :lon)' : ''}
        ${tmVenue.postalCode ? ', postcode = if_not_exists(postcode, :pc)' : ''}
        ${tmVenue.address?.line1 ? ', address = if_not_exists(address, :addr)' : ''}`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': name, ':c': city, ':s': slug, ':a': true, ':u': 0,
        ':t': new Date().toISOString(),
        ...(lat  ? { ':lat': lat }  : {}),
        ...(lon  ? { ':lon': lon }  : {}),
        ...(tmVenue.postalCode        ? { ':pc':   tmVenue.postalCode }        : {}),
        ...(tmVenue.address?.line1    ? { ':addr': tmVenue.address.line1 }     : {}),
      },
    })).catch(() => {});
    seededVenues.add(venueId);
  }
  return venueId;
}

// ─── Parse events from TM response ───────────────────────────────────────────

async function parseEvents(events, gigsSaved, artistsSaved, venuesSaved) {
  let newGigs = 0, newArtists = 0, newVenues = 0;

  for (const ev of events) {
    // Venue
    const tmVenue = ev._embedded?.venues?.[0];
    if (!tmVenue?.name) continue;
    const city = tmVenue.city?.name || '';

    // Skip non-GB venues (sometimes TM returns nearby IE/NI with countryCode=GB)
    const country = tmVenue.country?.countryCode || '';
    if (country && country !== 'GB') continue;

    const canonicalVenueId = await autoSeedVenue(tmVenue);
    if (!canonicalVenueId) continue;
    if (!seededVenues.has(canonicalVenueId) || !venuesSaved.has(canonicalVenueId)) {
      newVenues++;
      venuesSaved.add(canonicalVenueId);
    }

    // Artist(s) — from _embedded.attractions
    const attractions = ev._embedded?.attractions || [];
    if (!attractions.length) {
      // Fall back to event name
      attractions.push({ name: ev.name });
    }

    const date = ev.dates?.start?.localDate;
    if (!date) continue;

    const doorsTime = ev.dates?.start?.localTime?.substring(0, 5) || null;
    const priceMin  = ev.priceRanges?.[0]?.min;
    const priceMax  = ev.priceRanges?.[0]?.max;
    const priceStr  = priceMin != null
      ? `£${priceMin}${priceMax && priceMax !== priceMin ? `–£${priceMax}` : ''}`
      : null;
    const isSoldOut = ev.dates?.status?.code === 'offsale' || ev.dates?.status?.code === 'cancelled';
    const venueName = tmVenue.name;

    // Headliner is first attraction
    const headliner = attractions[0];
    const artist = await autoSeedArtist(headliner.name);
    if (!artist) continue;
    if (!seededArtists.has(artist.artistId) || !artistsSaved.has(artist.artistId)) {
      newArtists++;
      artistsSaved.add(artist.artistId);
    }

    // Support acts
    const supportActs = [];
    for (const a of attractions.slice(1)) {
      if (isValidArtist(a.name)) supportActs.push(a.name);
      await autoSeedArtist(a.name);
    }

    const onSaleDate = ev.sales?.public?.startDateTime || null;

    const gig = {
      gigId:            `tm-${ev.id}`,
      artistId:         artist.artistId,
      artistName:       artist.name,
      date,
      doorsTime,
      venueName,
      venueCity:        city,
      venueCountry:     'GB',
      canonicalVenueId,
      isSoldOut,
      minAge:           null,
      supportActs,
      minPrice:         priceMin != null ? priceMin : null,
      onSaleDate,
      tickets: [{
        seller:    'Ticketmaster',
        url:       ev.url || 'https://www.ticketmaster.co.uk',
        available: !isSoldOut,
        price:     priceStr || 'See site',
      }],
      sources:     ['ticketmaster'],
      lastUpdated: new Date().toISOString(),
    };

    if (!DRY_RUN) {
      await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig }))
        .catch(e => console.error(`  Gig save error ${gig.gigId}:`, e.message));
    }
    gigsSaved.add(gig.gigId);
    newGigs++;
  }

  return { newGigs, newArtists, newVenues };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!TM_KEY) {
    console.error('Error: Ticketmaster API key required.');
    console.error('  Get a free key at https://developer.ticketmaster.com');
    console.error('  Usage: TM_API_KEY=xxxx node scripts/scrape-ticketmaster.cjs');
    console.error('     or: node scripts/scrape-ticketmaster.cjs --api-key xxxx');
    process.exit(1);
  }

  console.log('=== GigRadar Ticketmaster Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const progress    = loadProgress();
  const completedW  = new Set(progress.completedWeeks || []);
  const gigsSaved   = new Set();
  const artistsSaved = new Set();
  const venuesSaved  = new Set();

  // Quick mode: next 4 weeks only. Full mode: past 1 month + next 13 months.
  const start = new Date();
  if (!QUICK) { start.setMonth(start.getMonth() - 1); start.setDate(1); }
  const end = new Date();
  end.setDate(end.getDate() + (QUICK ? 28 : 0));
  if (!QUICK) { end.setMonth(end.getMonth() + 13); end.setDate(1); }

  const weeks = weeklyRanges(start.toISOString(), end.toISOString());
  console.log(`Date range: ${start.toISOString().split('T')[0]} → ${end.toISOString().split('T')[0]}`);
  console.log(`Weeks to process: ${weeks.length}`);
  if (RESUME && completedW.size) console.log(`Resuming — ${completedW.size} weeks already done\n`);
  else console.log('');

  let totalGigs = 0, totalArtists = 0, totalVenues = 0, errors = 0;

  for (let wi = 0; wi < weeks.length; wi++) {
    const { from, to } = weeks[wi];
    const weekKey = from.substring(0, 10);

    if (completedW.has(weekKey)) {
      process.stdout.write(`\r  Week ${wi + 1}/${weeks.length} [${weekKey}] — skipped (already done)   `);
      continue;
    }

    let page = 0, totalPages = 1, weekGigs = 0;

    while (page < totalPages && page < 5) { // TM hard cap: 5 pages × 200 = 1,000/query
      const data = await fetchTMPage(from, to, page);
      if (!data) { errors++; break; }

      if (data.fault) {
        console.error(`\n  TM API error: ${JSON.stringify(data.fault)}`);
        errors++;
        break;
      }

      const pageInfo   = data.page || {};
      const events     = data._embedded?.events || [];
      totalPages       = Math.min(pageInfo.totalPages || 1, 5);

      if (events.length === 0) break;

      const { newGigs, newArtists, newVenues } = await parseEvents(events, gigsSaved, artistsSaved, venuesSaved);
      weekGigs     += newGigs;
      totalGigs    += newGigs;
      totalArtists += newArtists;
      totalVenues  += newVenues;

      page++;
      await sleep(250); // 4 req/s — within 5/s limit
    }

    completedW.add(weekKey);
    if (!DRY_RUN) saveProgress({ completedWeeks: [...completedW], gigs: totalGigs, artists: totalArtists, venues: totalVenues });

    const pct = ((wi + 1) / weeks.length * 100).toFixed(1);
    process.stdout.write(
      `\r  Week ${wi + 1}/${weeks.length} (${pct}%) [${weekKey}] — +${weekGigs} gigs | Total: ${totalGigs.toLocaleString()} gigs, ${totalArtists.toLocaleString()} artists, ${totalVenues.toLocaleString()} venues   `
    );
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Gigs saved    : ${totalGigs.toLocaleString()}`);
  console.log(`Artists seeded: ${totalArtists.toLocaleString()}`);
  console.log(`Venues seeded : ${totalVenues.toLocaleString()}`);
  console.log(`Errors        : ${errors}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');

  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
