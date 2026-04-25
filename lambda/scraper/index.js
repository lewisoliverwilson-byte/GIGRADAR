/**
 * GigRadar Scraper — Multi-source UK gig ingestion
 *
 * Sources:
 *   1. Last.fm        — top 1000 UK artists (ranking signal)
 *   2. Ticketmaster   — major venues, API
 *   3. Bandsintown    — indie/mid-size, free API
 *   4. Skiddle        — UK clubs & gigs, free API (UK only)
 *   (Bandsintown removed — API now returns 403)
 *   5. Songkick       — broad listings, scraped
 *   6. Dice.fm        — London indie/electronic, scraped API
 *   7. Resident Advisor — electronic, GraphQL
 *   8. See Tickets    — UK wide, scraped
 *   9. Gigantic       — UK indie/alt, scraped
 *  10. WeGotTickets   — grassroots venues, scraped
 *  11. Eventbrite     — smaller events, scraped
 */

const { DynamoDBClient }                             = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

const LASTFM_KEY      = process.env.LASTFM_API_KEY;
const TM_KEY          = process.env.TICKETMASTER_API_KEY;
const SKIDDLE_KEY     = process.env.SKIDDLE_API_KEY     || '';
const SETLISTFM_KEY   = process.env.SETLISTFM_API_KEY   || '';
const ARTISTS_TABLE   = 'gigradar-artists';
const GIGS_TABLE      = 'gigradar-gigs';
const VENUES_TABLE    = 'gigradar-venues';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Name normalisation ──────────────────────────────────────────────────────

function normaliseName(name) {
  return (name || '').toLowerCase()
    .replace(/^the /, '')
    .replace(/[^a-z0-9]/g, '');
}

function toArtistId(name) {
  const id = (name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return id;
}

// ─── Tribute / cover band filter ────────────────────────────────────────────
// Exclude events where the matched act name signals it's a cover/tribute act

// Comprehensive tribute/cover band detection — applied to both artist names AND event titles.
// Catches "Nirvana Tribute Night" via event title even when TM attraction is listed as "Nirvana".
const TRIBUTE_RE = /tribute|cover band|covers band|\bcovers\b|salute to|the music of|celebrating the music|songs of|the songs of|in the style of|a night of|an evening of|lives on|symphony of|story of|the story of|legacy of|anniversary show|anniversary tour|anniversary concert|plays the hits|performs the hits|greatest hits show|years of hits|through the years|honouring|honoring|in memory of|in tribute|a tribute to|vs\s|feat\.|featuring\s+the|experience\b|celebrating \w|performed by|starring/i;

function isTributeAct(name) {
  return TRIBUTE_RE.test(name || '');
}

// Non-music event genre keywords (Skiddle/Eventbrite send genre arrays)
const NON_MUSIC_GENRE_RE = /comedy|stand.?up|spoken word|cabaret|theatre|theater|magic|circus|variety|film|cinema|sport|fitness|quiz|bingo|gaming|esport/i;

const GENERIC_ACT_RE = /^(live music|open mic|various artists?|dj night|club night|karaoke|quiz night|comedy night|open stage|acoustic night|local bands?|tribute night|unsigned night|battle of the bands|bands? night|gig night|music night|headline act tba|tba|tbc|doors? open)$/i;

// Non-music event filter — event titles that indicate food, comedy, sport, dating etc.
const NON_MUSIC_RE = /\b(pizza|cooking class|cookery|food tour|wine tasting|cocktail making|speed dating|dating event|comedy club|stand.?up comedy|stand up comedy|comedy night|open mic comedy|paint.?night|painting class|yoga|fitness class|pilates|book club|quiz night|pub quiz|escape room|murder mystery|bingo|poker|gaming|e.?sports|football|rugby|cricket|tennis|golf|boxing|wrestling|basketball|art class|drawing class|pottery class|wreath making|flower arranging|gin tasting|beer tasting|whisky tasting|cheese tasting|chocolate making|sushi making|curry night|tapas night|networking event|business event|conference|seminar|workshop|exhibition|gallery|film screening|movie night|drag brunch|bottomless brunch|afternoon tea|halloween party|christmas party|nye party|new year party)\b/i;

function isNonMusicEvent(name) {
  return NON_MUSIC_RE.test(name || '');
}

// Patterns that indicate an event title rather than an artist name
const EVENT_TITLE_RE = /\bpresents[:\-\s]/i | / @ /;
const isEventTitle = name => {
  if (!name) return false;
  const n = name.trim();
  if (n.length > 60) return true;           // event descriptions are long
  if (/\bpresents[:\-]/i.test(n)) return true; // "X Presents: Y"
  if (/ @ /.test(n)) return true;           // "Artist @ Venue"
  if (/\bfestival\b/i.test(n)) return true; // "X Festival"
  // Multiple acts separated by + (e.g. "Artist A + Artist B + Artist C")
  if ((n.match(/ \+ /g) || []).length >= 2) return true;
  return false;
};

function isGenericName(name) {
  return !name || name.trim().length < 2 || GENERIC_ACT_RE.test(name.trim()) || isEventTitle(name);
}

// ─── Extract artist name from event title or URL slug ────────────────────────
// Handles: "Eric Clapton: Slowhand at 80" → "Eric Clapton"
//          "Coldplay - Music of the Spheres Tour" → "Coldplay"
//          "The 1975 live at O2" → "The 1975"
function extractArtistFromTitle(evName, evUrl) {
  let fromTitle = (evName || '')
    .replace(/\s*\bft\.?\s+.+$/i, '')
    .replace(/\s*\bfeat(?:uring)?\.?\s+.+$/i, '')
    .replace(/\s*[:\-–—|]\s*.*$/, '')
    .replace(/\s+(?:live|tour|concert|show)\s*$/i, '')
    .replace(/\s+(?:at|in)\s+[A-Z].+$/i, '')
    .trim();
  if (fromTitle.length >= 2 && fromTitle.length <= 70 && !isGenericName(fromTitle)) return fromTitle;

  const urlSlug = (evUrl || '').match(/\/e\/([^/?]+)/)?.[1] || '';
  if (!urlSlug) return '';
  return urlSlug
    .replace(/-tickets-\d+.*$/, '')
    .replace(/-(?:live|tour|concert|the)-.*$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// ─── Venue ID / slug helpers ─────────────────────────────────────────────────

function toVenueId(name, city) {
  return `venue#${normaliseName(name || '')}#${normaliseName(city || '')}`;
}

function toVenueSlug(name, city) {
  const slugify = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const n = slugify(name);
  const c = slugify(city);
  return c ? `${c}-${n}` : n;
}

// ─── Currency symbol helper ──────────────────────────────────────────────────

function currSym(code) {
  return { USD: '$', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', JPY: '¥', SEK: 'kr', NOK: 'kr', DKK: 'kr' }[code] || (code ? code + ' ' : '');
}

// ─── Last.fm: fetch top 1000 UK artists ─────────────────────────────────────

async function fetchLastfmArtists() {
  if (!LASTFM_KEY) { console.log('No Last.fm key'); return []; }
  const artists = [];
  for (let page = 1; page <= 20; page++) {
    try {
      const url  = `https://ws.audioscrobbler.com/2.0/?method=geo.getTopArtists&country=united+kingdom&limit=50&page=${page}&api_key=${LASTFM_KEY}&format=json`;
      const res  = await fetch(url);
      const data = await res.json();
      const items = data?.topartists?.artist || [];
      if (!items.length) break;
      items.forEach((a, i) => {
        const artistId = toArtistId(a.name);
        if (!artistId) return;
        artists.push({
          name:       a.name,
          artistId,
          normName:   normaliseName(a.name),
          listeners:  parseInt(a.listeners || 0, 10),
          lastfmRank: (page - 1) * 50 + i + 1,
          lastfmMbid: a.mbid || null,
        });
      });
    } catch (e) { console.error(`Last.fm page ${page}:`, e.message); }
    await sleep(250);
  }
  console.log(`Last.fm: ${artists.length} artists`);
  return artists;
}

// ─── Build artist lookup map ─────────────────────────────────────────────────

function buildNameMap(artists) {
  const map = {};
  artists.forEach(a => { map[a.normName || normaliseName(a.name)] = { id: a.artistId, name: a.name }; });
  return map;
}

// ─── Load all artists already in DynamoDB ───────────────────────────────────

async function loadAllArtistsFromDb() {
  const artists = [];
  let lastKey;
  do {
    const params = { TableName: ARTISTS_TABLE, ProjectionExpression: 'artistId, #n', ExpressionAttributeNames: { '#n': 'name' } };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    for (const item of (result.Items || [])) {
      if (!item.name || item.artistId.startsWith('_')) continue;
      artists.push({ artistId: item.artistId, name: item.name });
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  console.log(`DB artists loaded: ${artists.length}`);
  return artists;
}

// ─── Auto-seed a new grassroots artist ──────────────────────────────────────

async function autoSeedArtist(name, nameMap) {
  if (!name || isGenericName(name) || isTributeAct(name)) return null;
  const norm = normaliseName(name);
  if (nameMap[norm]) return nameMap[norm];
  const artistId = toArtistId(name);
  if (!artistId || artistId.length < 2) return null;

  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId },
    UpdateExpression: `SET #n = if_not_exists(#n, :n),
      isGrassroots = if_not_exists(isGrassroots, :gr),
      country      = if_not_exists(country,      :c),
      genres       = if_not_exists(genres,        :g),
      upcoming     = if_not_exists(upcoming,      :u),
      lastUpdated  = :t`,
    ExpressionAttributeNames: { '#n': 'name' },
    ExpressionAttributeValues: {
      ':n': name, ':gr': true, ':c': 'UK',
      ':g': [], ':u': 0, ':t': new Date().toISOString(),
    },
  })).catch(() => {});

  const entry = { id: artistId, name };
  nameMap[norm] = entry;
  return entry;
}

// ─── Gig deduplication key ───────────────────────────────────────────────────

function dedupKey(artistId, date, venueName) {
  return `${artistId}|${date}|${normaliseName(venueName)}`;
}

// ─── 1. Ticketmaster ────────────────────────────────────────────────────────

// Per-artist queries — reliable worldwide coverage, no bulk-scan pagination issues
async function fetchTicketmaster(artists) {
  if (!TM_KEY) { console.log('No Ticketmaster key'); return []; }
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];
  const end   = new Date(Date.now() + 365 * 864e5).toISOString().split('.')[0] + 'Z';

  for (const artist of artists) {
    try {
      const url  = `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(artist.name)}&classificationName=music&countryCode=GB&startDateTime=${today}T00:00:00Z&endDateTime=${end}&size=50&page=0&apikey=${TM_KEY}`;
      const res  = await fetch(url);
      if (res.status === 429) { await sleep(5000); continue; }
      if (!res.ok) continue;
      const data   = await res.json();
      const events = data?._embedded?.events || [];
      for (const ev of events) {
        const venue   = ev._embedded?.venues?.[0];
        const date    = ev.dates?.start?.localDate;
        if (!date || !venue) continue;
        // Skip if the event title itself signals a tribute/cover ("Nirvana Tribute Night" etc.)
        if (isTributeAct(ev.name || '')) continue;
        // Verify at least one attraction matches this artist (and isn't a tribute/cover act)
        const attract = ev._embedded?.attractions || [];
        const match   = attract.find(a => normaliseName(a.name) === normaliseName(artist.name) && !isTributeAct(a.name));
        if (attract.length > 0 && !match) continue;
        const pr    = ev.priceRanges?.[0];
        const sym   = currSym(pr?.currency);
        const price = pr ? `${sym}${Math.round(pr.min)}${pr.max !== pr.min ? `–${sym}${Math.round(pr.max)}` : ''}` : null;
        gigs.push({
          gigId:        `tm-${ev.id}`,
          dedupKey:     dedupKey(artist.artistId, date, venue.name),
          artistId:     artist.artistId,
          artistName:   artist.name,
          date,
          doorsTime:    ev.dates?.start?.localTime || null,
          venueName:    venue.name,
          venueId:      `venue-tm-${venue.id}`,
          venueCity:    venue.city?.name || '',
          venueCountry: venue.country?.countryCode || '',
          isSoldOut:    ev.dates?.status?.code === 'offsale',
          supportActs:  [],
          tickets: [{ seller: 'Ticketmaster', url: ev.url || '#', available: ev.dates?.status?.code !== 'offsale', price: price || 'See site' }],
          sources:      ['ticketmaster'],
          lastUpdated:  new Date().toISOString(),
        });
      }
    } catch (e) { console.error(`TM ${artist.name}:`, e.message); }
    await sleep(250); // ~4 req/s, within Ticketmaster rate limit
  }
  console.log(`Ticketmaster: ${gigs.length} gigs`);
  return gigs;
}

// ─── 1b. Ticketmaster bulk UK scan (discovers acts not in Last.fm top 1000) ──

async function fetchTicketmasterBulk(nameMap) {
  if (!TM_KEY) return [];

  // Only run once per 6 hours — matches scraper frequency so every cycle discovers new events
  const meta = await ddb.send(new GetCommand({ TableName: ARTISTS_TABLE, Key: { artistId: '_gigradar_meta' } })).catch(() => ({ Item: null }));
  const lastTmRun = meta.Item?.tmBulkLastRun;
  if (lastTmRun && (Date.now() - new Date(lastTmRun).getTime()) < 6 * 3600 * 1000) {
    console.log(`Ticketmaster bulk: skipping — last ran ${Math.round((Date.now() - new Date(lastTmRun).getTime()) / 3600000)}h ago`);
    return [];
  }
  await ddb.send(new UpdateCommand({ TableName: ARTISTS_TABLE, Key: { artistId: '_gigradar_meta' }, UpdateExpression: 'SET tmBulkLastRun = :t', ExpressionAttributeValues: { ':t': new Date().toISOString() } })).catch(() => {});

  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];
  const end   = new Date(Date.now() + 365 * 864e5).toISOString().split('.')[0] + 'Z';

  for (let page = 0; page < 50; page++) {
    try {
      const url  = `https://app.ticketmaster.com/discovery/v2/events.json?classificationName=music&countryCode=GB&startDateTime=${today}T00:00:00Z&endDateTime=${end}&size=200&page=${page}&apikey=${TM_KEY}`;
      const res  = await fetch(url);
      if (res.status === 429) { console.log('TM bulk: quota hit, stopping early'); break; } // stop immediately, don't waste time
      if (!res.ok) break;
      const data   = await res.json();
      const events = data?._embedded?.events || [];
      if (!events.length) break;

      for (const ev of events) {
        const venue   = ev._embedded?.venues?.[0];
        const date    = ev.dates?.start?.localDate;
        if (!date || !venue) continue;
        const attract = ev._embedded?.attractions || [];
        const mainAct = attract[0];
        if (!mainAct?.name) continue;
        // Skip tribute acts and tribute event titles
        if (isTributeAct(mainAct.name) || isTributeAct(ev.name || '')) continue;

        const norm = normaliseName(mainAct.name);
        let artist = nameMap[norm];
        if (!artist) {
          artist = await autoSeedArtist(mainAct.name, nameMap);
          if (!artist) continue;
        }

        const pr  = ev.priceRanges?.[0];
        const sym = currSym(pr?.currency);
        gigs.push({
          gigId:        `tm-${ev.id}`,
          dedupKey:     dedupKey(artist.id, date, venue.name),
          artistId:     artist.id,
          artistName:   artist.name,
          date,
          doorsTime:    ev.dates?.start?.localTime || null,
          venueName:    venue.name,
          venueId:      `venue-tm-${venue.id}`,
          venueCity:    venue.city?.name || '',
          venueCountry: 'GB',
          isSoldOut:    ev.dates?.status?.code === 'offsale',
          supportActs:  attract.slice(1).map(a => a.name).filter(Boolean),
          tickets: [{ seller: 'Ticketmaster', url: ev.url || '#', available: ev.dates?.status?.code !== 'offsale', price: pr ? `${sym}${Math.round(pr.min)}` : 'See site' }],
          sources:      ['ticketmaster'],
          lastUpdated:  new Date().toISOString(),
        });
      }

      const totalPages = data?.page?.totalPages || 0;
      if (page >= totalPages - 1) break;
    } catch (e) { console.error(`TM bulk page ${page}:`, e.message); }
    await sleep(250);
  }
  console.log(`Ticketmaster bulk: ${gigs.length} gigs`);
  return gigs;
}

