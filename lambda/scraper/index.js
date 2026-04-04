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
  artists.forEach(a => { map[a.normName] = { id: a.artistId, name: a.name }; });
  return map;
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
        // Verify at least one attraction matches this artist
        const attract = ev._embedded?.attractions || [];
        if (attract.length > 0 && !attract.some(a => normaliseName(a.name) === normaliseName(artist.name))) continue;
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

// ─── 2. Bandsintown — removed (API now returns 403 for all requests) ─────────

async function fetchBandsintown() {
  console.log('Bandsintown: skipped (API blocked)');
  return [];
  return gigs;
}

// ─── 3. Skiddle (free API key required but easy to get) ─────────────────────

async function fetchSkiddle(nameMap) {
  if (!SKIDDLE_KEY) { console.log('No Skiddle key — skipping'); return []; }
  const gigs    = [];
  const today   = new Date().toISOString().split('T')[0];
  let page      = 1;
  let total     = 1;

  while (page <= Math.ceil(total / 100) && page <= 30) {
    try {
      const url  = `https://www.skiddle.com/api/v1/events/search/?api_key=${SKIDDLE_KEY}&country=GB&eventcode=LIVE&startdate=${today}&limit=100&page=${page}&order=date`;
      const res  = await fetch(url);
      const data = await res.json();
      total      = data?.totalcount || 1;
      const events = data?.results || [];
      for (const ev of events) {
        const norm = normaliseName(ev.artists?.[0]?.name || ev.eventname || '');
        if (!nameMap[norm]) continue;
        const artist = nameMap[norm];
        const date   = ev.date;
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
    } catch (e) { console.error(`Skiddle page ${page}:`, e.message); }
    page++;
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
  let page    = 1;

  while (page <= 20) {
    try {
      const url  = `https://api.dice.fm/events?types=linkout,event&country_codes[]=GB&page=${page}&per_page=100`;
      const res  = await fetch(url, {
        headers: { 'x-api-key': 'dice', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) break;
      const data   = await res.json();
      const events = data?.data || data?.events || [];
      if (!events.length) break;

      for (const ev of events) {
        const date = (ev.date || ev.event_date || '').split('T')[0];
        if (!date || date < today) continue;
        const artistName = ev.artists?.[0]?.name || ev.name || '';
        const norm       = normaliseName(artistName);
        if (!nameMap[norm]) continue;
        const artist = nameMap[norm];
        const venue  = ev.venue || {};
        gigs.push({
          gigId:        `dice-${ev.id || ev.slug}`,
          dedupKey:     dedupKey(artist.id, date, venue.name || ''),
          artistId:     artist.id,
          artistName:   artist.name,
          date,
          doorsTime:    ev.doors || null,
          venueName:    venue.name || '',
          venueId:      `venue-dice-${venue.id || normaliseName(venue.name || '')}`,
          venueCity:    venue.city || venue.location || '',
          venueCountry: 'GB',
          isSoldOut:    ev.sold_out || false,
          supportActs:  (ev.artists || []).slice(1).map(a => a.name).filter(Boolean),
          tickets: [{
            seller:    'Dice',
            url:       ev.url || `https://dice.fm/event/${ev.slug}`,
            available: !ev.sold_out,
            price:     ev.price ? `${currSym(ev.currency)}${ev.price}` : 'See site',
          }],
          sources:     ['dice'],
          lastUpdated: new Date().toISOString(),
        });
      }
    } catch (e) { console.error(`Dice page ${page}:`, e.message); break; }
    page++;
    await sleep(300);
  }
  console.log(`Dice: ${gigs.length} gigs`);
  return gigs;
}

// ─── 6. Resident Advisor (GraphQL) ──────────────────────────────────────────

async function fetchResidentAdvisor(nameMap) {
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];

  const query = `query GetEventListings($filters: FilterInputDtoInput, $page: Int) {
    eventListings(filters: $filters, pageSize: 100, page: $page) {
      data { id title artists { name } date venue { name area { name country { name isoCode } } }
        ticketLink priceRange { min max currency }
      }
    }
  }`;

  for (let page = 1; page <= 10; page++) {
    try {
      const res = await fetch('https://ra.co/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({
          query,
          variables: { filters: { areas: { id: 'GB' }, listingDate: { gte: today } }, page },
        }),
      });
      const data   = await res.json();
      const events = data?.data?.eventListings?.data || [];
      if (!events.length) break;

      for (const ev of events) {
        const country = ev.venue?.area?.country?.isoCode || '';
        if (country && country !== 'GB') continue;
        const date = (ev.date || '').split('T')[0];
        if (!date || date < today) continue;
        for (const art of (ev.artists || [])) {
          const norm = normaliseName(art.name);
          if (!nameMap[norm]) continue;
          const artist  = nameMap[norm];
          const pr      = ev.priceRange;
          const sym     = currSym(pr?.currency);
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
              price:     pr ? `${sym}${pr.min}${pr.max && pr.max !== pr.min ? `–${sym}${pr.max}` : ''}` : 'See site',
            }],
            sources:     ['residentadvisor'],
            lastUpdated: new Date().toISOString(),
          });
          break;
        }
      }
    } catch (e) { console.error(`RA page ${page}:`, e.message); break; }
    await sleep(500);
  }
  console.log(`Resident Advisor: ${gigs.length} gigs`);
  return gigs;
}

