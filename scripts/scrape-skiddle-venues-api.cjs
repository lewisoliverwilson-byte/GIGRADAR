#!/usr/bin/env node
/**
 * Skiddle Venue API Scraper
 *
 * Uses the Skiddle REST API to bulk-fetch all venues (115k+) without WAF issues.
 * Writes basic profiles to gigradar-venues DynamoDB table.
 * Complements scrape-skiddle-venues.cjs which adds website URLs for active venues.
 *
 * Usage:
 *   node scripts/scrape-skiddle-venues-api.cjs
 *   node scripts/scrape-skiddle-venues-api.cjs --dry-run
 *   node scripts/scrape-skiddle-venues-api.cjs --resume   (skip already-written venues)
 */

'use strict';

const path         = require('path');
const fs           = require('fs');
const SDK_PATH     = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, BatchWriteCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb          = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const VENUES_TABLE = 'gigradar-venues';
const CACHE_FILE   = path.join(__dirname, 'venues-api-scraped.json');
const PROGRESS_FILE= path.join(__dirname, 'venues-api-progress.json');
const DRY_RUN      = process.argv.includes('--dry-run');
const RESUME       = process.argv.includes('--resume');
const sleep        = ms => new Promise(r => setTimeout(r, ms));

const SKIDDLE_KEY  = '4e0a7a6dacf5930b9bf39ece1f9b456f';
const PAGE_SIZE    = 100;

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

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return { lastPage: 0, written: 0 };
}
function saveProgress(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data));
}

