#!/usr/bin/env node
/**
 * Discovers ticketing platform links for every venue by querying each platform
 * directly. Stores results in venue.ticketingUrls for the Lambda to scrape.
 *
 * What works (tested):
 *   Songkick  — venue search + calendar pages return 50+ JSON-LD events each ✓
 *   Skiddle   — API already handled separately in Lambda
 *   TM        — API already handled via tmVenueId enrichment
 *
 * What blocks from server IPs (Cloudflare / 403):
 *   AXS, SeeTickets, Gigantic, Gigsandtours, Eventim — skipped
 *
 * Usage:
 *   node scripts/enrich-venues-ticketing-links.cjs              # all venues
 *   node scripts/enrich-venues-ticketing-links.cjs --limit=500
 *   node scripts/enrich-venues-ticketing-links.cjs --refresh    # re-enrich all
 */
'use strict';

const path = require('path');
const SDK  = p => require(path.join(__dirname, '../lambda/scraper/node_modules', p));

const { DynamoDBClient }                                     = SDK('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = SDK('@aws-sdk/lib-dynamodb');

const ddb     = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE   = 'gigradar-venues';
const LIMIT   = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '10000', 10);
const REFRESH = process.argv.includes('--refresh');
const sleep   = ms => new Promise(r => setTimeout(r, ms));

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
};

// ─── Songkick venue search ────────────────────────────────────────────────────
// Returns e.g. https://www.songkick.com/venues/17522-o2-academy-brixton

async function findSongkickVenue(venueName, city) {
  const q   = encodeURIComponent(`${venueName} ${city || ''}`);
  const url = `https://www.songkick.com/search?utf8=%E2%9C%93&type=venues&query=${q}`;
  try {
    const res  = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = await res.text();

    // Match venue result links: /venues/12345-venue-name
    const matches = [...html.matchAll(/href="(\/venues\/\d+-[^"?#]+)"/g)].map(m => m[1]);
    if (!matches.length) return null;

    // Pick best match: prefer one where name is in the slug
    const normVenue = venueName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const best = matches.find(m => {
      const slug = m.split('/').pop().replace(/^\d+-/, '');
      const normSlug = slug.replace(/-/g, '');
      return normSlug.includes(normVenue.slice(0, 6)) || normVenue.includes(normSlug.slice(0, 6));
    }) || matches[0];

    return `https://www.songkick.com${best}`;
  } catch { return null; }
}

// ─── WeGotTickets venue search ────────────────────────────────────────────────

async function findWeGotTicketsVenue(venueName) {
  const url = `https://www.wegottickets.com/searchresults/${encodeURIComponent(venueName)}`;
  try {
    const res  = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const html = await res.text();
    const m    = html.match(/href="(\/location\/\d+[^"]*)"/i);
    return m ? `https://www.wegottickets.com${m[1]}` : null;
  } catch { return null; }
}

// ─── Ticketweb venue page ─────────────────────────────────────────────────────

async function findTicketwebVenue(venueName, city) {
  const q   = encodeURIComponent(`${venueName} ${city || ''}`);
  const url = `https://www.ticketweb.uk/search?q=${q}&type=venue`;
  try {
    const res  = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const html = await res.text();
    const m    = html.match(/href="(\/venue\/[^"]+)"/i);
    return m ? `https://www.ticketweb.uk${m[1]}` : null;
  } catch { return null; }
}

// ─── Bandsintown venue page ───────────────────────────────────────────────────

async function findBandsintownVenue(venueName, city) {
  // Bandsintown has city event pages — search for venue within city
  const citySlug = (city || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!citySlug) return null;
  const q   = encodeURIComponent(venueName);
  const url = `https://bandsintown.com/en/c/${citySlug}?came_from=257&sort_by_filter=Date`;
  try {
    const res  = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const html = await res.text();
    // Look for venue link in page
    const normV = venueName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const m = [...html.matchAll(/href="(https?:\/\/bandsintown\.com\/[^"]+)"/g)]
      .find(([, u]) => u.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normV.slice(0, 8)));
    return m ? m[1] : null;
  } catch { return null; }
}

// ─── Load venues ──────────────────────────────────────────────────────────────

async function loadVenues() {
  const venues = [];
  let lastKey;
  do {
    const params = {
      TableName: TABLE,
      ProjectionExpression: 'venueId, #n, city, ticketingUrls',
      ExpressionAttributeNames: { '#n': 'name' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    venues.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return venues;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('Loading venues…');
  const all  = await loadVenues();
  const todo = all
    .filter(v => v.name && (REFRESH || !v.ticketingUrls?.songkick))
    .slice(0, LIMIT);

  const alreadyDone = all.filter(v => v.ticketingUrls?.songkick).length;
  console.log(`Total: ${all.length}  Already have Songkick: ${alreadyDone}  To search: ${todo.length}`);

  let enriched = 0;
  for (let i = 0; i < todo.length; i++) {
    const v = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] ${v.name} (${v.city || '?'}) → `);

    const [sk, wgt, tw] = await Promise.allSettled([
      findSongkickVenue(v.name, v.city),
      findWeGotTicketsVenue(v.name),
      findTicketwebVenue(v.name, v.city),
    ]);
    await sleep(800);

    const found = {};
    if (sk.value)  found.songkick     = sk.value;
    if (wgt.value) found.wegottickets = wgt.value;
    if (tw.value)  found.ticketweb    = tw.value;

    if (Object.keys(found).length > 0) {
      const merged = { ...(v.ticketingUrls || {}), ...found };
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { venueId: v.venueId },
        UpdateExpression: 'SET ticketingUrls = :u, ticketingUrlsUpdated = :t',
        ExpressionAttributeValues: { ':u': merged, ':t': new Date().toISOString() },
      })).catch(e => process.stdout.write(' [DDB err: ' + e.message + ']'));
      console.log(`✓ ${Object.keys(found).join(', ')}`);
      enriched++;
    } else {
      console.log('none found');
    }

    await sleep(600);
  }

  console.log(`\nDone. Enriched: ${enriched}/${todo.length}`);
})();