// ─── 2. Bandsintown — removed (API now returns 403 for all requests) ─────────

async function fetchBandsintown() {
  console.log('Bandsintown: skipped (API blocked)');
  return [];
  return gigs;
}

// ─── 3. Skiddle (free API key required but easy to get) ─────────────────────

async function fetchSkiddle(nameMap) {
  if (!SKIDDLE_KEY) { console.log('No Skiddle key — skipping'); return []; }
  const gigs   = [];
  const today  = new Date().toISOString().split('T')[0];
  let offset   = 0;
  let total    = 1;
  const MAX    = 1000; // cap at 1,000 events per run

  while (offset < total && offset < MAX) {
    try {
      const url  = `https://www.skiddle.com/api/v1/events/search/?api_key=${SKIDDLE_KEY}&country=GB&eventcode=LIVE&startdate=${today}&limit=100&order=date&offset=${offset}`;
      const res  = await fetch(url);
      const data = await res.json();
      total      = Math.min(data?.totalcount || 1, MAX);
      const events = data?.results || [];
      if (!events.length) break;
      for (const ev of events) {
        const rawName = ev.artists?.[0]?.name || '';
        if (isGenericName(rawName) || isTributeAct(rawName)) continue;
        // Skip if the event title or Skiddle genre indicates non-music/tribute
        if (isTributeAct(ev.eventname || ev.name || '')) continue;
        const skiGenres  = (ev.genres || []).map(g => (g.name || g.EventCode || '').toLowerCase().trim()).filter(Boolean);
        if (skiGenres.some(g => NON_MUSIC_GENRE_RE.test(g))) continue;
        const norm = normaliseName(rawName);
        let artist = nameMap[norm];
        if (!artist) {
          artist = await autoSeedArtist(rawName, nameMap);
          if (!artist) continue;
        }
        const date = ev.date;
        gigs.push({
          gigId:        `ski-${ev.id}`,
          dedupKey:     dedupKey(artist.id, date, ev.venue?.name || ''),
          artistId:     artist.id,
          artistName:   artist.name,
          date,
          doorsTime:    ev.openingtimes?.doorsopen || null,
          venueName:    ev.venue?.name || '',
          venueId:      `venue-ski-${ev.venue?.id || ''}`,
          venueCity:    ev.venue?.town || '',
          venueCountry: 'GB',
          isSoldOut:    ev.soldout === '1',
          supportActs:  [],
          ...(skiGenres.length ? { genre: skiGenres } : {}),
          tickets: [{
            seller:    'Skiddle',
            url:       ev.link || '#',
            available: ev.soldout !== '1',
            price:     ev.mineticketprice ? `£${ev.mineticketprice}` : 'See site',
          }],
          sources:     ['skiddle'],
          lastUpdated: new Date().toISOString(),
        });
      }
    } catch (e) { console.error(`Skiddle offset ${offset}:`, e.message); break; }
    offset += 100;
    await sleep(300);
  }
  console.log(`Skiddle: ${gigs.length} gigs`);
  return gigs;
}

