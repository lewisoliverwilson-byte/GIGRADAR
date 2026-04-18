#!/usr/bin/env node
/**
 * GigRadar Artist Image Enrichment — Spotify
 *
 * Fetches artist profile images from Spotify Search API using Client Credentials.
 * Only targets artists that: have no imageUrl AND have upcoming > 0 gigs.
 *
 * Usage:
 *   SPOTIFY_CLIENT_SECRET=xxx node scripts/enrich-artists-images-spotify.cjs
 *   SPOTIFY_CLIENT_SECRET=xxx node scripts/enrich-artists-images-spotify.cjs --dry-run
 *   SPOTIFY_CLIENT_SECRET=xxx node scripts/enrich-artists-images-spotify.cjs --limit 500
 *
 * Get client secret from: https://developer.spotify.com/dashboard
 * App Client ID: 9f4abb0eac5a45019b8d9a492daa41fc
 */

'use strict';

const path = require('path');
const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                         = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand }     = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb    = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const sleep  = ms => new Promise(r => setTimeout(r, ms));
const DRY    = process.argv.includes('--dry-run');
const LIMIT  = parseInt(process.argv[process.argv.indexOf('--limit') + 1] || '0') || 0;

const CLIENT_ID     = '9f4abb0eac5a45019b8d9a492daa41fc';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const ARTISTS_TABLE = 'gigradar-artists';

if (!CLIENT_SECRET) {
  console.error('Error: SPOTIFY_CLIENT_SECRET environment variable is required.');
  console.error('Get it from: https://developer.spotify.com/dashboard');
  process.exit(1);
}

// ─── Spotify Client Credentials token ────────────────────────────────────────

let token = null, tokenExpiry = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiry) return token;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Spotify token error ${r.status}: ${t}`); }
  const d = await r.json();
  token = d.access_token;
  tokenExpiry = Date.now() + (d.expires_in - 30) * 1000;
  return token;
}

// ─── Fetch artist image from Spotify ─────────────────────────────────────────

function normName(n) { return (n||'').toLowerCase().replace(/[^a-z0-9]/g,''); }

async function fetchSpotifyImage(name) {
  try {
    const tok = await getToken();
    const r   = await fetch(
      'https://api.spotify.com/v1/search?q=' + encodeURIComponent(name) + '&type=artist&limit=5',
      { headers: { 'Authorization': 'Bearer ' + tok } }
    );
    if (r.status === 429) {
      const retry = parseInt(r.headers.get('Retry-After') || '5');
      console.log(`  Spotify rate limit — waiting ${retry}s`);
      await sleep(retry * 1000 + 500);
      return fetchSpotifyImage(name);
    }
    if (!r.ok) return null;
    const d       = await r.json();
    const artists = d?.artists?.items || [];
    const norm    = normName(name);
    const hit     = artists.find(a => normName(a.name) === norm) || artists[0];
    if (!hit?.images?.length) return null;
    const img = hit.images[0]?.url;  // largest image first
    return img || null;
  } catch { return null; }
}

// ─── Load artists to enrich ───────────────────────────────────────────────────

async function loadArtists() {
  console.log('Loading artists without images (with upcoming gigs)...');
  const artists = [];
  let lastKey;
  do {
    const params = {
      TableName: ARTISTS_TABLE,
      FilterExpression: '(attribute_not_exists(imageUrl) OR imageUrl = :n) AND upcoming > :z',
      ExpressionAttributeValues: { ':n': null, ':z': 0 },
      ProjectionExpression: 'artistId, #nm, upcoming',
      ExpressionAttributeNames: { '#nm': 'name' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    artists.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  // Sort by most upcoming gigs first — most impactful
  artists.sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0));
  console.log(`  ${artists.length.toLocaleString()} artists to enrich\n`);
  return LIMIT ? artists.slice(0, LIMIT) : artists;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== GigRadar Spotify Image Enrichment${DRY ? ' [DRY RUN]' : ''} ===\n`);
  const artists = await loadArtists();
  let found = 0, notFound = 0;

  for (let i = 0; i < artists.length; i++) {
    const { artistId, name, upcoming } = artists[i];
    if (!name) { notFound++; continue; }

    const img = await fetchSpotifyImage(name);
    if (img) {
      if (!DRY) {
        await ddb.send(new UpdateCommand({
          TableName: ARTISTS_TABLE,
          Key: { artistId },
          UpdateExpression: 'SET imageUrl = :url, lastUpdated = :t',
          ExpressionAttributeValues: { ':url': img, ':t': new Date().toISOString() },
        })).catch(() => {});
      }
      found++;
    } else {
      notFound++;
    }

    if ((i + 1) % 50 === 0 || i === artists.length - 1) {
      process.stdout.write(`\r  [${i+1}/${artists.length}] Found: ${found} | Not found: ${notFound}`);
    }
    await sleep(100); // ~10 req/sec, well within Spotify's limits
  }

  console.log(`\n\nDone. Found images for ${found}/${artists.length} artists.`);
}

main().catch(console.error);
