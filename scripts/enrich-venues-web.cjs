#!/usr/bin/env node
/**
 * Enriches venue profiles with descriptions, capacity, address, and images
 * from Wikipedia, MusicBrainz, and OpenStreetMap Nominatim.
 *
 * Usage: node scripts/enrich-venues-web.cjs [--limit=200]
 * Writes: bio, imageUrl, address, wikiUrl fields to venues
 */
'use strict';

const path = require('path');
const SDK  = p => require(path.join(__dirname, '../lambda/scraper/node_modules', p));

const { DynamoDBClient }                                     = SDK('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = SDK('@aws-sdk/lib-dynamodb');

const ddb   = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE = 'gigradar-venues';
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '200', 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HEADERS = { 'User-Agent': 'GigRadar/1.0 (lewis.oliver.wilson@googlemail.com)' };

// ─── Wikipedia ───────────────────────────────────────────────────────────────

async function searchWikipedia(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json`;
  try {
    const res  = await fetch(url, { headers: HEADERS });
    const data = await res.json();
    return data?.query?.search || [];
  } catch { return []; }
}

async function getWikipediaSummary(pageTitle) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
  try {
    const res  = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchWikiData(venueName, city) {
  const queries = [
    `${venueName} ${city} music venue`,
    `${venueName} ${city}`,
    venueName,
  ];
  for (const q of queries) {
    const results = await searchWikipedia(q);
    await sleep(200);
    for (const r of results) {
      if (!r.title) continue;
      const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!norm(r.title).includes(norm(venueName)) && !norm(venueName).includes(norm(r.title.split(' ')[0]))) continue;
      const summary = await getWikipediaSummary(r.title);
      await sleep(200);
      if (!summary?.extract) continue;
      return {
        description: summary.extract.split('.').slice(0, 3).join('.') + '.',
        imageUrl:    summary.thumbnail?.source || null,
        wikiUrl:     summary.content_urls?.desktop?.page || null,
      };
    }
  }
  return null;
}

// ─── MusicBrainz ─────────────────────────────────────────────────────────────

async function fetchMusicBrainzPlace(venueName, city) {
  const q   = `place:"${venueName}"${city ? ` AND area:"${city}"` : ''}`;
  const url = `https://musicbrainz.org/ws/2/place/?query=${encodeURIComponent(q)}&limit=3&fmt=json`;
  try {
    const res  = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const places = data?.places || [];
    const match  = places.find(p => {
      const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return norm(p.name).includes(norm(venueName)) || norm(venueName).includes(norm(p.name));
    });
    if (!match) return null;
    return {
      mbid:     match.id,
      capacity: match.life_span ? null : (match['life-span'] ? null : null),
      address:  match.address || null,
      mbType:   match.type || null,
    };
  } catch { return null; }
}

// ─── Nominatim (OpenStreetMap) for address + coordinates ─────────────────────

async function fetchNominatim(venueName, city) {
  const q   = `${venueName}, ${city}, United Kingdom`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
  try {
    const res  = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const r    = data?.[0];
    if (!r) return null;
    const addr = r.address || {};
    return {
      lat:     parseFloat(r.lat),
      lng:     parseFloat(r.lon),
      address: [addr.road, addr.suburb || addr.quarter, addr.city || addr.town || addr.village, addr.postcode].filter(Boolean).join(', '),
    };
  } catch { return null; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function loadVenues() {
  const venues = [];
  let lastKey;
  do {
    const params = {
      TableName: TABLE,
      ProjectionExpression: 'venueId, #n, city, description, imageUrl',
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
  const todo = all.filter(v => !v.description && v.name && v.city).slice(0, LIMIT);
  console.log(`Total: ${all.length}  Missing description: ${todo.length}  Processing: ${Math.min(todo.length, LIMIT)}`);

  let enriched = 0;
  for (let i = 0; i < todo.length; i++) {
    const v = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] ${v.name} (${v.city}) → `);

    const [wiki, mb, geo] = await Promise.all([
      fetchWikiData(v.name, v.city),
      fetchMusicBrainzPlace(v.name, v.city),
      fetchNominatim(v.name, v.city),
    ]);

    const updates = {};
    if (wiki?.description) updates.bio      = wiki.description; // stored as bio to match VenuePage
    if (wiki?.imageUrl)    updates.imageUrl = wiki.imageUrl;
    if (wiki?.wikiUrl)     updates.wikiUrl  = wiki.wikiUrl;
    if (mb?.mbid)          updates.mbid     = mb.mbid;
    if (mb?.address)       updates.address  = mb.address;
    if (geo?.address && !updates.address) updates.address = geo.address;
    if (geo?.lat)          updates.lat      = geo.lat;
    if (geo?.lng)          updates.lng      = geo.lng;

    if (Object.keys(updates).length > 0) {
      const setExpr = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
      const exprVals = {};
      for (const [k, v2] of Object.entries(updates)) exprVals[`:${k}`] = v2;
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { venueId: v.venueId },
        UpdateExpression: `SET ${setExpr}, lastEnriched = :ts`,
        ExpressionAttributeValues: { ...exprVals, ':ts': new Date().toISOString() },
      })).catch(e => console.error(' DDB error:', e.message));
      console.log(`✓ ${Object.keys(updates).join(', ')}`);
      enriched++;
    } else {
      console.log('no data found');
    }

    await sleep(500);
  }

  console.log(`\nDone. Enriched: ${enriched}/${todo.length}`);
})();
