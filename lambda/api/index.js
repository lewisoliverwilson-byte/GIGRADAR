const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, GetCommand, UpdateCommand, PutCommand, DeleteCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

// In-memory cache for expensive scan endpoints (survives across warm invocations)
const _cache = new Map();
function withCache(key, ttlMs, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() < hit.exp) return hit.val;
  const val = fn();
  val.then(r => _cache.set(key, { val: Promise.resolve(r), exp: Date.now() + ttlMs })).catch(() => {});
  return val;
}

const ARTISTS_TABLE        = 'gigradar-artists';
const GIGS_TABLE           = 'gigradar-gigs';
const VENUES_TABLE         = 'gigradar-venues';
const FOLLOWS_TABLE        = 'gigradar-follows';
const SPOTIFY_TOKENS_TABLE = 'gigradar-spotify-tokens';
const ADMIN_KEY            = process.env.ADMIN_API_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const RESEND_API_KEY        = process.env.RESEND_API_KEY        || '';
const FROM_EMAIL            = process.env.FROM_EMAIL            || 'GigRadar <onboarding@resend.dev>';
const SITE_URL              = 'https://gigradar.co.uk';

const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID     || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-admin-key'
};

function ok(body) {
  return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function notFound(msg = 'Not found') {
  return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: msg }) };
}
function forbidden(msg = 'Forbidden') {
  return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: msg }) };
}
function badRequest(msg = 'Bad request') {
  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: msg }) };
}
function unauthorized() {
  return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
}

function isAdmin(event) {
  const key = event.headers?.['x-admin-key'] || event.headers?.['X-Admin-Key'] || '';
  return ADMIN_KEY.length > 0 && key === ADMIN_KEY;
}

function getJwtSub(event) {
  const auth = event.headers?.['authorization'] || event.headers?.['Authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const payload = auth.slice(7).split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.sub || null;
  } catch { return null; }
}

function parseBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch { return {}; }
}

/* ---- GET /artists ---- */
async function getArtists() {
  const result = await ddb.send(new ScanCommand({ TableName: ARTISTS_TABLE }));
  const artists = (result.Items || [])
    .filter(a => a.name && !a.artistId.startsWith('_'))
    .sort((a, b) => (a.lastfmRank || 9999) - (b.lastfmRank || 9999));
  return ok(artists);
}

/* ---- GET /artists/:id ---- */
async function getArtist(artistId) {
  const result = await ddb.send(new GetCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId }
  }));
  if (!result.Item) return notFound('Artist not found');
  return ok(result.Item);
}

/* ---- GET /artists/:id/gigs ---- */
function mergeGigTickets(items) {
  const normKey = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  const seen = new Map();
  for (const g of items) {
    const key = `${g.artistId}|${g.date}|${normKey(g.venueName)}`;
    if (seen.has(key)) {
      const ex = seen.get(key);
      ex.tickets = [...(ex.tickets || []), ...(g.tickets || [])];
      if (g.minPrice != null && (ex.minPrice == null || g.minPrice < ex.minPrice)) ex.minPrice = g.minPrice;
      if (g.onSaleDate && !ex.onSaleDate) ex.onSaleDate = g.onSaleDate;
    } else {
      seen.set(key, { ...g, tickets: [...(g.tickets || [])] });
    }
  }
  return [...seen.values()];
}

async function getArtistGigs(artistId) {
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];
  const result = await ddb.send(new QueryCommand({
    TableName:                 GIGS_TABLE,
    IndexName:                 'artistId-date-index',
    KeyConditionExpression:    'artistId = :id AND #d >= :yearAgo',
    ExpressionAttributeNames:  { '#d': 'date' },
    ExpressionAttributeValues: { ':id': artistId, ':yearAgo': yearAgo },
    ScanIndexForward:          true
  }));
  return ok(mergeGigTickets(result.Items || []).sort((a, b) => a.date.localeCompare(b.date)));
}

/* ---- POST /artists/:id/claim ---- */
async function submitClaim(artistId, event) {
  const sub = getJwtSub(event);
  if (!sub) return unauthorized();

  const { email, note } = parseBody(event);
  if (!email) return badRequest('email required');

  const existing = await ddb.send(new GetCommand({ TableName: ARTISTS_TABLE, Key: { artistId } }));
  const artist = existing.Item;
  if (!artist) return notFound('Artist not found');
  if (artist.claimedBy) return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: 'Artist already claimed' }) };

  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId },
    UpdateExpression: 'SET pendingClaim = :c',
    ExpressionAttributeValues: {
      ':c': { sub, email, note: note || '', timestamp: new Date().toISOString() }
    },
  }));
  return ok({ ok: true });
}

