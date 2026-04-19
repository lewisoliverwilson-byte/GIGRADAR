#!/usr/bin/env node
/**
 * Enriches artist profiles with bio, genres, social links, and images
 * from Wikipedia, MusicBrainz, and Spotify (if token available).
 *
 * Usage: node scripts/enrich-artists-web.cjs [--limit=500] [--missing-only]
 *
 * Writes: bio, genres, imageUrl, mbid, wikiUrl fields to artists
 */
'use strict';

const path = require('path');
const SDK  = p => require(path.join(__dirname, '../lambda/scraper/node_modules', p));

const { DynamoDBClient }                                     = SDK('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = SDK('@aws-sdk/lib-dynamodb');

const ddb          = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE        = 'gigradar-artists';
const LASTFM_KEY   = process.env.LASTFM_API_KEY || '37f3d1f6b6c7936d7074a9ecc21ed623';
const LIMIT        = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '500', 10);
const MISSING_ONLY = process.argv.includes('--missing-only');
const sleep        = ms => new Promise(r => setTimeout(r, ms));

const MB_HEADERS = { 'User-Agent': 'GigRadar/1.0 (lewis.oliver.wilson@googlemail.com)' };

// ─── Wikipedia ───────────────────────────────────────────────────────────────

async function fetchWikiBio(artistName) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // Try search fallback
      const search = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(artistName + ' musician')}&srlimit=1&format=json`);
      const sd = await search.json();
      const title = sd?.query?.search?.[0]?.title;
      if (!title) return null;
      await sleep(200);
      const r2 = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (!r2.ok) return null;
      const d2 = await r2.json();
      if (!d2?.extract || d2.type === 'disambiguation') return null;
      return { bio: d2.extract.split('.').slice(0, 4).join('.') + '.', wikiUrl: d2.content_urls?.desktop?.page };
    }
    const data = await res.json();
    if (!data?.extract || data.type === 'disambiguation') return null;
    return { bio: data.extract.split('.').slice(0, 4).join('.') + '.', wikiUrl: data.content_urls?.desktop?.page };
  } catch { return null; }
}

// ─── MusicBrainz ─────────────────────────────────────────────────────────────

async function fetchMBData(artistName) {
  const url = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent('"' + artistName + '"')}&limit=3&fmt=json`;
  try {
    const res  = await fetch(url, { headers: MB_HEADERS });
    if (!res.ok) return null;
    const data    = await res.json();
    const artists = data?.artists || [];
    const match   = artists.find(a => {
      const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return norm(a.name) === norm(artistName);
    }) || artists[0];
    if (!match) return null;
    const genres = (match.tags || []).sort((a, b) => b.count - a.count).slice(0, 5).map(t => t.name);
    return { mbid: match.id, genres, country: match.country, type: match.type };
  } catch { return null; }
}

// ─── Last.fm ─────────────────────────────────────────────────────────────────

async function fetchLastfmBio(artistName) {
  if (!LASTFM_KEY) return null;
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${LASTFM_KEY}&format=json&autocorrect=1`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    const info = data?.artist;
    if (!info) return null;
    const bio    = info.bio?.summary?.replace(/<a href[^>]*>.*?<\/a>/g, '').replace(/\s+/g, ' ').trim();
    const genres = (info.tags?.tag || []).slice(0, 5).map(t => t.name);
    const img    = (info.image || []).find(i => i.size === 'extralarge' || i.size === 'large')?.['#text'];
    return {
      bio:     bio?.length > 50 ? bio.slice(0, 500) : null,
      genres:  genres.length ? genres : null,
      imageUrl: (img && !img.includes('2a96cbd8b46e442fc41c2b86b821562f')) ? img : null,
    };
  } catch { return null; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function loadArtists() {
  const artists = [];
  let lastKey;
  do {
    const params = {
      TableName: TABLE,
      ProjectionExpression: 'artistId, #n, bio, genres, imageUrl, mbid',
      ExpressionAttributeNames: { '#n': 'name' },
      FilterExpression: 'attribute_not_exists(#n) OR #n <> :meta',
      ExpressionAttributeValues: { ':meta': '_gigradar_meta' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    artists.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return artists;
}

(async () => {
  console.log('Loading artists…');
  const all  = await loadArtists();
  let   todo = all.filter(a => a.name && a.artistId !== '_gigradar_meta');
  if (MISSING_ONLY) todo = todo.filter(a => !a.bio || !a.genres?.length || !a.imageUrl);
  todo = todo.slice(0, LIMIT);
  console.log(`Total: ${all.length}  To process: ${todo.length}${MISSING_ONLY ? ' (missing-only)' : ''}`);

  let enriched = 0;
  for (let i = 0; i < todo.length; i++) {
    const a = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] ${a.name} → `);

    const [lfm, mb, wiki] = await Promise.all([
      fetchLastfmBio(a.name),
      a.mbid ? Promise.resolve(null) : fetchMBData(a.name),
      a.bio ? Promise.resolve(null) : fetchWikiBio(a.name),
    ]);
    await sleep(300);

    const updates = {};
    const bio = wiki?.bio || lfm?.bio;
    if (bio && !a.bio)           updates.bio      = bio;
    if (wiki?.wikiUrl)           updates.wikiUrl  = wiki.wikiUrl;
    const genres = mb?.genres?.length ? mb.genres : (lfm?.genres?.length ? lfm.genres : null);
    if (genres && !a.genres?.length) updates.genres = genres;
    if (!a.imageUrl && lfm?.imageUrl) updates.imageUrl = lfm.imageUrl;
    if (mb?.mbid && !a.mbid)    updates.mbid     = mb.mbid;
    if (mb?.country)             updates.country  = mb.country;

    if (Object.keys(updates).length > 0) {
      const setExpr = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      const exprVals = {};
      for (const [k, v] of Object.entries(updates)) exprVals[`:${k}`] = v;
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { artistId: a.artistId },
        UpdateExpression: `SET ${setExpr}, lastEnriched = :ts`,
        ExpressionAttributeValues: { ...exprVals, ':ts': new Date().toISOString() },
      })).catch(e => console.error(' DDB error:', e.message));
      console.log(`✓ ${Object.keys(updates).join(', ')}`);
      enriched++;
    } else {
      console.log('no new data');
    }

    await sleep(400);
  }

  console.log(`\nDone. Enriched: ${enriched}/${todo.length}`);
})();
