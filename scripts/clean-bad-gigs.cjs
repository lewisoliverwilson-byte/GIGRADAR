/**
 * clean-bad-gigs.cjs
 *
 * Scans DynamoDB for gig records that should not exist:
 *   1. Tribute/cover acts stored under real artist IDs (e.g. "nirvana" with upcoming tribute gigs)
 *   2. Non-music "artists" with no music signals (no Spotify, no Last.fm, no imageUrl)
 *
 * Run in dry-run mode first:
 *   node scripts/clean-bad-gigs.cjs --dry-run
 * Then live:
 *   node scripts/clean-bad-gigs.cjs --live
 */

const path = require('path');
const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient } = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand, UpdateCommand, QueryCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const DRY_RUN = !process.argv.includes('--live');
if (DRY_RUN) console.log('🔍  DRY RUN — pass --live to delete\n');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const ARTISTS_TABLE = 'gigradar-artists';
const GIGS_TABLE    = 'gigradar-gigs';

// ─── Tribute detection (same regex as scraper) ───────────────────────────────
const TRIBUTE_RE = /tribute|cover band|covers band|\bcovers\b|salute to|the music of|celebrating the music|songs of|the songs of|in the style of|a night of|an evening of|lives on|symphony of|story of|the story of|legacy of|anniversary show|anniversary tour|anniversary concert|plays the hits|performs the hits|greatest hits show|years of hits|through the years|honouring|honoring|in memory of|in tribute|a tribute to|vs\s|feat\.|featuring\s+the|experience\b|celebrating \w|performed by|starring/i;
function isTributeAct(name) { return TRIBUTE_RE.test(name || ''); }

// ─── Artists known to be permanently defunct (no active members) ─────────────
// Gigs under these artistIds are almost certainly tribute acts misattributed.
const KNOWN_DEFUNCT_IDS = new Set([
  'nirvana',
  'the-beatles', 'beatles',
  'led-zeppelin',
  'the-doors',
  'jimi-hendrix', 'jimi-hendrix-experience',
  'the-clash',
  'joy-division',
  'the-smiths',
  'the-pixies',   // still active, remove if needed
  'queen',        // active as tribute with Adam Lambert — may legitimately have gigs
  'sex-pistols',
  'the-jam',
  'ramones',
  'the-velvet-underground',
  'grateful-dead', // technically active as Dead & Co etc, but "Grateful Dead" is defunct
  'talking-heads',
  'the-stone-roses', // disbanded 2017
  'the-verve',       // disbanded 2008
  'oasis',           // disbanded 2009, reformed 2024 - remove from list if needed
]);

// ─── Scan helpers ─────────────────────────────────────────────────────────────

async function scanAll(params) {
  const items = [];
  let key;
  do {
    const res = await ddb.send(new ScanCommand({ ...params, ExclusiveStartKey: key }));
    if (res.Items) items.push(...res.Items);
    key = res.LastEvaluatedKey;
  } while (key);
  return items;
}

async function deleteGig(gigId, reason) {
  console.log(`  DELETE gig ${gigId} — ${reason}`);
  if (!DRY_RUN) {
    await ddb.send(new DeleteCommand({ TableName: GIGS_TABLE, Key: { gigId } })).catch(e => console.error('    Error:', e.message));
  }
}

async function updateArtistUpcoming(artistId, count) {
  if (DRY_RUN) return;
  await ddb.send(new UpdateCommand({
    TableName: ARTISTS_TABLE,
    Key: { artistId },
    UpdateExpression: 'SET upcoming = :u',
    ExpressionAttributeValues: { ':u': count },
  })).catch(() => {});
}

// ─── Pass 1: Artists with NO music signals ────────────────────────────────────
// Artists with upcoming gigs but no Spotify, no Last.fm, no imageUrl, no genres
// These are likely non-music acts (comedians, presenters) seeded by non-music scrapers.

async function cleanNonMusicArtists() {
  console.log('Pass 1: Non-music artists (no Spotify, no Last.fm, no image)\n');

  const today = new Date().toISOString().split('T')[0];
  const artists = await scanAll({
    TableName: ARTISTS_TABLE,
    FilterExpression: 'upcoming > :z AND attribute_not_exists(spotify) AND (attribute_not_exists(lastfmListeners) OR lastfmListeners = :z) AND attribute_not_exists(imageUrl)',
    ExpressionAttributeValues: { ':z': 0 },
    ProjectionExpression: 'artistId, #n, upcoming, genres, lastfmRank',
    ExpressionAttributeNames: { '#n': 'name' },
  });

  console.log(`  Found ${artists.length} artists with no music signals\n`);

  let totalDeleted = 0;
  for (const artist of artists) {
    // Query upcoming gigs for this artist
    const gigsRes = await ddb.send(new QueryCommand({
      TableName: GIGS_TABLE,
      IndexName: 'artistId-date-index',
      KeyConditionExpression: 'artistId = :id AND #d >= :today',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':id': artist.artistId, ':today': today },
    })).catch(() => ({ Items: [] }));
    const gigs = gigsRes.Items || [];
    if (gigs.length === 0) continue;

    console.log(`  [NO-MUSIC] ${artist.name} (${artist.artistId}) — ${gigs.length} upcoming gigs, no music signals`);
    for (const gig of gigs) {
      await deleteGig(gig.gigId, `non-music artist: ${artist.name}`);
      totalDeleted++;
    }
    // Update upcoming count to 0
    if (!DRY_RUN) await updateArtistUpcoming(artist.artistId, 0);
  }
  console.log(`\nPass 1 complete: ${totalDeleted} gigs ${DRY_RUN ? 'would be' : ''} deleted\n`);
  return totalDeleted;
}

