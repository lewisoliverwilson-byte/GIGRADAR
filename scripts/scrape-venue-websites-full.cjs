#!/usr/bin/env node
/**
 * Full venue website scraper — runs locally, not in Lambda.
 * For every venue with a real website (not a ticketing platform URL), crawls
 * the events section using multiple strategies:
 *   1. JSON-LD MusicEvent / Event schema
 *   2. Schema.org microdata (itemtype)
 *   3. Direct Dice.fm event links (artist name in URL slug)
 *   4. Direct Eventbrite event links (fetch JSON-LD from event page)
 *   5. HTML pattern matching (event class blocks with artist + date)
 *   6. Detects embedded platform widgets → saves to ticketingUrls for Lambda
 *
 * Usage:
 *   node scripts/scrape-venue-websites-full.cjs [--limit=200] [--workers=5]
 *   node scripts/scrape-venue-websites-full.cjs --venue="O2 Academy Brixton"
 *   node scripts/scrape-venue-websites-full.cjs --dry-run   # no DB writes
 */
'use strict';

const path = require('path');
const SDK  = p => require(path.join(__dirname, '../lambda/scraper/node_modules', p));

const { DynamoDBClient }                                       = SDK('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand, PutCommand, GetCommand } = SDK('@aws-sdk/lib-dynamodb');

const ddb          = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const VENUES_TABLE = 'gigradar-venues';
const GIGS_TABLE   = 'gigradar-gigs';
const ARTISTS_TABLE = 'gigradar-artists';
const LIMIT        = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '500', 10);
const WORKERS      = parseInt(process.argv.find(a => a.startsWith('--workers='))?.split('=')[1] || '3', 10);
const VENUE_FILTER = process.argv.find(a => a.startsWith('--venue='))?.split('=').slice(1).join('=');
const DRY_RUN      = process.argv.includes('--dry-run');
const DEBUG        = process.argv.includes('--debug');
const sleep        = ms => new Promise(r => setTimeout(r, ms));
const dbg = (...args) => DEBUG && console.error('[DBG]', ...args);

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

// Domains that are ticketing platforms, not venue own sites — skip these
const TICKETING_URL = /ticketmaster|seetickets\.com|eventbrite\.|skiddle\.com|dice\.fm|songkick\.com|wegottickets|ticketweb|gigantic\.com|ents24\.com|bandsintown|axs\.com|gigsandtours/i;

const EVENT_PATHS = [
  '', '/events', '/whats-on', '/gigs', '/whatson', '/listings', '/calendar',
  '/shows', '/tickets', '/upcoming', '/programme', '/diary', '/live',
  '/events/music', '/events/gigs', '/events/live', '/music', '/live-music',
  '/whats-on/music', '/whats-on/gigs', '/whats-on/live-music',
  '/events/upcoming', '/all-events', '/schedule', '/gig-guide',
  '/events/list', '/index', '/events/index', '/whats-on/index',
];

