const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

const LASTFM_KEY    = process.env.LASTFM_API_KEY;
const TM_KEY        = process.env.TICKETMASTER_API_KEY;
const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- Normalise artist name for matching ---- */
function normaliseName(name) {
  return name.toLowerCase()
    .replace(/^the /, '')
    .replace(/[^a-z0-9]/g, '');
}

function toArtistId(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ---- Last.fm: fetch top 1000 UK artists ---- */
async function fetchLastfmArtists() {
  if (!LASTFM_KEY) {
    console.log('No Last.fm API key — skipping artist refresh');
    return [];
  }
  const artists = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://ws.audioscrobbler.com/2.0/?method=geo.getTopArtists&country=united+kingdom&limit=50&page=${page}&api_key=${LASTFM_KEY}&format=json`;
    try {
      const res  = await fetch(url);
      const data = await res.json();
      const items = data?.topartists?.artist || [];
      if (!items.length) break;
      items.forEach((a, i) => {
        artists.push({
          name:        a.name,
          artistId:    toArtistId(a.name),
          normName:    normaliseName(a.name),
          listeners:   parseInt(a.listeners || 0, 10),
          lastfmRank:  (page - 1) * 50 + i + 1,
          lastfmMbid:  a.mbid || null
        });
      });
    } catch (e) {
      console.error(`Last.fm page ${page} failed:`, e.message);
    }
    await sleep(250); // stay well under rate limit
  }
  console.log(`Last.fm: fetched ${artists.length} UK artists`);
  return artists;
}

/* ---- Ticketmaster: fetch all upcoming UK music events ---- */
async function fetchTicketmasterEvents() {
  if (!TM_KEY) {
    console.log('No Ticketmaster API key — skipping gig fetch');
    return [];
  }
  const events = [];
  const today  = new Date().toISOString().split('T')[0];
  const sixMonths = new Date(Date.now() + 183 * 864e5).toISOString().split('.')[0] + 'Z';
  let   page   = 0;
  let   totalPages = 1;

  while (page < totalPages && page < 50) { // cap at 50 pages (10,000 events)
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?classificationName=music&countryCode=GB&startDateTime=${today}T00:00:00Z&endDateTime=${sixMonths}&size=200&page=${page}&apikey=${TM_KEY}`;
    try {
      const res  = await fetch(url);
      if (res.status === 429) {
        console.log('Ticketmaster rate limit — waiting 2s');
        await sleep(2000);
        continue;
      }
      const data = await res.json();
      totalPages = data?.page?.totalPages ?? 1;
      const items = data?._embedded?.events || [];
      events.push(...items);
      console.log(`Ticketmaster page ${page + 1}/${totalPages}: ${items.length} events`);
    } catch (e) {
      console.error(`Ticketmaster page ${page} failed:`, e.message);
    }
    page++;
    await sleep(220); // ~4.5 req/sec, safely under 5/sec limit
  }
  console.log(`Ticketmaster: fetched ${events.length} events total`);
  return events;
}

/* ---- Upsert artist into DynamoDB ---- */
async function upsertArtist(artist) {
  await ddb.send(new PutCommand({
    TableName: ARTISTS_TABLE,
    Item: {
      artistId:        artist.artistId,
      name:            artist.name,
      monthlyListeners: artist.listeners,
      lastfmRank:      artist.lastfmRank,
      lastfmMbid:      artist.lastfmMbid,
      country:         'UK',
      genres:          [],       // enriched separately
      bio:             '',       // enriched separately
      color:           '#8b5cf6', // default, enriched separately
      wikipedia:       null,
      upcoming:        0,
      lastUpdated:     new Date().toISOString()
    },
    ConditionExpression: 'attribute_not_exists(artistId) OR lastfmRank > :rank OR attribute_not_exists(lastfmRank)',
    ExpressionAttributeValues: { ':rank': artist.lastfmRank }
  })).catch(() => {
    // condition failed = existing record has better rank, just update listeners/rank
    return ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId: artist.artistId },
      UpdateExpression: 'SET monthlyListeners = :l, lastfmRank = :r, lastUpdated = :t',
      ExpressionAttributeValues: {
        ':l': artist.listeners,
        ':r': artist.lastfmRank,
        ':t': new Date().toISOString()
      }
    }));
  });
}

/* ---- Parse a Ticketmaster event into a gig record ---- */
function parseEvent(event, artistId, artistName) {
  const venue = event._embedded?.venues?.[0];
  const date  = event.dates?.start?.localDate;
  if (!date || !venue) return null;

  const priceRange = event.priceRanges?.[0];
  const price = priceRange
    ? `£${Math.round(priceRange.min)}${priceRange.max !== priceRange.min ? `–£${Math.round(priceRange.max)}` : ''}`
    : null;

  return {
    gigId:      `tm-${event.id}`,
    artistId,
    artistName,
    date,
    venueId:    `tm-venue-${venue.id}`,
    venueName:  venue.name,
    venueCity:  venue.city?.name || '',
    venueCountry: venue.country?.countryCode || 'GB',
    tickets: [{
      seller:    'Ticketmaster',
      url:       event.url || '#',
      available: event.dates?.status?.code !== 'offsale',
      price:     price || 'See site'
    }],
    source:      'ticketmaster',
    sourceId:    event.id,
    lastUpdated: new Date().toISOString()
  };
}

/* ---- Main handler ---- */
exports.handler = async () => {
  console.log('GigRadar scraper starting...');

  // 1. Fetch and upsert artists
  const artists = await fetchLastfmArtists();
  if (artists.length) {
    for (const artist of artists) {
      await upsertArtist(artist);
    }
    console.log(`Upserted ${artists.length} artists`);
  }

  // Build lookup map: normalisedName → artistId
  const nameMap = {};
  artists.forEach(a => { nameMap[a.normName] = { id: a.artistId, name: a.name }; });

  // 2. Fetch Ticketmaster events
  const events = await fetchTicketmasterEvents();

  // 3. Match events to artists and upsert gigs
  let matched = 0;
  let unmatched = 0;

  for (const event of events) {
    const attractions = event._embedded?.attractions || [];
    let foundArtist = null;

    for (const attraction of attractions) {
      const norm = normaliseName(attraction.name);
      if (nameMap[norm]) {
        foundArtist = nameMap[norm];
        break;
      }
    }

    if (!foundArtist) { unmatched++; continue; }

    const gig = parseEvent(event, foundArtist.id, foundArtist.name);
    if (!gig) continue;

    await ddb.send(new PutCommand({
      TableName: GIGS_TABLE,
      Item: gig
    })).catch(e => console.error('Gig upsert failed:', e.message));

    matched++;
  }

  // 4. Update upcoming count on each artist
  // (done in a separate pass to avoid excessive writes mid-scrape)
  const gigsByArtist = {};
  const today = new Date().toISOString().split('T')[0];
  events.forEach(event => {
    const date = event.dates?.start?.localDate;
    if (!date || date < today) return;
    const attractions = event._embedded?.attractions || [];
    for (const a of attractions) {
      const norm = normaliseName(a.name);
      if (nameMap[norm]) {
        const id = nameMap[norm].id;
        gigsByArtist[id] = (gigsByArtist[id] || 0) + 1;
      }
    }
  });

  for (const [artistId, count] of Object.entries(gigsByArtist)) {
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: 'SET upcoming = :c',
      ExpressionAttributeValues: { ':c': count }
    })).catch(() => {});
  }

  console.log(`Done. Matched: ${matched}, unmatched: ${unmatched}`);
  return { matched, unmatched, artists: artists.length };
};
