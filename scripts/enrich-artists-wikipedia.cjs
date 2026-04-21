#!/usr/bin/env node
/**
 * GigRadar Artist Enrichment — Wikipedia bios
 *
 * For artists missing bios, searches Wikipedia and pulls the summary paragraph.
 * Falls back to searching "{name} band" if the first search misses.
 *
 * Usage:
 *   node scripts/enrich-artists-wikipedia.cjs
 *   node scripts/enrich-artists-wikipedia.cjs --dry-run
 *   node scripts/enrich-artists-wikipedia.cjs --resume
 */
'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb           = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const ARTISTS_TABLE = 'gigradar-artists';
const PROGRESS_FILE = path.join(__dirname, 'wiki-artists-progress.json');
const DRY_RUN       = process.argv.includes('--dry-run');
const RESUME        = process.argv.includes('--resume');
const sleep         = ms => new Promise(r => setTimeout(r, ms));

const WIKI_HEADERS = { 'User-Agent': 'GigRadar/1.0 (lewis.oliver.wilson@googlemail.com)' };

// Terms that indicate a non-music Wikipedia result
const BAD_TERMS = ['footballer','cricket','politician','actor','actress','television','novel','film','rugby','athlete','mathematician','philosopher','painter','sculptor','poet','album','song','single','ep','compilation','soundtrack','video game','politician'];

function loadProgress() {
  if (RESUME && fs.existsSync(PROGRESS_FILE)) {
    try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); } catch {}
  }
  return new Set();
}
function saveProgress(done) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done])); }

async function searchWiki(query) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
  try {
    const r = await fetch(url, { headers: WIKI_HEADERS });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.type === 'disambiguation') return null;
    const extract = data.extract || '';
    if (!extract || extract.length < 50) return null;
    // Reject non-music articles
    const lower = extract.toLowerCase();
    if (BAD_TERMS.some(t => lower.includes(t))) return null;
    // Must mention music-related terms
    const musicTerms = ['band','music','singer','musician','vocalist','guitarist','drummer','dj','producer','album','record','tour','concert','genre','rock','pop','jazz','electronic','hip-hop','folk','metal','punk','indie'];
    if (!musicTerms.some(t => lower.includes(t))) return null;
    return { bio: extract.split('\n')[0].slice(0, 500), wikiUrl: data.content_urls?.desktop?.page || null };
  } catch { return null; }
}

async function main() {
  console.log('=== Artist Enrichment — Wikipedia ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  console.log('Loading artists without bios...');
  const toProcess = [];
  let lastKey;
  do {
    const p = {
      TableName: ARTISTS_TABLE,
      FilterExpression: 'attribute_not_exists(bio) AND attribute_exists(upcoming)',
      ProjectionExpression: 'artistId, #n, upcoming',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {},
    };
    // Only artists with upcoming gigs — more likely to have Wikipedia pages
    p.FilterExpression = 'attribute_not_exists(bio) AND upcoming > :z';
    p.ExpressionAttributeValues = { ':z': 0 };
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p));
    toProcess.push(...(r.Items || []).filter(a => a.name));
    lastKey = r.LastEvaluatedKey;
    process.stdout.write(`\r  Loaded ${toProcess.length.toLocaleString()} artists without bios...`);
  } while (lastKey);
  // Sort by most upcoming first — highest value targets
  toProcess.sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0));
  console.log(`\n  ${toProcess.length.toLocaleString()} artists to process\n`);

  const done = loadProgress();
  let enriched = 0, notFound = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { artistId, name } = toProcess[i];
    if (done.has(artistId)) continue;

    // Try exact name first, then "{name} band"
    let result = await searchWiki(name);
    await sleep(100); // Wikipedia rate limit: generous but be polite
    if (!result) {
      result = await searchWiki(`${name} band`);
      await sleep(100);
    }
    if (!result) {
      result = await searchWiki(`${name} musician`);
      await sleep(100);
    }

    if (result) {
      if (!DRY_RUN) {
        await ddb.send(new UpdateCommand({
          TableName: ARTISTS_TABLE,
          Key: { artistId },
          UpdateExpression: 'SET bio = if_not_exists(bio, :b), lastUpdated = :t' + (result.wikiUrl ? ', wikiUrl = if_not_exists(wikiUrl, :w)' : ''),
          ExpressionAttributeValues: {
            ':b': result.bio,
            ':t': new Date().toISOString(),
            ...(result.wikiUrl ? { ':w': result.wikiUrl } : {}),
          },
        })).catch(() => {});
      }
      enriched++;
    } else {
      notFound++;
    }

    done.add(artistId);
    if (!DRY_RUN && (i + 1) % 200 === 0) saveProgress(done);
    if ((i + 1) % 100 === 0 || i === toProcess.length - 1) {
      process.stdout.write(`\r  [${i + 1}/${toProcess.length}] Enriched: ${enriched} | Not found: ${notFound}   `);
    }
  }

  if (!DRY_RUN) saveProgress(done);
  console.log(`\n\n=== Complete ===`);
  console.log(`Enriched: ${enriched.toLocaleString()}`);
  console.log(`Not found: ${notFound.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written]');
}

main().catch(e => { console.error(e); process.exit(1); });