// ─── 4. Songkick (scrape JSON-LD / structured data) ─────────────────────────

async function fetchSongkick(artists) {
  const gigs    = [];
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];
  const yearAhead = new Date(Date.now() + 365 * 864e5).toISOString().split('T')[0];
  for (const artist of artists) {
    try {
      const slug = artist.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const url  = `https://www.songkick.com/artists/${slug}/gigography?order=asc`;
      const res  = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GigRadar/2.0)' },
      });
      if (!res.ok) continue;
      const html = await res.text();

      // Extract JSON-LD
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (jsonLdMatch) {
        try {
          const ld = JSON.parse(jsonLdMatch[1]);
          const events = Array.isArray(ld) ? ld : (ld['@type'] === 'MusicEvent' ? [ld] : ld?.event || []);
          for (const ev of events) {
            if (!ev.startDate) continue;
            const date     = ev.startDate.split('T')[0];
            if (date < yearAgo || date > yearAhead) continue; // 12-month window each way
            const location = ev.location?.address || ev.location || {};
            const country  = location.addressCountry || '';
            if (country && !['GB', 'UK'].includes(country)) continue;
            const venueName = ev.location?.name || ev.name || '';
            gigs.push({
              gigId:        `sk-${artist.artistId}-${date}-${normaliseName(venueName)}`,
              dedupKey:     dedupKey(artist.artistId, date, venueName),
              artistId:     artist.artistId,
              artistName:   artist.name,
              date,
              doorsTime:    null,
              venueName,
              venueId:      `venue-sk-${normaliseName(venueName)}`,
              venueCity:    location.addressLocality || '',
              venueCountry: 'GB',
              isSoldOut:    ev.eventStatus === 'EventCancelled',
              supportActs:  [],
              tickets: ev.url ? [{ seller: 'Songkick', url: ev.url, available: true, price: 'See site' }] : [],
              sources:     ['songkick'],
              lastUpdated: new Date().toISOString(),
            });
          }
        } catch { /* malformed JSON-LD */ }
      }
    } catch { /* network error */ }
    await sleep(150); // 150ms — artists not on Songkick 404 quickly, keeps total under ~350s
  }
  console.log(`Songkick: ${gigs.length} gigs`);
  return gigs;
}

// ─── 5. Dice.fm (undocumented REST API) ─────────────────────────────────────

async function fetchDice(nameMap) {
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];
  const seen  = new Set();

  // Dice public REST API is blocked (403); scrape Next.js SSR data from browse pages instead
  const browsePages = [
    'https://dice.fm/browse',
    'https://dice.fm/browse?page=2',
    'https://dice.fm/browse?page=3',
  ];

  for (const url of browsePages) {
    try {
      const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } });
      if (!res.ok) continue;
      const html = await res.text();
      const m    = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) continue;
      const data   = JSON.parse(m[1]);
      const events = data?.props?.pageProps?.events || [];

      for (const ev of events) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        const dateUnix = ev.dates?.[0]?.date || ev.date_unix;
        const date = dateUnix ? new Date(typeof dateUnix === 'number' ? dateUnix * 1000 : dateUnix).toISOString().split('T')[0] : '';
        if (!date || date < today) continue;
        const artists = ev.summary_lineup?.top_artists || [];
        if (!artists.length) continue;
        const venue = ev.venues?.[0] || {};
        const city  = venue.city?.name || venue.location?.name || '';

        for (const art of artists) {
          const artistName = art.name || '';
          if (isGenericName(artistName) || isTributeAct(artistName)) continue;
          if (isTributeAct(ev.name || ev.title || '')) continue;
          const norm = normaliseName(artistName);
          let artist = nameMap[norm];
          if (!artist) {
            artist = await autoSeedArtist(artistName, nameMap);
            if (!artist) continue;
          }
          gigs.push({
            gigId:        `dice-${ev.id}`,
            dedupKey:     dedupKey(artist.id, date, venue.name || ''),
            artistId:     artist.id,
            artistName:   artist.name,
            date,
            doorsTime:    null,
            venueName:    venue.name || '',
            venueId:      `venue-dice-${normaliseName(venue.name || '')}`,
            venueCity:    city,
            venueCountry: 'GB',
            isSoldOut:    ev.status === 'sold_out',
            supportActs:  artists.slice(1).map(a => a.name).filter(Boolean),
            tickets: [{
              seller:    'Dice',
              url:       `https://dice.fm/event/${ev.perm_name}`,
              available: ev.status !== 'sold_out',
              price:     ev.price?.amount ? `${currSym(ev.price.currency)}${(ev.price.amount / 100).toFixed(2)}` : 'See site',
            }],
            sources:     ['dice'],
            lastUpdated: new Date().toISOString(),
          });
          break; // one gig entry per event (headliner)
        }
      }
    } catch (e) { console.error(`Dice browse:`, e.message); }
    await sleep(500);
  }
  console.log(`Dice: ${gigs.length} gigs`);
  return gigs;
}

// ─── 6. Resident Advisor (GraphQL) ──────────────────────────────────────────
// UK area IDs: 13=London, 14=Birmingham, 15=Brighton, 16=Newcastle,
//              24=Bristol, 30=Edinburgh, 35=Belfast
const RA_UK_AREAS = [13, 14, 15, 16, 24, 30, 35];

async function fetchResidentAdvisor(nameMap) {
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];
  const seen  = new Set(); // deduplicate across areas

  const query = `query($filters: FilterInputDtoInput, $page: Int) {
    eventListings(filters: $filters, pageSize: 100, page: $page) {
      data {
        id
        event {
          id title date cost
          venue { name area { name } }
          artists { name }
          ticketLink
        }
      }
    }
  }`;

  for (const areaId of RA_UK_AREAS) {
    for (let page = 1; page <= 5; page++) {
      try {
        const res = await fetch('https://ra.co/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
          body: JSON.stringify({ query, variables: { filters: { areas: { eq: areaId }, listingDate: { gte: today } }, page } }),
        });
        if (!res.ok) { console.log(`RA area ${areaId} page ${page}: HTTP ${res.status}`); break; }
        const data     = await res.json();
        const listings = data?.data?.eventListings?.data || [];
        if (areaId === 13 && page === 1) console.log(`RA London p1: ${listings.length} listings`);
        if (!listings.length) break;

        for (const listing of listings) {
          const ev = listing.event;
          if (!ev || seen.has(ev.id)) continue;
          seen.add(ev.id);
          const date = (ev.date || '').split('T')[0];
          if (!date || date < today) continue;

          for (const art of (ev.artists || [])) {
            if (isGenericName(art.name) || isTributeAct(art.name)) continue;
            const norm = normaliseName(art.name);
            let artist = nameMap[norm];
            if (!artist) {
              artist = await autoSeedArtist(art.name, nameMap);
              if (!artist) continue;
            }
            gigs.push({
              gigId:        `ra-${ev.id}`,
              dedupKey:     dedupKey(artist.id, date, ev.venue?.name || ''),
              artistId:     artist.id,
              artistName:   artist.name,
              date,
              doorsTime:    null,
              venueName:    ev.venue?.name || '',
              venueId:      `venue-ra-${normaliseName(ev.venue?.name || '')}`,
              venueCity:    ev.venue?.area?.name || '',
              venueCountry: 'GB',
              isSoldOut:    false,
              supportActs:  (ev.artists || []).filter(a => normaliseName(a.name) !== norm).map(a => a.name),
              tickets: [{
                seller:    'Resident Advisor',
                url:       ev.ticketLink || `https://ra.co/events/${ev.id}`,
                available: true,
                price:     ev.cost || 'See site',
              }],
              sources:     ['residentadvisor'],
              lastUpdated: new Date().toISOString(),
            });
            break; // one gig per event
          }
        }
      } catch (e) { console.error(`RA area ${areaId} page ${page}:`, e.message); break; }
      await sleep(400);
    }
  }
  console.log(`Resident Advisor: ${gigs.length} gigs`);
  return gigs;
}

// ─── 7. Ticketweb (JSON-LD) — replaces See Tickets (403) ────────────────────

