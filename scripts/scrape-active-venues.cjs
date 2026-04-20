#!/usr/bin/env node
/**
 * GigRadar Active Venue Scraper
 *
 * Phase 1 — Events API: Pages through ALL upcoming UK events using correct
 *            offset-based pagination, extracts every unique venue object.
 *            No WAF needed. Gets: id, name, address, postcode, lat/lon, phone,
 *            type, region, rating, reviewCount.
 *
 * Phase 2 — Extended events: 12-month lookahead to catch venues with events
 *            booked far out (festivals, arena tours etc).
 *
 * Phase 3 — Website enrichment: Fetches Skiddle venue page for each active venue
 *            that has no website URL yet. WAF token refreshed proactively every
 *            300 requests (before it expires).
 *
 * Usage:
 *   node scripts/scrape-active-venues.cjs
 *   node scripts/scrape-active-venues.cjs --skip-enrichment
 *   node scripts/scrape-active-venues.cjs --dry-run
 */

'use strict';

const path         = require('path');
const fs           = require('fs');
const { execSync } = require('child_process');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb          = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const VENUES_TABLE = 'gigradar-venues';
const CACHE_FILE   = path.join(__dirname, 'venues-active-scraped.json');
const PROGRESS_FILE= path.join(__dirname, 'venues-active-progress.json');
const DRY_RUN      = process.argv.includes('--dry-run');
const SKIP_ENRICH  = process.argv.includes('--skip-enrichment');
const sleep        = ms => new Promise(r => setTimeout(r, ms));

const SKIDDLE_KEY  = '4e0a7a6dacf5930b9bf39ece1f9b456f';
const PAGE_SIZE    = 100;
// Proactively refresh WAF token every N venue page fetches (before it expires ~1000-1500)
const WAF_REFRESH_INTERVAL = 300;

// ─── DynamoDB helpers ─────────────────────────────────────────────────────────

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

