#!/usr/bin/env node
/**
 * Finds official websites for venues that don't have one stored.
 *
 * Sources (in order):
 *   1. Wikidata P856 (official website) — via stored wikiUrl → QID → Wikidata
 *   2. MusicBrainz URL relations (official homepage) — via stored mbid
 *   3. Wikipedia external links — fallback, filtered for likely official site
 *
 * Usage:
 *   node scripts/discover-venue-websites.cjs [--limit=500]
 *   node scripts/discover-venue-websites.cjs --all   # include already-have-website
 */
'use strict';

const path = require('path');
const SDK  = p => require(path.join(__dirname, '../lambda/scraper/node_modules', p));

const { DynamoDBClient }                                     = SDK('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = SDK('@aws-sdk/lib-dynamodb');

const ddb   = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE = 'gigradar-venues';
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '5000', 10);
const ALL   = process.argv.includes('--all');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HDR = { 'User-Agent': 'GigRadar/1.0 (lewis.oliver.wilson@googlemail.com)' };

// Domains that are NOT official venue websites
const NOT_OFFICIAL = /wikipedia|wikidata|wikimedia|facebook|instagram|twitter|x\.com|youtube|ticketmaster|eventbrite|skiddle|songkick|dice\.fm|seetickets|gigantic|ents24|google|maps\.app|openstreetmap|tripadvisor|yelp|visitbritain|timeout\.com|theguardian|bbc\.|nme\.|thisisnotawebsite/i;

// ─── Wikidata P856 (official website) ────────────────────────────────────────

async function websiteFromWikidata(wikiUrl) {
  try {
    // Extract page title from URL
    const title = decodeURIComponent(wikiUrl.replace(/^.*\/wiki\//, ''));
    // Get Wikibase QID
    const propRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=${encodeURIComponent(title)}&format=json&ppprop=wikibase_item`,
      { headers: HDR }
    );
    const propData = await propRes.json();
    const pages    = propData?.query?.pages || {};
    const qid      = Object.values(pages)[0]?.pageprops?.wikibase_item;
    if (!qid) return null;
    await sleep(300);

    // Fetch Wikidata entity
    const wdRes  = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { headers: HDR });
    const wdData = await wdRes.json();
    const entity = wdData?.entities?.[qid];
    // P856 = official website
    const p856   = entity?.claims?.P856;
    if (!p856?.length) return null;
    const site = p856[0]?.mainsnak?.datavalue?.value;
    return (site && !NOT_OFFICIAL.test(site)) ? site : null;
  } catch { return null; }
}

// ─── MusicBrainz URL relations ───────────────────────────────────────────────

async function websiteFromMusicBrainz(mbid) {
  try {
    const res  = await fetch(`https://musicbrainz.org/ws/2/place/${mbid}?inc=url-rels&fmt=json`, { headers: HDR });
    if (!res.ok) return null;
    const data = await res.json();
    const rels  = data?.relations || [];
    // Prefer "official homepage" type
    const official = rels.find(r => r.type === 'official homepage');
    if (official?.url?.resource) return official.url.resource;
    // Fall back to any non-social URL relation
    const any = rels.find(r => r.url?.resource && !NOT_OFFICIAL.test(r.url.resource));
    return any?.url?.resource || null;
  } catch { return null; }
}

// ─── Wikipedia external links fallback ───────────────────────────────────────

async function websiteFromWikipediaLinks(wikiUrl) {
  try {
    const title = decodeURIComponent(wikiUrl.replace(/^.*\/wiki\//, ''));
    const res   = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&prop=extlinks&titles=${encodeURIComponent(title)}&format=json&ellimit=20`,
      { headers: HDR }
    );
    const data  = await res.json();
    const pages = data?.query?.pages || {};
    const links = Object.values(pages)[0]?.extlinks || [];
    // Filter: not social/ticketing/news, must look like a standalone venue domain
    const candidates = links
      .map(l => l['*'])
      .filter(u => u && !NOT_OFFICIAL.test(u))
      .filter(u => {
        try {
          const dom = new URL(u).hostname.replace(/^www\./, '');
          // Prefer short domains (venue own site), reject aggregator subpaths
          return dom.split('.').length <= 3 && !u.includes('/search') && !u.includes('/venues');
        } catch { return false; }
      });
    return candidates[0] || null;
  } catch { return null; }
}

// ─── Load & save ─────────────────────────────────────────────────────────────

async function loadVenues() {
  const venues = [];
  let lastKey;
  do {
    const params = {
      TableName: TABLE,
      ProjectionExpression: 'venueId, #n, city, website, wikiUrl, mbid',
      ExpressionAttributeNames: { '#n': 'name' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    venues.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return venues;
}

(async () => {
  console.log('Loading venues…');
  const all  = await loadVenues();
  const todo = all
    .filter(v => v.name && (v.wikiUrl || v.mbid) && (ALL || !v.website))
    .slice(0, LIMIT);

  console.log(`Total: ${all.length}  Have wikiUrl or mbid, no website: ${todo.length}`);

  let found = 0;
  for (let i = 0; i < todo.length; i++) {
    const v = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] ${v.name} → `);

    let website = null;

    if (v.wikiUrl) {
      website = await websiteFromWikidata(v.wikiUrl);
      await sleep(400);
      if (!website) {
        website = await websiteFromWikipediaLinks(v.wikiUrl);
        await sleep(400);
      }
    }
    if (!website && v.mbid) {
      website = await websiteFromMusicBrainz(v.mbid);
      await sleep(1100); // MB rate limit
    }

    if (website) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { venueId: v.venueId },
        UpdateExpression: 'SET website = :w',
        ExpressionAttributeValues: { ':w': website },
      })).catch(() => {});
      console.log(`✓ ${website}`);
      found++;
    } else {
      console.log('not found');
    }
  }

  console.log(`\nDone. Found websites: ${found}/${todo.length}`);
})();