async function fetchSeeTickets(nameMap) {
  // See Tickets returns 403 from Lambda IPs — replaced with Ticketweb (JSON-LD)
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];
  try {
    for (let pg = 1; pg <= 15; pg++) {
      const url = `https://www.ticketweb.uk/search?q=music&page=${pg}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' } });
      if (!res.ok) break;
      const html  = await res.text();
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      let found = 0;
      for (const [, json] of blocks) {
        let items;
        try { items = JSON.parse(json); } catch { continue; }
        if (!Array.isArray(items)) items = [items];
        for (const ev of items) {
          if (ev['@type'] !== 'MusicEvent') continue;
          const date = (ev.startDate || '').split('T')[0];
          if (!date || date < today) continue;
          const rawName = (ev.name || '').trim();
          if (isGenericName(rawName) || isTributeAct(rawName)) continue;
          const norm = normaliseName(rawName);
          let artist = nameMap[norm];
          if (!artist) { artist = await autoSeedArtist(rawName, nameMap); if (!artist) continue; }
          const venue = ev.location?.name || '';
          const city  = ev.location?.address?.addressLocality || '';
          gigs.push({
            gigId:        `tw-${(ev.url || '').match(/tickets\/(\d+)/)?.[1] || normaliseName(rawName + date)}`,
            dedupKey:     dedupKey(artist.id, date, venue),
            artistId:     artist.id, artistName: artist.name, date,
            doorsTime: null, venueName: venue,
            venueId:   `venue-tw-${normaliseName(venue)}`, venueCity: city, venueCountry: 'GB',
            isSoldOut: ev.eventStatus?.includes('EventCancelled') || false,
            supportActs: [],
            tickets: [{ seller: 'Ticketweb', url: ev.url || 'https://ticketweb.uk', available: true, price: 'See site' }],
            sources: ['ticketweb'], lastUpdated: new Date().toISOString(),
          });
          found++;
        }
      }
      if (!found) break;
      await sleep(400);
    }
  } catch (e) { console.error('Ticketweb:', e.message); }
  console.log(`Ticketweb: ${gigs.length} gigs`);
  return gigs;
}

// ─── 8. Songkick metro areas (replaces Gigantic — 403 from Lambda IPs) ───────
// Queries UK city calendar pages and extracts JSON-LD MusicEvent data.
// London (24426) confirmed working; others added as discovered.
const SK_UK_METROS = [
  { id: 24426, name: 'London' },
  { id: 31366, name: 'Manchester' },
  { id: 24521, name: 'Birmingham' },
  { id: 25014, name: 'Glasgow' },
  { id: 24516, name: 'Leeds' },
  { id: 24803, name: 'Bristol' },
  { id: 24523, name: 'Edinburgh' },
  { id: 24517, name: 'Liverpool' },
  { id: 24515, name: 'Newcastle upon Tyne' },
  { id: 24518, name: 'Sheffield' },
  { id: 25109, name: 'Nottingham' },
  { id: 24512, name: 'Cardiff' },
  { id: 24525, name: 'Brighton' },
  { id: 24535, name: 'Oxford' },
  { id: 24533, name: 'Cambridge' },
  { id: 28458, name: 'Guildford' },
];

async function fetchGigantic(nameMap) {
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];

  for (const metro of SK_UK_METROS) {
    for (let pg = 1; pg <= 5; pg++) {
      try {
        const url = `https://www.songkick.com/metro-areas/${metro.id}/calendar${pg > 1 ? `?page=${pg}` : ''}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' } });
        if (!res.ok) break;
        const html   = await res.text();
        const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
        let found = 0;
        for (const [, json] of blocks) {
          let items;
          try { items = JSON.parse(json); } catch { continue; }
          if (!Array.isArray(items)) items = [items];
          for (const ev of items) {
            if (ev['@type'] !== 'MusicEvent') continue;
            const date = (ev.startDate || '').split('T')[0];
            if (!date || date < today) continue;
            // Extract artist name — strip venue suffix from event title
            const rawName = (ev.name || '').replace(/\s*[@–\-]\s*.+$/, '').trim();
            if (!rawName || isGenericName(rawName) || isTributeAct(rawName)) continue;
            const norm = normaliseName(rawName);
            let artist = nameMap[norm];
            if (!artist) { artist = await autoSeedArtist(rawName, nameMap); if (!artist) continue; }
            const venue = ev.location?.name || '';
            const city  = ev.location?.address?.addressLocality || metro.name;
            const evId  = (ev.url || '').match(/\/(\d+)\b/)?.[1] || normaliseName(rawName + date);
            gigs.push({
              gigId:        `sk-${evId}`,
              dedupKey:     dedupKey(artist.id, date, venue),
              artistId:     artist.id, artistName: artist.name, date,
              doorsTime:    null, venueName: venue,
              venueId:      `venue-sk-${normaliseName(venue)}`, venueCity: city, venueCountry: 'GB',
              isSoldOut:    false, supportActs: [],
              tickets: [{ seller: 'Songkick', url: ev.url || 'https://songkick.com', available: true, price: 'See site' }],
              sources: ['songkick'], lastUpdated: new Date().toISOString(),
            });
            found++;
          }
        }
        if (!found || pg > 1) break; // Songkick metro pages don't truly paginate
        await sleep(400);
      } catch (e) { console.error(`Songkick metro ${metro.id}:`, e.message); break; }
    }
  }
  console.log(`Songkick metro: ${gigs.length} gigs`);
  return gigs;
}

// ─── 9. WeGotTickets — disabled (site migrated, structure changed) ───────────

async function fetchWeGotTickets(nameMap) {
  // WGT migrated to a new platform; the old scraper structure no longer matches.
  // Placeholder until a new approach is found.
  console.log(`WeGotTickets: skipped (site migrated)`);
  return [];
}

// ─── 10. Eventbrite (JSON-LD scrape) ─────────────────────────────────────────

async function fetchEventbrite(nameMap) {
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];

  // Scrape national UK pages + city-specific pages to catch regional events like
  // Eric Clapton at G Live Guildford that don't surface on the national browse.
  const EB_NATIONAL = [
    'https://www.eventbrite.co.uk/d/united-kingdom/music/',
    'https://www.eventbrite.co.uk/d/united-kingdom/concerts/',
  ];
  const EB_UK_CITIES = [
    'london','manchester','birmingham','glasgow','edinburgh','liverpool',
    'bristol','leeds','sheffield','newcastle-upon-tyne','nottingham','cardiff',
    'oxford','cambridge','brighton','guildford','reading','york','exeter','bath',
    'coventry','leicester','derby','hull','portsmouth','southampton','norwich',
    'cheltenham','wolverhampton','milton-keynes','stoke-on-trent','belfast',
  ];
  const CATEGORIES = [
    ...EB_NATIONAL.map(u => ({ url: u, pages: 10 })),
    ...EB_UK_CITIES.map(c => ({ url: `https://www.eventbrite.co.uk/d/united-kingdom--${c}/music/`, pages: 3 })),
  ];

  try {
    for (const { url: baseUrl, pages: maxPages } of CATEGORIES) {
      for (let pg = 1; pg <= maxPages; pg++) {
        const url = `${baseUrl}?page=${pg}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' } });
        if (!res.ok) break;
        const html = await res.text();

        const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
        let foundEvents = 0;
        for (const [, json] of ldBlocks) {
          let ld;
          try { ld = JSON.parse(json); } catch { continue; }
          if (!ld?.itemListElement) continue;

          for (const item of ld.itemListElement) {
            const ev = item.item || item;
            const date = (ev.startDate || '').split('T')[0];
            if (!date || date < today) continue;

            // Extract artist from event title (more reliable than URL slug)
            const rawName = extractArtistFromTitle(ev.name || '', ev.url || '');

            if (!rawName || isGenericName(rawName) || isTributeAct(rawName)) continue;
            // Also check the full event title for tribute keywords (artist name may be "Nirvana" while title is "Nirvana Tribute Night")
            if (isTributeAct(ev.name || '')) continue;
            const norm = normaliseName(rawName);
            let artist = nameMap[norm];
            if (!artist) {
              artist = await autoSeedArtist(rawName, nameMap);
              if (!artist) continue;
            }

            // Extract venue from JSON-LD location field
            const venueName = ev.location?.name || '';
            const venueCity = ev.location?.address?.addressLocality || ev.location?.address?.addressRegion || '';

            // Extract event ID from URL
            const ebId = (ev.url || '').match(/tickets-(\d+)/)?.[1] || normaliseName(rawName + date);

            gigs.push({
              gigId:        `eb-${ebId}`,
              dedupKey:     dedupKey(artist.id, date, venueName),
              artistId:     artist.id,
              artistName:   artist.name,
              date,
              doorsTime:    null,
              venueName,
              venueId:      venueName ? `venue#${normaliseName(venueName)}#${normaliseName(venueCity)}` : `venue-eb-${ebId}`,
              venueCity,
              venueCountry: 'GB',
              isSoldOut:    false,
              supportActs:  [],
              tickets: [{ seller: 'Eventbrite', url: ev.url || 'https://eventbrite.co.uk', available: true, price: 'See site' }],
              sources:     ['eventbrite'],
              lastUpdated: new Date().toISOString(),
            });
            foundEvents++;
          }
        }
        if (!foundEvents) break; // no events found on this page — stop
        await sleep(500);
      }
    }
  } catch (e) { console.error('Eventbrite:', e.message); }
  console.log(`Eventbrite: ${gigs.length} gigs`);
  return gigs;
}

// ─── 11. Setlist.fm (past gigs + setlists, worldwide) ───────────────────────