// ─── 7. See Tickets (scrape search) ─────────────────────────────────────────

async function fetchSeeTickets(nameMap) {
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];

  try {
    for (let pg = 1; pg <= 15; pg++) {
      const url = `https://www.seetickets.com/tour/search?q=&genre=&country=GB&page=${pg}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
      if (!res.ok) break;
      const html = await res.text();

      // Extract event blocks
      const blocks = html.matchAll(/<article[^>]*class="[^"]*event-listing[^"]*"[^>]*>([\s\S]*?)<\/article>/g);
      for (const [, block] of blocks) {
        const titleMatch  = block.match(/class="[^"]*event-name[^"]*"[^>]*>([^<]+)</);
        const dateMatch   = block.match(/datetime="([0-9]{4}-[0-9]{2}-[0-9]{2})/);
        const venueMatch  = block.match(/class="[^"]*venue-name[^"]*"[^>]*>([^<]+)</);
        const urlMatch    = block.match(/href="(https?:\/\/[^"]*seetickets\.com\/event\/[^"]+)"/);
        const cityMatch   = block.match(/class="[^"]*venue-location[^"]*"[^>]*>([^<]+)</);
        const priceMatch  = block.match(/class="[^"]*event-price[^"]*"[^>]*>([^<]+)</);

        if (!titleMatch || !dateMatch) continue;
        const date = dateMatch[1];
        if (date < today) continue;
        const norm = normaliseName(titleMatch[1]);
        if (!nameMap[norm]) continue;
        const artist = nameMap[norm];
        const venue  = (venueMatch?.[1] || '').trim();

        gigs.push({
          gigId:        `see-${date}-${normaliseName(venue)}-${artist.id}`,
          dedupKey:     dedupKey(artist.id, date, venue),
          artistId:     artist.id,
          artistName:   artist.name,
          date,
          doorsTime:    null,
          venueName:    venue,
          venueId:      `venue-see-${normaliseName(venue)}`,
          venueCity:    (cityMatch?.[1] || '').trim(),
          venueCountry: 'GB',
          isSoldOut:    block.includes('sold-out') || block.includes('soldout'),
          supportActs:  [],
          tickets: [{
            seller:    'See Tickets',
            url:       urlMatch?.[1] || 'https://seetickets.com',
            available: !block.includes('sold-out'),
            price:     priceMatch ? priceMatch[1].trim() : 'See site',
          }],
          sources:     ['seetickets'],
          lastUpdated: new Date().toISOString(),
        });
      }
      await sleep(500);
    }
  } catch (e) { console.error('See Tickets:', e.message); }
  console.log(`See Tickets: ${gigs.length} gigs`);
  return gigs;
}

// ─── 8. Gigantic (scrape) ────────────────────────────────────────────────────

async function fetchGigantic(nameMap) {
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];

  try {
    for (let pg = 1; pg <= 10; pg++) {
      const url = `https://www.gigantic.com/gigs-and-concerts?page=${pg}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
      if (!res.ok) break;
      const html = await res.text();

      const blocks = html.matchAll(/<div[^>]*class="[^"]*event-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g);
      for (const [, block] of blocks) {
        const titleMatch = block.match(/class="[^"]*event-name[^"]*"[^>]*>([^<]+)</);
        const dateMatch  = block.match(/datetime="([0-9]{4}-[0-9]{2}-[0-9]{2})/);
        const venueMatch = block.match(/class="[^"]*venue[^"]*"[^>]*>([^<]+)</);
        const urlMatch   = block.match(/href="(\/[^"]+)"/);

        if (!titleMatch || !dateMatch) continue;
        const date = dateMatch[1];
        if (date < today) continue;
        const norm = normaliseName(titleMatch[1]);
        if (!nameMap[norm]) continue;
        const artist = nameMap[norm];
        const venue  = (venueMatch?.[1] || '').trim();

        gigs.push({
          gigId:        `gig-${date}-${normaliseName(venue)}-${artist.id}`,
          dedupKey:     dedupKey(artist.id, date, venue),
          artistId:     artist.id,
          artistName:   artist.name,
          date,
          doorsTime:    null,
          venueName:    venue,
          venueId:      `venue-gig-${normaliseName(venue)}`,
          venueCity:    '',
          venueCountry: 'GB',
          isSoldOut:    block.toLowerCase().includes('sold out'),
          supportActs:  [],
          tickets: [{
            seller:    'Gigantic',
            url:       urlMatch ? `https://www.gigantic.com${urlMatch[1]}` : 'https://gigantic.com',
            available: !block.toLowerCase().includes('sold out'),
            price:     'See site',
          }],
          sources:     ['gigantic'],
          lastUpdated: new Date().toISOString(),
        });
      }
      await sleep(500);
    }
  } catch (e) { console.error('Gigantic:', e.message); }
  console.log(`Gigantic: ${gigs.length} gigs`);
  return gigs;
}