/* ---- PATCH /artists/:id ---- */
async function updateArtistProfile(artistId, event) {
  const sub = getJwtSub(event);
  if (!sub) return unauthorized();

  const existing = await ddb.send(new GetCommand({ TableName: ARTISTS_TABLE, Key: { artistId } }));
  const artist = existing.Item;
  if (!artist) return notFound('Artist not found');
  if (artist.claimedBy !== sub) return forbidden();

  const allowed = ['bio', 'instagram', 'facebook', 'spotify', 'website', 'imageUrl'];
  const data = parseBody(event);
  const updates = Object.entries(data).filter(([k]) => allowed.includes(k));
  if (updates.length === 0) return badRequest('No valid fields');

  const sets   = updates.map(([, ], i) => `#f${i} = :v${i}`).join(', ');
  const names  = Object.fromEntries(updates.map(([k], i) => [`#f${i}`, k]));
  const values = Object.fromEntries(updates.map(([, v], i) => [`:v${i}`, v]));

  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId },
    UpdateExpression: `SET ${sets}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
  return ok({ ok: true });
}

/* ---- GET /admin/artists ---- */
async function adminGetArtists(event) {
  if (!isAdmin(event)) return forbidden();
  const result = await ddb.send(new ScanCommand({ TableName: ARTISTS_TABLE }));
  const artists = (result.Items || [])
    .filter(a => a.name && !a.artistId.startsWith('_'))
    .sort((a, b) => (a.lastfmRank || 9999) - (b.lastfmRank || 9999));
  return ok(artists);
}

/* ---- POST /admin/artists/:id/genres ---- */
async function adminSetGenres(artistId, event) {
  if (!isAdmin(event)) return forbidden();
  const { genres } = parseBody(event);
  if (!Array.isArray(genres)) return badRequest('genres must be an array');

  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId },
    UpdateExpression: 'SET genres = :g',
    ExpressionAttributeValues: { ':g': genres },
  }));
  return ok({ ok: true });
}

/* ---- GET /admin/claims ---- */
async function adminGetClaims(event) {
  if (!isAdmin(event)) return forbidden();
  const result = await ddb.send(new ScanCommand({
    TableName: ARTISTS_TABLE,
    FilterExpression: 'attribute_exists(pendingClaim)',
  }));
  return ok(result.Items || []);
}

/* ---- POST /admin/claims/:id/approve ---- */
async function adminApproveClaim(artistId, event) {
  if (!isAdmin(event)) return forbidden();
  const existing = await ddb.send(new GetCommand({ TableName: ARTISTS_TABLE, Key: { artistId } }));
  const artist = existing.Item;
  if (!artist?.pendingClaim) return notFound('No pending claim');

  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId },
    UpdateExpression: 'SET claimedBy = :sub, verified = :v REMOVE pendingClaim',
    ExpressionAttributeValues: { ':sub': artist.pendingClaim.sub, ':v': true },
  }));
  return ok({ ok: true });
}

/* ---- POST /admin/claims/:id/reject ---- */
async function adminRejectClaim(artistId, event) {
  if (!isAdmin(event)) return forbidden();
  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId },
    UpdateExpression: 'REMOVE pendingClaim',
  }));
  return ok({ ok: true });
}

/* ---- GET /venues ---- */
async function getVenues() {
  const result = await ddb.send(new ScanCommand({ TableName: VENUES_TABLE }));
  const venues = (result.Items || [])
    .filter(v => v.isActive && v.name)
    .sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0));
  return ok(venues);
}

/* ---- GET /venues/:slug ---- */
async function getVenue(slug) {
  const result = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: 'slug = :s',
    ExpressionAttributeValues: { ':s': slug },
  }));
  const venue = (result.Items || [])[0];
  if (!venue) return notFound('Venue not found');
  return ok(venue);
}

/* ---- GET /venues/:slug/gigs ---- */
async function getVenueGigs(slug) {
  const vRes = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: 'slug = :s',
    ExpressionAttributeValues: { ':s': slug },
  }));
  const venue = (vRes.Items || [])[0];
  if (!venue) return notFound('Venue not found');

  const today   = new Date().toISOString().split('T')[0];
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];
  const result  = await ddb.send(new ScanCommand({
    TableName: GIGS_TABLE,
    FilterExpression: '(canonicalVenueId = :vid OR venueName = :vname) AND #d >= :yearAgo',
    ExpressionAttributeNames:  { '#d': 'date' },
    ExpressionAttributeValues: { ':vid': venue.venueId, ':vname': venue.name, ':yearAgo': yearAgo },
  }));
  const gigs = mergeGigTickets(result.Items || []).sort((a, b) => a.date.localeCompare(b.date));

  // "Discovered them first" — count past artists who subsequently blew up (>50k monthly listeners)
  const pastArtistIds = [...new Set(
    gigs.filter(g => g.date < today && g.artistId).map(g => g.artistId)
  )].slice(0, 100);

  let discoveredCount = 0;
  if (pastArtistIds.length > 0) {
    try {
      const chunks = [];
      for (let i = 0; i < pastArtistIds.length; i += 100) chunks.push(pastArtistIds.slice(i, i + 100));
      for (const chunk of chunks) {
        const batchRes = await ddb.send(new BatchGetCommand({
          RequestItems: {
            [ARTISTS_TABLE]: {
              Keys: chunk.map(id => ({ artistId: id })),
              ProjectionExpression: 'monthlyListeners',
            },
          },
        }));
        const items = batchRes.Responses?.[ARTISTS_TABLE] || [];
        discoveredCount += items.filter(a => (a.monthlyListeners || 0) > 50000).length;
      }
    } catch {}
  }

  return ok({ gigs, discoveredCount });
}

/* ---- GET /search?q= ---- */
async function search(params) {
  const q = (params?.q || '').trim();
  if (q.length < 2) return ok({ artists: [], venues: [] });
  const limit = Math.min(parseInt(params?.limit || '20', 10), 50);

  const [aRes, vRes] = await Promise.all([
    ddb.send(new ScanCommand({
      TableName: ARTISTS_TABLE,
      FilterExpression: 'contains(#n, :q)',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':q': q },
      ProjectionExpression: 'artistId, #n, imageUrl, genres, upcoming',
    })),
    ddb.send(new ScanCommand({
      TableName: VENUES_TABLE,
      FilterExpression: 'contains(#n, :q) AND isActive = :t',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':q': q, ':t': true },
      ProjectionExpression: 'venueId, slug, #n, city, upcoming',
    })),
  ]);

  const artists = (aRes.Items || [])
    .filter(a => a.name && !a.artistId.startsWith('_'))
    .sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0))
    .slice(0, limit);

  const venues = (vRes.Items || [])
    .sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0))
    .slice(0, limit);

  return ok({ artists, venues });
}

/* ---- GET /artists/:id/similar ---- */
async function getSimilarArtists(artistId) {
  const res = await ddb.send(new GetCommand({ TableName: ARTISTS_TABLE, Key: { artistId } }));
  const artist = res.Item;
  if (!artist) return notFound('Artist not found');

  const genres = artist.genres || [];
  if (genres.length === 0) return ok([]);

  // Find artists sharing at least one genre, exclude self
  const filterParts = genres.slice(0, 3).map((_, i) => `contains(#g, :g${i})`);
  const exprValues  = Object.fromEntries(genres.slice(0, 3).map((g, i) => [`:g${i}`, g]));

  const scan = await ddb.send(new ScanCommand({
    TableName: ARTISTS_TABLE,
    FilterExpression: `(${filterParts.join(' OR ')}) AND artistId <> :self`,
    ExpressionAttributeNames: { '#g': 'genres' },
    ExpressionAttributeValues: { ...exprValues, ':self': artistId },
    ProjectionExpression: 'artistId, #n, imageUrl, genres, upcoming',
    ExpressionAttributeNames: { '#g': 'genres', '#n': 'name' },
  }));

  const similar = (scan.Items || [])
    .filter(a => a.name && !a.artistId.startsWith('_') && (a.upcoming || 0) > 0)
    .sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0))
    .slice(0, 12);

  return ok(similar);
}

/* ---- GET /trending ---- */
async function getTrending() {
  const result = await ddb.send(new ScanCommand({
    TableName: ARTISTS_TABLE,
    FilterExpression: 'upcoming > :z',
    ExpressionAttributeValues: { ':z': 0 },
    ProjectionExpression: 'artistId, #n, imageUrl, genres, upcoming, spotifyPopularity, lastfmListeners',
    ExpressionAttributeNames: { '#n': 'name' },
  }));
  const artists = (result.Items || [])
    .filter(a => a.name && !a.artistId.startsWith('_'))
    .sort((a, b) => {
      const pop = (b.spotifyPopularity || 0) - (a.spotifyPopularity || 0);
      if (pop !== 0) return pop;
      return (b.lastfmListeners || 0) - (a.lastfmListeners || 0);
    })
    .slice(0, 20);
  return ok(artists);
}

/* ---- GET /emerging ---- */
async function getEmerging() {
  const result = await ddb.send(new ScanCommand({
    TableName: ARTISTS_TABLE,
    FilterExpression: 'upcoming > :z AND (attribute_not_exists(spotifyPopularity) OR spotifyPopularity < :maxPop)',
    ExpressionAttributeValues: { ':z': 0, ':maxPop': 40 },
    ProjectionExpression: 'artistId, #n, imageUrl, genres, upcoming, spotifyPopularity',
    ExpressionAttributeNames: { '#n': 'name' },
  }));
  const artists = (result.Items || [])
    .filter(a => a.name && !a.artistId.startsWith('_') && (a.upcoming || 0) >= 2)
    .sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0))
    .slice(0, 20);
  return ok(artists);
}

