const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';

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

  return notFound();
};