async function fetchSetlistFm(artists) {
  if (!SETLISTFM_KEY) { console.log('No Setlist.fm key — skipping past gigs from this source'); return []; }
  const gigs    = [];
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];
  const today   = new Date().toISOString().split('T')[0];

  // Rate limit: 1,440 req/day — only run once per day so the full allowance
  // covers all ~946 artists with MBIDs in a single pass.
  const meta = await ddb.send(new GetCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId: '_gigradar_meta' },
  })).catch(() => ({ Item: null }));
  const lastRun = meta.Item?.setlistfmLastRun;
  if (lastRun && (Date.now() - new Date(lastRun).getTime()) < 20 * 3600 * 1000) {
    console.log(`Setlist.fm: skipping — last run was ${Math.round((Date.now() - new Date(lastRun).getTime()) / 3600000)}h ago`);
    return [];
  }

  // Cap at top 200 artists by Last.fm rank — keeps runtime under 3 min vs 8.5 min for all 946.
  // 20-hour cooldown already limits this to once/day so we don't lose coverage over time.
  const withMbid = artists
    .filter(a => a.lastfmMbid)
    .slice()
    .sort((a, b) => (a.lastfmRank || 9999) - (b.lastfmRank || 9999))
    .slice(0, 200);
  console.log(`Setlist.fm: querying top ${withMbid.length} artists with MBID`);
  // Top 100 get 2 pages (lots of international dates pushing UK gigs off page 1)
  const twoPageIds = new Set(withMbid.slice(0, 100).map(a => a.artistId));

  for (const artist of withMbid) {
    const maxPages = twoPageIds.has(artist.artistId) ? 2 : 1;
    try {
      for (let page = 1; page <= maxPages; page++) {
        const url = `https://api.setlist.fm/rest/1.0/artist/${artist.lastfmMbid}/setlists?p=${page}`;
        const res = await fetch(url, {
          headers: {
            'x-api-key': SETLISTFM_KEY,
            'Accept':    'application/json',
            'User-Agent': 'GigRadar/2.0',
          },
        });
        if (res.status === 404 || res.status === 429) break;
        if (!res.ok) break;
        const data     = await res.json();
        const setlists = data.setlist || [];
        if (!setlists.length) break;

        let reachedOld = false;
        for (const sl of setlists) {
          // Setlist.fm date format: DD-MM-YYYY
          const parts = sl.eventDate?.split('-');
          if (!parts || parts.length !== 3) continue;
          const date = `${parts[2]}-${parts[1]}-${parts[0]}`; // → YYYY-MM-DD
          if (date < yearAgo) { reachedOld = true; continue; }
          if (date >= today)  continue; // future gigs handled by other sources

          const venue   = sl.venue || {};
          const city    = venue.city || {};
          const country = city.country?.code || '';
          if (country && country !== 'GB') continue;

          // Build a readable setlist string from songs
          const songs = (sl.sets?.set || []).flatMap(s => s.song || []);
          const setlistPreview = songs.slice(0, 8).map(s => s.name).filter(Boolean).join(' · ');

          gigs.push({
            gigId:        `slm-${sl.id}`,
            dedupKey:     dedupKey(artist.artistId, date, venue.name || ''),
            artistId:     artist.artistId,
            artistName:   artist.name,
            date,
            doorsTime:    null,
            venueName:    venue.name || '',
            venueId:      `venue-slm-${venue.id || normaliseName(venue.name || '')}`,
            venueCity:    city.name || '',
            venueCountry: 'GB',
            isSoldOut:    false,
            supportActs:  [],
            setlist:      setlistPreview || null,
            tickets: [{
              seller:    'Setlist.fm',
              url:       sl.url || `https://www.setlist.fm/setlist/${sl.id}.html`,
              available: false,
              price:     null,
            }],
            sources:     ['setlistfm'],
            lastUpdated: new Date().toISOString(),
          });
        }
        if (reachedOld) break; // rest of pages are older than 12 months
      }
    } catch (e) { console.error(`Setlist.fm ${artist.name}:`, e.message); }
    await sleep(500); // 2 req/sec rate limit
  }
  // Record successful run time so subsequent runs within 20h are skipped
  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId: '_gigradar_meta' },
    UpdateExpression: 'SET setlistfmLastRun = :t',
    ExpressionAttributeValues: { ':t': new Date().toISOString() },
  })).catch(() => {});

  console.log(`Setlist.fm: ${gigs.length} past gigs`);
  return gigs;
}

// ─── Merge & deduplicate gigs ────────────────────────────────────────────────

function mergeGigs(allGigArrays) {
  const merged = new Map(); // dedupKey → canonical gig

  for (const gigs of allGigArrays) {
    for (const gig of gigs) {
      const key = gig.dedupKey;
      if (!merged.has(key)) {
        merged.set(key, { ...gig });
      } else {
        // Merge: aggregate tickets and sources
        const existing  = merged.get(key);
        const newUrls   = new Set(existing.tickets.map(t => t.url));
        for (const t of gig.tickets) {
          if (!newUrls.has(t.url)) { existing.tickets.push(t); newUrls.add(t.url); }
        }
        for (const s of (gig.sources || [])) {
          if (!existing.sources.includes(s)) existing.sources.push(s);
        }
        // Merge support acts
        const actSet = new Set(existing.supportActs);
        for (const a of (gig.supportActs || [])) actSet.add(a);
        existing.supportActs = [...actSet];
        // Sold out: if any source says available, keep available unless all say sold out
        if (!gig.isSoldOut) existing.isSoldOut = false;
        // Use first non-null doorsTime / setlist
        if (!existing.doorsTime && gig.doorsTime) existing.doorsTime = gig.doorsTime;
        if (!existing.setlist   && gig.setlist)   existing.setlist   = gig.setlist;
        merged.set(key, existing);
      }
    }
  }

  return [...merged.values()];
}

// ─── Image enrichment: Deezer API (no key required) ─────────────────────────

