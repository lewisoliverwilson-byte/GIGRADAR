#!/usr/bin/env node
/**
 * Discovers UK music venues not yet in DynamoDB using MusicBrainz,
 * Skiddle API, and Songkick. Seeds them into gigradar-venues.
 *
 * Usage: node scripts/discover-new-venues.cjs [--source mb|skiddle|songkick|all]
 *
 * MusicBrainz has the most comprehensive UK venue database.
 * Skiddle lists active venues with events.
 */
'use strict';

const path = require('path');
const SDK  = p => require(path.join(__dirname, '../lambda/scraper/node_modules', p));

const { DynamoDBClient }                                                  = SDK('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand, PutCommand }  = SDK('@aws-sdk/lib-dynamodb');

const ddb         = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE       = 'gigradar-venues';
const SKIDDLE_KEY = process.env.SKIDDLE_API_KEY || '4e0a7a6dacf5930b9bf39ece1f9b456f';
const SOURCE      = process.argv.find(a => a.startsWith('--source='))?.split('=')[1] || 'all';
const sleep       = ms => new Promise(r => setTimeout(r, ms));

const MB_HEADERS = { 'User-Agent': 'GigRadar/1.0 (lewis.oliver.wilson@googlemail.com)' };

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}
function toSlug(name, city) {
  const sl = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const n = sl(name), c = sl(city);
  return c ? `${c}-${n}` : n;
}

// ─── MusicBrainz: UK music venues ────────────────────────────────────────────

const MB_PLACE_TYPES = ['venue', 'concert hall', 'theatre', 'arena', 'festival stage'];

async function discoverFromMusicBrainz() {
  console.log('\n=== MusicBrainz venue discovery ===');
  const venues = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const url = `https://musicbrainz.org/ws/2/place/?query=country:GB+AND+(type:venue+OR+type:"concert+hall"+OR+type:theatre+OR+type:arena)&limit=100&offset=${offset}&fmt=json`;
    try {
      const res  = await fetch(url, { headers: MB_HEADERS });
      if (!res.ok) { console.log(`MB HTTP ${res.status} at offset ${offset}`); break; }
      const data   = await res.json();
      const places = data?.places || [];
      if (!places.length) break;
      console.log(`  MB offset ${offset}: ${places.length} places`);
      for (const p of places) {
        if (!p.name) continue;
        const city = p.address?.split(',').slice(-2)[0]?.trim() ||
                     (p.relations || []).find(r => r.type === 'located in')?.place?.name || '';
        venues.push({ name: p.name, city, mbid: p.id, address: p.address || '' });
      }
      await sleep(1100); // MB rate limit: 1 req/s
    } catch (e) { console.error('MB error:', e.message); break; }
  }
  console.log(`MusicBrainz: ${venues.length} UK places found`);
  return venues;
}

// ─── Skiddle: active UK venues with recent events ────────────────────────────

async function discoverFromSkiddle() {
  if (!SKIDDLE_KEY) { console.log('No SKIDDLE_API_KEY — skipping'); return []; }
  console.log('\n=== Skiddle venue discovery ===');
  const venues = [];
  const seen   = new Set();
  for (let offset = 0; offset < 5000; offset += 100) {
    const url = `https://www.skiddle.com/api/v1/events/search/?api_key=${SKIDDLE_KEY}&country=GB&eventcode=LIVE&limit=100&offset=${offset}&order=date`;
    try {
      const res  = await fetch(url);
      const data = await res.json();
      const evts = data?.results || [];
      if (!evts.length) break;
      for (const ev of evts) {
        const v = ev.venue;
        if (!v?.name || seen.has(v.id)) continue;
        seen.add(v.id);
        venues.push({ name: v.name, city: v.town || '', skiddleId: v.id, lat: parseFloat(v.latitude || 0), lng: parseFloat(v.longitude || 0) });
      }
      await sleep(300);
    } catch (e) { console.error('Skiddle error:', e.message); break; }
  }
  console.log(`Skiddle: ${venues.length} venues found`);
  return venues;
}

// ─── Songkick metro venue pages ───────────────────────────────────────────────

