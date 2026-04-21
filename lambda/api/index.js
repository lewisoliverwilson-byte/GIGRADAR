const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, GetCommand, UpdateCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

const ARTISTS_TABLE        = 'gigradar-artists';
const GIGS_TABLE           = 'gigradar-gigs';
const VENUES_TABLE         = 'gigradar-venues';
const FOLLOWS_TABLE        = 'gigradar-follows';
const SPOTIFY_TOKENS_TABLE = 'gigradar-spotify-tokens';
const ADMIN_KEY            = process.env.ADMIN_API_KEY || '';

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
  return ok(result.Items || []);
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

  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];
  const result  = await ddb.send(new ScanCommand({
    TableName: GIGS_TABLE,
    FilterExpression: '(canonicalVenueId = :vid OR venueName = :vname) AND #d >= :yearAgo',
    ExpressionAttributeNames:  { '#d': 'date' },
    ExpressionAttributeValues: { ':vid': venue.venueId, ':vname': venue.name, ':yearAgo': yearAgo },
  }));
  const gigs = (result.Items || []).sort((a, b) => a.date.localeCompare(b.date));
  return ok(gigs);
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

/* ---- GET /gigs ---- */
async function getGigs(params) {
  const today = new Date().toISOString().split('T')[0];
  const limit = Math.min(parseInt(params?.limit || '200', 10), 500);
  const city  = (params?.city  || '').trim().split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '').join(' ');
  const genre = (params?.genre || '').trim().toLowerCase();
  const from  = params?.from  || today;
  const to    = params?.to    || (() => { const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().split('T')[0]; })();

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

  return ok(
    allGigs
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, limit)
  );
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

  await ddb.send(new PutCommand({
    TableName: FOLLOWS_TABLE,
    Item: { followId, email, targetId, targetType, targetName: targetName || '', confirmed: true, createdAt: new Date().toISOString(), unsubToken },
    ConditionExpression: 'attribute_not_exists(followId)',
  })).catch(() => {}); // ignore duplicate

  return ok({ ok: true });
}

/* ---- DELETE /follows ---- */
async function unfollowTarget(event) {
  const { email, targetId } = parseBody(event);
  if (!email || !targetId) return badRequest('email and targetId required');
  await ddb.send(new DeleteCommand({ TableName: FOLLOWS_TABLE, Key: { followId: `${email}#${targetId}` } })).catch(() => {});
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

    if (rawPath === '/gigs') return getGigs(params);

    if (rawPath === '/venues') return getVenues();

    const venueGigsMatch = rawPath.match(/^\/venues\/([^/]+)\/gigs$/);
    if (venueGigsMatch) return getVenueGigs(decodeURIComponent(venueGigsMatch[1]));

    const venueMatch = rawPath.match(/^\/venues\/([^/]+)$/);
    if (venueMatch) return getVenue(decodeURIComponent(venueMatch[1]));

    if (rawPath === '/admin/artists') return adminGetArtists(event);
    if (rawPath === '/admin/claims')  return adminGetClaims(event);
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

    const genresMatch = rawPath.match(/^\/admin\/artists\/([^/]+)\/genres$/);
    if (genresMatch) return adminSetGenres(decodeURIComponent(genresMatch[1]), event);

    const approveMatch = rawPath.match(/^\/admin\/claims\/([^/]+)\/approve$/);
    if (approveMatch) return adminApproveClaim(decodeURIComponent(approveMatch[1]), event);

    const rejectMatch = rawPath.match(/^\/admin\/claims\/([^/]+)\/reject$/);
    if (rejectMatch) return adminRejectClaim(decodeURIComponent(rejectMatch[1]), event);

    if (rawPath === '/follows')     return followTarget(event);

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

    return notFound();
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
