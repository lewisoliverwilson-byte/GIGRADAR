#!/usr/bin/env node
/**
 * GigRadar Artist Enrichment — MusicBrainz
 *
 * Looks up artists by name in the MusicBrainz API and adds:
 *   - genres (from MB tags, score >= 2)
 *   - mbid (MusicBrainz ID)
 *   - country of origin
 *
 * Only processes artists missing genres. MB rate limit: 1 req/sec.
 *
 * Usage:
 *   node scripts/enrich-artists-musicbrainz.cjs
 *   node scripts/enrich-artists-musicbrainz.cjs --dry-run
 *   node scripts/enrich-artists-musicbrainz.cjs --resume
 */
'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb          = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const ARTISTS_TABLE = 'gigradar-artists';
const PROGRESS_FILE = path.join(__dirname, 'mb-artists-progress.json');
const DRY_RUN  = process.argv.includes('--dry-run');
const RESUME   = process.argv.includes('--resume');
const QUICK    = process.argv.includes('--quick'); // only artists with upcoming gigs
const sleep    = ms => new Promise(r => setTimeout(r, ms));

const MB_HEADERS = {
  'User-Agent': 'GigRadar/1.0 (lewis.oliver.wilson@googlemail.com)',
  'Accept': 'application/json',
};

// Tags to skip — too generic or non-genre
const SKIP_TAGS = new Set([
  'seen live','british','english','scottish','welsh','irish','american','australian',
  'canadian','german','swedish','norwegian','danish','french','japanese','korean',
  'male vocalists','female vocalists','all','love','spotify','acoustic','uk','us',
  'indie','singer-songwriter', // too broad on their own, keep only with other genres
]);

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); } catch {}
  }
  return new Set();
}
function saveProgress(done) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
}

async function mbSearch(name) {
  const url = `https://musicbrainz.org/ws/2/artist/?query=artist:"${encodeURIComponent(name)}"&limit=1&fmt=json`;
  try {
    const r = await fetch(url, { headers: MB_HEADERS });
    if (!r.ok) return null;
    const data = await r.json();
    const artist = data.artists?.[0];
    if (!artist || artist.score < 70) return null;
    return artist;
  } catch { return null; }
}

async function mbGetTags(mbid) {
  const url = `https://musicbrainz.org/ws/2/artist/${mbid}?inc=tags&fmt=json`;
  try {
    const r = await fetch(url, { headers: MB_HEADERS });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.tags || [])
      .filter(t => t.count >= 2 && !SKIP_TAGS.has(t.name.toLowerCase()))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(t => t.name.toLowerCase());
  } catch { return []; }
}

async function main() {
  console.log('=== Artist Enrichment — MusicBrainz ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // Load artists missing genres
  console.log('Loading artists without genres...');
  const toProcess = [];
  let lastKey;
  do {
    const p = {
      TableName: ARTISTS_TABLE,
      FilterExpression: QUICK
        ? '(attribute_not_exists(genres) OR size(genres) = :z) AND upcoming > :u'
        : 'attribute_not_exists(genres) OR size(genres) = :z',
      ExpressionAttributeValues: QUICK ? { ':z': 0, ':u': 0 } : { ':z': 0 },
      ProjectionExpression: 'artistId, #n',
      ExpressionAttributeNames: { '#n': 'name' },
    };
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p));
    toProcess.push(...(r.Items || []).filter(a => a.name && !a.artistId.startsWith('_')));
    lastKey = r.LastEvaluatedKey;
    process.stdout.write(`\r  Loaded ${toProcess.length.toLocaleString()} artists without genres...`);
  } while (lastKey);
  console.log(`\n  ${toProcess.length.toLocaleString()} artists to process\n`);

  const done = loadProgress();
  let enriched = 0, notFound = 0, genresAdded = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { artistId, name } = toProcess[i];
    if (done.has(artistId)) continue;

    // Search MB
    const artist = await mbSearch(name);
    await sleep(1050); // MB rate limit: 1 req/sec

    if (!artist) { notFound++; done.add(artistId); continue; }

    // Fetch tags (second request)
    const genres = await mbGetTags(artist.id);
    await sleep(1050);

    if (genres.length > 0 || artist.id) {
      if (!DRY_RUN) {
        const sets = ['#n = if_not_exists(#n, :n)', 'lastUpdated = :t'];
        const names = { '#n': 'name' };
        const vals  = { ':n': name, ':t': new Date().toISOString() };

        if (genres.length) { sets.push('genres = if_not_exists(genres, :g)'); vals[':g'] = genres; }
        if (artist.id)     { sets.push('mbid = if_not_exists(mbid, :m)'); vals[':m'] = artist.id; }
        if (artist['begin-area']?.name || artist.area?.name) {
          sets.push('mbCountry = if_not_exists(mbCountry, :c)');
          vals[':c'] = artist['begin-area']?.name || artist.area?.name;
        }

        await ddb.send(new UpdateCommand({
          TableName: ARTISTS_TABLE,
          Key: { artistId },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: vals,
        })).catch(() => {});
      }
      enriched++;
      if (genres.length) genresAdded++;
    } else {
      notFound++;
    }

    done.add(artistId);
    if (!DRY_RUN && (i + 1) % 100 === 0) saveProgress(done);

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`\r  [${i + 1}/${toProcess.length}] Enriched: ${enriched} | Genres: ${genresAdded} | Not found: ${notFound}   `);
    }
  }

  if (!DRY_RUN) saveProgress(done);
  console.log(`\r  [${toProcess.length}/${toProcess.length}] Enriched: ${enriched} | Genres: ${genresAdded} | Not found: ${notFound}   `);

  console.log('\n=== Complete ===');
  console.log(`Enriched   : ${enriched.toLocaleString()}`);
  console.log(`With genres: ${genresAdded.toLocaleString()}`);
  console.log(`Not found  : ${notFound.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written]');
}

main().catch(e => { console.error(e); process.exit(1); });