/* ---- GET /grassroots ---- */
async function getGrassrootsGigs(params) {
  const today  = new Date().toISOString().split('T')[0];
  const cutoff = new Date(Date.now() + 21 * 86400000).toISOString().split('T')[0];
  const city   = (params?.city || '').trim();
  const genre  = (params?.genre || '').trim().toLowerCase();

  // Get grassroots venue IDs
  const vFilter = city
    ? 'isGrassroots = :t AND contains(#city, :city)'
    : 'isGrassroots = :t';
  const vNames  = city ? { '#city': 'city' } : undefined;
  const vValues = city ? { ':t': true, ':city': city } : { ':t': true };

  const vRes = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: vFilter,
    ...(vNames ? { ExpressionAttributeNames: vNames } : {}),
    ExpressionAttributeValues: vValues,
    ProjectionExpression: 'venueId, #n, city, slug',
    ExpressionAttributeNames: { ...(vNames || {}), '#n': 'name' },
  }));
  const grassrootsIds = new Set((vRes.Items || []).map(v => v.venueId));
  const venueMap      = Object.fromEntries((vRes.Items || []).map(v => [v.venueId, v]));
  if (!grassrootsIds.size) return ok([]);

  const gFilter = genre
    ? '#d >= :today AND #d <= :end AND contains(#genres, :genre)'
    : '#d >= :today AND #d <= :end';
  const gNames  = genre ? { '#d': 'date', '#genres': 'genres' } : { '#d': 'date' };
  const gValues = genre
    ? { ':today': today, ':end': cutoff, ':genre': genre }
    : { ':today': today, ':end': cutoff };

  const gRes = await ddb.send(new ScanCommand({
    TableName: GIGS_TABLE,
    FilterExpression: gFilter,
    ExpressionAttributeNames: gNames,
    ExpressionAttributeValues: gValues,
  }));

  const gigs = (gRes.Items || [])
    .filter(g => g.canonicalVenueId && grassrootsIds.has(g.canonicalVenueId))
    .map(g => ({ ...g, _venue: venueMap[g.canonicalVenueId] || null }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 30);

  return ok(gigs);
}

/* ---- GET /gigs/nearby?lat=&lng=&radius=&genre= ---- */
async function getNearbyGigs(params) {
  const lat    = parseFloat(params?.lat);
  const lng    = parseFloat(params?.lng);
  const radius = parseFloat(params?.radius || '15');
  const genre  = (params?.genre || '').trim().toLowerCase();
  if (isNaN(lat) || isNaN(lng)) return badRequest('lat and lng required');

  const today  = new Date().toISOString().split('T')[0];
  const cutoff = new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0];

  const toRad = d => d * Math.PI / 180;
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  const [vRes, gRes] = await Promise.all([
    ddb.send(new ScanCommand({
      TableName: VENUES_TABLE,
      FilterExpression: 'attribute_exists(lat) AND attribute_exists(#lng) AND isActive = :a',
      ExpressionAttributeNames: { '#lng': 'lng' },
      ExpressionAttributeValues: { ':a': true },
      ProjectionExpression: 'venueId, lat, #lng, isGrassroots',
      ExpressionAttributeNames: { '#lng': 'lng' },
    })),
    ddb.send(new ScanCommand({
      TableName: GIGS_TABLE,
      FilterExpression: genre
        ? '#d >= :today AND #d <= :end AND contains(#genres, :genre)'
        : '#d >= :today AND #d <= :end',
      ExpressionAttributeNames: genre ? { '#d': 'date', '#genres': 'genres' } : { '#d': 'date' },
      ExpressionAttributeValues: genre
        ? { ':today': today, ':end': cutoff, ':genre': genre }
        : { ':today': today, ':end': cutoff },
    })),
  ]);

  const nearbyVenues = new Map();
  for (const v of (vRes.Items || [])) {
    const dist = haversine(lat, lng, v.lat, v.lng);
    if (dist <= radius) nearbyVenues.set(v.venueId, { dist, isGrassroots: v.isGrassroots || false });
  }

  const gigs = (gRes.Items || [])
    .filter(g => g.canonicalVenueId && nearbyVenues.has(g.canonicalVenueId))
    .map(g => ({ ...g, _distanceMiles: Math.round(nearbyVenues.get(g.canonicalVenueId).dist * 10) / 10, _isGrassroots: nearbyVenues.get(g.canonicalVenueId).isGrassroots }))
    .sort((a, b) => a.date.localeCompare(b.date) || a._distanceMiles - b._distanceMiles)
    .slice(0, 200);

  return ok(gigs);
}

/* ---- GET /venues/featured — Pro + Spotlight only, used by homepage ---- */
async function getVenuesFeatured() {
  return withCache('venues_featured', 5 * 60 * 1000, async () => {
    const result = await ddb.send(new ScanCommand({
      TableName: VENUES_TABLE,
      FilterExpression: 'isActive = :a AND (isVenuePro = :t OR isSpotlight = :t)',
      ExpressionAttributeValues: { ':a': true, ':t': true },
      ProjectionExpression: 'venueId, #n, slug, city, #cap, followerCount, upcoming, genres, isVenuePro, isSpotlight, isGrassroots, photoUrl, imageUrl',
      ExpressionAttributeNames: { '#n': 'name', '#cap': 'capacity' },
    }));
    const venues = (result.Items || []).sort((a, b) => {
      if (a.isVenuePro && !b.isVenuePro) return -1;
      if (!a.isVenuePro && b.isVenuePro) return 1;
      return (b.followerCount || 0) - (a.followerCount || 0);
    });
    return ok(venues);
  });
}

/* ---- GET /venues?city=&grassroots= ---- */
async function getVenuesFiltered(params) {
  const city       = (params?.city || '').trim();
  const grassroots = params?.grassroots === 'true';
  const filterParts = ['isActive = :a'];
  const names = {}, values = { ':a': true };
  if (city) { filterParts.push('contains(#city, :city)'); names['#city'] = 'city'; values[':city'] = city; }
  if (grassroots) { filterParts.push('isGrassroots = :gr'); values[':gr'] = true; }
  const result = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: filterParts.join(' AND '),
    ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
    ExpressionAttributeValues: values,
    ProjectionExpression: 'venueId, slug, #n, city, upcoming, isGrassroots, imageUrl, photoUrl, genres',
    ExpressionAttributeNames: { ...names, '#n': 'name' },
  }));
  const venues = (result.Items || [])
    .filter(v => v.name)
    .sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0))
    .slice(0, 50);
  return ok(venues);
}

/* ---- GET /on-sale — gigs going on sale in the next 7 days ---- */
async function getOnSaleGigs(params) {
  const today  = new Date().toISOString().split('T')[0];
  const cutoff = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  const genre  = (params?.genre || '').trim().toLowerCase();
  const city   = (params?.city  || '').trim();

  const filterParts = ['onSaleDate >= :today AND onSaleDate <= :end AND #d > :today'];
  const names  = { '#d': 'date' };
  const values = { ':today': today, ':end': cutoff };
  if (genre) { filterParts.push('contains(#genres, :genre)'); names['#genres'] = 'genres'; values[':genre'] = genre; }
  if (city)  { filterParts.push('contains(#city, :city)');   names['#city']   = 'venueCity'; values[':city'] = city; }

  const result = await ddb.send(new ScanCommand({
    TableName: GIGS_TABLE,
    FilterExpression: filterParts.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  })).catch(() => ({ Items: [] }));

  const gigs = (result.Items || [])
    .sort((a, b) => (a.onSaleDate || '').localeCompare(b.onSaleDate || ''))
    .slice(0, 50);
  return ok(gigs);
}