async function fetchPage(page) {
  const url = `https://www.skiddle.com/api/v1/venues/?api_key=${SKIDDLE_KEY}&limit=${PAGE_SIZE}&page=${page}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) {
        console.log(`  Rate limited, waiting 30s...`);
        await sleep(30000);
        continue;
      }
      if (r.status === 403) {
        console.log(`  Page ${page} returned 403, backing off ${10 * attempt}s...`);
        await sleep(10000 * attempt);
        continue;
      }
      if (!r.ok) {
        console.log(`  Page ${page} returned ${r.status}, retrying...`);
        await sleep(3000 * attempt);
        continue;
      }
      const j = await r.json();
      if (j.error) throw new Error(j.errormessage);
      return j;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(2000 * attempt);
    }
  }
}

async function upsertVenueBatch(venues) {
  // Use individual UpdateCommands with if_not_exists to avoid overwriting richer data
  for (const venue of venues) {
    const venueId = toVenueId(venue.name, venue.city);
    const slug    = toVenueSlug(venue.name, venue.city);

    const updates = [
      '#n         = if_not_exists(#n,         :n)',
      'city        = if_not_exists(city,        :c)',
      'slug        = if_not_exists(slug,        :s)',
      'isActive    = if_not_exists(isActive,    :a)',  // defaults false; active venue scraper overrides to true
      'upcoming    = if_not_exists(upcoming,    :u)',
      'skiddleId   = if_not_exists(skiddleId,   :sid)',
      'lastUpdated = :t',
    ];
    const names  = { '#n': 'name' };
    const values = {
      ':n':   venue.name,
      ':c':   venue.city    || '',
      ':s':   slug,
      ':a':   false,  // historical venues default to inactive; active venue scraper sets true
      ':u':   0,
      ':sid': venue.skiddleId,
      ':t':   new Date().toISOString(),
    };

    // Optional fields — only set if present, never overwrite existing
    const optionals = [
      ['address',     ':addr', null,   venue.address     || null],
      ['postcode',    ':pc',   null,   venue.postcode    || null],
      ['lat',         ':lat',  null,   venue.lat         || null],
      ['lon',         ':lon',  null,   venue.lon         || null],
      ['phone',       ':ph',   null,   venue.phone       || null],
      ['description', ':desc', null,   venue.description || null],
      ['imageUrl',    ':img',  null,   venue.imageUrl    || null],
      ['venueType',   ':vt',   null,   venue.venueType   || null],
      ['capacity',    ':cap',  '#cap', venue.capacity    || null],
    ];
    for (const [field, placeholder, alias, val] of optionals) {
      if (val !== null && val !== undefined && val !== '') {
        const ref = alias || field;
        if (alias) names[alias] = field;
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
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Skiddle Venue API Scraper ===\n');

  // Resume support — load progress before fetching page 1 so we can skip it in resume mode
  const progress   = loadProgress();
  let startPage    = RESUME ? progress.lastPage + 1 : 1;
  let written      = RESUME ? progress.written : 0;
  let errors       = 0;
  let totalVenues  = RESUME && progress.totalVenues ? progress.totalVenues : null;
  let totalPages   = RESUME && progress.totalPages  ? progress.totalPages  : null;

  if (!totalVenues) {
    // Need to fetch page 1 to get total count
    const first = await fetchPage(1);
    if (!first) { console.error('Failed to fetch page 1 — API may be rate limiting. Try again in a few minutes.'); process.exit(1); }
    totalVenues = first.totalcount;
    totalPages  = Math.ceil(totalVenues / PAGE_SIZE);
    // Store in progress for future resumes
    saveProgress({ ...progress, totalVenues, totalPages });
  }

  console.log(`Total venues in Skiddle: ${totalVenues.toLocaleString()}`);
  console.log(`Pages to fetch: ${totalPages} (${PAGE_SIZE}/page)\n`);

  if (RESUME && startPage > 1) {
    console.log(`Resuming from page ${startPage} (${written.toLocaleString()} already written)\n`);
  }

  const allVenues = [];

  // Process first page data if starting from page 1
  const pagesToProcess = startPage === 1
    ? [{ page: 1, data: first }, ...Array.from({ length: totalPages - 1 }, (_, i) => ({ page: i + 2 }))]
    : Array.from({ length: totalPages - startPage + 1 }, (_, i) => ({ page: startPage + i }));

  for (const { page, data: prefetched } of pagesToProcess) {
    let pageData;
    try {
      pageData = prefetched || await fetchPage(page);
    } catch (e) {
      console.error(`\n  Failed to fetch page ${page}: ${e.message}`);
      errors++;
      continue;
    }

    if (!pageData) {
      errors++;
      continue;
    }

    const results = pageData.results || [];
    const venues = results.map(v => ({
      skiddleId:   v.id,
      name:        v.name        || '',
      city:        (v.town || '').replace(/\s*,.*$/, '').trim(), // clean "Southport , Southpor" → "Southport"
      address:     v.address     || null,
      postcode:    v.postcode    || null,
      lat:         parseFloat(v.latitude)  || null,
      lon:         parseFloat(v.longitude) || null,
      phone:       v.phone       || null,
      description: v.description || null,
      imageUrl:    (v.imageurl && v.imageurl !== '') ? v.imageurl : null,
      venueType:   v.type        || null,
    }));

    allVenues.push(...venues);

    if (!DRY_RUN) {
      try {
        await upsertVenueBatch(venues);
        written += venues.length;
      } catch (e) {
        errors++;
        if (errors <= 5) console.error(`\n  DynamoDB error on page ${page}: ${e.message}`);
      }
    }

    // Flush cache every 10 pages (~1k venues)
    if (page % 10 === 0 || page === totalPages) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(allVenues, null, 2));
      if (!DRY_RUN) saveProgress({ lastPage: page, written, totalVenues, totalPages });
      const pct = ((page / totalPages) * 100).toFixed(1);
      process.stdout.write(
        `\r  Page ${page}/${totalPages} (${pct}%) | Venues written: ${written.toLocaleString()} | Errors: ${errors}   `
      );
    }

    await sleep(150); // Skiddle API is generous — 150ms is plenty
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Total venues fetched : ${allVenues.length.toLocaleString()}`);
  console.log(`Written to DynamoDB  : ${written.toLocaleString()}`);
  console.log(`Errors               : ${errors}`);
  console.log(`Cache saved to       : ${CACHE_FILE}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: DynamoDB writes skipped');
    console.log('\nSample venues:');
    allVenues.slice(0, 10).forEach(v =>
      console.log(`  [${String(v.skiddleId).padEnd(7)}] ${v.name.padEnd(40)} ${(v.city||'').padEnd(20)} ${v.venueType||''}`)
    );
  }

  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(err => { console.error(err); process.exit(1); });
