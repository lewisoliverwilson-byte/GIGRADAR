const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';
const VENUES_TABLE  = 'gigradar-venues';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function ok(body) {
  return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function notFound(msg = 'Not found') {
  return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: msg }) };
}

/* ---- GET /artists ---- */
async function getArtists() {
  const result = await ddb.send(new ScanCommand({ TableName: ARTISTS_TABLE }));
  const artists = (result.Items || [])
    .filter(a => a.name && !a.artistId.startsWith('_')) // exclude internal meta records
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
  // Resolve venue to get venueId and name
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

/* ---- GET /gigs?upcoming=true&limit=N ---- */
async function getGigs(params) {
  const today  = new Date().toISOString().split('T')[0];
  const limit  = Math.min(parseInt(params?.limit || '200', 10), 500);

  // Scan with date filter — acceptable at this scale
  const result = await ddb.send(new ScanCommand({
    TableName:                 GIGS_TABLE,
    FilterExpression:          '#d >= :today',
    ExpressionAttributeNames:  { '#d': 'date' },
    ExpressionAttributeValues: { ':today': today },
    Limit:                     1000
  }));

  const gigs = (result.Items || [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);

  return ok(gigs);
}

/* ---- Router ---- */
exports.handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const method   = event.requestContext?.http?.method || 'GET';
  const rawPath  = event.rawPath || '/';
  const params   = event.queryStringParameters || {};

  if (method !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // GET /artists
  if (rawPath === '/artists') return getArtists();

  // GET /artists/:id
  const artistMatch = rawPath.match(/^\/artists\/([^/]+)$/);
  if (artistMatch) return getArtist(decodeURIComponent(artistMatch[1]));

  // GET /artists/:id/gigs
  const artistGigsMatch = rawPath.match(/^\/artists\/([^/]+)\/gigs$/);
  if (artistGigsMatch) return getArtistGigs(decodeURIComponent(artistGigsMatch[1]));

  // GET /gigs
  if (rawPath === '/gigs') return getGigs(params);

  // GET /venues
  if (rawPath === '/venues') return getVenues();

  // GET /venues/:slug/gigs
  const venueGigsMatch = rawPath.match(/^\/venues\/([^/]+)\/gigs$/);
  if (venueGigsMatch) return getVenueGigs(decodeURIComponent(venueGigsMatch[1]));

  // GET /venues/:slug
  const venueMatch = rawPath.match(/^\/venues\/([^/]+)$/);
  if (venueMatch) return getVenue(decodeURIComponent(venueMatch[1]));

  return notFound();
};