// ─── 9. WeGotTickets (scrape) ────────────────────────────────────────────────

async function fetchWeGotTickets(nameMap) {
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];

  try {
    for (let pg = 1; pg <= 10; pg++) {
      const url = `https://www.wegottickets.com/searchresults/page/${pg}/all`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
      if (!res.ok) break;
      const html = await res.text();

      const blocks = html.matchAll(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/g);
      for (const [, block] of blocks) {
        const titleMatch = block.match(/class="[^"]*event_title[^"]*"[^>]*>([^<]+)</);
        const dateMatch  = block.match(/([0-9]{1,2}[a-z]{2}\s+\w+\s+20[0-9]{2})/i);
        const venueMatch = block.match(/class="[^"]*location[^"]*"[^>]*>([^<]+)</);
        const urlMatch   = block.match(/href="(https?:\/\/[^"]*wegottickets[^"]+)"/);

        if (!titleMatch) continue;
        const norm = normaliseName(titleMatch[1]);
        if (!nameMap[norm]) continue;
        const artist = nameMap[norm];

        // Parse UK date like "15th April 2025"
        let date = '';
        if (dateMatch) {
          const d = new Date(dateMatch[1].replace(/(\d+)(st|nd|rd|th)/, '$1'));
          if (!isNaN(d)) date = d.toISOString().split('T')[0];
        }
        if (!date || date < today) continue;
        const venue = (venueMatch?.[1] || '').trim();

        gigs.push({
          gigId:        `wgt-${date}-${normaliseName(venue)}-${artist.id}`,
          dedupKey:     dedupKey(artist.id, date, venue),
          artistId:     artist.id,
          artistName:   artist.name,
          date,
          doorsTime:    null,
          venueName:    venue,
          venueId:      `venue-wgt-${normaliseName(venue)}`,
          venueCity:    '',
          venueCountry: 'GB',
          isSoldOut:    block.toLowerCase().includes('sold out'),
          supportActs:  [],
          tickets: [{
            seller:    'WeGotTickets',
            url:       urlMatch?.[1] || 'https://wegottickets.com',
            available: !block.toLowerCase().includes('sold out'),
            price:     'See site',
          }],
          sources:     ['wegottickets'],
          lastUpdated: new Date().toISOString(),
        });
      }
      await sleep(500);
    }
  } catch (e) { console.error('WeGotTickets:', e.message); }
  console.log(`WeGotTickets: ${gigs.length} gigs`);
  return gigs;
}

// ─── 10. Eventbrite (scrape search) ─────────────────────────────────────────

