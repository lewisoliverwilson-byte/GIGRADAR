#!/usr/bin/env node
/**
 * Phase 2 — Crawl URL Discovery
 *
 * For each venue in DynamoDB that has a `website` but no confirmed `crawlUrl`,
 * try common event-listing paths. Store the first URL that looks like a gig
 * listings page, or flag the venue as "no-crawl-url" for manual review.
 *
 * Usage:
 *   node scripts/probe-crawl-urls.cjs            — probe all venues, write to DynamoDB
 *   node scripts/probe-crawl-urls.cjs --dry-run  — probe but don't write to DynamoDB
 *   node scripts/probe-crawl-urls.cjs --limit 20 — only probe first N venues
 */

const path = require('path');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                              = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE = 'gigradar-venues';
const DRY_RUN      = process.argv.includes('--dry-run');
const limitArg     = process.argv.indexOf('--limit');
const LIMIT        = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;
const sleep        = ms => new Promise(r => setTimeout(r, ms));

// Paths to try in order (most likely first)
const CANDIDATE_PATHS = [
  '/whats-on',
  '/events',
  '/gigs',
  '/listings',
  '/calendar',
  '/programme',
  '/shows',
  '/whatson',
  '/live',
  '/music',
  '/tickets',
  '/whats-on.html',
  '/events.html',
  '/gigs.html',
];

// Keywords that suggest a page is an event listing
const EVENT_KEYWORDS = [
  'tickets', 'doors', 'support', 'headline', 'live music', 'support act',
  'buy now', 'book now', 'sold out', 'on sale', 'adv ', '£', 'free entry',
  'jan ', 'feb ', 'mar ', 'apr ', 'may ', 'jun ',
  'jul ', 'aug ', 'sep ', 'oct ', 'nov ', 'dec ',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
];

// Minimum number of event keywords to count as an event listing page
const MIN_EVENT_SIGNALS = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseWebsite(url) {
  if (!url) return null;
  url = url.trim().replace(/\/$/, '');
  if (!url.startsWith('http')) url = 'https://' + url;
  try { return new URL(url).origin; } catch { return null; }
}

function countEventSignals(html) {
  if (!html) return 0;
  const lower = html.toLowerCase();
  return EVENT_KEYWORDS.filter(kw => lower.includes(kw)).length;
}