async function upsertVenue(venue) {
  const venueId = toVenueId(venue.name, venue.city);
  const slug    = toVenueSlug(venue.name, venue.city);

  const updates = [
    '#n          = if_not_exists(#n,          :n)',
    'city         = if_not_exists(city,         :c)',
    'slug         = if_not_exists(slug,         :s)',
    'isActive     = :a',
    'upcoming     = if_not_exists(upcoming,     :u)',
    'skiddleId    = if_not_exists(skiddleId,    :sid)',
    'lastUpdated  = :t',
  ];
  // DynamoDB reserved keywords need aliases
  const names  = { '#n': 'name', '#reg': 'region' };
  const values = {
    ':n':   venue.name,
    ':c':   venue.city    || '',
    ':s':   slug,
    ':a':   true,
    ':u':   0,
    ':sid': venue.skiddleId,
    ':t':   new Date().toISOString(),
  };

  // Optional fields — only set if present, never overwrite existing richer data
  const optionals = [
    ['address',     ':addr', null,    venue.address     || null],
    ['postcode',    ':pc',   null,    venue.postcode    || null],
    ['#reg',        ':reg',  '#reg',  venue.region      || null],  // reserved keyword
    ['country',     ':ctry', null,    venue.country     || null],
    ['lat',         ':lat',  null,    venue.lat         || null],
    ['lon',         ':lon',  null,    venue.lon         || null],
    ['phone',       ':ph',   null,    venue.phone       || null],
    ['description', ':desc', null,    venue.description || null],
    ['imageUrl',    ':img',  null,    venue.imageUrl    || null],
    ['venueType',   ':vt',   null,    venue.venueType   || null],
    ['rating',      ':rat',  null,    venue.rating      || null],
    ['reviewCount', ':rc',   null,    venue.reviewCount || null],
    ['capacity',    ':cap',  '#cap',  venue.capacity    || null],  // reserved keyword
    ['website',     ':w',    null,    venue.website     || null],
    ['skiddleUrl',  ':surl', null,    venue.skiddleUrl  || null],
  ];

  for (const [field, placeholder, alias, val] of optionals) {
    if (val !== null && val !== undefined && val !== '') {
      // field may already be an alias (e.g. '#reg') or a plain name
      const ref = field.startsWith('#') ? field : (alias || field);
      if (alias && !field.startsWith('#')) names[alias] = field;
      updates.push(`${ref} = if_not_exists(${ref}, ${placeholder})`);
      values[placeholder] = val;
    }
  }

  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

// ─── Events API ───────────────────────────────────────────────────────────────

async function fetchEventsPage(offset, startdate, enddate) {
  // Skiddle uses 'offset' not 'page' for pagination
  let url = `https://www.skiddle.com/api/v1/events/search/?api_key=${SKIDDLE_KEY}&country=GB&limit=${PAGE_SIZE}&offset=${offset}&startdate=${startdate}&order=date`;
  if (enddate) url += `&enddate=${enddate}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) { console.log('  Rate limited, waiting 30s...'); await sleep(30000); continue; }
      if (!r.ok) { await sleep(3000 * attempt); continue; }
      const j = await r.json();
      if (j.error) throw new Error(j.errormessage);
      return j;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(2000 * attempt);
    }
  }
}

function extractVenueFromEvent(event) {
  const v = event.venue;
  if (!v || !v.id || !v.name) return null;
  return {
    skiddleId:   v.id,
    name:        v.name || '',
    city:        v.town || '',
    address:     v.address || null,
    postcode:    v.postcode || null,
    region:      v.region || null,
    country:     v.country || null,
    lat:         parseFloat(v.latitude)  || null,
    lon:         parseFloat(v.longitude) || null,
    phone:       v.phone || null,
    venueType:   v.type || null,
    rating:      v.rating      ? parseFloat(v.rating)      : null,
    reviewCount: v.reviewCount ? parseInt(v.reviewCount)   : null,
  };
}

// Generate monthly date ranges between two dates
function monthlyRanges(startDate, endDate) {
  const ranges = [];
  const cur = new Date(startDate);
  const end = new Date(endDate);
  while (cur < end) {
    const from = cur.toISOString().split('T')[0];
    cur.setMonth(cur.getMonth() + 1);
    const to = new Date(Math.min(cur, end)).toISOString().split('T')[0];
    ranges.push({ from, to });
  }
  return ranges;
}

async function collectVenuesFromRange(from, to, knownIds) {
  const first = await fetchEventsPage(0, from, to);
  if (!first) return new Map();
  const totalEvents = first.totalcount;
  // Cap at 99 pages (9,900 events) to stay safely under the 10k API limit
  const totalPages  = Math.min(Math.ceil(totalEvents / PAGE_SIZE), 99);

  const newVenues = new Map();
  for (const event of (first.results || [])) {
    const v = extractVenueFromEvent(event);
    if (v && !knownIds.has(v.skiddleId)) newVenues.set(v.skiddleId, v);
  }

  for (let page = 2; page <= totalPages; page++) {
    const offset = (page - 1) * PAGE_SIZE;
    try {
      const j = await fetchEventsPage(offset, from, to);
      if (!j) continue;
      for (const event of (j.results || [])) {
        const v = extractVenueFromEvent(event);
        if (v && !knownIds.has(v.skiddleId)) newVenues.set(v.skiddleId, v);
      }
    } catch (e) {
      // Skip bad pages silently — a few failures won't affect overall coverage
    }
    await sleep(150);
  }
  return newVenues;
}

async function collectVenuesFromEvents(label, startdate, enddate, knownIds) {
  console.log(`\n  Fetching ${label} (split by month to bypass 10k API cap)...`);
  const ranges = monthlyRanges(startdate, enddate);
  console.log(`  ${ranges.length} monthly ranges`);

  const allNew = new Map();
  for (const { from, to } of ranges) {
    const first = await fetchEventsPage(0, from, to);
    const total = first?.totalcount || 0;
    process.stdout.write(`\r  ${from} → ${to}: ${total.toLocaleString()} events | Total new venues: ${allNew.size}   `);
    const rangeVenues = await collectVenuesFromRange(from, to, new Map([...knownIds, ...allNew]));
    rangeVenues.forEach((v, id) => allNew.set(id, v));
    await sleep(300);
  }

  console.log(`\n  Done — ${allNew.size} new unique venues`);
  return allNew;
}

// ─── WAF token + website enrichment ──────────────────────────────────────────

async function fetchWafToken() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const browsePaths = [
    path.join(home, '.claude/skills/gstack/browse/dist/browse.exe'),
    path.join(home, '.claude/skills/gstack/browse/dist/browse'),
  ];
  const browseBin = browsePaths.find(p => fs.existsSync(p));
  if (!browseBin) throw new Error('gstack browse binary not found');
  execSync(`"${browseBin}" goto https://www.skiddle.com/`, { stdio: 'ignore', timeout: 30000 });
  const cookies = execSync(`"${browseBin}" js "document.cookie"`, { timeout: 10000 }).toString().trim();
  const match = cookies.match(/aws-waf-token=([^\s;]+)/);
  if (!match) throw new Error('aws-waf-token not found');
  return match[1];
}

function isWafChallenge(html) {
  if (!html) return false;
  if (html.includes('awswaf') || html.includes('aws-waf') || html.includes('challenge.js')) return true;
  if (html.length < 5000 && !html.includes('__NEXT_DATA__')) return true;
  return false;
}

function fetchWithCurl(url, wafToken) {
  // Use curl instead of Node fetch — curl has a different TLS fingerprint
  // that many WAFs (including Skiddle's) allow through
  try {
    const result = execSync(
      `curl -s -L --max-time 15 --compressed ` +
      `-H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36" ` +
      `-H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" ` +
      `-H "Accept-Language: en-GB,en;q=0.9" ` +
      `-H "Referer: https://www.skiddle.com/" ` +
      `-H "Cookie: aws-waf-token=${wafToken}" ` +
      `"${url}"`,
      { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }
    ).toString();
    return result;
  } catch (e) {
    return null;
  }
}

function toSkiddleUrlPath(city, name) {
  // Skiddle venue URLs: /whats-on/{City}/{Venue-Name}/
  // City and name use title-case with hyphens, special chars stripped
  const fmt = s => (s || '')
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
  return `/whats-on/${fmt(city)}/${fmt(name)}/`;
}

function extractWebsiteFromHtml(html) {
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nd) return null;
  try {
    const vd = JSON.parse(nd[1]).props?.pageProps?.venueData;
    return vd?.url || null;
  } catch { return null; }
}