/* ---- GET /coming-soon — recently announced gigs (last 14 days) ---- */
async function getComingSoonGigs(params) {
  const today    = new Date().toISOString().split('T')[0];
  const cutoff   = new Date(Date.now() - 14 * 86400000).toISOString();
  const genre    = (params?.genre || '').trim().toLowerCase();
  const city     = (params?.city  || '').trim();

  const filterParts = ['#d > :today AND lastUpdated >= :cutoff'];
  const names  = { '#d': 'date' };
  const values = { ':today': today, ':cutoff': cutoff };
  if (genre) { filterParts.push('contains(#genres, :genre)'); names['#genres'] = 'genres'; values[':genre'] = genre; }
  if (city)  { filterParts.push('contains(#city, :city)');   names['#city']   = 'venueCity'; values[':city'] = city; }

  const result = await ddb.send(new ScanCommand({
    TableName: GIGS_TABLE,
    FilterExpression: filterParts.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  })).catch(() => ({ Items: [] }));

  const gigs = (result.Items || [])
    .sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''))
    .slice(0, 50);
  return ok(gigs);
}

/* ---- GET /artists/:id/setlists — proxy Setlist.fm ---- */
async function getArtistSetlists(artistId) {
  const SETLISTFM_KEY = process.env.SETLISTFM_KEY || '';
  if (!SETLISTFM_KEY) return ok([]);

  const res = await ddb.send(new GetCommand({ TableName: ARTISTS_TABLE, Key: { artistId } }));
  const artist = res.Item;
  if (!artist) return notFound('Artist not found');

  const mbid = artist.mbid || artist.musicBrainzId || null;
  if (!mbid) return ok([]);

  // Return cached setlists if < 7 days old (preserves 1440/day rate limit)
  const cacheAgeMs = 7 * 86400000;
  if (artist.setlistsCachedAt && Date.now() - new Date(artist.setlistsCachedAt).getTime() < cacheAgeMs) {
    return ok(artist.setlists || []);
  }

  try {
    const r = await fetch(
      `https://api.setlist.fm/rest/1.0/artist/${mbid}/setlists?p=1`,
      { headers: { 'x-api-key': SETLISTFM_KEY, 'Accept': 'application/json' } }
    );
    if (!r.ok) {
      // On rate limit (429), return cached if available rather than error
      if (r.status === 429 && artist.setlists) return ok(artist.setlists);
      return ok([]);
    }
    const data = await r.json();

    const setlists = (data.setlist || []).slice(0, 10).map(s => ({
      id:        s.id,
      date:      s.eventDate,
      venueName: s.venue?.name || '',
      venueCity: s.venue?.city?.name || '',
      country:   s.venue?.city?.country?.name || '',
      tourName:  s.tour?.name || null,
      sets:      (s.sets?.set || []).map(set => ({
        name:  set.name || null,
        songs: (set.song || []).map(sg => ({
          name:  sg.name,
          cover: sg.cover ? { artist: sg.cover.name } : null,
          tape:  sg.tape || false,
        })),
      })),
    }));

    // Cache on artist record — fire and forget
    ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: 'SET #sl = :s, setlistsCachedAt = :t',
      ExpressionAttributeNames: { '#sl': 'setlists' },
      ExpressionAttributeValues: { ':s': setlists, ':t': new Date().toISOString() },
    })).catch(() => {});

    return ok(setlists);
  } catch { return ok(artist.setlists || []); }
}

/* ---- POST /venues/:slug/claim ---- */
async function submitVenueClaim(slug, event) {
  const sub = getJwtSub(event);
  if (!sub) return unauthorized();

  const { email, role, note } = parseBody(event);
  if (!email || !role) return badRequest('email and role required');

  const vRes = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: 'slug = :s',
    ExpressionAttributeValues: { ':s': slug },
  }));
  const venue = (vRes.Items || [])[0];
  if (!venue) return notFound('Venue not found');
  if (venue.claimedBy) return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: 'Venue already claimed' }) };

  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: venue.venueId },
    UpdateExpression: 'SET pendingClaim = :c',
    ExpressionAttributeValues: {
      ':c': { sub, email, role, note: note || '', timestamp: new Date().toISOString() }
    },
  }));
  return ok({ ok: true });
}

/* ---- PATCH /venues/:slug — update venue profile (claimed only) ---- */
async function updateVenueProfile(slug, event) {
  const sub = getJwtSub(event);
  if (!sub) return unauthorized();

  const vRes = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: 'slug = :s',
    ExpressionAttributeValues: { ':s': slug },
  }));
  const venue = (vRes.Items || [])[0];
  if (!venue) return notFound('Venue not found');
  if (venue.claimedBy !== sub) return forbidden();

  const isProOrSpotlight = venue.isVenuePro || venue.isSpotlight;
  const allowed = [
    'bio', 'website', 'instagram', 'facebook', 'twitter', 'imageUrl', 'photoUrl',
    'email', 'phone', 'bookingEmail', 'capacity', 'isGrassroots',
    ...(isProOrSpotlight ? ['announcement'] : []),
  ];
  const data = parseBody(event);
  const updates = Object.entries(data).filter(([k]) => allowed.includes(k));
  if (updates.length === 0) return badRequest('No valid fields');

  const sets   = updates.map(([, ], i) => `#f${i} = :v${i}`).join(', ');
  const names  = Object.fromEntries(updates.map(([k], i) => [`#f${i}`, k]));
  const values = Object.fromEntries(updates.map(([, v], i) => [`:v${i}`, v]));

  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: venue.venueId },
    UpdateExpression: `SET ${sets}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
  return ok({ ok: true });
}

/* ---- POST /venues/:slug/view — track page view (non-owner visitors) ---- */
async function trackVenueView(slug) {
  const vRes = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: 'slug = :s',
    ExpressionAttributeValues: { ':s': slug },
  }));
  const venue = (vRes.Items || [])[0];
  if (!venue) return notFound('Venue not found');

  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: venue.venueId },
    UpdateExpression: `ADD pageViews :one, #vm :one SET lastViewMonth = if_not_exists(lastViewMonth, :m)`,
    ConditionExpression: 'attribute_exists(venueId)',
    ExpressionAttributeNames: { '#vm': `pageViews_${month}` },
    ExpressionAttributeValues: { ':one': 1, ':m': month },
  })).catch(() => {});

  return ok({ ok: true });
}