async function fetchPage(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GigRadar/1.0; +https://gigradar.co.uk)',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status, html: null };
    // Only read up to 200KB — enough to detect event keywords without full parse
    const reader = res.body.getReader();
    let html = '';
    let bytes = 0;
    while (bytes < 200_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      bytes += value.length;
    }
    reader.cancel().catch(() => {});
    return { ok: true, status: res.status, html, finalUrl: res.url };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, html: null, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

// ─── Probe a single venue website ────────────────────────────────────────────

async function probeVenue(venue) {
  const origin = normaliseWebsite(venue.website);
  if (!origin) return { result: 'invalid-url' };

  // First check the homepage itself — some sites list events on the root
  const home = await fetchPage(origin);
  if (!home.ok) return { result: 'unreachable', detail: `homepage ${home.status || home.error}` };

  // If the homepage redirected to a social media site, it's not a real venue website
  const SOCIAL_HOSTS = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linktree.com', 'linktr.ee'];
  if (home.finalUrl) {
    try {
      const redirectHost = new URL(home.finalUrl).hostname.replace(/^www\./, '');
      if (SOCIAL_HOSTS.some(s => redirectHost === s || redirectHost.endsWith('.' + s))) {
        return { result: 'not-found' };
      }
    } catch {}
  }

  const homeSignals = countEventSignals(home.html);
  if (homeSignals >= MIN_EVENT_SIGNALS) {
    return { result: 'found', crawlUrl: origin, signals: homeSignals, path: '/' };
  }

  // Try candidate paths
  for (const candidatePath of CANDIDATE_PATHS) {
    const url = origin + candidatePath;
    const page = await fetchPage(url);
    await sleep(300); // be polite

    if (!page.ok) continue;

    // Redirect back to homepage = path doesn't exist
    try {
      if (page.finalUrl && new URL(page.finalUrl).pathname === '/') continue;
    } catch {}

    const signals = countEventSignals(page.html);
    if (signals >= MIN_EVENT_SIGNALS) {
      return { result: 'found', crawlUrl: url, signals, path: candidatePath };
    }
  }

  // Check homepage for links that suggest an events page
  if (home.html) {
    const linkRe = /href=["']([^"']*(?:events?|gigs?|whats-on|listings?|calendar|programme|shows?|live)[^"']*?)["']/gi;
    let match;
    while ((match = linkRe.exec(home.html)) !== null) {
      let href = match[1];
      if (href.startsWith('#') || href.includes('facebook') || href.includes('twitter')) continue;
      if (!href.startsWith('http')) href = origin + (href.startsWith('/') ? '' : '/') + href;
      try { new URL(href); } catch { continue; }

      const page = await fetchPage(href);
      await sleep(300);
      if (!page.ok) continue;
      const signals = countEventSignals(page.html);
      if (signals >= MIN_EVENT_SIGNALS) {
        return { result: 'found', crawlUrl: href, signals, path: href.replace(origin, '') };
      }
    }
  }

  return { result: 'not-found' };
}

// ─── Load venues from DynamoDB ────────────────────────────────────────────────

async function loadVenuesToProbe() {
  const venues = [];
  let lastKey;
  do {
    const params = { TableName: VENUES_TABLE };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    for (const item of (result.Items || [])) {
      if (item.website && !item.crawlUrl && item.crawlStatus !== 'not-found') {
        venues.push(item);
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return venues;
}

// ─── Write result to DynamoDB ─────────────────────────────────────────────────

async function saveCrawlUrl(venueId, crawlUrl, crawlStatus) {
  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId },
    UpdateExpression: 'SET crawlUrl = :u, crawlStatus = :s, lastProbed = :t',
    ExpressionAttributeValues: {
      ':u': crawlUrl || null,
      ':s': crawlStatus,
      ':t': new Date().toISOString(),
    },
  }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Crawl URL Probe — Phase 2 ===\n');

  const venues = await loadVenuesToProbe();
  console.log(`Venues to probe: ${venues.length}`);

  const todo = venues.slice(0, LIMIT === Infinity ? venues.length : LIMIT);
  console.log(`Probing ${todo.length} venues${DRY_RUN ? ' (DRY RUN)' : ''}...\n`);

  let found = 0, notFound = 0, unreachable = 0, errors = 0;
  const results = [];

  for (let i = 0; i < todo.length; i++) {
    const venue = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] ${(venue.name || '').padEnd(40)} `);

    try {
      const probe = await probeVenue(venue);

      if (probe.result === 'found') {
        found++;
        console.log(`✓ ${probe.path} (${probe.signals} signals)`);
        results.push({ venue: venue.name, city: venue.city, crawlUrl: probe.crawlUrl, status: 'found' });
        if (!DRY_RUN) await saveCrawlUrl(venue.venueId, probe.crawlUrl, 'ready');
      } else if (probe.result === 'not-found') {
        notFound++;
        console.log(`✗ no event page found`);
        results.push({ venue: venue.name, city: venue.city, website: venue.website, status: 'not-found' });
        if (!DRY_RUN) await saveCrawlUrl(venue.venueId, null, 'not-found');
      } else if (probe.result === 'unreachable') {
        unreachable++;
        console.log(`✗ unreachable (${probe.detail || '?'})`);
        results.push({ venue: venue.name, city: venue.city, website: venue.website, status: 'unreachable' });
        if (!DRY_RUN) await saveCrawlUrl(venue.venueId, null, 'unreachable');
      } else {
        notFound++;
        console.log(`✗ ${probe.result}`);
      }
    } catch (e) {
      errors++;
      console.log(`! error: ${e.message}`);
    }

    await sleep(200);
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✓ Found crawl URLs : ${found}`);
  console.log(`✗ No event page    : ${notFound}`);
  console.log(`✗ Unreachable      : ${unreachable}`);
  console.log(`! Errors           : ${errors}`);
  console.log(`  Total probed     : ${todo.length}`);

  if (DRY_RUN) {
    console.log('\nResults summary (dry run):');
    results.filter(r => r.status === 'found').forEach(r =>
      console.log(`  ${r.venue} — ${r.crawlUrl}`)
    );
  }
}

main().catch(err => { console.error(err); process.exit(1); });
