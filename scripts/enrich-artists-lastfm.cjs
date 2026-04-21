#!/usr/bin/env node
/**
 * GigRadar Artist Enrichment — Last.fm
 *
 * For every artist in gigradar-artists, fetches Last.fm artist.getInfo to get:
 *   - genres (tags)
 *   - bio (summary)
 *   - listener count
 *   - MusicBrainz ID (for cross-referencing)
 *
 * Only writes fields that aren't already set (uses if_not_exists for bio/genres).
 * Always updates listener count (changes over time).
 *
 * Usage:
 *   LASTFM_API_KEY=xxxx node scripts/enrich-artists-lastfm.cjs
 *   LASTFM_API_KEY=xxxx node scripts/enrich-artists-lastfm.cjs --dry-run
 *   LASTFM_API_KEY=xxxx node scripts/enrich-artists-lastfm.cjs --resume
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                               = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand }           = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const ARTISTS_TABLE  = 'gigradar-artists';
const PROGRESS_FILE  = path.join(__dirname, 'lastfm-enrich-progress.json');
const LASTFM_KEY     = process.env.LASTFM_API_KEY || 'e2c0791c809dd2a81adde0158dd70c41';
const DRY_RUN        = process.argv.includes('--dry-run');
const RESUME         = process.argv.includes('--resume');
const QUICK          = process.argv.includes('--quick'); // only artists with upcoming gigs
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

// ─── Load all artists ─────────────────────────────────────────────────────────

async function loadArtists() {
  console.log(`Loading artists${QUICK ? ' with upcoming gigs' : ''} from DynamoDB...`);
  const artists = [];
  let lastKey;
  do {
    const p = { TableName: ARTISTS_TABLE, ProjectionExpression: 'artistId, #n', ExpressionAttributeNames: { '#n': 'name' } };
    if (QUICK) { p.FilterExpression = 'upcoming > :z'; p.ExpressionAttributeValues = { ':z': 0 }; }
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p)).catch(() => ({ Items: [] }));
    artists.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  console.log(`  ${artists.length.toLocaleString()} artists loaded\n`);
  return artists;
}

// ─── Fetch Last.fm artist info ────────────────────────────────────────────────

async function fetchLastfm(name) {
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${LASTFM_KEY}&format=json&autocorrect=1`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) { await sleep(10000); continue; }
      if (!r.ok) { await sleep(2000 * attempt); continue; }
      const data = await r.json();
      if (data.error) return null; // artist not found
      return data.artist || null;
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(2000 * attempt);
    }
  }
  return null;
}

function cleanBio(raw) {
  if (!raw) return null;
  // Remove Last.fm "Read more" links and trim
  return raw
    .replace(/<a href="[^"]*">[^<]*<\/a>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 1000) || null;
}

function extractGenres(tags) {
  if (!tags?.tag) return [];
  const list = Array.isArray(tags.tag) ? tags.tag : [tags.tag];
  const skip = /^(seen live|british|english|scottish|welsh|irish|uk|american|male vocalists|female vocalists|all|love|spotify|acoustic)$/i;
  return list
    .filter(t => t.name && !skip.test(t.name.trim()))
    .slice(0, 5)
    .map(t => t.name.trim());
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Artist Enrichment — Last.fm ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const done     = loadProgress();
  const artists  = await loadArtists();
  const toProcess = RESUME ? artists.filter(a => !done.has(a.artistId)) : artists;

  console.log(`Processing ${toProcess.length.toLocaleString()} artists${RESUME ? ` (${done.size} already done)` : ''}\n`);

  let enriched = 0, notFound = 0, withBio = 0, withGenres = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { artistId, name } = toProcess[i];
    if (!name) { notFound++; continue; }

    const artist = await fetchLastfm(name);

    if (!artist) {
      notFound++;
    } else {
      const genres    = extractGenres(artist.tags);
      const bio       = cleanBio(artist.bio?.summary);
      const listeners = parseInt(artist.stats?.listeners || 0) || null;
      const mbid      = artist.mbid || null;

      if (!DRY_RUN) {
        const sets   = ['lastUpdated = :t'];
        const values = { ':t': new Date().toISOString() };

        // Always update listener count (changes over time)
        if (listeners) { sets.push('lastfmListeners = :l'); values[':l'] = listeners; }
        if (mbid)      { sets.push('lastfmMbid = if_not_exists(lastfmMbid, :m)'); values[':m'] = mbid; }
        if (bio)       { sets.push('bio = if_not_exists(bio, :b)'); values[':b'] = bio; }
        // Always overwrite genres when Last.fm returns real tags (fixes empty [] never updating)
        if (genres.length) { sets.push('genres = :g'); values[':g'] = genres; }

        await ddb.send(new UpdateCommand({
          TableName: ARTISTS_TABLE,
          Key: { artistId },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeValues: values,
        })).catch(() => {});
      }

      enriched++;
      if (bio) withBio++;
      if (genres.length) withGenres++;
    }

    done.add(artistId);

    if (i % 100 === 0 || i === toProcess.length - 1) {
      saveProgress(done);
      const pct = ((i + 1) / toProcess.length * 100).toFixed(1);
      process.stdout.write(
        `\r  [${(i + 1).toLocaleString()}/${toProcess.length.toLocaleString()}] (${pct}%) | Enriched: ${enriched} | Genres: ${withGenres} | Bios: ${withBio} | Not found: ${notFound}   `
      );
    }

    await sleep(210); // ~5 req/sec
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Enriched      : ${enriched.toLocaleString()}`);
  console.log(`With genres   : ${withGenres.toLocaleString()}`);
  console.log(`With bios     : ${withBio.toLocaleString()}`);
  console.log(`Not found     : ${notFound.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
  if (fs.existsSync(PROGRESS_FILE) && !DRY_RUN) fs.unlinkSync(PROGRESS_FILE);
}

main().catch(e => { console.error(e); process.exit(1); });