/* ---- GET /venues/:slug/analytics — Pro/Spotlight owners only ---- */
async function getVenueAnalytics(slug, event) {
  const sub = getJwtSub(event);
  if (!sub) return unauthorized();

  const vRes = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: 'slug = :s',
    ExpressionAttributeValues: { ':s': slug },
  }));
  const venue = (vRes.Items || [])[0];
  if (!venue) return notFound('Venue not found');
  if (venue.claimedBy !== sub) return forbidden();
  if (!venue.isVenuePro && !venue.isSpotlight) return forbidden('Analytics require Spotlight or Venue Pro');

  // Count followers
  const followRes = await ddb.send(new ScanCommand({
    TableName: FOLLOWS_TABLE,
    FilterExpression: 'targetId = :t AND targetType = :v',
    ExpressionAttributeValues: { ':t': venue.venueId, ':v': 'venue' },
  })).catch(() => ({ Items: [] }));
  const followerCount = (followRes.Items || []).length;

  // Count upcoming gigs
  const today = new Date().toISOString().split('T')[0];
  const gigsRes = await ddb.send(new ScanCommand({
    TableName: GIGS_TABLE,
    FilterExpression: 'canonicalVenueId = :v AND #d >= :today',
    ExpressionAttributeNames: { '#d': 'date' },
    ExpressionAttributeValues: { ':v': venue.venueId, ':today': today },
  })).catch(() => ({ Items: [] }));
  const upcomingCount = (gigsRes.Items || []).length;

  // Build monthly snapshot from pageViews_YYYY-MM keys
  const monthlyViews = {};
  for (const [k, v] of Object.entries(venue)) {
    const m = k.match(/^pageViews_(\d{4}-\d{2})$/);
    if (m) monthlyViews[m[1]] = v;
  }

  return ok({
    pageViews: venue.pageViews || 0,
    monthlyViews,
    followerCount,
    upcomingCount,
  });
}

/* ---- GET /admin/venue-claims ---- */
async function adminGetVenueClaims(event) {
  if (!isAdmin(event)) return forbidden();
  const result = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: 'attribute_exists(pendingClaim)',
  }));
  return ok(result.Items || []);
}

/* ---- POST /admin/venue-claims/:venueId/approve ---- */
async function adminApproveVenueClaim(venueId, event) {
  if (!isAdmin(event)) return forbidden();
  const existing = await ddb.send(new GetCommand({ TableName: VENUES_TABLE, Key: { venueId } }));
  const venue = existing.Item;
  if (!venue?.pendingClaim) return notFound('No pending claim');

  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId },
    UpdateExpression: 'SET claimedBy = :sub, verified = :v REMOVE pendingClaim',
    ExpressionAttributeValues: { ':sub': venue.pendingClaim.sub, ':v': true },
  }));
  return ok({ ok: true });
}

/* ---- POST /admin/venue-claims/:venueId/reject ---- */
async function adminRejectVenueClaim(venueId, event) {
  if (!isAdmin(event)) return forbidden();
  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId },
    UpdateExpression: 'REMOVE pendingClaim',
  }));
  return ok({ ok: true });
}

/* ---- GET /gigs/:id ---- */
async function getGig(gigId) {
  const result = await ddb.send(new GetCommand({ TableName: GIGS_TABLE, Key: { gigId } }));
  if (!result.Item) return notFound('Gig not found');
  return ok(result.Item);
}

/* ---- GET /gigs ---- */
async function getGigs(params) {
  const today    = new Date().toISOString().split('T')[0];
  const limit    = Math.min(parseInt(params?.limit || '200', 10), 2000);
  const city     = (params?.city  || '').trim().split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '').join(' ');
  const genre    = (params?.genre || '').trim().toLowerCase();
  const maxPrice = params?.maxPrice ? parseFloat(params.maxPrice) : null;
  const from     = params?.from  || today;
  const to       = params?.to    || (() => { const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().split('T')[0]; })();

  // Build list of dates in range (capped at 90 days to avoid runaway queries)
  const dates = [];
  const start = new Date(from), end = new Date(to);
  const dayLimit = Math.min(90, Math.ceil((end - start) / 86400000) + 1);
  for (let i = 0; i < dayLimit; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  // Query date-index for each date (parallel, batched 5 at a time)
  const filterParts = [];
  const filterNames = {};
  const filterValues = {};
  if (city)  { filterParts.push('contains(#city, :city)');   filterNames['#city']  = 'venueCity';  filterValues[':city']  = city; }
  if (genre) { filterParts.push('contains(#genres, :genre)'); filterNames['#genres'] = 'genres'; filterValues[':genre'] = genre; }

  const allGigs = [];
  const BATCH = 5;
  for (let i = 0; i < dates.length && allGigs.length < limit; i += BATCH) {
    const batch = dates.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(async date => {
      const items = [];
      let lastKey;
      do {
        const p = {
          TableName:  GIGS_TABLE,
          IndexName:  'date-index',
          KeyConditionExpression: '#d = :date',
          ExpressionAttributeNames:  { '#d': 'date', ...filterNames },
          ExpressionAttributeValues: { ':date': date, ...filterValues },
        };
        if (filterParts.length) p.FilterExpression = filterParts.join(' AND ');
        if (lastKey) p.ExclusiveStartKey = lastKey;
        const r = await ddb.send(new QueryCommand(p)).catch(() => ({ Items: [] }));
        items.push(...(r.Items || []));
        lastKey = r.LastEvaluatedKey;
      } while (lastKey);
      return items;
    }));
    for (const items of batchResults) allGigs.push(...items);
  }

  let sorted = allGigs.sort((a, b) => a.date.localeCompare(b.date));
  if (maxPrice !== null) sorted = sorted.filter(g => g.minPrice != null && g.minPrice <= maxPrice);
  return ok(sorted.slice(0, limit));
}

/* ---- Spotify helpers ---- */