// ─── Name helpers ─────────────────────────────────────────────────────────────

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toArtistId(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function dedupKey(artistId, date, venueName) {
  return `${artistId}|${date}|${normaliseName(venueName)}`;
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}

const TRIBUTE_RE  = /tribute|cover band|salute to|the music of|\bcovers\b|in the style of|celebrating |legacy of |experience\b/i;
const GENERIC_RE  = /^(live music|open mic|various artists?|dj night|club night|karaoke|quiz night|comedy night|open stage|acoustic night|local bands?|tba|tbc|doors? open|music night|gig night|new year|christmas|halloween|valentines?|mothers? day|fathers? day|bank holiday)$/i;
const MONTH_NAMES = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

function isValidArtist(name) {
  if (!name || name.trim().length < 2 || name.trim().length > 80) return false;
  if (GENERIC_RE.test(name.trim())) return false;
  if (TRIBUTE_RE.test(name)) return false;
  if (/ @ /.test(name) || /\bpresents[:\-]/i.test(name)) return false;
  if (MONTH_NAMES.test(name) && /\d{4}|\d{1,2}(?:st|nd|rd|th)/.test(name)) return false; // date strings
  return true;
}

function extractArtistFromTitle(evName) {
  let s = (evName || '')
    .replace(/\s+—\s+[^—]+$/, '') // strip trailing venue "— Venue Name"
    .trim();
  // If there's a pipe separator, take the part AFTER the last pipe (artist)
  if (s.includes('|')) {
    s = s.split('|').pop().trim();
  }
  return s
    .replace(/\s*\bft\.?\s+.+$/i, '')
    .replace(/\s*\bfeat(?:uring)?\.?\s+.+$/i, '')
    .replace(/\s*[:–—]\s*.*$/, '')   // strip tour name after colon/dash
    .replace(/\s+(?:live|tour|concert|show)\s*$/i, '')
    .replace(/\s+(?:at|in)\s+[A-Z].+$/i, '')
    .trim();
}

// ─── Artist upsert ────────────────────────────────────────────────────────────

const nameMapCache = {};

async function getOrCreateArtist(rawName) {
  const norm = normaliseName(rawName);
  if (nameMapCache[norm]) return nameMapCache[norm];

  const artistId = toArtistId(rawName);
  if (!artistId || artistId.length < 2) return null;

  const existing = await ddb.send(new GetCommand({ TableName: ARTISTS_TABLE, Key: { artistId } })).catch(() => ({ Item: null }));
  if (existing.Item) {
    nameMapCache[norm] = { id: artistId, name: existing.Item.name };
    return nameMapCache[norm];
  }

  if (!DRY_RUN) {
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: 'SET #n = if_not_exists(#n, :n), isGrassroots = if_not_exists(isGrassroots, :gr), country = if_not_exists(country, :c), genres = if_not_exists(genres, :g), upcoming = if_not_exists(upcoming, :u), lastUpdated = :t',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':n': rawName, ':gr': true, ':c': 'UK', ':g': [], ':u': 0, ':t': new Date().toISOString() },
    })).catch(() => {});
  }

  const entry = { id: artistId, name: rawName };
  nameMapCache[norm] = entry;
  return entry;
}

// ─── JSON-LD extraction ───────────────────────────────────────────────────────

function extractJsonLdEvents(html) {
  const events = [];
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const data  = JSON.parse(json);
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const item of items) {
        if (item['@type'] === 'MusicEvent' || item['@type'] === 'Event') events.push(item);
        if (item['@type'] === 'ItemList' || item.itemListElement) {
          for (const el of (item.itemListElement || [])) {
            const ev = el.item || el;
            if (ev['@type'] === 'MusicEvent' || ev['@type'] === 'Event') events.push(ev);
          }
        }
      }
    } catch {}
  }
  return events;
}

// ─── Schema.org microdata extraction ─────────────────────────────────────────

function extractMicrodata(html) {
  const events = [];
  for (const [, block] of html.matchAll(/<[^>]+itemtype="[^"]*(?:MusicEvent|Event)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article|section|li)>/gi)) {
    const name   = block.match(/itemprop="name"[^>]*>([^<]+)/i)?.[1]?.trim();
    const date   = block.match(/itemprop="startDate"[^>]*(?:content="([^"]+)"|>([^<]+))/i);
    const dateVal = date?.[1] || date?.[2];
    if (!name || !dateVal) continue;
    events.push({ '@type': 'MusicEvent', name, startDate: dateVal.trim() });
  }
  return events;
}

// ─── Dice.fm direct link extraction ──────────────────────────────────────────
// Dice event URLs: dice.fm/event/{id}-{artist-slug}-{date}-{venue-slug}-tickets
// Artist name is in the slug between the ID and the date

const DICE_DATE_MARKERS = /-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

