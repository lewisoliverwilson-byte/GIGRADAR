#!/usr/bin/env node
/**
 * GigRadar Artist Enrichment — Spotify
 *
 * Uses Spotify Client Credentials (no user login) to enrich artists with:
 *   - Spotify profile URL
 *   - Follower count (monthlyListeners field)
 *   - Genres (if not already set by Last.fm)
 *   - Popularity score
 *
 * Usage:
 *   node scripts/enrich-artists-spotify.cjs
 *   node scripts/enrich-artists-spotify.cjs --dry-run
 *   node scripts/enrich-artists-spotify.cjs --resume
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const ARTISTS_TABLE  = 'gigradar-artists';
const PROGRESS_FILE  = path.join(__dirname, 'spotify-enrich-progress.json');
const CLIENT_ID      = process.env.SPOTIFY_CLIENT_ID     || '9f4abb0eac5a45019b8d9a492daa41fc';
const CLIENT_SECRET  = process.env.SPOTIFY_CLIENT_SECRET || '';
const DRY_RUN        = process.argv.includes('--dry-run');
const RESUME         = process.argv.includes('--resume');
const sleep          = ms => new Promise(r => setTimeout(r, ms));

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); } catch {}
  }
  return new Set();
}
function saveProgress(done) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
}

// ─── Spotify Client Credentials token ────────────────────────────────────────

let spotifyToken = null;
let tokenExpiry  = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < tokenExpiry) return spotifyToken;

  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) { console.error('Spotify token error:', r.status); return null; }
  const data = await r.json();
  spotifyToken = data.access_token;
  tokenExpiry  = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

// ─── Load artists ─────────────────────────────────────────────────────────────

async function loadArtists() {
  console.log('Loading artists from DynamoDB...');
  const artists = [];
  let lastKey;
  do {
    const p = {
      TableName: ARTISTS_TABLE,
      ProjectionExpression: 'artistId, #n, genres',
      ExpressionAttributeNames: { '#n': 'name' },
    };
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p)).catch(() => ({ Items: [] }));
    artists.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  console.log(`  ${artists.length.toLocaleString()} artists loaded\n`);
  return artists;
}

// ─── Search Spotify for artist ────────────────────────────────────────────────

function normName(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

async function searchSpotify(name) {
  const token = await getSpotifyToken();
  if (!token) return null;

  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=5&market=GB`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (r.status === 429) {
        const retry = parseInt(r.headers.get('Retry-After') || '5');
        await sleep(retry * 1000);
        continue;
      }
      if (r.status === 401) { spotifyToken = null; return searchSpotify(name); }
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const data = await r.json();
      const items = data.artists?.items || [];

      // Find exact name match first, then closest
      const normN = normName(name);
      return items.find(a => normName(a.name) === normN) ||
             items.find(a => normName(a.name).includes(normN) || normN.includes(normName(a.name))) ||
             null;
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Artist Enrichment — Spotify ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  if (!CLIENT_SECRET) {
    console.error('Error: SPOTIFY_CLIENT_SECRET environment variable required.');
    console.error('Get it from: https://developer.spotify.com/dashboard');
    process.exit(1);
  }

  const done     = loadProgress();
  const artists  = await loadArtists();
  const toProcess = RESUME ? artists.filter(a => !done.has(a.artistId)) : artists;

  console.log(`Processing ${toProcess.length.toLocaleString()} artists\n`);

  let enriched = 0, notFound = 0, withGenres = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { artistId, name, genres } = toProcess[i];
    if (!name) { notFound++; continue; }

    const spotifyArtist = await searchSpotify(name);

    if (!spotifyArtist) {
      notFound++;
    } else {
      const spotifyUrl  = spotifyArtist.external_urls?.spotify || null;
      const followers   = spotifyArtist.followers?.total || null;
      const popularity  = spotifyArtist.popularity || null;
      const spGenres    = spotifyArtist.genres || [];

      if (!DRY_RUN) {
        const sets   = ['lastUpdated = :t'];
        const values = { ':t': new Date().toISOString() };

        if (spotifyUrl) { sets.push('spotify = if_not_exists(spotify, :s)'); values[':s'] = spotifyUrl; }
        if (followers)  { sets.push('monthlyListeners = :f'); values[':f'] = followers; }
        if (popularity) { sets.push('spotifyPopularity = :p'); values[':p'] = popularity; }
        // Only set genres from Spotify if not already populated by Last.fm
        if (spGenres.length && (!genres || genres.length === 0)) {
          sets.push('genres = :g');
          values[':g'] = spGenres.slice(0, 5);
          withGenres++;
        }

        await ddb.send(new UpdateCommand({
          TableName: ARTISTS_TABLE,
          Key: { artistId },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeValues: values,
        })).catch(() => {});
      }

      enriched++;
    }

    done.add(artistId);

    if (i % 100 === 0 || i === toProcess.length - 1) {
      saveProgress(done);
      const pct = ((i + 1) / toProcess.length * 100).toFixed(1);
      process.stdout.write(
        `\r  [${(i + 1).toLocaleString()}/${toProcess.length.toLocaleString()}] (${pct}%) | Found: ${enriched} | Not found: ${notFound} | Genres added: ${withGenres}   `
      );
    }

    await sleep(100); // ~10 req/sec, well within Spotify limits
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Enriched      : ${enriched.toLocaleString()}`);
  console.log(`Genres added  : ${withGenres.toLocaleString()}`);
  console.log(`Not found     : ${notFound.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
