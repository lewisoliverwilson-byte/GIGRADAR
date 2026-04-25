/**
 * enrich-artists-spotify-v2.cjs
 *
 * Bulk Spotify enrichment for all 47k artists.
 * Improvements over v1:
 *   - Stores spotifyId field separately (not just URL)
 *   - Fetches + stores artist image (highest-res, ~640px)
 *   - Always updates popularity/followers (not if_not_exists)
 *   - Only if_not_exists for genres (don't override Last.fm)
 *   - 10 concurrent requests (~300 req/sec in practice)
 *   - Strict name matching: exact only, skip if followers=0
 *   - Deduplication: tracks Spotify IDs assigned; skips collisions
 *   - Processes artists with upcoming gigs first
 *   - Resume support via progress file
 *
 * Usage:
 *   node scripts/enrich-artists-spotify-v2.cjs           # all artists
 *   node scripts/enrich-artists-spotify-v2.cjs --quick   # upcoming only (faster)
 *   node scripts/enrich-artists-spotify-v2.cjs --resume  # continue from last run
 *   node scripts/enrich-artists-spotify-v2.cjs --dry-run
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const ARTISTS_TABLE  = 'gigradar-artists';
const PROGRESS_FILE  = path.join(__dirname, 'spotify-v2-progress.json');
const CLIENT_ID      = process.env.SPOTIFY_CLIENT_ID     || '9f4abb0eac5a45019b8d9a492daa41fc';
const CLIENT_SECRET  = process.env.SPOTIFY_CLIENT_SECRET || '130c12d419064803bec3126cb3d4e411';
const DRY_RUN        = process.argv.includes('--dry-run');
const RESUME         = process.argv.includes('--resume');
const QUICK          = process.argv.includes('--quick');
const CONCURRENCY    = 10;
const sleep          = ms => new Promise(r => setTimeout(r, ms));

// ─── Progress ────────────────────────────────────────────────────────────────

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); } catch {}
  }
  return new Set();
}
function saveProgress(done) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
}

// ─── Spotify token ────────────────────────────────────────────────────────────

let spotifyToken = null;
let tokenExpiry  = 0;

async function getToken() {
  if (spotifyToken && Date.now() < tokenExpiry) return spotifyToken;
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) { console.error('\nSpotify token error:', r.status); return null; }
  const d = await r.json();
  spotifyToken = d.access_token;
  tokenExpiry  = Date.now() + (d.expires_in - 60) * 1000;
  return spotifyToken;
}

// ─── Load artists ─────────────────────────────────────────────────────────────

async function loadArtists() {
  const artists = [];
  let lastKey;
  do {
    const p = {
      TableName: ARTISTS_TABLE,
      ProjectionExpression: 'artistId, #n, genres, spotify, spotifyId, imageUrl, upcoming',
      ExpressionAttributeNames: { '#n': 'name' },
    };
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p)).catch(() => ({ Items: [] }));
    artists.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return artists;
}

// ─── Search Spotify ───────────────────────────────────────────────────────────

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

async function searchSpotify(name) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const token = await getToken();
      if (!token) return null;
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent('"' + name + '"')}&type=artist&limit=10&market=GB`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 429) {
        const retry = parseInt(r.headers.get('Retry-After') || '10');
        await sleep(retry * 1000);
        continue;
      }
      if (r.status === 401) { spotifyToken = null; continue; }
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const data = await r.json();
      const items = data.artists?.items || [];
      const normN = norm(name);
      // Strict: exact normalised name match only
      return items.find(a => norm(a.name) === normN) || null;
    } catch {
      if (attempt === 4) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

// ─── Enrich one artist ────────────────────────────────────────────────────────

const assignedSpotifyIds = new Set(); // dedup across this run

async function enrichArtist(artist) {
  const { artistId, name, genres, spotify, spotifyId: existingSpotifyId, imageUrl } = artist;
  if (!name) return 'skip';

  const sa = await searchSpotify(name);
  if (!sa) return 'not-found';
  if (sa.followers?.total === 0) return 'not-found'; // skip zero-follower matches (usually wrong)

  const saId = sa.id;

  // Dedup: if this Spotify ID is already assigned to another artist in this run, skip
  if (assignedSpotifyIds.has(saId) && existingSpotifyId !== saId) return 'duplicate';
  assignedSpotifyIds.add(saId);

  // Pick highest-res image (sorted by width desc)
  const imgs = (sa.images || []).sort((a, b) => (b.width || 0) - (a.width || 0));
  const saImage = imgs[0]?.url || null;
  const saImageMed = imgs.find(i => (i.width || 0) <= 300)?.url || imgs[imgs.length - 1]?.url || null;

  if (DRY_RUN) return 'found';

  const sets = ['spotifyId = :si', 'spotify = :s', 'spotifyPopularity = :p', 'monthlyListeners = :f', 'lastUpdated = :t'];
  const vals = {
    ':si': saId,
    ':s':  `https://open.spotify.com/artist/${saId}`,
    ':p':  sa.popularity || 0,
    ':f':  sa.followers?.total || 0,
    ':t':  new Date().toISOString(),
  };

  // Only set image if not already set (don't override manually uploaded images)
  if (saImage && !imageUrl) { sets.push('imageUrl = if_not_exists(imageUrl, :img)'); vals[':img'] = saImage; }
  if (saImageMed && !imageUrl) { sets.push('imageUrlMed = if_not_exists(imageUrlMed, :imgm)'); vals[':imgm'] = saImageMed; }

  // Only set genres if not already set (Last.fm genres are better)
  if (sa.genres?.length && (!genres || genres.length === 0)) {
    sets.push('genres = if_not_exists(genres, :g)');
    vals[':g'] = sa.genres.slice(0, 6);
  }

  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeValues: vals,
  })).catch(() => {});

  // Append listener snapshot for growth tracking
  if (sa.followers?.total > 0) {
    const entry = JSON.stringify({ ts: new Date().toISOString().split('T')[0], l: sa.followers.total });
    await ddb.send(new UpdateCommand({
      TableName: ARTISTS_TABLE,
      Key: { artistId },
      UpdateExpression: 'SET listenersHistory = list_append(if_not_exists(listenersHistory, :e), :v)',
      ExpressionAttributeValues: { ':v': [entry], ':e': [] },
    })).catch(() => {});
  }

  return 'found';
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function pool(items, fn, concurrency) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Spotify Enrichment v2 ===');
  if (DRY_RUN)  console.log('[DRY RUN]\n');
  if (QUICK)    console.log('[QUICK MODE — upcoming artists only]\n');
  if (RESUME)   console.log('[RESUME MODE]\n');

  console.log('Loading artists from DynamoDB...');
  let artists = await loadArtists();
  console.log(`  ${artists.length.toLocaleString()} artists loaded`);

  if (QUICK) {
    artists = artists.filter(a => (a.upcoming || 0) > 0);
    console.log(`  ${artists.length.toLocaleString()} with upcoming gigs`);
  }

  // Prioritise: artists with upcoming gigs first, then rest
  artists.sort((a, b) => {
    const ua = (a.upcoming || 0) > 0 ? 1 : 0;
    const ub = (b.upcoming || 0) > 0 ? 1 : 0;
    return ub - ua;
  });

  const done = loadProgress();
  const toProcess = artists.filter(a => !done.has(a.artistId));
  console.log(`  ${toProcess.length.toLocaleString()} remaining to process\n`);

  let found = 0, notFound = 0, dupes = 0, skipped = 0;
  let lastSave = Date.now();

  const results = await pool(toProcess, async (artist, idx) => {
    const result = await enrichArtist(artist);
    done.add(artist.artistId);

    if (result === 'found')      found++;
    else if (result === 'not-found') notFound++;
    else if (result === 'duplicate') dupes++;
    else skipped++;

    // Save progress and print status every 100 artists or every 30s
    if (idx % 100 === 0 || Date.now() - lastSave > 30000) {
      saveProgress(done);
      lastSave = Date.now();
      const pct = ((idx + 1) / toProcess.length * 100).toFixed(1);
      process.stdout.write(
        `\r  [${(idx+1).toLocaleString()}/${toProcess.length.toLocaleString()}] ${pct}% | Found: ${found} | Not found: ${notFound} | Dupes: ${dupes}   `
      );
    }
  }, CONCURRENCY);

  saveProgress(done);
  console.log(`\n\n=== Complete ===`);
  console.log(`Found      : ${found.toLocaleString()}`);
  console.log(`Not found  : ${notFound.toLocaleString()}`);
  console.log(`Duplicates : ${dupes.toLocaleString()}`);
  console.log(`Skipped    : ${skipped.toLocaleString()}`);
  if (!DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