function normaliseArtistName(name) {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

async function getValidSpotifyToken(userId) {
  const result = await ddb.send(new GetCommand({
    TableName: SPOTIFY_TOKENS_TABLE,
    Key: { userId },
  }));
  const item = result.Item;
  if (!item) return null;

  const bufferMs = 5 * 60 * 1000;
  if (Date.now() < item.tokenExpiry - bufferMs) {
    return item.accessToken;
  }

  // Refresh the token
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: item.refreshToken,
      client_id: SPOTIFY_CLIENT_ID,
      client_secret: SPOTIFY_CLIENT_SECRET,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();

  const updates = {
    accessToken: data.access_token,
    tokenExpiry: Date.now() + data.expires_in * 1000,
  };
  if (data.refresh_token) updates.refreshToken = data.refresh_token;

  await ddb.send(new UpdateCommand({
    TableName: SPOTIFY_TOKENS_TABLE,
    Key: { userId },
    UpdateExpression: 'SET accessToken = :at, tokenExpiry = :te' + (data.refresh_token ? ', refreshToken = :rt' : ''),
    ExpressionAttributeValues: {
      ':at': updates.accessToken,
      ':te': updates.tokenExpiry,
      ...(data.refresh_token ? { ':rt': data.refresh_token } : {}),
    },
  }));

  return updates.accessToken;
}

async function fetchSpotifyTopArtists(accessToken) {
  const artists = [];
  for (const offset of [0, 50]) {
    const res = await fetch(
      `https://api.spotify.com/v1/me/top/artists?time_range=long_term&limit=50&offset=${offset}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) break;
    const data = await res.json();
    if (data.items) artists.push(...data.items);
  }
  return artists;
}

async function matchSpotifyArtistsToDb(spotifyArtists) {
  // Fetch all artists from DB (we already have a scan-based approach)
  const result = await ddb.send(new ScanCommand({ TableName: ARTISTS_TABLE }));
  const dbArtists = (result.Items || []).filter(a => a.name && !a.artistId.startsWith('_'));

  // Build lookup maps
  const bySpotifyId   = new Map(dbArtists.filter(a => a.spotify).map(a => [a.spotify.split('/').pop(), a]));
  const byNormName    = new Map(dbArtists.map(a => [normaliseArtistName(a.name), a]));

  const matched = [];
  const seen = new Set();

  for (const sa of spotifyArtists) {
    let match = bySpotifyId.get(sa.id) || byNormName.get(normaliseArtistName(sa.name));
    if (match && !seen.has(match.artistId)) {
      seen.add(match.artistId);
      matched.push({
        artistId: match.artistId,
        name:     match.name,
        imageUrl: match.imageUrl || null,
        genres:   match.genres   || [],
      });
    }
  }
  return matched;
}

/* ---- POST /api/artists/match ---- */
async function matchArtists(event) {
  const { artists: spotifyArtists } = parseBody(event);
  if (!Array.isArray(spotifyArtists) || spotifyArtists.length === 0) {
    return ok({ artists: [] });
  }

  const result = await ddb.send(new ScanCommand({ TableName: ARTISTS_TABLE }));
  const dbArtists = (result.Items || []).filter(a => a.name && !a.artistId.startsWith('_'));

  const bySpotifyId = new Map(dbArtists.filter(a => a.spotify).map(a => [a.spotify.split('/').pop(), a]));
  const byNormName  = new Map(dbArtists.map(a => [normaliseArtistName(a.name), a]));

  const matched = [];
  const seen = new Set();

  for (const sa of spotifyArtists) {
    const match = bySpotifyId.get(sa.id) || byNormName.get(normaliseArtistName(sa.name));
    if (match && !seen.has(match.artistId)) {
      seen.add(match.artistId);
      matched.push({
        artistId: match.artistId,
        name:     match.name,
        imageUrl: match.imageUrl || null,
        genres:   match.genres   || [],
      });
    }
  }

  return ok({ artists: matched });
}

/* ---- POST /api/auth/spotify/exchange ---- */
async function spotifyExchange(event) {
  const sub = getJwtSub(event);
  if (!sub) return unauthorized();

  const { code, codeVerifier, redirectUri } = parseBody(event);
  if (!code || !codeVerifier || !redirectUri) return badRequest('code, codeVerifier, redirectUri required');

  const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Spotify token exchange error:', err);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Spotify token exchange failed', detail: err }) };
  }

  const data = await res.json();

  await ddb.send(new PutCommand({
    TableName: SPOTIFY_TOKENS_TABLE,
    Item: {
      userId:       sub,
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiry:  Date.now() + data.expires_in * 1000,
      connected:    true,
      connectedAt:  new Date().toISOString(),
    },
  }));

  return ok({ ok: true });
}

/* ---- GET /api/auth/spotify/artists ---- */
async function spotifyArtists(event) {
  const sub = getJwtSub(event);
  if (!sub) return unauthorized();

  const accessToken = await getValidSpotifyToken(sub);
  if (!accessToken) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Spotify not connected or token expired' }) };
  }

  const spotifyArtists = await fetchSpotifyTopArtists(accessToken);
  if (spotifyArtists.length === 0) {
    return ok({ artists: [] });
  }

  const matched = await matchSpotifyArtistsToDb(spotifyArtists);
  return ok({ artists: matched });
}

/* ---- POST /api/auth/spotify/disconnect ---- */
async function spotifyDisconnect(event) {
  const sub = getJwtSub(event);
  if (!sub) return unauthorized();

  await ddb.send(new DeleteCommand({
    TableName: SPOTIFY_TOKENS_TABLE,
    Key: { userId: sub },
  }));

  return ok({ ok: true });
}

/* ---- POST /follows ---- */
async function followTarget(event) {
  const { email, targetId, targetType, targetName } = parseBody(event);
  if (!email || !targetId || !targetType) return badRequest('email, targetId, targetType required');
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return badRequest('Invalid email');

  const followId   = `${email}#${targetId}`;
  const unsubToken = Buffer.from(`${followId}:${Date.now()}`).toString('base64url').slice(0, 32);

  let isNew = false;
  try {
    await ddb.send(new PutCommand({
      TableName: FOLLOWS_TABLE,
      Item: { followId, email, targetId, targetType, targetName: targetName || '', confirmed: true, createdAt: new Date().toISOString(), unsubToken },
      ConditionExpression: 'attribute_not_exists(followId)',
    }));
    isNew = true;
  } catch {} // ignore duplicate

  if (isNew && targetType === 'venue') {
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: targetId },
      UpdateExpression: 'ADD followerCount :one',
      ExpressionAttributeValues: { ':one': 1 },
    })).catch(() => {});
  }

  return ok({ ok: true });
}

/* ---- DELETE /follows ---- */
async function unfollowTarget(event) {
  const { email, targetId } = parseBody(event);
  if (!email || !targetId) return badRequest('email and targetId required');

  // Fetch the follow record first to know targetType (needed for followerCount decrement)
  const existing = await ddb.send(new GetCommand({
    TableName: FOLLOWS_TABLE,
    Key: { followId: `${email}#${targetId}` },
  })).catch(() => ({}));
  const targetType = existing.Item?.targetType;

  await ddb.send(new DeleteCommand({ TableName: FOLLOWS_TABLE, Key: { followId: `${email}#${targetId}` } })).catch(() => {});

  if (targetType === 'venue') {
    await ddb.send(new UpdateCommand({
      TableName: VENUES_TABLE,
      Key: { venueId: targetId },
      UpdateExpression: 'ADD followerCount :neg',
      ConditionExpression: 'followerCount > :zero',
      ExpressionAttributeValues: { ':neg': -1, ':zero': 0 },
    })).catch(() => {}); // safe to ignore if followerCount already 0
  }

  return ok({ ok: true });
}

/* ---- GET /follows/check?email=&targetId= ---- */
async function checkFollow(params) {
  const { email, targetId } = params || {};
  if (!email || !targetId) return badRequest('email and targetId required');
  const r = await ddb.send(new GetCommand({ TableName: FOLLOWS_TABLE, Key: { followId: `${email}#${targetId}` } })).catch(() => ({}));
  return ok({ following: !!r.Item });
}

/* ---- GET /unsubscribe?token= ---- */
async function unsubscribeByToken(params) {
  const token = params?.token || '';
  if (!token) return badRequest('token required');
  // Scan for the token (low frequency, acceptable)
  const r = await ddb.send(new ScanCommand({
    TableName: FOLLOWS_TABLE,
    FilterExpression: 'unsubToken = :t',
    ExpressionAttributeValues: { ':t': token },
    Limit: 1,
  })).catch(() => ({ Items: [] }));
  const item = r.Items?.[0];
  if (!item) return ok({ ok: true, message: 'Already removed or not found' });
  await ddb.send(new DeleteCommand({ TableName: FOLLOWS_TABLE, Key: { followId: item.followId } })).catch(() => {});
  return ok({ ok: true, message: 'Unsubscribed successfully' });
}