async function fetchEventbrite(nameMap) {
  const gigs  = [];
  const today = new Date().toISOString().split('T')[0];

  try {
    for (let pg = 1; pg <= 10; pg++) {
      const url = `https://www.eventbrite.co.uk/d/united-kingdom/music/?page=${pg}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
      if (!res.ok) break;
      const html = await res.text();

      // Eventbrite embeds server data in a JSON blob
      const dataMatch = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});\s*<\/script>/);
      if (!dataMatch) { await sleep(600); continue; }

      let serverData;
      try { serverData = JSON.parse(dataMatch[1]); } catch { continue; }

      const events = serverData?.search_data?.events?.results || [];
      for (const ev of events) {
        const date = (ev.start?.local || ev.start_date || '').split('T')[0];
        if (!date || date < today) continue;
        const norm = normaliseName(ev.name?.text || ev.name || '');
        if (!nameMap[norm]) continue;
        const artist = nameMap[norm];
        const venue  = ev.venue?.name || '';

        gigs.push({
          gigId:        `eb-${ev.id}`,
          dedupKey:     dedupKey(artist.id, date, venue),
          artistId:     artist.id,
          artistName:   artist.name,
          date,
          doorsTime:    null,
          venueName:    venue,
          venueId:      `venue-eb-${ev.venue?.id || normaliseName(venue)}`,
          venueCity:    ev.venue?.address?.city || '',
          venueCountry: 'GB',
          isSoldOut:    ev.is_sold_out || false,
          supportActs:  [],
          tickets: [{
            seller:    'Eventbrite',
            url:       ev.url || `https://eventbrite.com/e/${ev.id}`,
            available: !ev.is_sold_out,
            price:     ev.ticket_availability?.minimum_ticket_price
              ? `${currSym(ev.ticket_availability.minimum_ticket_price.currency)}${Math.round(ev.ticket_availability.minimum_ticket_price.major_value)}`
              : 'See site',
          }],
          sources:     ['eventbrite'],
          lastUpdated: new Date().toISOString(),
        });
      }
      await sleep(600);
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

  const withMbid = artists.filter(a => a.lastfmMbid); // all artists with MBID, no cap
  console.log(`Setlist.fm: querying all ${withMbid.length} artists with MBID`);
  // Top 480 artists (by lastfmRank) get 2 pages — catches artists with lots of international
  // dates pushing UK gigs off page 1. 480×2 + 466×1 = 1,426 req/day (≤ 1,440 limit).
  const twoPageIds = new Set(
    withMbid
      .slice()
      .sort((a, b) => (a.lastfmRank || 9999) - (b.lastfmRank || 9999))
      .slice(0, 480)
      .map(a => a.artistId)
  );

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
  const item = { ...gig };
  delete item.dedupKey; // don't store internal key
  await ddb.send(new PutCommand({ TableName: GIGS_TABLE, Item: item }))
    .catch(e => console.error(`Gig upsert ${gig.gigId}:`, e.message));
}

// ─── Main handler ────────────────────────────────────────────────────────────

exports.handler = async () => {
  console.log('GigRadar scraper v2 starting…');
  const start = Date.now();

  // 1. Fetch artists
  const artists = await fetchLastfmArtists();
  if (!artists.length) return { error: 'No artists fetched' };

  // Upsert artists
  for (const a of artists) await upsertArtist(a);
  console.log(`Upserted ${artists.length} artists`);

  // Enrich with artist photos from Deezer (skips artists that already have an image)
  await enrichArtistImages(artists);

  const nameMap = buildNameMap(artists);

  // 2. Fetch all gig sources in sequence (Lambda has one thread, respect rate limits)
  const tmGigs   = await fetchTicketmaster(artists);  // per-artist worldwide queries
  const bitGigs  = await fetchBandsintown();           // removed — API blocked
  const skiGigs  = await fetchSkiddle(nameMap);
  const skGigs   = await fetchSongkick(artists);       // past + upcoming
  const diceGigs = await fetchDice(nameMap);
  const raGigs   = await fetchResidentAdvisor(nameMap);
  const seeGigs  = await fetchSeeTickets(nameMap);
  const gigGigs  = await fetchGigantic(nameMap);
  const wgtGigs  = await fetchWeGotTickets(nameMap);
  const ebGigs   = await fetchEventbrite(nameMap);
  const slmGigs  = await fetchSetlistFm(artists);      // past gigs with setlists

  // 3. Merge & deduplicate
  const merged = mergeGigs([tmGigs, bitGigs, skiGigs, skGigs, diceGigs, raGigs, seeGigs, gigGigs, wgtGigs, ebGigs, slmGigs]);
  console.log(`Merged: ${merged.length} unique gigs`);

  // 4. Upsert gigs
  let saved = 0;
  for (const gig of merged) {
    await upsertGig(gig);
    saved++;
  }

  // 5. Update upcoming counts per artist
  const today = new Date().toISOString().split('T')[0];
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

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`Done in ${elapsed}s. Saved ${saved} gigs across ${Object.keys(countMap).length} artists.`);
  return { artists: artists.length, gigs: saved, elapsed };
};