async function fetchDeezerImage(artistName) {
  try {
    const url  = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`;
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GigRadar/2.0)' } });
    if (!res.ok) return null;
    const data = await res.json();
    const hit  = data?.data?.[0];
    if (!hit) return null;
    // Deezer uses a placeholder image for artists with no photo — filter it out
    const url2 = hit.picture_big || hit.picture_xl || hit.picture || '';
    if (url2.includes('default') || url2.includes('placeholder')) return null;
    return url2 || null;
  } catch { return null; }
}

async function enrichArtistImages(artists) {
  // First scan DynamoDB to find which artists are missing images — avoids
  // calling Deezer on every run for artists that already have photos.
  const missingIds = new Set();
  let lastKey;
  do {
    const params = {
      TableName:                 ARTISTS_TABLE,
      ProjectionExpression:      'artistId, imageUrl',
      FilterExpression:          'attribute_not_exists(imageUrl) OR imageUrl = :n',
      ExpressionAttributeValues: { ':n': null },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params));
    for (const item of result.Items || []) missingIds.add(item.artistId);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  const toEnrich = artists.filter(a => missingIds.has(a.artistId));
  console.log(`Images: ${toEnrich.length}/${artists.length} artists need photos`);
  if (!toEnrich.length) return;

  let enriched = 0;
  for (const artist of toEnrich) {
    const imageUrl = await fetchDeezerImage(artist.name);
    if (!imageUrl) { await sleep(100); continue; }
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId: artist.artistId },
      UpdateExpression: 'SET imageUrl = :url',
      ExpressionAttributeValues: { ':url': imageUrl },
    })).catch(() => {});
    enriched++;
    await sleep(150);
  }
  console.log(`Images: enriched ${enriched}/${toEnrich.length}`);
}

// ─── Enrich newly discovered grassroots artists ──────────────────────────────

async function enrichGrassrootsArtists() {
  if (!LASTFM_KEY) return;
  // Find grassroots artists that haven't been enriched with Last.fm data yet
  const result = await ddb.send(new ScanCommand({
    TableName: ARTISTS_TABLE,
    FilterExpression: 'isGrassroots = :gr AND attribute_not_exists(monthlyListeners)',
    ExpressionAttributeValues: { ':gr': true },
    Limit: 300,
  })).catch(() => ({ Items: [] }));

  const toEnrich = (result.Items || []).slice(0, 100);
  if (!toEnrich.length) { console.log('Grassroots enrichment: none needed'); return; }
  console.log(`Grassroots enrichment: ${toEnrich.length} artists`);

  let enriched = 0;
  for (const artist of toEnrich) {
    try {
      const url  = `https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artist.name)}&api_key=${LASTFM_KEY}&format=json`;
      const res  = await fetch(url);
      const data = await res.json();
      const info = data?.artist;

      const listeners = parseInt(info?.stats?.listeners || 0, 10);
      const mbid      = info?.mbid || null;
      const rawBio    = info?.bio?.summary || '';
      const bio       = rawBio.replace(/<[^>]+>/g, '').split('Read more on Last.fm')[0].trim();

      let expr   = 'SET monthlyListeners = :l, lastUpdated = :t';
      const vals = { ':l': listeners, ':t': new Date().toISOString() };
      if (mbid) { expr += ', lastfmMbid = if_not_exists(lastfmMbid, :m)'; vals[':m'] = mbid; }
      if (bio)  { expr += ', bio = if_not_exists(bio, :b)'; vals[':b'] = bio; }

      await ddb.send(new UpdateCommand({
        TableName: ARTISTS_TABLE,
        Key: { artistId: artist.artistId },
        UpdateExpression: expr,
        ExpressionAttributeValues: vals,
      })).catch(() => {});

      // Try Deezer for image if missing
      if (!artist.imageUrl) {
        const img = await fetchDeezerImage(artist.name);
        if (img) {
          await ddb.send(new UpdateCommand({
            TableName: ARTISTS_TABLE,
            Key: { artistId: artist.artistId },
            UpdateExpression: 'SET imageUrl = :url',
            ExpressionAttributeValues: { ':url': img },
          })).catch(() => {});
          await sleep(150);
        }
      }
      enriched++;
    } catch { /* skip this artist */ }
    await sleep(100);
  }
  console.log(`Grassroots enrichment: ${enriched}/${toEnrich.length} done`);
}

// ─── Upsert to DynamoDB ──────────────────────────────────────────────────────

async function upsertArtist(artist) {
  // Use UpdateCommand throughout so existing enrichment data (imageUrl, genres, bio) is never overwritten
  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId: artist.artistId },
    UpdateExpression: `SET #n = :n, monthlyListeners = :l, lastfmRank = :r, lastfmMbid = :m,
      country = if_not_exists(country, :c),
      genres   = if_not_exists(genres,   :g),
      bio      = if_not_exists(bio,      :b),
      color    = if_not_exists(color,    :col),
      upcoming = if_not_exists(upcoming, :u),
      lastUpdated = :t`,
    ExpressionAttributeNames: { '#n': 'name' },
    ExpressionAttributeValues: {
      ':n':   artist.name,
      ':l':   artist.listeners,
      ':r':   artist.lastfmRank,
      ':m':   artist.lastfmMbid,
      ':c':   'UK',
      ':g':   [],
      ':b':   '',
      ':col': '#8b5cf6',
      ':u':   0,
      ':t':   new Date().toISOString(),
    },
  })).catch(e => console.error(`upsertArtist ${artist.artistId}:`, e.message));
}

async function upsertGig(gig) {
  if (isNonMusicEvent(gig.artistName) || isNonMusicEvent(gig.eventTitle)) {
    console.log(`Skipping non-music event: "${gig.artistName || gig.eventTitle}"`);
    return;
  }
  const item = { ...gig };
  delete item.dedupKey; // don't store internal key
  await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: item }))
    .catch(e => console.error(`Gig upsert ${gig.gigId}:`, e.message));
}

// ─── Build venue records from gig data ──────────────────────────────────────

async function upsertVenues(gigsArr, today) {
  const venueMap = new Map();
  for (const gig of gigsArr) {
    if (!gig.venueName) continue;
    const vid  = toVenueId(gig.venueName, gig.venueCity);
    const slug = toVenueSlug(gig.venueName, gig.venueCity);
    const v    = venueMap.get(vid) || { venueId: vid, slug, name: gig.venueName, city: gig.venueCity || '', upcoming: 0 };
    if (gig.date >= today) v.upcoming++;
    venueMap.set(vid, v);
  }
  let saved = 0;
  for (const [, v] of venueMap) {
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: v.venueId },
      UpdateExpression: 'SET #n = :n, slug = :s, city = :c, upcoming = :u, isActive = :a, lastUpdated = :t',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n': v.name, ':s': v.slug, ':c': v.city,
        ':u': v.upcoming, ':a': true, ':t': new Date().toISOString(),
      },
    })).catch(() => {});
    saved++;
  }
  console.log(`Venues: upserted ${saved} venues`);
}

// ─── Venue batch crawler ─────────────────────────────────────────────────────
// Runs every Lambda invocation: picks the 50 venues crawled longest ago (or never),
// scrapes their Skiddle per-venue feed + own website JSON-LD, saves new gigs.
// Full cycle across all ~4,700 venues takes ~16 days at 6 runs/day.

const VENUE_BATCH_SIZE = 100;

const VENUE_WEBSITE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
};

const EVENT_TITLE_VENUE_RE = /\bpresents[:\-]/i;
function isValidVenueArtist(name) {
  if (!name || name.trim().length < 2 || name.trim().length > 80) return false;
  if (GENERIC_ACT_RE.test(name.trim())) return false;
  if (TRIBUTE_RE.test(name)) return false;
  if (EVENT_TITLE_VENUE_RE.test(name)) return false;
  if (/ @ /.test(name)) return false;
  return true;
}

function extractVenueJsonLdEvents(html) {
  const events = [];
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data  = JSON.parse(json);
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const item of items) {
        if (item['@type'] === 'MusicEvent' || item['@type'] === 'Event') events.push(item);
      }
    } catch {}
  }
  return events;
}

// Extract artist from event title (handles "Series | Artist: Tour" patterns)
function extractVenueArtistFromTitle(evName) {
  let s = (evName || '').replace(/\s+[—–]\s+[^—–]+$/, '').trim(); // strip trailing "— Venue"
  if (s.includes('|')) s = s.split('|').pop().trim(); // prefer part after pipe
  return s
    .replace(/\s*\bft\.?\s+.+$/i, '')
    .replace(/\s*\bfeat(?:uring)?\.?\s+.+$/i, '')
    .replace(/\s*[:–—]\s*.*$/, '')
    .replace(/\s+(?:live|tour|concert|show)\s*$/i, '')
    .replace(/\s+(?:at|in)\s+[A-Z].+$/i, '')
    .replace(/\s*@\s*.+$/, '')
    .trim();
}

// Parse minimal iCal (Squarespace event pages support ?format=ical → 350 bytes)
function parseVenueIcal(text) {
  const summary = text.match(/SUMMARY:(.+)/)?.[1]?.trim();
  const dtstart = text.match(/DTSTART:([^\r\n]+)/)?.[1]?.trim();
  if (!summary || !dtstart) return null;
  const d = dtstart.match(/(\d{4})(\d{2})(\d{2})/);
  return d ? { name: summary, startDate: `${d[1]}-${d[2]}-${d[3]}` } : null;
}

// Extract Dice event links embedded in venue pages (artist name is in URL slug)
function extractVenueDiceEvents(html) {
  const events = [];
  for (const [, url] of html.matchAll(/href="(https?:\/\/(?:link\.)?dice\.fm\/event\/([^"?]+))"/gi)) {
    const slug = url.split('/event/')[1] || '';
    const s    = slug.replace(/-tickets$/, '').replace(/\?.*$/, '');
    const m    = s.match(/^[^-]+-(.+?)-((?:\d+[a-z]{0,2}|[a-z]+)-(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-\d+)/i);
    if (!m) continue;
    const artistName = m[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const dp = m[2].match(/(\d+)[a-z]*-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-(\d{4})/i);
    if (!dp) continue;
    const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const mon = MONTHS[dp[2].toLowerCase().slice(0,3)];
    if (!mon) continue;
    const date = `${dp[3]}-${String(mon).padStart(2,'0')}-${String(parseInt(dp[1])).padStart(2,'0')}`;
    events.push({ '@type': 'Event', name: artistName, startDate: date, offers: { url }, _platform: 'dice' });
  }
  return events;
}

const TICKETING_WEBSITE_RE = /ticketmaster|seetickets\.com|eventbrite\.|skiddle\.com|dice\.fm|songkick\.com|wegottickets|ticketweb|gigantic\.com|ents24\.com|bandsintown|axs\.com/i;

async function fetchVenueWebsiteGigs(venue, nameMap) {
  if (!venue.website) return [];
  let base = venue.website.startsWith('http') ? venue.website : `https://${venue.website}`;
  base = base.replace(/\/$/, '');
  if (TICKETING_WEBSITE_RE.test(base)) return []; // skip ticketing platform URLs

  const today   = new Date().toISOString().split('T')[0];
  const gigs    = [];
  const allEvts = [];

  const SQSP_PATH_RE = /href="(\/[^"?#]+\/\d{4}\/\d{1,2}\/\d{1,2}\/[^"?#]+)"/gi;

  // Try common event paths; collect Squarespace event links and Dice event links
  const paths = ['', '/events', '/whats-on', '/gigs', '/whatson', '/listings', '/calendar', '/shows'];
  for (const p of paths) {
    try {
      const res  = await fetch(`${base}${p}`, { headers: VENUE_WEBSITE_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(7000) });
      if (!res.ok) { await sleep(150); continue; }
      const html = await res.text();

      // JSON-LD events
      const jsonLd = extractVenueJsonLdEvents(html);
      if (jsonLd.length) { allEvts.push(...jsonLd); break; }

      // Dice embedded events
      const dice = extractVenueDiceEvents(html);
      if (dice.length) { allEvts.push(...dice); break; }

      // Squarespace event page links (fetch individual iCal)
      const sqspLinks = [...html.matchAll(SQSP_PATH_RE)]
        .map(m => { try { return new URL(m[1], `${base}${p}`).href; } catch { return null; } })
        .filter(Boolean)
        .slice(0, 20);
      if (sqspLinks.length) {
        for (const link of sqspLinks) {
          try {
            const ir = await fetch(link + '?format=ical', { headers: VENUE_WEBSITE_HEADERS, signal: AbortSignal.timeout(5000) });
            if (ir.ok) {
              const text = await ir.text();
              if (text.includes('VEVENT')) {
                const ev = parseVenueIcal(text);
                if (ev) allEvts.push({ ...ev, '@type': 'Event', _sourceUrl: link });
              }
            }
          } catch {}
          await sleep(100);
        }
        if (allEvts.length) break;
      }

      await sleep(200);
    } catch { break; }
  }

  for (const ev of allEvts) {
    const date = (ev.startDate || '').split('T')[0];
    if (!date || date < today) continue;
    const performers = Array.isArray(ev.performer) ? ev.performer : ev.performer ? [ev.performer] : [];
    const rawName    = performers[0]?.name || extractVenueArtistFromTitle(ev.name || '');
    if (!isValidVenueArtist(rawName)) continue;
    const norm   = normaliseName(rawName);
    let   artist = nameMap[norm];
    if (!artist) { artist = await autoSeedArtist(rawName, nameMap); if (!artist) continue; }

    const support   = performers.slice(1).map(p => p.name).filter(n => isValidVenueArtist(n));
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
      canonicalVenueId: venue.venueId,
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
  return gigs;
}