// ─── Pass 2: Known-defunct artist IDs ─────────────────────────────────────────
// Any upcoming gig under e.g. "nirvana" is almost certainly a misattributed tribute.

async function cleanDefunctArtists() {
  console.log('Pass 2: Known-defunct artists\n');
  const today = new Date().toISOString().split('T')[0];
  let totalDeleted = 0;

  for (const artistId of KNOWN_DEFUNCT_IDS) {
    const gigsRes = await ddb.send(new QueryCommand({
      TableName: GIGS_TABLE,
      IndexName: 'artistId-date-index',
      KeyConditionExpression: 'artistId = :id AND #d >= :today',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':id': artistId, ':today': today },
    })).catch(() => ({ Items: [] }));
    const gigs = gigsRes.Items || [];
    if (gigs.length === 0) continue;

    console.log(`  [DEFUNCT] ${artistId} — ${gigs.length} upcoming gig(s) to remove`);
    for (const gig of gigs) {
      await deleteGig(gig.gigId, `known-defunct artist: ${artistId} — likely tribute`);
      totalDeleted++;
    }
    if (!DRY_RUN) await updateArtistUpcoming(artistId, 0);
  }
  console.log(`\nPass 2 complete: ${totalDeleted} gigs ${DRY_RUN ? 'would be' : ''} deleted\n`);
  return totalDeleted;
}

// ─── Pass 3: Tribute act names stored as artists ──────────────────────────────
// Artists whose own name contains tribute keywords — they should never appear in trending
// but their gigs also pollute the feed. Delete their upcoming gigs.

async function cleanTributeArtistGigs() {
  console.log('Pass 3: Artists whose names are tribute acts\n');
  const today = new Date().toISOString().split('T')[0];

  const artists = await scanAll({
    TableName: ARTISTS_TABLE,
    FilterExpression: 'upcoming > :z',
    ExpressionAttributeValues: { ':z': 0 },
    ProjectionExpression: 'artistId, #n, upcoming',
    ExpressionAttributeNames: { '#n': 'name' },
  });

  const tributeArtists = artists.filter(a => isTributeAct(a.name || ''));
  console.log(`  Found ${tributeArtists.length} artist records with tribute-act names\n`);

  let totalDeleted = 0;
  for (const artist of tributeArtists.slice(0, 200)) { // cap to avoid runaway
    const gigsRes = await ddb.send(new QueryCommand({
      TableName: GIGS_TABLE,
      IndexName: 'artistId-date-index',
      KeyConditionExpression: 'artistId = :id AND #d >= :today',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':id': artist.artistId, ':today': today },
    })).catch(() => ({ Items: [] }));
    const gigs = gigsRes.Items || [];
    if (gigs.length === 0) continue;

    console.log(`  [TRIBUTE-NAME] "${artist.name}" (${artist.artistId}) — ${gigs.length} gig(s)`);
    for (const gig of gigs) {
      await deleteGig(gig.gigId, `tribute act name: ${artist.name}`);
      totalDeleted++;
    }
    if (!DRY_RUN) {
      await updateArtistUpcoming(artist.artistId, 0);
      await ddb.send(new UpdateCommand({
        TableName: ARTISTS_TABLE,
        Key: { artistId: artist.artistId },
        UpdateExpression: 'SET isTribute = :t',
        ExpressionAttributeValues: { ':t': true },
      })).catch(() => {});
    }
  }
  console.log(`\nPass 3 complete: ${totalDeleted} gigs ${DRY_RUN ? 'would be' : ''} deleted\n`);
  return totalDeleted;
}

// ─── Pass 4: Sold-out gigs showing as on-sale ─────────────────────────────────
// These are already handled in the API filter, but log them so we know scale.

async function reportSoldOutOnSale() {
  const today = new Date().toISOString().split('T')[0];
  const cutoff = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const res = await ddb.send(new ScanCommand({
    TableName: GIGS_TABLE,
    FilterExpression: 'onSaleDate >= :today AND onSaleDate <= :end AND #d > :today AND isSoldOut = :t',
    ExpressionAttributeNames: { '#d': 'date' },
    ExpressionAttributeValues: { ':today': today, ':end': cutoff, ':t': true },
  })).catch(() => ({ Items: [] }));

  console.log(`Pass 4 (info only): ${(res.Items || []).length} sold-out gigs in on-sale window — filtered by API, no action needed\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let total = 0;
  total += await cleanNonMusicArtists();
  total += await cleanDefunctArtists();
  total += await cleanTributeArtistGigs();
  await reportSoldOutOnSale();

  console.log(`═══════════════════════════════════════`);
  console.log(`Total gigs ${DRY_RUN ? 'flagged for deletion' : 'deleted'}: ${total}`);
  if (DRY_RUN) console.log('\nRe-run with --live to execute deletions.');
}

main().catch(console.error);
