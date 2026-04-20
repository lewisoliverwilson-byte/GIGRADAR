#!/usr/bin/env node
/**
 * GigRadar Artist Image Enrichment
 *
 * For every artist in gigradar-artists that has no imageUrl, tries:
 *   1. Deezer API (no key, instant)
 *   2. MusicBrainz + Cover Art Archive (no key, 1 req/sec)
 *
 * Usage:
 *   node scripts/enrich-artists-images.cjs
 *   node scripts/enrich-artists-images.cjs --dry-run
 *   node scripts/enrich-artists-images.cjs --limit 500
 */

'use strict';

const path = require('path');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                         = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand }     = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb     = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT   = parseInt(process.argv[process.argv.indexOf('--limit') + 1] || '0') || 0;

const ARTISTS_TABLE = 'gigradar-artists';

const MB_HEADERS = { 'User-Agent': 'GigRadar/1.0 (gigradar.co.uk)', 'Accept': 'application/json' };

// ─── Load artists without images ──────────────────────────────────────────────

async function loadArtistsWithoutImages() {
  console.log('Loading artists without images...');
  const artists = [];
  let lastKey;
  do {
    const params = {
      TableName: ARTISTS_TABLE,
      FilterExpression: 'attribute_not_exists(imageUrl) OR imageUrl = :n',
      ExpressionAttributeValues: { ':n': null },
      ProjectionExpression: 'artistId, #n',
      ExpressionAttributeNames: { '#n': 'name' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    artists.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  console.log(`  ${artists.length.toLocaleString()} artists without images\n`);
  return LIMIT ? artists.slice(0, LIMIT) : artists;
}

// ─── Source 1: Deezer ─────────────────────────────────────────────────────────

async function fetchDeezer(name) {
  try {
    const url  = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=3`;
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GigRadar/2.0)' } });
    if (!res.ok) return null;
    const data = await res.json();
    // Find best name match
    const normName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hit = (data?.data || []).find(a =>
      a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normName
    ) || data?.data?.[0];
    if (!hit) return null;
    const img = hit.picture_xl || hit.picture_big || hit.picture || '';
    if (!img || img.includes('default') || img.includes('placeholder') || img.includes('2a96cbd8b46e442fc41c2b86b821562f')) return null;
    return img;
  } catch { return null; }
}

// ─── Source 2: MusicBrainz → fanart.tv ───────────────────────────────────────

async function fetchMusicBrainzImage(name) {
  try {
    // Search MB for artist
    const q   = encodeURIComponent(`artist:"${name}"`);
    const url = `https://musicbrainz.org/ws/2/artist/?query=${q}&limit=3&fmt=json`;
    const res = await fetch(url, { headers: MB_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();

    const normName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const artist = (data.artists || []).find(a =>
      a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normName
    ) || data.artists?.[0];

    if (!artist?.id) return null;

    // Try fanart.tv for the image (free, no key needed for basic)
    const ftUrl = `https://webservice.fanart.tv/v3/music/${artist.id}?api_key=4b6d983d5c274b9b96e12e70e1ef7939`;
    const ftRes = await fetch(ftUrl).catch(() => null);
    if (ftRes?.ok) {
      const ftData = await ftRes.json().catch(() => null);
      const img = ftData?.artistthumb?.[0]?.url || ftData?.artistbackground?.[0]?.url;
      if (img) return img;
    }

    return null;
  } catch { return null; }
}

// ─── Save image to DynamoDB ───────────────────────────────────────────────────

async function saveImage(artistId, imageUrl) {
  if (DRY_RUN) return;
  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId },
    UpdateExpression: 'SET imageUrl = :url, lastUpdated = :t',
    ExpressionAttributeValues: { ':url': imageUrl, ':t': new Date().toISOString() },
  })).catch(() => {});
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Artist Image Enrichment ===\n');
  if (DRY_RUN) console.log('[DRY RUN — no DB writes]\n');

  const artists = await loadArtistsWithoutImages();
  let fromDeezer = 0, fromMB = 0, notFound = 0;

  for (let i = 0; i < artists.length; i++) {
    const { artistId, name } = artists[i];
    if (!name) { notFound++; continue; }

    // Try Deezer first (fast, no rate limit)
    let img = await fetchDeezer(name);
    if (img) {
      await saveImage(artistId, img);
      fromDeezer++;
    } else {
      // Fall back to MusicBrainz (1 req/sec limit)
      await sleep(1100);
      img = await fetchMusicBrainzImage(name);
      await sleep(1100);
      if (img) {
        await saveImage(artistId, img);
        fromMB++;
      } else {
        notFound++;
      }
    }

    if (i % 50 === 0 || i === artists.length - 1) {
      const pct = ((i + 1) / artists.length * 100).toFixed(1);
      process.stdout.write(
        `\r  [${i + 1}/${artists.length}] (${pct}%) | Deezer: ${fromDeezer} | MusicBrainz: ${fromMB} | Not found: ${notFound}   `
      );
    }

    await sleep(50); // tiny pause between Deezer calls
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`From Deezer      : ${fromDeezer}`);
  console.log(`From MusicBrainz : ${fromMB}`);
  console.log(`Not found        : ${notFound}`);
  console.log(`Total enriched   : ${fromDeezer + fromMB}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written to DynamoDB]');
}

main().catch(e => { console.error(e); process.exit(1); });