const SK_METROS = [
  { id: 24426, name: 'London' }, { id: 31366, name: 'Manchester' },
  { id: 24521, name: 'Birmingham' }, { id: 25014, name: 'Glasgow' },
  { id: 24516, name: 'Leeds' }, { id: 24803, name: 'Bristol' },
  { id: 24523, name: 'Edinburgh' }, { id: 24517, name: 'Liverpool' },
  { id: 24515, name: 'Newcastle' }, { id: 24518, name: 'Sheffield' },
  { id: 25109, name: 'Nottingham' }, { id: 24512, name: 'Cardiff' },
  { id: 24525, name: 'Brighton' }, { id: 24535, name: 'Oxford' },
  { id: 24533, name: 'Cambridge' }, { id: 28458, name: 'Guildford' },
];

async function discoverFromSongkick() {
  console.log('\n=== Songkick venue discovery ===');
  const venues = [];
  const seen   = new Set();
  for (const metro of SK_METROS) {
    for (let pg = 1; pg <= 10; pg++) {
      const url = `https://www.songkick.com/metro-areas/${metro.id}/calendar${pg > 1 ? `?page=${pg}` : ''}`;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } });
        if (!res.ok) break;
        const html = await res.text();
        // Extract venue names from JSON-LD
        let found = 0;
        for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
          let items; try { items = JSON.parse(json); if (!Array.isArray(items)) items = [items]; } catch { continue; }
          for (const ev of items) {
            if (ev['@type'] !== 'MusicEvent') continue;
            const vName = ev.location?.name;
            const vCity = ev.location?.address?.addressLocality || metro.name;
            if (!vName || seen.has(normaliseName(vName) + normaliseName(vCity))) continue;
            seen.add(normaliseName(vName) + normaliseName(vCity));
            venues.push({ name: vName, city: vCity });
            found++;
          }
        }
        if (!found) break;
        await sleep(500);
      } catch { break; }
    }
  }
  console.log(`Songkick: ${venues.length} venues found`);
  return venues;
}

// ─── Load existing venue IDs for dedup ───────────────────────────────────────

async function loadExistingVenueIds() {
  const ids = new Set();
  let lastKey;
  do {
    const params = { TableName: TABLE, ProjectionExpression: 'venueId' };
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    (r.Items || []).forEach(i => ids.add(i.venueId));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return ids;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('Loading existing venue IDs…');
  const existing = await loadExistingVenueIds();
  console.log(`Existing venues: ${existing.size}`);

  const discovered = [];
  if (SOURCE === 'mb' || SOURCE === 'all')       discovered.push(...await discoverFromMusicBrainz());
  if (SOURCE === 'skiddle' || SOURCE === 'all')  discovered.push(...await discoverFromSkiddle());
  if (SOURCE === 'songkick' || SOURCE === 'all') discovered.push(...await discoverFromSongkick());

  // Deduplicate by venueId
  const toAdd = new Map();
  for (const v of discovered) {
    if (!v.name || !v.city) continue;
    const vid = toVenueId(v.name, v.city);
    if (existing.has(vid) || toAdd.has(vid)) continue;
    toAdd.set(vid, v);
  }

  console.log(`\nNew venues to add: ${toAdd.size}`);
  let added = 0;
  for (const [vid, v] of toAdd) {
    const item = {
      venueId:     vid,
      slug:        toSlug(v.name, v.city),
      name:        v.name,
      city:        v.city,
      upcoming:    0,
      isActive:    true,
      lastUpdated: new Date().toISOString(),
    };
    if (v.mbid)      item.mbid      = v.mbid;
    if (v.address)   item.address   = v.address;
    if (v.skiddleId) item.skiddleId = String(v.skiddleId);
    if (v.lat)       item.lat       = v.lat;
    if (v.lng)       item.lng       = v.lng;

    await ddb.send(new PutCommand({
      TableName:           TABLE,
      Item:                item,
      ConditionExpression: 'attribute_not_exists(venueId)',
    })).catch(() => {}); // ignore if already exists (race condition)
    added++;
    if (added % 100 === 0) console.log(`  Added ${added}…`);
    await sleep(30);
  }

  console.log(`\nDone. Added ${added} new venues. Total now: ${existing.size + added}`);
})();