/* ---- GET /early-radar ---- */
async function getEarlyRadar() {
  const today      = new Date().toISOString().split('T')[0];
  const twoWeeks   = new Date(Date.now() + 14 * 864e5).toISOString().split('T')[0];

  // Artists with 2+ listener history snapshots
  const artistsRes = await ddb.send(new ScanCommand({
    TableName: ARTISTS_TABLE,
    FilterExpression: 'size(listenersHistory) >= :min',
    ExpressionAttributeValues: { ':min': 2 },
    ProjectionExpression: 'artistId, #n, listenersHistory, imageUrl, genres',
    ExpressionAttributeNames: { '#n': 'name' },
  })).catch(() => ({ Items: [] }));

  const artists = artistsRes.Items || [];
  if (!artists.length) return ok([]);

  // Compute growth rate from history snapshots
  const withGrowth = artists.map(a => {
    const history = (a.listenersHistory || []).map(e => {
      try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; }
    }).filter(Boolean).sort((x, y) => (x.ts || '').localeCompare(y.ts || ''));
    if (history.length < 2) return null;
    const oldest = history[0].l;
    const latest = history[history.length - 1].l;
    if (!oldest || oldest <= 0) return null;
    const growthRate = ((latest - oldest) / oldest) * 100;
    return { ...a, growthRate: Math.round(growthRate), latestListeners: latest };
  }).filter(Boolean);

  if (!withGrowth.length) return ok([]);

  // Top 50 by growth rate, then cross-reference with upcoming grassroots gigs
  const topGrowing = withGrowth.sort((a, b) => b.growthRate - a.growthRate).slice(0, 50);
  const topIds     = new Set(topGrowing.map(a => a.artistId));

  const gigsRes = await ddb.send(new ScanCommand({
    TableName: GIGS_TABLE,
    FilterExpression: '#d >= :today AND #d <= :twoWeeks AND #ig = :t',
    ExpressionAttributeNames: { '#d': 'date', '#ig': '_isGrassroots' },
    ExpressionAttributeValues: { ':today': today, ':twoWeeks': twoWeeks, ':t': true },
    ProjectionExpression: 'artistId, artistName, venueName, venueCity, venueSlug, #d, gigId, ticketUrl',
  })).catch(() => ({ Items: [] }));

  const gigsByArtist = new Map();
  for (const g of (gigsRes.Items || [])) {
    if (!topIds.has(g.artistId)) continue;
    if (!gigsByArtist.has(g.artistId)) gigsByArtist.set(g.artistId, []);
    gigsByArtist.get(g.artistId).push(g);
  }

  const result = topGrowing
    .filter(a => gigsByArtist.has(a.artistId))
    .slice(0, 10)
    .map(a => ({
      artistId:              a.artistId,
      name:                  a.name,
      imageUrl:              a.imageUrl,
      genres:                a.genres,
      growthRate:            a.growthRate,
      latestListeners:       a.latestListeners,
      upcomingGrassrootsGigs: (gigsByArtist.get(a.artistId) || [])
        .sort((x, y) => x.date.localeCompare(y.date))
        .slice(0, 2),
    }));

  return ok(result);
}

/* ---- POST /stripe/webhook ---- */
const crypto = require('crypto');