function parseDiceSlug(slug) {
  // Remove -tickets suffix
  const s = slug.replace(/-tickets$/, '').replace(/\?.*$/, '');
  // Split on known date markers
  const dateMatch = s.match(/^([^-]+-)([\s\S]+?)-((?:\d+[a-z]{2}|[a-z]+)-(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-\d+)/i);
  if (dateMatch) {
    // Group 2 is the artist slug, group 3 is the date fragment
    const artistSlug = dateMatch[2];
    const dateStr    = dateMatch[3];
    const artistName = artistSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    // Parse rough date from "1st-apr-2026" or "apr-1-2026"
    const dp = dateStr.match(/(\d+)[a-z]*-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-(\d{4})/i)
            || dateStr.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-(\d+)-(\d{4})/i);
    let date = null;
    if (dp) {
      const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
      const isAlt = isNaN(parseInt(dp[1]));
      const day   = isAlt ? parseInt(dp[2]) : parseInt(dp[1]);
      const mon   = MONTHS[(isAlt ? dp[1] : dp[2]).toLowerCase().slice(0,3)] || 0;
      const yr    = parseInt(isAlt ? dp[3] : dp[3]);
      if (day && mon && yr) date = `${yr}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    return { artistName, date };
  }
  return null;
}

function extractDiceEvents(html) {
  const events = [];
  for (const [, url] of html.matchAll(/href="(https?:\/\/(?:link\.)?dice\.fm\/event\/([^"?]+))"/gi)) {
    const slug   = url.split('/event/')[1] || '';
    const parsed = parseDiceSlug(slug);
    if (!parsed?.artistName || !parsed?.date) continue;
    events.push({
      '@type': 'Event',
      name: parsed.artistName,
      startDate: parsed.date,
      offers: { url },
      _platform: 'dice',
    });
  }
  return events;
}

// ─── Eventbrite direct link extraction ───────────────────────────────────────

function extractEventbriteLinks(html) {
  const urls = new Set();
  for (const [, url] of html.matchAll(/href="(https?:\/\/(?:www\.)?eventbrite\.co\.uk\/e\/[^"?]+)"/gi)) urls.add(url);
  for (const [, url] of html.matchAll(/href="(https?:\/\/(?:www\.)?eventbrite\.com\/e\/[^"?]+)"/gi)) urls.add(url);
  return [...urls];
}

async function fetchEventbriteEventDetails(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = await res.text();
    const events = extractJsonLdEvents(html);
    return events[0] || null;
  } catch { return null; }
}

// ─── HTML pattern extraction (fallback for non-structured sites) ──────────────

const DATE_RE = /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/gi;
const MONTHS  = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function parseHtmlDate(str) {
  const m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  DATE_RE.lastIndex = 0;
  const m2 = DATE_RE.exec(str);
  if (!m2) return null;
  const month = MONTHS[m2[2].slice(0, 3).toLowerCase()];
  const d = new Date(parseInt(m2[3]), month, parseInt(m2[1]));
  return d.toISOString().split('T')[0];
}

function extractHtmlPatternEvents(html) {
  const events = [];
  const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  const eventBlockRe = /<(?:article|div|li)[^>]+class="[^"]*(?:event|gig|show|listing|gig-entry|event-item)[^"]*"[^>]*>([\s\S]{30,1200}?)<\/(?:article|div|li)>/gi;
  for (const [, block] of cleaned.matchAll(eventBlockRe)) {
    const textContent = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const date = parseHtmlDate(textContent);
    if (!date) continue;

    const titleMatch = block.match(/<(?:h[1-4]|[^>]+class="[^"]*(?:title|name|artist|act|headline|event-title|act-name)[^"]*")[^>]*>([^<]{2,80})<\//i);
    const rawName = titleMatch?.[1]?.replace(/&amp;/g, '&').replace(/&#[0-9]+;/g, '').trim();
    if (!rawName || !isValidArtist(rawName)) continue;

    const linkMatch = block.match(/href="([^"]+(?:ticket|book|buy)[^"]*?)"/i) || block.match(/href="(https?:\/\/[^"]+)"/i);

    events.push({
      '@type': 'Event',
      name: rawName,
      startDate: date,
      offers: linkMatch ? { url: linkMatch[1] } : undefined,
    });
  }
  return events;
}

// ─── Platform widget / link detection ────────────────────────────────────────

function detectPlatformLinks(html, baseUrl) {
  const platforms = {};

  // Ticketmaster widget or embedded page
  const tmMatch = html.match(/ticketmaster\.co\.uk[^"']*\/venue\/(\d+)/i)
                || html.match(/data-venue-id="(\d+)"/i);
  if (tmMatch) platforms.ticketmaster = `https://www.ticketmaster.co.uk/venue/${tmMatch[1]}`;

  // Eventbrite organizer page
  const ebOrgMatch = html.match(/eventbrite\.co\.uk\/o\/([^"'/?\s]+)/i);
  if (ebOrgMatch) platforms.eventbrite = `https://www.eventbrite.co.uk/o/${ebOrgMatch[1]}`;

  // Dice venue page
  const diceMatch = html.match(/dice\.fm\/venue\/([^"'/?\s]+)/i)
                  || html.match(/dice\.fm\/partner\/([^"'/?\s]+)/i);
  if (diceMatch) platforms.dice = `https://dice.fm/venue/${diceMatch[1]}`;

  // See Tickets widget
  const seeTMatch = html.match(/seetickets\.com\/tour\/(\d+)/i)
                  || html.match(/widget\.seetickets\.com[^"']*\/([^"'?&]+)/i);
  if (seeTMatch) platforms.seetickets = seeTMatch[0].startsWith('http') ? seeTMatch[0] : `https://www.seetickets.com/tour/${seeTMatch[1]}`;

  // Songkick
  const skMatch = html.match(/songkick\.com\/venues\/(\d+-[^"'/?\s]+)/i);
  if (skMatch) platforms.songkick = `https://www.songkick.com/venues/${skMatch[1]}`;

  return platforms;
}

// ─── Squarespace / WordPress event link extraction ───────────────────────────
// Squarespace: /{path}/{YYYY}/{M}/{D}/{slug}
// Fetches each event's iCal (354 bytes) to get proper title + date

const SQSP_EVENT_SRC = /href="(\/[^"?#]+\/\d{4}\/\d{1,2}\/\d{1,2}\/[^"?#]+)(?:\?format=ical)?"/i.source;

function extractEventPageLinks(html, baseUrl) {
  const links = new Set();
  // Squarespace event URL pattern — create fresh regex each call to avoid lastIndex issues
  const re = new RegExp(SQSP_EVENT_SRC, 'gi');
  for (const [, path] of html.matchAll(re)) {
    if (path.includes('/format=') || path.includes('?')) continue;
    try { links.add(new URL(path, baseUrl).href); } catch {}
  }
  // WordPress-style event links: /event/event-name or /events/event-name
  for (const [, url] of html.matchAll(/href="(https?:\/\/[^"?#]+\/events?\/[^"?#/]{5,100})"/gi)) {
    links.add(url);
  }
  return [...links].slice(0, 30);
}

function parseIcal(text) {
  const summary = text.match(/SUMMARY:(.+)/)?.[1]?.trim();
  const dtstart = text.match(/DTSTART:([^\r\n]+)/)?.[1]?.trim();
  if (!summary || !dtstart) return null;
  const date = dtstart.match(/(\d{4})(\d{2})(\d{2})/);
  return date ? { name: summary, startDate: `${date[1]}-${date[2]}-${date[3]}` } : null;
}

async function fetchEventPageEvents(links, baseUrl) {
  const events = [];
  for (const link of links) {
    // Prefer iCal (tiny) if looks like Squarespace
    const icalUrl = link.includes('/whats-on/') || link.match(/\/\d{4}\/\d{1,2}\/\d{1,2}\//)
      ? link + '?format=ical' : null;
    try {
      if (icalUrl) {
        const res = await fetch(icalUrl, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const text = await res.text();
          if (text.includes('VEVENT')) {
            const ev = parseIcal(text);
            if (ev) { events.push({ ...ev, '@type': 'Event', _sourceUrl: link }); await sleep(100); continue; }
          }
        }
      }
      // Fall back to fetching full page for JSON-LD
      const res = await fetch(link, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const html = await res.text();
        const ld = extractJsonLdEvents(html);
        events.push(...ld.map(e => ({ ...e, _sourceUrl: link })));
      }
    } catch {}
    await sleep(200);
  }
  return events;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function findNextPageUrl(html, currentUrl) {
  const patterns = [
    /href="([^"]+)"\s*[^>]*>(?:\s*(?:next|›|→|»|&rsaquo;|&raquo;|more events?|load more)\s*)<\//gi,
    /(?:class|rel)="[^"]*(?:next|pagination-next)[^"]*"[^>]*href="([^"]+)"/gi,
    /href="([^"]+)"[^>]*rel="next"/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(html);
    if (m) {
      try { return new URL(m[1], currentUrl).href; } catch {}
    }
  }
  return null;
}

// ─── Process a single URL for events ─────────────────────────────────────────

async function scrapePageForEvents(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { events: [], platforms: {}, nextUrl: null };
    const html     = await res.text();
    const jsonLd   = extractJsonLdEvents(html);
    const micro    = extractMicrodata(html);
    const dice     = extractDiceEvents(html);
    const pattern  = (jsonLd.length + micro.length + dice.length) === 0 ? extractHtmlPatternEvents(html) : [];
    const platforms = detectPlatformLinks(html, url);
    const nextUrl  = findNextPageUrl(html, url);
    return { events: [...jsonLd, ...micro, ...dice, ...pattern], platforms, nextUrl, html };
  } catch { return { events: [], platforms: {}, nextUrl: null, html: '' }; }
}

// ─── Scrape a single venue ────────────────────────────────────────────────────

async function scrapeVenue(venue) {
  let base = (venue.website || '').trim();
  if (!base.startsWith('http')) base = 'https://' + base;
  base = base.replace(/\/$/, '');

  // Skip ticketing platform URLs
  if (TICKETING_URL.test(base)) return { gigs: [], newPlatforms: {} };

  const today      = new Date().toISOString().split('T')[0];
  const allEvents  = [];
  const allPlatforms = {};
  const triedUrls  = new Set();

  // Phase 1: try common event paths
  let foundPath = null;
  for (const p of EVENT_PATHS) {
    const url = `${base}${p}`;
    if (triedUrls.has(url)) continue;
    triedUrls.add(url);

    const result = await scrapePageForEvents(url);
    Object.assign(allPlatforms, result.platforms);

    if (result.events.length > 0) {
      allEvents.push(...result.events.map(e => ({ ...e, _sourceUrl: url })));
      foundPath = url;

      // Phase 2: follow pagination
      let next = result.nextUrl;
      let pageCount = 0;
      while (next && !triedUrls.has(next) && pageCount < 10) {
        triedUrls.add(next);
        const pg = await scrapePageForEvents(next);
        if (!pg.events.length) break;
        allEvents.push(...pg.events.map(e => ({ ...e, _sourceUrl: next })));
        Object.assign(allPlatforms, pg.platforms);
        next = pg.nextUrl;
        pageCount++;
        await sleep(400);
      }
      break;
    }
    await sleep(150);
  }

  // Phase 3: if no structured events found, try per-platform link extraction
  dbg(`Phase 3 starting, allEvents=${allEvents.length}`);
  if (allEvents.length === 0) {
    // Collect all page HTMLs we've seen
    const pageHtmls = [];
    for (const p of EVENT_PATHS.slice(0, 5)) {
      const url = `${base}${p}`;
      try {
        const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (!res.ok) { dbg(`${url}: ${res.status}`); continue; }
        const html = await res.text();
        dbg(`${url}: 200, ${html.length}b`);
        pageHtmls.push({ url, html });
        Object.assign(allPlatforms, detectPlatformLinks(html, url));
        if (pageHtmls.length >= 2) break; // Don't hammer the server
      } catch(e) { dbg(`${url}: ERR ${e.message}`); }
      await sleep(200);
    }

    dbg(`pageHtmls count: ${pageHtmls.length}`);
    for (const { url, html } of pageHtmls) {
      // Squarespace / WordPress event pages
      const eventPageLinks = extractEventPageLinks(html, url);
      dbg(`eventPageLinks from ${url}: ${eventPageLinks.length}`);
      const newLinks = eventPageLinks.filter(l => !triedUrls.has(l));
      dbg(`newLinks: ${newLinks.length}`);
      newLinks.forEach(l => triedUrls.add(l));
      if (newLinks.length > 0) {
        const evPageEvents = await fetchEventPageEvents(newLinks, url);
        dbg(`evPageEvents: ${evPageEvents.length}`);
        allEvents.push(...evPageEvents);
      }

      // Eventbrite individual event links
      const ebLinks = extractEventbriteLinks(html);
      for (const ebUrl of ebLinks.slice(0, 10)) {
        if (triedUrls.has(ebUrl)) continue;
        triedUrls.add(ebUrl);
        const ev = await fetchEventbriteEventDetails(ebUrl);
        if (ev) allEvents.push({ ...ev, _sourceUrl: ebUrl, _platform: 'eventbrite' });
        await sleep(300);
      }

      // Dice direct links
      const diceEvents = extractDiceEvents(html);
      allEvents.push(...diceEvents.map(e => ({ ...e, _sourceUrl: url })));

      if (allEvents.length > 0) break;
    }
  }

  // Convert events → gigs
  dbg(`Converting ${allEvents.length} events to gigs`);
  const gigs = [];
  const seen = new Set();

  for (const ev of allEvents) {
    dbg(`Processing ev: name="${ev.name}" startDate="${ev.startDate}"`);
    const date = (ev.startDate || '').split('T')[0];
    if (!date || date < today) { dbg(`Skip date: "${date}" < "${today}"`); continue; }

    const performers = Array.isArray(ev.performer) ? ev.performer : ev.performer ? [ev.performer] : [];
    let rawName = performers[0]?.name || extractArtistFromTitle(ev.name || '');
    dbg(`rawName: "${rawName}"`);
    if (!isValidArtist(rawName)) { dbg(`Invalid artist: "${rawName}" from "${ev.name}"`); continue; }

    const dk = `${normaliseName(rawName)}|${date}`;
    if (seen.has(dk)) continue;
    seen.add(dk);

    const artist = await getOrCreateArtist(rawName);
    dbg(`artist: ${JSON.stringify(artist)}`);
    if (!artist) continue;

    const support   = performers.slice(1).map(p => p.name).filter(isValidArtist);
    const ticketUrl = Array.isArray(ev.offers) ? ev.offers[0]?.url : ev.offers?.url;
    const price     = Array.isArray(ev.offers) ? ev.offers[0]?.price : ev.offers?.price;
    const platform  = ev._platform || 'venue-website';

    gigs.push({
      gigId:            `web-${normaliseName(venue.name)}-${artist.id}-${date}`,
      dedupKey:         dedupKey(artist.id, date, venue.name),
      artistId:         artist.id,
      artistName:       artist.name,
      date,
      doorsTime:        ev.startDate?.includes('T') ? ev.startDate.split('T')[1]?.slice(0, 5) : null,
      venueName:        venue.name,
      venueId:          venue.venueId,
      venueCity:        venue.city || '',
      venueCountry:     'GB',
      canonicalVenueId: toVenueId(venue.name, venue.city || ''),
      isSoldOut:        false,
      supportActs:      support,
      tickets: [{
        seller:    platform === 'venue-website' ? venue.name : platform,
        url:       ticketUrl || ev._sourceUrl || base,
        available: true,
        price:     price ? `£${price}` : 'See site',
      }],
      sources:     [platform],
      lastUpdated: new Date().toISOString(),
    });
  }

  return { gigs, newPlatforms: allPlatforms };
}

// ─── Load venues ──────────────────────────────────────────────────────────────

async function loadVenues() {
  const venues = [];
  let lastKey;
  do {
    const params = {
      TableName: VENUES_TABLE,
      ProjectionExpression: 'venueId, #n, city, website, ticketingUrls, lastWebScraped',
      ExpressionAttributeNames: { '#n': 'name' },
      FilterExpression: 'attribute_exists(website) AND isActive = :a',
      ExpressionAttributeValues: { ':a': true },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    venues.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return venues;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

async function processVenue(venue, idx, total) {
  process.stdout.write(`[${idx}/${total}] ${venue.name} → `);
  const { gigs, newPlatforms } = await scrapeVenue(venue);

  let saved = gigs.length;
  if (!DRY_RUN) {
    for (const gig of gigs) {
      await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: gig })).catch(() => {});
    }

    // Merge any newly discovered platform links into ticketingUrls
    const mergedPlatforms = { ...(venue.ticketingUrls || {}), ...newPlatforms };
    const hasPlatforms = Object.keys(newPlatforms).length > 0;
    const platformsChanged = hasPlatforms && Object.entries(newPlatforms).some(([k, v]) => mergedPlatforms[k] !== venue.ticketingUrls?.[k]);

    const updateExpr = platformsChanged
      ? 'SET lastWebScraped = :t, ticketingUrls = :p'
      : 'SET lastWebScraped = :t';
    const exprVals = platformsChanged
      ? { ':t': new Date().toISOString(), ':p': mergedPlatforms }
      : { ':t': new Date().toISOString() };

    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: venue.venueId },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: exprVals,
    })).catch(() => {});
  }

  const platformStr = Object.keys(newPlatforms).length ? ` [+${Object.keys(newPlatforms).join(',')}]` : '';
  console.log(`${saved} gigs${platformStr}${DRY_RUN ? ' (dry-run)' : ''}`);
  return saved;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (DRY_RUN) console.log('DRY RUN — no DB writes\n');
  console.log('Loading venues with websites…');
  let venues = await loadVenues();

  // Filter out ticketing platform URLs
  venues = venues.filter(v => v.website && !TICKETING_URL.test(v.website));

  if (VENUE_FILTER) {
    venues = venues.filter(v => v.name.toLowerCase().includes(VENUE_FILTER.toLowerCase()));
    console.log(`Filtered to: ${venues.length} matching "${VENUE_FILTER}"`);
  } else {
    venues.sort((a, b) => {
      if (!a.lastWebScraped && !b.lastWebScraped) return 0;
      if (!a.lastWebScraped) return -1;
      if (!b.lastWebScraped) return 1;
      return a.lastWebScraped < b.lastWebScraped ? -1 : 1;
    });
    venues = venues.slice(0, LIMIT);
  }

  console.log(`Processing ${venues.length} venues with ${WORKERS} parallel workers\n`);

  let totalGigs = 0;
  for (let i = 0; i < venues.length; i += WORKERS) {
    const batch = venues.slice(i, i + WORKERS);
    const results = await Promise.all(
      batch.map((v, j) => processVenue(v, i + j + 1, venues.length))
    );
    totalGigs += results.reduce((a, b) => a + b, 0);
    await sleep(500);
  }

  console.log(`\nDone. Total gigs saved: ${totalGigs}`);
})();