async function fetchVenueSkiddleGigs(venue, nameMap) {
  if (!venue.skiddleId) return [];
  const today     = new Date().toISOString().split('T')[0];
  const yearAhead = new Date(Date.now() + 365 * 864e5).toISOString().split('T')[0];
  const gigs      = [];
  try {
    const url  = `https://www.skiddle.com/api/v1/events/search/?api_key=${SKIDDLE_KEY}&venueid=${venue.skiddleId}&startdate=${today}&enddate=${yearAhead}&limit=100&order=date`;
    const res  = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.error) return [];
    for (const ev of (data.results || [])) {
      if (ev.cancelled === '1') continue;
      // Strip venue suffix from event name: "Artist @ Venue, City"
      let rawName = (ev.artists?.[0]?.name || ev.eventname || '').replace(/\s*@\s*.+$/, '').trim();
      if (!isValidVenueArtist(rawName)) continue;
      const norm   = normaliseName(rawName);
      let   artist = nameMap[norm];
      if (!artist) { artist = await autoSeedArtist(rawName, nameMap); if (!artist) continue; }
      const date      = (ev.date || '').split('T')[0];
      if (!date) continue;
      const skiGenres = (ev.genres || []).map(g => (g.name || g).toLowerCase().trim()).filter(Boolean);
      gigs.push({
        gigId:            `ski-v-${venue.skiddleId}-${ev.id}`,
        dedupKey:         dedupKey(artist.id, date, venue.name),
        artistId:         artist.id,
        artistName:       artist.name,
        date,
        doorsTime:        ev.openingtimes?.doorsopen || null,
        venueName:        venue.name,
        venueId:          venue.venueId,
        venueCity:        venue.city || '',
        venueCountry:     'GB',
        canonicalVenueId: venue.venueId,
        isSoldOut:        !ev.tickets,
        supportActs:      [],
        ...(skiGenres.length ? { genre: skiGenres } : {}),
        tickets: [{
          seller:    'Skiddle',
          url:       ev.link || 'https://www.skiddle.com',
          available: !!ev.tickets,
          price:     ev.mineticketprice ? `£${ev.mineticketprice}` : 'See site',
        }],
        sources:     ['skiddle-venue'],
        lastUpdated: new Date().toISOString(),
      });
    }
  } catch {}
  return gigs;
}

// ─── Venue-direct: Ticketmaster by stored tmVenueId ─────────────────────────
async function fetchVenueTMGigs(venue, nameMap) {
  if (!venue.tmVenueId || !TM_KEY) return [];
  const today = new Date().toISOString().split('T')[0];
  const end   = new Date(Date.now() + 365 * 864e5).toISOString().split('.')[0] + 'Z';
  const gigs  = [];
  try {
    const url  = `https://app.ticketmaster.com/discovery/v2/events.json?classificationName=music&venueId=${venue.tmVenueId}&startDateTime=${today}T00:00:00Z&endDateTime=${end}&size=200&apikey=${TM_KEY}`;
    const res  = await fetch(url);
    if (!res.ok) return [];
    const data   = await res.json();
    const events = data?._embedded?.events || [];
    for (const ev of events) {
      const date    = ev.dates?.start?.localDate;
      if (!date) continue;
      const attract = ev._embedded?.attractions || [];
      const mainAct = attract[0];
      if (!mainAct?.name) continue;
      const norm   = normaliseName(mainAct.name);
      let   artist = nameMap[norm];
      if (!artist) { artist = await autoSeedArtist(mainAct.name, nameMap); if (!artist) continue; }
      const pr  = ev.priceRanges?.[0];
      const sym = currSym(pr?.currency);
      gigs.push({
        gigId:            `tm-${ev.id}`,
        dedupKey:         dedupKey(artist.id, date, venue.name),
        artistId:         artist.id,
        artistName:       artist.name,
        date,
        doorsTime:        ev.dates?.start?.localTime || null,
        venueName:        venue.name,
        venueId:          venue.venueId,
        venueCity:        venue.city || '',
        venueCountry:     'GB',
        canonicalVenueId: venue.venueId,
        isSoldOut:        ev.dates?.status?.code === 'offsale',
        supportActs:      attract.slice(1).map(a => a.name).filter(Boolean),
        tickets: [{ seller: 'Ticketmaster', url: ev.url || '#', available: ev.dates?.status?.code !== 'offsale', price: pr ? `${sym}${Math.round(pr.min)}` : 'See site' }],
        sources:          ['ticketmaster-venue'],
        lastUpdated:      new Date().toISOString(),
      });
    }
  } catch (e) { console.error(`TM venue ${venue.name}:`, e.message); }
  return gigs;
}

// ─── Venue-direct: Eventbrite city+venue search ──────────────────────────────
async function fetchVenueEventbriteGigs(venue, nameMap) {
  if (!venue.name) return [];
  const today = new Date().toISOString().split('T')[0];
  const gigs  = [];
  const city  = (venue.city || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const q     = encodeURIComponent(venue.name);
  const url   = city
    ? `https://www.eventbrite.co.uk/d/united-kingdom--${city}/music/?q=${q}`
    : `https://www.eventbrite.co.uk/d/united-kingdom/music/?q=${q}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const html = await res.text();
    for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let ld; try { ld = JSON.parse(json); } catch { continue; }
      if (!ld?.itemListElement) continue;
      for (const item of ld.itemListElement) {
        const ev = item.item || item;
        const date = (ev.startDate || '').split('T')[0];
        if (!date || date < today) continue;
        const evVenueName = ev.location?.name || '';
        if (evVenueName && normaliseName(evVenueName) !== normaliseName(venue.name)) continue;
        const rawName = extractArtistFromTitle(ev.name || '', ev.url || '');
        if (!rawName || isGenericName(rawName)) continue;
        const norm   = normaliseName(rawName);
        let   artist = nameMap[norm];
        if (!artist) { artist = await autoSeedArtist(rawName, nameMap); if (!artist) continue; }
        const ebId = (ev.url || '').match(/tickets-(\d+)/)?.[1] || normaliseName(rawName + date);
        gigs.push({
          gigId:            `eb-${ebId}`,
          dedupKey:         dedupKey(artist.id, date, venue.name),
          artistId:         artist.id,
          artistName:       artist.name,
          date,
          doorsTime:        ev.startDate?.includes('T') ? ev.startDate.split('T')[1]?.slice(0, 5) : null,
          venueName:        venue.name,
          venueId:          venue.venueId,
          venueCity:        venue.city || '',
          venueCountry:     'GB',
          canonicalVenueId: venue.venueId,
          isSoldOut:        false,
          supportActs:      [],
          tickets: [{ seller: 'Eventbrite', url: ev.url || 'https://eventbrite.co.uk', available: true, price: 'See site' }],
          sources:          ['eventbrite-venue'],
          lastUpdated:      new Date().toISOString(),
        });
      }
    }
  } catch (e) { console.error(`EB venue ${venue.name}:`, e.message); }
  return gigs;
}

// ─── Venue-direct: Dice.fm by venue name search ──────────────────────────────
async function fetchVenueDiceGigs(venue, nameMap) {
  if (!venue.name) return [];
  const today = new Date().toISOString().split('T')[0];
  const gigs  = [];
  try {
    const q   = encodeURIComponent(venue.name);
    const url = `https://dice.fm/search?query=${q}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    const data   = JSON.parse(m[1]);
    const events = data?.props?.pageProps?.events || data?.props?.pageProps?.results?.events || [];
    for (const ev of events) {
      const evVenueName = ev.venues?.[0]?.name || '';
      if (evVenueName && normaliseName(evVenueName) !== normaliseName(venue.name)) continue;
      const dateUnix = ev.dates?.[0]?.date || ev.date_unix;
      const date = dateUnix ? new Date(typeof dateUnix === 'number' ? dateUnix * 1000 : dateUnix).toISOString().split('T')[0] : '';
      if (!date || date < today) continue;
      const artists = ev.summary_lineup?.top_artists || [];
      if (!artists.length) continue;
      const artName = artists[0]?.name || '';
      if (isGenericName(artName)) continue;
      const norm   = normaliseName(artName);
      let   artist = nameMap[norm];
      if (!artist) { artist = await autoSeedArtist(artName, nameMap); if (!artist) continue; }
      gigs.push({
        gigId:            `dice-${ev.id}`,
        dedupKey:         dedupKey(artist.id, date, venue.name),
        artistId:         artist.id,
        artistName:       artist.name,
        date,
        doorsTime:        null,
        venueName:        venue.name,
        venueId:          venue.venueId,
        venueCity:        venue.city || '',
        venueCountry:     'GB',
        canonicalVenueId: venue.venueId,
        isSoldOut:        ev.status === 'sold_out',
        supportActs:      artists.slice(1).map(a => a.name).filter(Boolean),
        tickets: [{ seller: 'Dice', url: `https://dice.fm/event/${ev.perm_name}`, available: ev.status !== 'sold_out', price: ev.price?.amount ? `${currSym(ev.price.currency)}${(ev.price.amount / 100).toFixed(2)}` : 'See site' }],
        sources:          ['dice-venue'],
        lastUpdated:      new Date().toISOString(),
      });
    }
  } catch { /* Dice search may 403 */ }
  return gigs;
}