// ─── Progress ─────────────────────────────────────────────────────────────────

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return null;
}
function saveProgress(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Active Venue Scraper ===\n');

  const today    = new Date().toISOString().split('T')[0];
  const in12mo   = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0];
  const ago12mo  = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().split('T')[0];

  const progress  = loadProgress();
  const allVenues = new Map();

  // ── Phases 1–3: Collect venues from events API ────────────────────────────
  // Phase 1: Past 12 months  — venues that hosted gigs recently but may have nothing booked yet
  // Phase 2: Upcoming events — all venues with future events
  // Phase 3: 12-month lookahead — festivals, tours booked far in advance

  if (progress?.phase12Done) {
    console.log(`Resuming — loading ${progress.venueCount} venues from cache...`);
    JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')).forEach(v => allVenues.set(v.skiddleId, v));
  } else {
    const phase1 = await collectVenuesFromEvents('past 12 months', ago12mo, today, allVenues);
    phase1.forEach((v, id) => allVenues.set(id, v));

    const phase2 = await collectVenuesFromEvents('upcoming events', today, null, allVenues);
    phase2.forEach((v, id) => allVenues.set(id, v));

    const phase3 = await collectVenuesFromEvents('12 month lookahead', today, in12mo, allVenues);
    phase3.forEach((v, id) => allVenues.set(id, v));

    console.log(`\nTotal unique active venues: ${allVenues.size.toLocaleString()}`);

    // Write to DynamoDB
    if (!DRY_RUN) {
      console.log('\nWriting to DynamoDB...');
      let written = 0, errors = 0;
      for (const venue of allVenues.values()) {
        if (!venue.name) continue;
        try {
          await upsertVenue(venue);
          written++;
        } catch (e) {
          errors++;
          if (errors <= 5) console.error(`\n  Error for ${venue.name}: ${e.message}`);
        }
        if ((written + errors) % 100 === 0) {
          process.stdout.write(`\r  Written: ${written} | Errors: ${errors}   `);
        }
        await sleep(20);
      }
      console.log(`\n  Done — ${written} written, ${errors} errors`);
    }

    fs.writeFileSync(CACHE_FILE, JSON.stringify([...allVenues.values()], null, 2));
    saveProgress({ phase12Done: true, venueCount: allVenues.size, enrichedIds: [] });
  }

  if (SKIP_ENRICH || DRY_RUN) {
    console.log('\nSkipping website enrichment.');
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
    console.log(`\n✓ Done — ${allVenues.size.toLocaleString()} active venues`);
    return;
  }

  // ── Phase 3: Website URL enrichment ───────────────────────────────────────

  console.log('\n── Phase 3: Website URL enrichment ──');
  console.log('Fetching WAF token...');

  let wafToken;
  try {
    wafToken = await fetchWafToken();
    console.log('  WAF token obtained.\n');
  } catch (e) {
    console.error(`  Could not get WAF token: ${e.message}\n  Skipping enrichment.`);
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
    return;
  }

  const enrichedIds = new Set(progress?.enrichedIds || []);
  const toEnrich    = [...allVenues.values()].filter(v => !v.website && !enrichedIds.has(v.skiddleId));
  console.log(`Venues to enrich: ${toEnrich.length.toLocaleString()} (${enrichedIds.size} already done)\n`);

  let fetched = 0, withWebsite = 0, enrichErrors = 0;

  for (let i = 0; i < toEnrich.length; i++) {
    const venue = toEnrich[i];

    // Proactive WAF token refresh every 300 requests
    if (i > 0 && i % WAF_REFRESH_INTERVAL === 0) {
      console.log(`\n  [${i}/${toEnrich.length}] Proactive WAF token refresh...`);
      try { wafToken = await fetchWafToken(); console.log('  Token refreshed.\n'); }
      catch (e) { console.error(`  Refresh failed: ${e.message}`); }
    }

    const venueUrlPath = toSkiddleUrlPath(venue.city, venue.name);
    const fullUrl = `https://www.skiddle.com${venueUrlPath}`;

    let html = fetchWithCurl(fullUrl, wafToken);

    if (!html || isWafChallenge(html)) {
      // curl also blocked — refresh token and retry
      try {
        wafToken = await fetchWafToken();
        html = fetchWithCurl(fullUrl, wafToken);
      } catch {}
    }

    if (html) {
      const website = extractWebsiteFromHtml(html);
      if (website) {
        withWebsite++;
        venue.website = website;
        if (!DRY_RUN) {
          try { await upsertVenue({ ...venue, website }); } catch {}
        }
      }
      fetched++;
    } else {
      enrichErrors++;
    }

    enrichedIds.add(venue.skiddleId);

    if ((i + 1) % 25 === 0 || i === toEnrich.length - 1) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify([...allVenues.values()], null, 2));
      saveProgress({ phase12Done: true, venueCount: allVenues.size, enrichedIds: [...enrichedIds] });
      process.stdout.write(
        `\r  [${i+1}/${toEnrich.length}] Fetched: ${fetched} | With website: ${withWebsite} | Errors: ${enrichErrors}   `
      );
    }

    await sleep(500);
  }

  console.log(`\n\nEnrichment complete:`);
  console.log(`  Pages fetched   : ${fetched}`);
  console.log(`  Website URLs    : ${withWebsite}`);
  console.log(`  Errors          : ${enrichErrors}`);

  fs.writeFileSync(CACHE_FILE, JSON.stringify([...allVenues.values()], null, 2));
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  console.log(`\n✓ Complete — ${allVenues.size.toLocaleString()} active venues fully profiled`);
}

main().catch(err => { console.error(err); process.exit(1); });