async function stripeWebhook(event) {
  const sig        = (event.headers || {})['stripe-signature'] || '';
  const rawBody    = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  // Verify signature
  if (STRIPE_WEBHOOK_SECRET) {
    try {
      const parts   = Object.fromEntries(sig.split(',').map(p => p.split('=')));
      const ts      = parts.t || '';
      const v1      = parts.v1 || '';
      const payload = `${ts}.${rawBody}`;
      const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(payload).digest('hex');
      if (expected !== v1) return { statusCode: 400, headers: CORS, body: 'Invalid signature' };
      // Reject if timestamp is more than 5 minutes old
      if (Math.abs(Date.now() / 1000 - parseInt(ts)) > 300) return { statusCode: 400, headers: CORS, body: 'Timestamp too old' };
    } catch {
      return { statusCode: 400, headers: CORS, body: 'Signature error' };
    }
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(rawBody); } catch { return { statusCode: 400, headers: CORS, body: 'Invalid JSON' }; }

  if (stripeEvent.type !== 'checkout.session.completed') return ok({ received: true });

  const session       = stripeEvent.data?.object || {};
  const customerEmail = session.customer_details?.email || '';
  const customFields  = session.custom_fields || [];
  const venueField    = customFields.find(f => f.key === 'venue_slug');
  const venueInput    = venueField?.text?.value?.trim() || '';

  // Detect tier from amount: £149 = Pro, £49 = Spotlight
  const amountTotal  = session.amount_total || 0;
  const isPro        = amountTotal >= 14900;
  const tierName     = isPro ? 'Venue Pro' : 'Spotlight';

  if (!venueInput) {
    console.log(`Stripe webhook: no venue name provided in session ${session.id}`);
    return ok({ received: true });
  }

  // Find venue by name (case-insensitive) or slug
  const q = venueInput.toLowerCase();
  const scanRes = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: 'contains(#nm, :q) OR slug = :qs',
    ExpressionAttributeNames: { '#nm': 'name' },
    ExpressionAttributeValues: { ':q': venueInput, ':qs': q.replace(/\s+/g, '-') },
  })).catch(() => ({ Items: [] }));

  const venues = (scanRes.Items || []).filter(v => v.name?.toLowerCase().includes(q));
  const venue  = venues.sort((a, b) => {
    const aExact = a.name?.toLowerCase() === q ? 0 : 1;
    const bExact = b.name?.toLowerCase() === q ? 0 : 1;
    return aExact - bExact;
  })[0];

  if (!venue) {
    console.log(`Stripe webhook: venue not found for input "${venueInput}" (session ${session.id})`);
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: ['lewis.oliver.wilson@googlemail.com'],
          subject: `GigRadar ${tierName}: venue not found — manual activation needed`,
          html: `<p>New ${tierName} payment received but venue not found.</p>
                 <p><b>Customer:</b> ${customerEmail}</p>
                 <p><b>Venue input:</b> "${venueInput}"</p>
                 <p><b>Tier:</b> ${tierName} (£${(amountTotal / 100).toFixed(0)}/month)</p>
                 <p><b>Session:</b> ${session.id}</p>`,
        }),
      }).catch(() => {});
    }
    return ok({ received: true });
  }

  // Activate Spotlight or Venue Pro
  const updateExpr = isPro
    ? 'SET isVenuePro = :t, isSpotlight = :t, venueProActivatedAt = :ts, venueProEmail = :email'
    : 'SET isSpotlight = :t, spotlightActivatedAt = :ts, spotlightEmail = :email';

  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: venue.venueId },
    UpdateExpression: updateExpr,
    ExpressionAttributeValues: { ':t': true, ':ts': new Date().toISOString(), ':email': customerEmail },
  })).catch(() => {});

  console.log(`${tierName} activated: ${venue.name} (${venue.venueId}) for ${customerEmail}`);

  // Confirmation email
  if (RESEND_API_KEY && customerEmail) {
    const venueUrl = `${SITE_URL}/venues/${venue.slug}`;
    const proFeatures = isPro ? `
      <ul style="color:#a1a1aa;font-size:14px;padding-left:20px;margin:12px 0;">
        <li>Venue Pro badge on your page</li>
        <li>Analytics dashboard — page views, followers, upcoming gigs</li>
        <li>Announcement banner (pin messages for fans)</li>
        <li>Featured placement on the GigRadar homepage</li>
        <li>Weekly stats email every Friday</li>
      </ul>` : '';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [customerEmail],
        subject: `Your ${tierName} is live — ${venue.name}`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:auto;background:#111;color:#eee;padding:32px;border-radius:12px;">
          <div style="background:#6366f1;border-radius:8px;padding:6px 10px;font-weight:900;font-size:16px;color:#fff;display:inline-block;margin-bottom:20px;">GR</div>
          <h1 style="color:#fff;font-size:22px;margin:0 0 8px;">Your ${tierName} is live.</h1>
          <p style="color:#a1a1aa;font-size:14px;">
            <a href="${venueUrl}" style="color:#818cf8;">${venue.name}</a> is now active on GigRadar.
          </p>
          ${proFeatures}
          <a href="${venueUrl}" style="display:block;margin-top:20px;background:#6366f1;color:#fff;text-decoration:none;text-align:center;font-weight:700;padding:12px;border-radius:10px;font-size:14px;">View your venue page →</a>
          <p style="margin-top:20px;font-size:12px;color:#52525b;">Questions? Reply to this email.</p>
        </div>`,
      }),
    }).catch(() => {});
  }

  return ok({ received: true, activated: venue.venueId, tier: tierName });
}

/* ---- Router ---- */
exports.handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const method  = event.requestContext?.http?.method || 'GET';
  const rawPath = event.rawPath || '/';
  const params  = event.queryStringParameters || {};

  // ---- GET routes ----
  if (method === 'GET') {
    if (rawPath === '/api/auth/spotify/artists') return spotifyArtists(event);

    if (rawPath === '/artists') return getArtists();

    const artistMatch = rawPath.match(/^\/artists\/([^/]+)$/);
    if (artistMatch) return getArtist(decodeURIComponent(artistMatch[1]));

    const artistGigsMatch = rawPath.match(/^\/artists\/([^/]+)\/gigs$/);
    if (artistGigsMatch) return getArtistGigs(decodeURIComponent(artistGigsMatch[1]));

    const artistSimilarMatch = rawPath.match(/^\/artists\/([^/]+)\/similar$/);
    if (artistSimilarMatch) return getSimilarArtists(decodeURIComponent(artistSimilarMatch[1]));

    if (rawPath === '/search') return search(params);

    if (rawPath === '/trending')      return withCache('trending',    30*60000, () => getTrending());
    if (rawPath === '/emerging')      return withCache('emerging',    30*60000, () => getEmerging());
    if (rawPath === '/early-radar')   return withCache('early-radar', 60*60000, () => getEarlyRadar());
    if (rawPath === '/grassroots')    return withCache('grassroots',  30*60000, () => getGrassrootsGigs(params));
    if (rawPath === '/on-sale')       return withCache('on-sale',     15*60000, () => getOnSaleGigs(params));
    if (rawPath === '/coming-soon')   return withCache('coming-soon', 15*60000, () => getComingSoonGigs(params));
    if (rawPath === '/gigs/nearby')   return getNearbyGigs(params);
    const gigMatch = rawPath.match(/^\/gigs\/([^/]+)$/);
    if (gigMatch) return getGig(decodeURIComponent(gigMatch[1]));
    if (rawPath === '/gigs')          return getGigs(params);

    const artistSetlistsMatch = rawPath.match(/^\/artists\/([^/]+)\/setlists$/);
    if (artistSetlistsMatch) return getArtistSetlists(decodeURIComponent(artistSetlistsMatch[1]));

    if (rawPath === '/venues/featured') return getVenuesFeatured();
    if (rawPath === '/venues') return (params?.city || params?.grassroots) ? getVenuesFiltered(params) : getVenues();

    const venueGigsMatch = rawPath.match(/^\/venues\/([^/]+)\/gigs$/);
    if (venueGigsMatch) return getVenueGigs(decodeURIComponent(venueGigsMatch[1]));

    const venueAnalyticsMatch = rawPath.match(/^\/venues\/([^/]+)\/analytics$/);
    if (venueAnalyticsMatch) return getVenueAnalytics(decodeURIComponent(venueAnalyticsMatch[1]), event);

    const venueMatch = rawPath.match(/^\/venues\/([^/]+)$/);
    if (venueMatch) return getVenue(decodeURIComponent(venueMatch[1]));

    if (rawPath === '/admin/artists')       return adminGetArtists(event);
    if (rawPath === '/admin/claims')        return adminGetClaims(event);
    if (rawPath === '/admin/venue-claims')  return adminGetVenueClaims(event);
    if (rawPath === '/follows/check') return checkFollow(params);
    if (rawPath === '/unsubscribe')   return unsubscribeByToken(params);

    return notFound();
  }

  // ---- POST routes ----
  if (method === 'POST') {
    if (rawPath === '/api/auth/spotify/exchange')   return spotifyExchange(event);
    if (rawPath === '/api/auth/spotify/disconnect') return spotifyDisconnect(event);
    if (rawPath === '/api/artists/match')           return matchArtists(event);

    const claimMatch = rawPath.match(/^\/artists\/([^/]+)\/claim$/);
    if (claimMatch) return submitClaim(decodeURIComponent(claimMatch[1]), event);

    const venueClaimMatch = rawPath.match(/^\/venues\/([^/]+)\/claim$/);
    if (venueClaimMatch) return submitVenueClaim(decodeURIComponent(venueClaimMatch[1]), event);

    const venueViewMatch = rawPath.match(/^\/venues\/([^/]+)\/view$/);
    if (venueViewMatch) return trackVenueView(decodeURIComponent(venueViewMatch[1]));

    const approveVenueClaimMatch = rawPath.match(/^\/admin\/venue-claims\/([^/]+)\/approve$/);
    if (approveVenueClaimMatch) return adminApproveVenueClaim(decodeURIComponent(approveVenueClaimMatch[1]), event);

    const rejectVenueClaimMatch = rawPath.match(/^\/admin\/venue-claims\/([^/]+)\/reject$/);
    if (rejectVenueClaimMatch) return adminRejectVenueClaim(decodeURIComponent(rejectVenueClaimMatch[1]), event);

    const genresMatch = rawPath.match(/^\/admin\/artists\/([^/]+)\/genres$/);
    if (genresMatch) return adminSetGenres(decodeURIComponent(genresMatch[1]), event);

    const approveMatch = rawPath.match(/^\/admin\/claims\/([^/]+)\/approve$/);
    if (approveMatch) return adminApproveClaim(decodeURIComponent(approveMatch[1]), event);

    const rejectMatch = rawPath.match(/^\/admin\/claims\/([^/]+)\/reject$/);
    if (rejectMatch) return adminRejectClaim(decodeURIComponent(rejectMatch[1]), event);

    if (rawPath === '/follows')          return followTarget(event);
    if (rawPath === '/stripe/webhook')   return stripeWebhook(event);

    return notFound();
  }

  // ---- DELETE routes ----
  if (method === 'DELETE') {
    if (rawPath === '/follows')     return unfollowTarget(event);
    return notFound();
  }

  // ---- PATCH routes ----
  if (method === 'PATCH') {
    const artistPatchMatch = rawPath.match(/^\/artists\/([^/]+)$/);
    if (artistPatchMatch) return updateArtistProfile(decodeURIComponent(artistPatchMatch[1]), event);

    const venuePatchMatch = rawPath.match(/^\/venues\/([^/]+)$/);
    if (venuePatchMatch) return updateVenueProfile(decodeURIComponent(venuePatchMatch[1]), event);

    return notFound();
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