// ─── Venue-direct: scrape all stored ticketing URLs (from enrich-venues-ticketing-links.cjs)
// Uses generic JSON-LD extraction — works across AXS, See Tickets, Gigantic, Ents24,
// Songkick, Gigsandtours, Eventim, Ticketline, WeGotTickets, etc.
async function fetchVenueStoredUrls(venue, nameMap) {
  const urls = venue.ticketingUrls;
  if (!urls || typeof urls !== 'object') return [];
  const today = new Date().toISOString().split('T')[0];
  const gigs  = [];
  const seen  = new Set();

  for (const [platform, basePageUrl] of Object.entries(urls)) {
    // Skip platforms we already handle via dedicated functions to avoid duplication
    if (['ticketmaster', 'skiddle', 'eventbrite', 'dice'].includes(platform)) continue;
    if (!basePageUrl || typeof basePageUrl !== 'string') continue;

    // For Songkick venue pages, paginate through up to 5 pages (50 events/page)
    const maxPages = platform === 'songkick' ? 5 : 1;

    for (let pg = 1; pg <= maxPages; pg++) {
      const pageUrl = pg === 1 ? basePageUrl
        : basePageUrl.includes('?') ? `${basePageUrl}&page=${pg}` : `${basePageUrl}?page=${pg}`;

    try {
      const res = await fetch(pageUrl, { headers: VENUE_WEBSITE_HEADERS, signal: AbortSignal.timeout(10000) });
      if (!res.ok) break;
      const html   = await res.text();
      const events = extractVenueJsonLdEvents(html);
      if (!events.length && pg > 1) break; // no more pages

      for (const ev of events) {
        const date = (ev.startDate || '').split('T')[0];
        if (!date || date < today) continue;

        // Get performer name — try performers list first, then event title
        const performers = Array.isArray(ev.performer) ? ev.performer : ev.performer ? [ev.performer] : [];
        let rawName = performers[0]?.name || '';
        if (!rawName) rawName = extractArtistFromTitle(ev.name || '', '');
        if (!isValidVenueArtist(rawName)) continue;

        const dedupId = `${rawName}|${date}`;
        if (seen.has(dedupId)) continue;
        seen.add(dedupId);

        const norm   = normaliseName(rawName);
        let   artist = nameMap[norm];
        if (!artist) { artist = await autoSeedArtist(rawName, nameMap); if (!artist) continue; }

        const support   = performers.slice(1).map(p => p.name).filter(n => isValidVenueArtist(n));
        const ticketUrl = Array.isArray(ev.offers) ? ev.offers[0]?.url : ev.offers?.url;
        const price     = Array.isArray(ev.offers) ? ev.offers[0]?.price : ev.offers?.price;

        gigs.push({
          gigId:            `${platform}-${normaliseName(venue.name)}-${artist.id}-${date}`,
          dedupKey:         dedupKey(artist.id, date, venue.name),
          artistId:         artist.id,
          artistName:       artist.name,
          date,
          doorsTime:        ev.startDate?.includes('T') ? ev.startDate.split('T')[1]?.slice(0, 5) : null,
          venueName:        venue.name,
          venueId:          venue.venueId,
          venueCity:        venue.city || '',
          venueCountry:     'GB',
          canonicalVenueId: venue.venueId,
          isSoldOut:        false,
          supportActs:      support,
          tickets: [{
            seller:    platform.charAt(0).toUpperCase() + platform.slice(1),
            url:       ticketUrl || pageUrl,
            available: true,
            price:     price ? `£${price}` : 'See site',
          }],
          sources:     [platform],
          lastUpdated: new Date().toISOString(),
        });
      }
      if (!events.length) break;
    } catch { break; /* silently skip unreachable/rate-limited platforms */ }
    await sleep(300);
    } // end page loop
  } // end platform loop
  return gigs;
}

async function fetchVenueBatch(nameMap) {
  // Load all active venues, sort by lastVenueScraped ascending (null = never = highest priority)
  const venues = [];
  let lastKey;
  do {
    const params = {
      TableName: VENUES_TABLE,
      FilterExpression: 'isActive = :a',
      ExpressionAttributeValues: { ':a': true },
      ProjectionExpression: 'venueId, #n, city, website, skiddleId, tmVenueId, ticketingUrls, lastVenueScraped',
      ExpressionAttributeNames: { '#n': 'name' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(e => { console.error('Venue scan error:', e.message); return { Items: [] }; });
    venues.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  // Sort: never-scraped first, then oldest scraped
  venues.sort((a, b) => {
    if (!a.lastVenueScraped && !b.lastVenueScraped) return 0;
    if (!a.lastVenueScraped) return -1;
    if (!b.lastVenueScraped) return 1;
    return a.lastVenueScraped < b.lastVenueScraped ? -1 : 1;
  });

  const batch = venues.slice(0, VENUE_BATCH_SIZE);
  if (!batch.length) return;

  const oldestDate = batch[0].lastVenueScraped || 'never';
  console.log(`Venue crawl: ${batch.length} venues (oldest: ${oldestDate}, ${venues.length} total)`);

  let gigsFound = 0;
  const today = new Date().toISOString().split('T')[0];
  const seen  = new Set();

  for (const venue of batch) {
    const skiddleGigs  = await fetchVenueSkiddleGigs(venue, nameMap);
    await sleep(200);
    const tmGigs       = await fetchVenueTMGigs(venue, nameMap);
    await sleep(200);
    const ebGigs       = await fetchVenueEventbriteGigs(venue, nameMap);
    await sleep(200);
    const diceGigs     = await fetchVenueDiceGigs(venue, nameMap);
    await sleep(200);
    const storedGigs   = await fetchVenueStoredUrls(venue, nameMap);
    await sleep(200);
    const websiteGigs  = await fetchVenueWebsiteGigs(venue, nameMap);

    const venueGigs = [...skiddleGigs, ...tmGigs, ...ebGigs, ...diceGigs, ...storedGigs, ...websiteGigs];
    for (const gig of venueGigs) {
      if (seen.has(gig.dedupKey)) continue;
      seen.add(gig.dedupKey);
      if (isTributeAct(gig.artistName)) continue;
      await upsertGig(gig);
      gigsFound++;
    }

    // Mark venue as scraped
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: venue.venueId },
      UpdateExpression: 'SET lastVenueScraped = :t',
      ExpressionAttributeValues: { ':t': new Date().toISOString() },
    })).catch(() => {});
  }

  console.log(`Venue crawl: ${gigsFound} gigs from ${batch.length} venues`);
}

// ─── Main handler ────────────────────────────────────────────────────────────

exports.handler = async () => {
  console.log('GigRadar scraper v2 starting…');
  const start = Date.now();

  // 1. Fetch Last.fm top 1000 UK artists
  const artists = await fetchLastfmArtists();
  if (!artists.length) return { error: 'No artists fetched' };

  for (const a of artists) await upsertArtist(a);
  console.log(`Upserted ${artists.length} Last.fm artists`);

  // Load all previously discovered artists from DB (grassroots + Last.fm)
  const dbArtists = await loadAllArtistsFromDb();
  const nameMap   = buildNameMap([...artists, ...dbArtists]);
  console.log(`Name map: ${Object.keys(nameMap).length} total artists`);

  // Enrich with artist photos from Deezer (skips artists that already have an image)
  await enrichArtistImages(artists);

  // 2. Fetch all gig sources in sequence (Lambda has one thread, respect rate limits)
  // NOTE: fetchTicketmaster (per-artist) removed — fetchTicketmasterBulk is a superset
  //       and 999 × 250ms sleep alone consumed 4+ minutes of the 15-minute Lambda limit.
  const t = () => `[+${Math.round((Date.now() - start) / 1000)}s]`;
  const tmGigs     = [];
  const tmBulkGigs = await fetchTicketmasterBulk(nameMap); console.log(t(), 'TM bulk done');
  const bitGigs    = await fetchBandsintown();              // removed — API blocked
  const skiGigs    = await fetchSkiddle(nameMap);           console.log(t(), 'Skiddle done');
  // Songkick capped to top 100 artists (was 999 × 150ms = 2.5min sleep; now ~15s)
  const skGigs     = await fetchSongkick(artists.slice(0, 100)); console.log(t(), 'Songkick done');
  const diceGigs   = await fetchDice(nameMap);              console.log(t(), 'Dice done');
  const raGigs     = await fetchResidentAdvisor(nameMap);   console.log(t(), 'RA done');
  const seeGigs    = await fetchSeeTickets(nameMap);        console.log(t(), 'Ticketweb done');
  const gigGigs    = await fetchGigantic(nameMap);          console.log(t(), 'Songkick metro done');
  const wgtGigs    = await fetchWeGotTickets(nameMap);      console.log(t(), 'WGT done');
  const ebGigs     = await fetchEventbrite(nameMap);        console.log(t(), 'Eventbrite done');
  const slmGigs    = await fetchSetlistFm(artists);         console.log(t(), 'Setlist.fm done');

  // 3. Merge & deduplicate
  const merged = mergeGigs([tmGigs, tmBulkGigs, bitGigs, skiGigs, skGigs, diceGigs, raGigs, seeGigs, gigGigs, wgtGigs, ebGigs, slmGigs]);
  console.log(`Merged: ${merged.length} unique gigs`);

  // 4. Upsert gigs (stamping canonicalVenueId for venue pages)
  const today = new Date().toISOString().split('T')[0];
  let saved = 0;
  let skippedTribute = 0;
  for (const gig of merged) {
    if (isTributeAct(gig.artistName)) { skippedTribute++; continue; }
    gig.canonicalVenueId = toVenueId(gig.venueName, gig.venueCity);
    await upsertGig(gig);
    saved++;
  }
  if (skippedTribute) console.log(`Skipped ${skippedTribute} tribute/cover act gigs`);

  // 4b. Build venue records from merged gig data
  await upsertVenues(merged, today);

  // 5. Update upcoming counts per artist
  const countMap = {};
  for (const gig of merged) {
    if (gig.date >= today) countMap[gig.artistId] = (countMap[gig.artistId] || 0) + 1;
  }
  for (const [artistId, count] of Object.entries(countMap)) {
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: 'SET upcoming = :c',
      ExpressionAttributeValues: { ':c': count },
    })).catch(() => {});
  }

  // 6. Enrich newly discovered grassroots artists with Last.fm + Deezer (up to 100/run)
  await enrichGrassrootsArtists();

  // 7. Venue website crawl — 50 stalest venues per run, cycles all ~4,700 in ~16 days
  await fetchVenueBatch(nameMap);  console.log(t(), 'Venue crawl done');

  const elapsed = Math.round((Date.now() - start) / 1000);
  const totalArtists = Object.keys(nameMap).length;
  console.log(`Done in ${elapsed}s. Saved ${saved} gigs across ${totalArtists} artists (${artists.length} charting + ${totalArtists - artists.length} grassroots).`);
  return { artists: totalArtists, gigs: saved, elapsed };
};
