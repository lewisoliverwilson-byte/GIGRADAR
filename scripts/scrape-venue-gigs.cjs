#!/usr/bin/env node
/**
 * GigRadar Venue-Centric Gig Scraper
 *
 * Finds all gigs and artists at venues in gigradar-venues using 4 sources:
 *   1. Skiddle API      — venueid param, all events at each venue
 *   2. Songkick         — venue calendar scrape (JSON-LD, includes support acts)
 *   3. Venue website    — JSON-LD MusicEvent scrape from venue's own events page
 *   4. Facebook         — extracts & stores Facebook page URL from venue website
 *                         (full event pull requires Graph API token — see --fb-token)
 *
 * Usage:
 *   node scripts/scrape-venue-gigs.cjs                          # all venues, all sources
 *   node scripts/scrape-venue-gigs.cjs --dry-run                # no DB writes
 *   node scripts/scrape-venue-gigs.cjs --offset 0 --batch 200  # process venues 0-199
 *   node scripts/scrape-venue-gigs.cjs --source skiddle         # single source only
 *   node scripts/scrape-venue-gigs.cjs --venues-file scripts/venues-skiddle-scraped.json
 *   node scripts/scrape-venue-gigs.cjs --fb-token <token>       # enable Facebook events
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                             = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, PutCommand, ScanCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const VENUES_TABLE  = 'gigradar-venues';
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const PROGRESS_FILE = path.join(__dirname, 'venue-gigs-progress.json');
const SKIDDLE_KEY   = process.env.SKIDDLE_KEY || '4e0a7a6dacf5930b9bf39ece1f9b456f';

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}

const DRY_RUN     = process.argv.includes('--dry-run');
const ONLY_SOURCE = arg('--source');
const FB_TOKEN    = arg('--fb-token') || process.env.FB_TOKEN || null;
const BATCH_SIZE  = parseInt(arg('--batch', '200'));
const OFFSET      = parseInt(arg('--offset', '0'));
const VENUES_FILE = arg('--venues-file');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Name/ID helpers (match main scraper) ────────────────────────────────────

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toArtistId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}
function dedupKey(artistId, date, venueName) {
  return `${artistId}|${date}|${normaliseName(venueName)}`;
}

// ─── Filters (match main scraper) ────────────────────────────────────────────

const TRIBUTE_RE = /tribute|cover band|salute to|the music of|\bcovers\b|in the style of|celebrating |legacy of |experience\b/i;
const GENERIC_RE = /^(live music|open mic|various artists?|dj night|club night|karaoke|quiz night|comedy night|open stage|acoustic night|local bands?|tribute night|unsigned night|battle of the bands|bands? night|gig night|music night|headline act tba|tba|tbc|doors? open|club classics|freshers|halloween|christmas party|new year|nye|bank holiday|bottomless brunch|drag|comedy|quiz|bingo|film night|movie night|craft fair|market|festival|rave|disco|dance night|open decks)$/i;
const NON_ARTIST_RE = /boat party|boat trip|warehouse party|field day|festival|all dayer|all nighter|presents:|pres\.|club night|\bnight\b|\bparty\b at |\bfest\b|\bfestival\b/i;

function isGenericName(name) { return GENERIC_RE.test(name?.trim()); }
function isTributeAct(name)  { return TRIBUTE_RE.test(name || ''); }
function isNonArtist(name)   { return NON_ARTIST_RE.test(name || ''); }
function isValidArtist(name) {
  if (!name || name.length < 2 || name.length > 120) return false;
  if (isGenericName(name) || isTributeAct(name) || isNonArtist(name)) return false;
  return true;
}

// ─── Progress tracking ────────────────────────────────────────────────────────

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE)); } catch { return { songkickIds: {}, processed: [] }; }
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

// ─── Load venues ──────────────────────────────────────────────────────────────

async function loadVenues() {
  if (VENUES_FILE) {
    console.log(`Loading venues from ${VENUES_FILE}...`);
    const venues = JSON.parse(fs.readFileSync(VENUES_FILE));
    console.log(`  ${venues.length} venues loaded from file`);
    return venues;
  }

  console.log('Loading active venues from DynamoDB (isActive=true)...');
  const venues = [];
  let lastKey;
  do {
    const params = {
      TableName: VENUES_TABLE,
      FilterExpression: 'isActive = :a',
      ExpressionAttributeValues: { ':a': true },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    venues.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  console.log(`  ${venues.length} active venues loaded from DynamoDB`);
  return venues;
}

// ─── Auto-seed artist ─────────────────────────────────────────────────────────

const seededThisRun = new Set();

async function autoSeedArtist(name) {
  if (!isValidArtist(name)) return null;
  const artistId = toArtistId(name);
  if (!artistId || artistId.length < 2) return null;
  if (DRY_RUN) return { artistId, name };

  if (!seededThisRun.has(artistId)) {
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
        ':n': name, ':gr': true, ':c': 'UK', ':g': [], ':u': 0,
        ':t': new Date().toISOString(),
      },
    })).catch(() => {});
    seededThisRun.add(artistId);
  }
  return { artistId, name };
}

// ─── Save gig ────────────────────────────────────────────────────────────────

async function saveGig(gig) {
  if (DRY_RUN) return;
  const item = { ...gig };
  delete item.dedupKey;
  await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: item }))
    .catch(e => console.error(`  Gig save error ${gig.gigId}:`, e.message));
}

// ─── 1. SKIDDLE venue events ─────────────────────────────────────────────────
// Uses venueid param — returns all events at the venue

function parseArtistFromSkiddleEvent(eventname, venueName) {
  // Strip " @ Venue Name, City" suffix common in Skiddle event names
  let name = eventname || '';
  name = name.replace(/\s*@\s*.+$/i, '').trim();
  // Strip trailing venue name in parens: "Artist (Venue)"
  name = name.replace(/\s*\(([^)]*venue[^)]*)\)\s*$/i, '').trim();
  // Strip common suffixes like "- Bristol", "- Thekla"
  name = name.replace(/\s*[-–]\s*(Bristol|London|Manchester|Birmingham|Edinburgh|Glasgow|Leeds|Liverpool|Sheffield|Nottingham|Cardiff|Brighton|Newcastle|Bath|Oxford|Cambridge|Exeter|York|Bournemouth)$/i, '').trim();
  return name;
}

async function fetchSkiddleVenueEvents(venue) {
  if (!venue.skiddleId) return [];
  const today = new Date().toISOString().split('T')[0];
  const yearAhead = new Date(Date.now() + 365 * 864e5).toISOString().split('T')[0];
  const gigs = [];

  try {
    let page = 1, total = 1;
    while (page <= Math.ceil(total / 100) && page <= 10) {
      const url = `https://www.skiddle.com/api/v1/events/search/?api_key=${SKIDDLE_KEY}` +
        `&venueid=${venue.skiddleId}&startdate=${today}&enddate=${yearAhead}` +
        `&limit=100&page=${page}&order=date`;
      const r = await fetch(url, { headers: { 'User-Agent': 'GigRadar/1.0' } });
      if (r.status === 429) { await sleep(10000); continue; }
      if (!r.ok) break;

      const data = await r.json();
      if (data.error) break;
      total = parseInt(data.totalcount || '0', 10);
      const events = data.results || [];
      if (!events.length) break;

      for (const ev of events) {
        if (ev.cancelled === '1') continue;
        const rawName   = parseArtistFromSkiddleEvent(ev.eventname, venue.name);
        const artist    = await autoSeedArtist(rawName);
        if (!artist) continue;

        const date      = (ev.date || ev.startdate || '').split('T')[0];
        if (!date) continue;
        const price     = ev.ticketpricing ? `£${ev.ticketpricing.minPrice}${ev.ticketpricing.maxPrice !== ev.ticketpricing.minPrice ? `–£${ev.ticketpricing.maxPrice}` : ''}` : null;

        gigs.push({
          gigId:            `skiddle-v-${venue.skiddleId}-${ev.id}`,
          dedupKey:         dedupKey(artist.artistId, date, venue.name),
          artistId:         artist.artistId,
          artistName:       artist.name,
          date,
          doorsTime:        ev.openingtimes?.doorsopen || null,
          venueName:        venue.name,
          venueCity:        venue.city || '',
          venueCountry:     'GB',
          canonicalVenueId: toVenueId(venue.name, venue.city),
          isSoldOut:        !ev.tickets,
          minAge:           ev.minage ? parseInt(ev.minage) : null,
          supportActs:      [],
          tickets: [{
            seller:    'Skiddle',
            url:       ev.link || `https://www.skiddle.com`,
            available: !!ev.tickets,
            price:     price || 'See site',
          }],
          sources:     ['skiddle-venue'],
          lastUpdated: new Date().toISOString(),
        });
        await sleep(0); // yield
      }
      page++;
      await sleep(300);
    }
  } catch (e) { console.error(`  Skiddle error for ${venue.name}:`, e.message); }

  return gigs;
}

// ─── 2. SONGKICK venue calendar ───────────────────────────────────────────────
// Scrape search to get venue ID, then scrape JSON-LD from calendar page

const SONGKICK_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
};

async function findSongkickVenueId(venue, progress) {
  const cacheKey = `${normaliseName(venue.name)}-${normaliseName(venue.city)}`;
  if (progress.songkickIds[cacheKey] !== undefined) return progress.songkickIds[cacheKey];

  try {
    const query = encodeURIComponent(`${venue.name} ${venue.city || ''}`);
    const r = await fetch(`https://www.songkick.com/search?query=${query}&type=venue`, { headers: SONGKICK_HEADERS });
    if (!r.ok) { progress.songkickIds[cacheKey] = null; return null; }
    const html = await r.text();

    // Extract venue links: /venues/{id}-{slug}
    const venueLinks = [...html.matchAll(/href="(\/venues\/(\d+)-([^"?]+))"/g)];
    if (!venueLinks.length) { progress.songkickIds[cacheKey] = null; return null; }

    // Take first result (best match)
    const [, urlPath, venueId] = venueLinks[0];
    progress.songkickIds[cacheKey] = { id: venueId, path: urlPath };
    return progress.songkickIds[cacheKey];
  } catch {
    progress.songkickIds[cacheKey] = null;
    return null;
  }
}

function parseSongkickEvent(ldEvent, venue) {
  try {
    if (ldEvent['@type'] !== 'MusicEvent') return null;
    const startDate = ldEvent.startDate;
    if (!startDate) return null;
    const date = startDate.split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    if (date < today) return null;

    const performers = Array.isArray(ldEvent.performer) ? ldEvent.performer : ldEvent.performer ? [ldEvent.performer] : [];
    if (!performers.length) return null;

    const headliner = performers[0];
    const support   = performers.slice(1).map(p => p.name).filter(Boolean);

    return {
      artistName:  headliner.name,
      date,
      time:        startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) : null,
      supportActs: support,
      ticketUrl:   ldEvent.offers?.[0]?.url || ldEvent.url || null,
      eventStatus: ldEvent.eventStatus?.includes('Cancelled') ? 'cancelled' : 'scheduled',
    };
  } catch { return null; }
}

async function fetchSongkickVenueEvents(venue, progress) {
  const skVenue = await findSongkickVenueId(venue, progress);
  await sleep(500);
  if (!skVenue) return [];

  const gigs = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 10) {
    try {
      const url = `https://www.songkick.com${skVenue.path}/calendar${page > 1 ? `?page=${page}` : ''}`;
      const r = await fetch(url, { headers: SONGKICK_HEADERS });
      if (!r.ok) break;
      const html = await r.text();

      // Extract all JSON-LD blocks — one per event on the page
      const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      let eventsOnPage = 0;

      for (const block of ldBlocks) {
        try {
          const data = JSON.parse(block[1]);
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const parsed = parseSongkickEvent(item, venue);
            if (!parsed || parsed.eventStatus === 'cancelled') continue;

            const artist = await autoSeedArtist(parsed.artistName);
            if (!artist) continue;

            // Seed support acts
            for (const suppName of parsed.supportActs) {
              await autoSeedArtist(suppName);
            }

            gigs.push({
              gigId:            `sk-v-${skVenue.id}-${artist.artistId}-${parsed.date}`,
              dedupKey:         dedupKey(artist.artistId, parsed.date, venue.name),
              artistId:         artist.artistId,
              artistName:       artist.name,
              date:             parsed.date,
              doorsTime:        parsed.time,
              venueName:        venue.name,
              venueCity:        venue.city || '',
              venueCountry:     'GB',
              canonicalVenueId: toVenueId(venue.name, venue.city),
              isSoldOut:        false,
              minAge:           null,
              supportActs:      parsed.supportActs,
              tickets: [{
                seller:    'Songkick',
                url:       parsed.ticketUrl || `https://www.songkick.com${skVenue.path}/calendar`,
                available: true,
                price:     'See site',
              }],
              sources:     ['songkick-venue'],
              lastUpdated: new Date().toISOString(),
            });
            eventsOnPage++;
          }
        } catch {}
      }

      // Check for next page
      hasMore = eventsOnPage > 0 && html.includes('rel="next"');
      page++;
      await sleep(600);
    } catch (e) {
      console.error(`  Songkick error for ${venue.name}:`, e.message);
      break;
    }
  }

  return gigs;
}

// ─── 3. VENUE WEBSITE events ─────────────────────────────────────────────────
// Tries to find an events page on the venue's own site, parses JSON-LD

const EVENTS_PAGE_PATHS = [
  '', '/events', '/whats-on', '/gigs', '/whatson', '/what-s-on',
  '/listings', '/calendar', '/upcoming', '/shows', '/live',
];

const WEBSITE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
};

async function findEventsPage(baseUrl) {
  // First, fetch homepage and look for an events/gigs link
  try {
    const r = await fetch(baseUrl, { headers: WEBSITE_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const html = await r.text();

    // Check homepage itself for JSON-LD events
    const ldEvents = extractJsonLdEvents(html);
    if (ldEvents.length > 0) return { url: baseUrl, html };

    // Look for an events/gigs link on the homepage
    const eventsLinkRe = /href="([^"]*(?:event|gig|whats-on|whatson|what-s-on|listing|calendar|show|live|upcoming)[^"]*)"/gi;
    const links = [...html.matchAll(eventsLinkRe)].map(m => m[1]);
    for (const link of links.slice(0, 5)) {
      try {
        const absUrl = link.startsWith('http') ? link : new URL(link, baseUrl).href;
        // Don't follow external links
        if (!absUrl.includes(new URL(baseUrl).hostname)) continue;
        const r2 = await fetch(absUrl, { headers: WEBSITE_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (!r2.ok) continue;
        const html2 = await r2.text();
        const evs = extractJsonLdEvents(html2);
        if (evs.length > 0) return { url: absUrl, html: html2 };
      } catch {}
    }

    // Try common paths
    const base = baseUrl.replace(/\/$/, '');
    for (const p of EVENTS_PAGE_PATHS.slice(1)) {
      try {
        const r3 = await fetch(`${base}${p}`, { headers: WEBSITE_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(8000) });
        if (!r3.ok) continue;
        const h = await r3.text();
        const evs = extractJsonLdEvents(h);
        if (evs.length > 0) return { url: `${base}${p}`, html: h };
        await sleep(500);
      } catch {}
    }
  } catch {}
  return null;
}

function extractJsonLdEvents(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const events = [];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'MusicEvent' || item['@type'] === 'Event') events.push(item);
        if (item['@graph']) {
          for (const g of item['@graph']) {
            if (g['@type'] === 'MusicEvent' || g['@type'] === 'Event') events.push(g);
          }
        }
      }
    } catch {}
  }
  return events;
}

function extractFacebookPageUrl(html) {
  const fbMatch = html.match(/https?:\/\/(?:www\.)?facebook\.com\/(?:pages\/)?([a-zA-Z0-9._-]+)(?:\/|\?|"|'|$)/);
  if (!fbMatch) return null;
  const slug = fbMatch[1];
  // Filter out generic Facebook links
  if (['sharer', 'share', 'login', 'dialog', 'plugins', 'groups', 'events', 'hashtag', 'GigRadar', 'home'].includes(slug)) return null;
  return `https://www.facebook.com/${slug}`;
}

async function fetchWebsiteEvents(venue) {
  if (!venue.website) return { gigs: [], facebookUrl: null };

  let baseUrl = venue.website;
  if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;

  const gigs = [];
  let facebookUrl = null;

  try {
    const result = await findEventsPage(baseUrl);
    if (!result) return { gigs: [], facebookUrl: null };

    const { html } = result;

    // Extract Facebook page URL from website
    facebookUrl = extractFacebookPageUrl(html);

    // Parse JSON-LD events
    const today = new Date().toISOString().split('T')[0];
    const ldEvents = extractJsonLdEvents(html);

    for (const ev of ldEvents) {
      try {
        const startDate = ev.startDate || ev.startdate;
        if (!startDate) continue;
        const date = startDate.split('T')[0];
        if (date < today) continue;

        // Get performer(s)
        const performers = Array.isArray(ev.performer) ? ev.performer : ev.performer ? [ev.performer] : [];
        const artistName = performers[0]?.name || ev.name?.replace(/\s*@\s*.+$/, '').trim();
        if (!artistName) continue;

        const artist = await autoSeedArtist(artistName);
        if (!artist) continue;

        const support = performers.slice(1).map(p => p.name).filter(Boolean);
        for (const s of support) await autoSeedArtist(s);

        const ticketUrl = Array.isArray(ev.offers) ? ev.offers[0]?.url : ev.offers?.url;
        const price     = Array.isArray(ev.offers) ? ev.offers[0]?.price : ev.offers?.price;

        gigs.push({
          gigId:            `web-${normaliseName(venue.name)}-${artist.artistId}-${date}`,
          dedupKey:         dedupKey(artist.artistId, date, venue.name),
          artistId:         artist.artistId,
          artistName:       artist.name,
          date,
          doorsTime:        startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) : null,
          venueName:        venue.name,
          venueCity:        venue.city || '',
          venueCountry:     'GB',
          canonicalVenueId: toVenueId(venue.name, venue.city),
          isSoldOut:        false,
          minAge:           null,
          supportActs:      support,
          tickets: [{
            seller:    venue.name,
            url:       ticketUrl || baseUrl,
            available: true,
            price:     price ? `£${price}` : 'See site',
          }],
          sources:     ['venue-website'],
          lastUpdated: new Date().toISOString(),
        });
      } catch {}
    }
  } catch (e) { console.error(`  Website error for ${venue.name}:`, e.message?.substring(0, 80)); }

  return { gigs, facebookUrl };
}

// ─── 4. FACEBOOK events (requires Graph API token) ────────────────────────────

async function fetchFacebookEvents(venue) {
  if (!FB_TOKEN || !venue.facebookPageId) return [];
  // venue.facebookPageId = 'VenueName' or numeric page ID
  try {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(venue.facebookPageId)}/events` +
      `?fields=name,start_time,end_time,description,ticket_uri,place` +
      `&since=${today}&limit=50&access_token=${FB_TOKEN}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'GigRadar/1.0' } });
    if (!r.ok) return [];
    const data = await r.json();
    if (data.error) { console.error(`  FB error for ${venue.name}:`, data.error.message); return []; }

    const gigs = [];
    for (const ev of (data.data || [])) {
      const date = ev.start_time?.split('T')[0];
      if (!date) continue;
      const artistName = ev.name?.replace(/\s*@\s*.+$/, '').trim();
      const artist = await autoSeedArtist(artistName);
      if (!artist) continue;

      gigs.push({
        gigId:            `fb-${venue.facebookPageId}-${ev.id}`,
        dedupKey:         dedupKey(artist.artistId, date, venue.name),
        artistId:         artist.artistId,
        artistName:       artist.name,
        date,
        doorsTime:        ev.start_time?.split('T')[1]?.substring(0, 5) || null,
        venueName:        venue.name,
        venueCity:        venue.city || '',
        venueCountry:     'GB',
        canonicalVenueId: toVenueId(venue.name, venue.city),
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
      });
    }
    return gigs;
  } catch (e) { console.error(`  Facebook error for ${venue.name}:`, e.message); return []; }
}

// ─── Update venue Facebook page ID ───────────────────────────────────────────

async function saveFacebookPageUrl(venue, facebookUrl) {
  if (!facebookUrl || DRY_RUN) return;
  const slug = facebookUrl.replace('https://www.facebook.com/', '');
  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: venue.venueId || toVenueId(venue.name, venue.city) },
    UpdateExpression: 'SET facebook = if_not_exists(facebook, :fb), facebookPageId = if_not_exists(facebookPageId, :id)',
    ExpressionAttributeValues: { ':fb': facebookUrl, ':id': slug },
  })).catch(() => {});
}

// ─── Dedup + merge gigs ───────────────────────────────────────────────────────

function mergeGigs(gigArrays) {
  const map = new Map();
  for (const gigs of gigArrays) {
    for (const gig of gigs) {
      if (!map.has(gig.dedupKey)) {
        map.set(gig.dedupKey, gig);
      } else {
        // Merge ticket sources
        const existing = map.get(gig.dedupKey);
        for (const ticket of gig.tickets) {
          if (!existing.tickets.find(t => t.seller === ticket.seller)) {
            existing.tickets.push(ticket);
          }
        }
        existing.sources = [...new Set([...existing.sources, ...gig.sources])];
        if (!existing.supportActs?.length && gig.supportActs?.length) {
          existing.supportActs = gig.supportActs;
        }
      }
    }
  }
  return [...map.values()];
}

// ─── Update upcoming count for venue ─────────────────────────────────────────

async function updateVenueUpcoming(venue, count) {
  if (DRY_RUN || count === 0) return;
  const venueId = venue.venueId || toVenueId(venue.name, venue.city);
  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId },
    UpdateExpression: 'SET upcoming = :u, lastUpdated = :t',
    ExpressionAttributeValues: { ':u': count, ':t': new Date().toISOString() },
  })).catch(() => {});
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Venue-Centric Gig Scraper ===\n');
  if (DRY_RUN)     console.log('[DRY RUN — no DB writes]\n');
  if (ONLY_SOURCE) console.log(`[Source filter: ${ONLY_SOURCE}]\n`);
  if (FB_TOKEN)    console.log('[Facebook events enabled]\n');

  const venues   = await loadVenues();
  const progress = loadProgress();
  const today    = new Date().toISOString().split('T')[0];

  // Apply batch window
  const batch = venues.slice(OFFSET, OFFSET + BATCH_SIZE);
  console.log(`Processing ${batch.length} venues (offset ${OFFSET}, batch ${BATCH_SIZE} of ${venues.length} total)\n`);

  let totalGigs = 0, totalArtists = 0, venuesDone = 0;

  for (const venue of batch) {
    if (!venue.name) continue;
    const label = `${venue.name} (${venue.city || '?'})`;

    const allGigs = [];
    const counts  = [];
    process.stdout.write(`  [${String(venuesDone + 1).padStart(4)}] ${label.substring(0, 45).padEnd(45)}`);

    // 1. Skiddle
    if (!ONLY_SOURCE || ONLY_SOURCE === 'skiddle') {
      if (venue.skiddleId) {
        const gigs = await fetchSkiddleVenueEvents(venue);
        allGigs.push(...gigs);
        if (gigs.length) counts.push(`Skiddle=${gigs.length}`);
        await sleep(300);
      }
    }

    // 2. Songkick
    if (!ONLY_SOURCE || ONLY_SOURCE === 'songkick') {
      const gigs = await fetchSongkickVenueEvents(venue, progress);
      allGigs.push(...gigs);
      if (gigs.length) counts.push(`SK=${gigs.length}`);
      await sleep(500);
    }

    // 3. Venue website
    if (!ONLY_SOURCE || ONLY_SOURCE === 'website') {
      if (venue.website) {
        const { gigs, facebookUrl } = await fetchWebsiteEvents(venue);
        allGigs.push(...gigs);
        if (gigs.length) counts.push(`Web=${gigs.length}`);
        if (facebookUrl) {
          counts.push(`FB✓`);
          await saveFacebookPageUrl(venue, facebookUrl);
        }
        await sleep(1000);
      }
    }

    // 4. Facebook (if token + page ID found)
    if ((!ONLY_SOURCE || ONLY_SOURCE === 'facebook') && FB_TOKEN) {
      const fbGigs = await fetchFacebookEvents(venue);
      allGigs.push(...fbGigs);
      if (fbGigs.length) counts.push(`FB=${fbGigs.length}`);
    }

    // Merge, dedup, save
    const merged   = mergeGigs([allGigs]);
    const upcoming = merged.filter(g => g.date >= today).length;

    if (merged.length > 0) {
      console.log(`${counts.join(' | ')} → ${merged.length} gigs (${upcoming} upcoming)`);
      for (const gig of merged) {
        if (!DRY_RUN) await saveGig(gig);
        totalGigs++;
      }
      await updateVenueUpcoming(venue, upcoming);
    } else {
      console.log('—');
    }

    venuesDone++;
    saveProgress(progress); // save after each venue so Songkick IDs are cached
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✓ Done`);
  console.log(`  Venues processed  : ${venuesDone}`);
  console.log(`  Gigs saved        : ${totalGigs}`);
  console.log(`  Artists seeded    : ${seededThisRun.size}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
}

main().catch(e => { console.error(e); process.exit(1); });
