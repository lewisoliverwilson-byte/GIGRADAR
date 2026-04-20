#!/usr/bin/env node
/**
 * GigRadar Venue-Direct Scraper
 *
 * Scrapes events from individual venue websites. For each venue in our DB
 * that has a website, tries multiple strategies to find upcoming events.
 * Uses the venue's own website as the "ticket link" — no ticket URL needed.
 * This catches free pub gigs, door-pay shows, and events not on any ticketing platform.
 *
 * Strategies (in order):
 *   1. LD+JSON MusicEvent / Event schema
 *   2. WordPress Events Calendar REST API (/wp-json/tribe/events/v1/events)
 *   3. WordPress iCal feed (?ical=1)
 *   4. HTML date+title pattern matching (broad fallback)
 *
 * Usage:
 *   node scripts/scrape-venue-direct.cjs
 *   node scripts/scrape-venue-direct.cjs --dry-run
 *   node scripts/scrape-venue-direct.cjs --resume
 *   node scripts/scrape-venue-direct.cjs --limit=200
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
const PROGRESS_FILE = path.join(__dirname, 'venue-direct-progress.json');
const LOG_FILE      = path.join(__dirname, 'scrape-venue-direct-log.txt');

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');
const LIMIT   = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '99999', 10);
const sleep   = ms => new Promise(r => setTimeout(r, ms));

const HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json',
  'Accept-Language': 'en-GB,en;q=0.9',
};

// Domains that are never valid venue websites
const BAD_DOMAINS = /wikipedia|wikidata|wikimedia|facebook|instagram|twitter|x\.com|youtube|ticketmaster|eventbrite|skiddle|songkick|dice\.fm|seetickets|gigantic|ents24|google|openstreetmap|tripadvisor|yelp|gov\.uk|gov\.scot|gov\.wales|council\.|highbeam|nytimes|guardian|bbc\.|nme\.|timeout|residentadvisor|ra\.co|allgigs|setlist\.fm|last\.fm|musicbrainz|spotify|amazon|ebay|theguardian|telegraph|mirror|metro\.|dailymail|theface|pitchfork|rollingstone|musicweek|mixmag|clashmusic|loudersound|faroutmagazine|hotpress|uncut\.|mojo|recordcollectormag|quietus|insider\.co\.uk|gettyimages|shutterstock|4a-games|roccosiffredi|timessquarenyc|gazette|scarboroughspa\.co\.uk\/about/i;

const JUNK_ARTIST = /^(tba|tbc|various artists?|support|residents?|live|open mic|dj set|doors?|to be confirmed|club night|presents|event|tickets?|sold out|buy ticket|free entry|doors open)$/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}
function toArtistId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const logLines = [];
function log(msg) { logLines.push(msg); }
function flushLog() {
  if (logLines.length) {
    fs.appendFileSync(LOG_FILE, logLines.join('\n') + '\n');
    logLines.length = 0;
  }
}

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { processedVenues: [] };
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

function isValidWebsite(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (BAD_DOMAINS.test(u.hostname)) return false;
    return true;
  } catch { return false; }
}

// Normalise a URL to its base (strip query/hash, ensure path)
function baseUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch { return url; }
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchText(url, timeout = 8000) {
  try {
    const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

async function fetchJson(url, timeout = 8000) {
  try {
    const r = await fetch(url, {
      headers: { ...HDR, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(timeout)
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ─── Extraction strategies ────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];
const futureLimit = new Date();
futureLimit.setFullYear(futureLimit.getFullYear() + 2);

function parseDate(str) {
  if (!str) return null;
  // ISO format
  const iso = str.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) { const d = iso[1]; return d >= today && d <= futureLimit.toISOString().split('T')[0] ? d : null; }
  // UK format: 25 April 2026, 25th April 2026, Apr 25 2026
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const ukDate = str.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(\w{3,})\s+(\d{4})/i) ||
                 str.match(/(\w{3,})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (ukDate) {
    let day, mon, year;
    const m1 = months[ukDate[1]?.toLowerCase()?.substring(0,3)];
    const m2 = months[ukDate[2]?.toLowerCase()?.substring(0,3)];
    if (m1) { mon = m1; day = parseInt(ukDate[2]); year = parseInt(ukDate[3]); }
    else if (m2) { day = parseInt(ukDate[1]); mon = m2; year = parseInt(ukDate[3]); }
    if (day && mon && year) {
      const d = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      return d >= today && d <= futureLimit.toISOString().split('T')[0] ? d : null;
    }
  }
  return null;
}

// Strategy 1: LD+JSON
function extractLdJsonEvents(html) {
  const events = [];
  const blocks = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const [, json] of blocks) {
    try {
      const d = JSON.parse(json);
      const items = Array.isArray(d) ? d : [d];
      for (const item of items) {
        const type = item['@type'];
        if (type === 'MusicEvent' || type === 'Event') {
          const date = parseDate(item.startDate);
          if (!date) continue;
          const artistName = item.performer?.name || item.performer?.[0]?.name ||
                             item.name?.replace(/\s+at\s+.+$/i, '').replace(/\s+live\s*$/i, '').trim();
          if (!artistName || JUNK_ARTIST.test(artistName)) continue;
          events.push({ artistName, date, url: item.url });
        } else if (type === 'ItemList') {
          for (const listItem of (item.itemListElement || [])) {
            const ev = listItem.item || listItem;
            if (!['MusicEvent','Event'].includes(ev['@type'])) continue;
            const date = parseDate(ev.startDate);
            if (!date) continue;
            const artistName = ev.performer?.name || ev.name?.replace(/\s+at\s+.+$/i,'').trim();
            if (artistName && !JUNK_ARTIST.test(artistName)) events.push({ artistName, date, url: ev.url });
          }
        }
      }
    } catch {}
  }
  return events;
}

// Strategy 2: WordPress Events Calendar REST API
async function extractWpEventsApi(base) {
  const url = `${base}/wp-json/tribe/events/v1/events?per_page=50&start_date=${today}&status=publish`;
  const data = await fetchJson(url);
  if (!data?.events?.length) return [];
  return data.events.flatMap(ev => {
    const date = parseDate(ev.start_date);
    if (!date) return [];
    // Try to get artist from event title
    let artistName = ev.title?.replace(/\s+at\s+.+$/i,'').replace(/\s+[-–—]\s+.+$/,'').trim();
    if (!artistName || JUNK_ARTIST.test(artistName) || artistName.length > 80) return [];
    return [{ artistName, date, url: ev.url }];
  });
}

// Strategy 3: iCal
async function extractIcal(base) {
  const paths = [`${base}/?ical=1`, `${base}/events/?ical=1`, `${base}/events.ics`];
  for (const url of paths) {
    const text = await fetchText(url);
    if (!text?.includes('BEGIN:VCALENDAR')) continue;
    const events = [];
    const veventBlocks = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
    for (const block of veventBlocks) {
      const summary = block.match(/^SUMMARY[^:]*:(.+)$/m)?.[1]?.replace(/\\,/g,',').trim();
      const dtstart = block.match(/^DTSTART[^:]*:(\d{8})/m)?.[1];
      const url = block.match(/^URL[^:]*:(.+)$/m)?.[1]?.trim();
      if (!summary || !dtstart) continue;
      const date = `${dtstart.substring(0,4)}-${dtstart.substring(4,6)}-${dtstart.substring(6,8)}`;
      if (date < today) continue;
      let artistName = summary.replace(/\s+at\s+.+$/i,'').replace(/\s+[-–—]\s+.+$/,'').trim();
      if (!artistName || JUNK_ARTIST.test(artistName)) continue;
      events.push({ artistName, date, url });
    }
    if (events.length) return events;
  }
  return [];
}

// Strategy 4: HTML pattern matching — find date+title pairs
function extractHtmlEvents(html, venueName) {
  const events = [];
  const seen = new Set();

  // Strip script/style tags
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');

  // Look for common event listing patterns with dates
  // Pattern: heading (h2/h3/h4) near a date within 500 chars
  const headings = [...clean.matchAll(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/gi)].map(m => m[1].trim());

  // Date pattern
  const DATE_RE = /(\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/gi;

  for (const heading of headings) {
    if (heading.length < 2 || heading.length > 80) continue;
    if (JUNK_ARTIST.test(heading)) continue;
    if (/^(home|about|contact|news|blog|events|music|what.?s on|menu|tickets|buy|shop)$/i.test(heading)) continue;
    // Avoid generic headings
    if (/^\d+$/.test(heading)) continue;

    // Look for a date near this heading in the HTML
    const headingIdx = clean.indexOf(`>${heading}<`);
    if (headingIdx < 0) continue;
    const context = clean.substring(Math.max(0, headingIdx - 200), headingIdx + 500);
    const dateMatch = DATE_RE.exec(context);
    DATE_RE.lastIndex = 0;
    if (!dateMatch) continue;

    const date = parseDate(dateMatch[1]);
    if (!date) continue;

    const key = `${heading}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Clean up the heading as artist name
    let artistName = heading.replace(/\s+at\s+.+$/i,'').replace(/\s+[-–—]\s+.+$/,'').trim();
    if (artistName.length < 2 || JUNK_ARTIST.test(artistName)) continue;
    // Skip if heading IS the venue name
    if (normaliseName(artistName) === normaliseName(venueName)) continue;

    events.push({ artistName, date });
  }

  return events;
}

// ─── Auto-seed artist ─────────────────────────────────────────────────────────

const seededArtists = new Set();

async function autoSeedArtist(artistName) {
  if (!artistName || artistName.length < 2 || artistName.length > 100) return null;
  if (JUNK_ARTIST.test(artistName.trim())) return null;
  const artistId = toArtistId(artistName);
  if (!artistId || artistId.length < 2 || DRY_RUN) return artistId;

  if (!seededArtists.has(artistId)) {
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: `SET #n = if_not_exists(#n, :n), upcoming = if_not_exists(upcoming, :u), lastUpdated = :t`,
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': artistName, ':u': 0, ':t': new Date().toISOString() },
    })).catch(() => {});
    seededArtists.add(artistId);
  }
  return artistId;
}

// ─── Process one venue ─────────────────────────────────────────────────────────

async function processVenue(venue, gigsSaved) {
  const { venueId, name: venueName, city, website } = venue;
  if (!isValidWebsite(website)) return { gigs: 0, valid: false };

  const base = baseUrl(website);
  let events = [];

  // Try each strategy in order, stop when we find events
  // Strategy 1: LD+JSON on main page and /events page
  for (const path of ['', '/events', '/whats-on', '/gigs', '/diary']) {
    const html = await fetchText(base + path);
    if (!html) continue;
    const found = extractLdJsonEvents(html);
    if (found.length) { events = found; break; }
    // Also try HTML pattern on events pages
    if (path !== '') {
      const htmlEvents = extractHtmlEvents(html, venueName);
      if (htmlEvents.length) { events = htmlEvents; break; }
    }
  }

  // Strategy 2: WordPress Events Calendar REST API
  if (!events.length) {
    events = await extractWpEventsApi(base);
  }

  // Strategy 3: iCal
  if (!events.length) {
    events = await extractIcal(base);
  }

  // Strategy 4: HTML on main page as last resort
  if (!events.length) {
    const html = await fetchText(base + '/');
    if (html) events = extractHtmlEvents(html, venueName);
  }

  if (!events.length) return { gigs: 0, valid: true };

  let newGigs = 0;

  for (const ev of events) {
    const artistId = await autoSeedArtist(ev.artistName);
    if (!artistId) continue;

    const gigId = `vd-${normaliseName(venueName)}-${normaliseName(ev.artistName)}-${ev.date}`
      .replace(/[^a-z0-9-]/gi, '-').substring(0, 100);
    if (gigsSaved.has(gigId)) continue;

    const gig = {
      gigId,
      artistId,
      artistName: ev.artistName,
      date: ev.date,
      doorsTime: null,
      venueName,
      venueCity: city,
      venueCountry: 'GB',
      canonicalVenueId: venueId,
      isSoldOut: false,
      minAge: null,
      supportActs: [],
      tickets: [{
        seller: 'Venue Website',
        url:    ev.url || website,
        available: true,
        price:  'See venue',
      }],
      sources:     ['venue-direct'],
      lastUpdated: new Date().toISOString(),
    };

    if (!DRY_RUN) {
      await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig }))
        .catch(e => console.error(`  Save error ${gigId}:`, e.message));
    }
    gigsSaved.add(gigId);
    newGigs++;
    log(`  [${ev.artistName}] @ ${venueName}, ${city} — ${ev.date}`);
  }

  return { gigs: newGigs, valid: true };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Venue-Direct Scraper ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  if (!DRY_RUN) fs.writeFileSync(LOG_FILE, `=== Venue-Direct Scraper — ${new Date().toISOString()} ===\n\n`);

  // Load venues with websites
  console.log('Loading venues from DynamoDB...');
  let venues = [], lastKey;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: VENUES_TABLE,
      ExclusiveStartKey: lastKey,
      FilterExpression: 'attribute_exists(website) AND active = :a',
      ExpressionAttributeValues: { ':a': true },
      ProjectionExpression: 'venueId, #n, city, website',
      ExpressionAttributeNames: { '#n': 'name' },
    }));
    venues.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  // Filter valid websites
  venues = venues.filter(v => isValidWebsite(v.website)).slice(0, LIMIT);
  console.log(`  ${venues.length} venues with valid websites\n`);

  const progress     = loadProgress();
  const processedSet = new Set(progress.processedVenues || []);
  const gigsSaved    = new Set();
  let totalGigs = 0, validCount = 0, withGigs = 0;

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    if (RESUME && processedSet.has(venue.venueId)) {
      process.stdout.write(`\r  [${i+1}/${venues.length}] ${venue.name?.substring(0,20).padEnd(20)} — skipped   `);
      continue;
    }

    await sleep(400);
    const { gigs, valid } = await processVenue(venue, gigsSaved);
    if (valid) validCount++;
    if (gigs > 0) { withGigs++; totalGigs += gigs; }

    processedSet.add(venue.venueId);

    if (!DRY_RUN && i % 20 === 0) {
      saveProgress({ processedVenues: [...processedSet] });
      flushLog();
    }

    process.stdout.write(
      `\r  [${i+1}/${venues.length}] ${venue.name?.substring(0,20).padEnd(20)} — +${gigs} | Total: ${totalGigs} gigs from ${withGigs} venues   `
    );
  }

  if (!DRY_RUN) { saveProgress({ processedVenues: [...processedSet] }); flushLog(); }

  console.log('\n\n=== Complete ===');
  console.log(`Venues checked  : ${validCount}`);
  console.log(`Venues with gigs: ${withGigs}`);
  console.log(`Gigs found      : ${totalGigs}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
