#!/usr/bin/env node
/**
 * GigRadar Live Stats
 *
 * Polls DynamoDB every 90 seconds and writes two files:
 *   scripts/stats.csv        — append-only time-series (open in Excel/Sheets)
 *   scripts/stats-latest.json — latest snapshot for dashboards
 *
 * Usage:
 *   node scripts/live-stats.cjs          # runs forever, updates every 90s
 *   node scripts/live-stats.cjs --once   # single snapshot and exit
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb      = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const CSV_FILE = path.join(__dirname, 'stats.csv');
const JSON_FILE= path.join(__dirname, 'stats-latest.json');
const ONCE     = process.argv.includes('--once');
const INTERVAL = 90_000;

const today = () => new Date().toISOString().split('T')[0];

async function fullCount(table, filter, names, vals) {
  let count = 0, lastKey;
  do {
    const p = { TableName: table, Select: 'COUNT' };
    if (filter) {
      p.FilterExpression = filter;
      if (names) p.ExpressionAttributeNames  = names;
      if (vals)  p.ExpressionAttributeValues = vals;
    }
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p));
    count += r.Count;
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return count;
}

async function collectStats() {
  const t = today();
  const [
    totalGigs, futureGigs, gigsWithGenres, gigsLinkedToVenue,
    totalArtists, artistsWithUpcoming, artistsWithGenres, artistsWithBio, artistsWithImage,
    totalVenues, venuesWithUpcoming, venuesWithWebsite,
  ] = await Promise.all([
    fullCount('gigradar-gigs'),
    fullCount('gigradar-gigs', '#d >= :t', { '#d': 'date' }, { ':t': t }),
    fullCount('gigradar-gigs', 'attribute_exists(genres) AND #d >= :t', { '#d': 'date' }, { ':t': t }),
    fullCount('gigradar-gigs', 'attribute_exists(canonicalVenueId) AND #d >= :t', { '#d': 'date' }, { ':t': t }),
    fullCount('gigradar-artists'),
    fullCount('gigradar-artists', 'upcoming > :z', null, { ':z': 0 }),
    fullCount('gigradar-artists', 'attribute_exists(genres)'),
    fullCount('gigradar-artists', 'attribute_exists(bio)'),
    fullCount('gigradar-artists', 'attribute_exists(imageUrl)'),
    fullCount('gigradar-venues'),
    fullCount('gigradar-venues', 'upcoming > :z', null, { ':z': 0 }),
    fullCount('gigradar-venues', 'attribute_exists(website)'),
  ]);

  return {
    timestamp: new Date().toISOString(),
    // Gigs
    totalGigs, futureGigs, gigsWithGenres, gigsLinkedToVenue,
    // Artists
    totalArtists, artistsWithUpcoming, artistsWithGenres, artistsWithBio, artistsWithImage,
    // Venues
    totalVenues, venuesWithUpcoming, venuesWithWebsite,
    // Derived
    gigGenreCoverage:    Math.round(gigsWithGenres   / (futureGigs   || 1) * 100),
    artistGenreCoverage: Math.round(artistsWithGenres / (totalArtists || 1) * 100),
    artistBioCoverage:   Math.round(artistsWithBio   / (totalArtists || 1) * 100),
    artistImageCoverage: Math.round(artistsWithImage  / (totalArtists || 1) * 100),
    venueUpcomingPct:    Math.round(venuesWithUpcoming / (totalVenues || 1) * 100),
  };
}

const CSV_HEADERS = [
  'Timestamp',
  'Total Gigs', 'Future Gigs', 'Gigs With Genres', 'Gigs Linked To Venue',
  'Total Artists', 'Artists With Upcoming', 'Artists With Genres', 'Artists With Bio', 'Artists With Image',
  'Total Venues', 'Venues With Upcoming', 'Venues With Website',
  'Gig Genre Coverage %', 'Artist Genre Coverage %', 'Artist Bio Coverage %', 'Artist Image Coverage %', 'Venue Upcoming %',
];

function statsToRow(s) {
  return [
    s.timestamp,
    s.totalGigs, s.futureGigs, s.gigsWithGenres, s.gigsLinkedToVenue,
    s.totalArtists, s.artistsWithUpcoming, s.artistsWithGenres, s.artistsWithBio, s.artistsWithImage,
    s.totalVenues, s.venuesWithUpcoming, s.venuesWithWebsite,
    s.gigGenreCoverage, s.artistGenreCoverage, s.artistBioCoverage, s.artistImageCoverage, s.venueUpcomingPct,
  ];
}

function appendCsv(stats) {
  const row = statsToRow(stats).join(',') + '\n';
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, CSV_HEADERS.join(',') + '\n');
  }
  fs.appendFileSync(CSV_FILE, row);
}

function printSummary(s) {
  console.clear();
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           GigRadar Live Stats                        ║');
  console.log(`╠══════════════════════════════════════════════════════╣`);
  console.log(`║  Updated: ${s.timestamp.replace('T',' ').slice(0,19)}                       ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  GIGS                                                ║`);
  console.log(`║    Total          : ${String(s.totalGigs.toLocaleString()).padEnd(10)}                    ║`);
  console.log(`║    Future         : ${String(s.futureGigs.toLocaleString()).padEnd(10)}                    ║`);
  console.log(`║    With genres    : ${String(s.gigsWithGenres.toLocaleString()).padEnd(6)} (${String(s.gigGenreCoverage+'%').padEnd(4)})              ║`);
  console.log(`║    Linked to venue: ${String(s.gigsLinkedToVenue.toLocaleString()).padEnd(10)}                    ║`);
  console.log('║                                                      ║');
  console.log(`║  ARTISTS                                             ║`);
  console.log(`║    Total          : ${String(s.totalArtists.toLocaleString()).padEnd(10)}                    ║`);
  console.log(`║    With upcoming  : ${String(s.artistsWithUpcoming.toLocaleString()).padEnd(10)}                    ║`);
  console.log(`║    With genres    : ${String(s.artistsWithGenres.toLocaleString()).padEnd(6)} (${String(s.artistGenreCoverage+'%').padEnd(4)})              ║`);
  console.log(`║    With bio       : ${String(s.artistsWithBio.toLocaleString()).padEnd(6)} (${String(s.artistBioCoverage+'%').padEnd(4)})              ║`);
  console.log(`║    With image     : ${String(s.artistsWithImage.toLocaleString()).padEnd(6)} (${String(s.artistImageCoverage+'%').padEnd(4)})              ║`);
  console.log('║                                                      ║');
  console.log(`║  VENUES                                              ║`);
  console.log(`║    Total          : ${String(s.totalVenues.toLocaleString()).padEnd(10)}                    ║`);
  console.log(`║    With upcoming  : ${String(s.venuesWithUpcoming.toLocaleString()).padEnd(6)} (${String(s.venueUpcomingPct+'%').padEnd(4)})              ║`);
  console.log(`║    With website   : ${String(s.venuesWithWebsite.toLocaleString()).padEnd(10)}                    ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n  → CSV: ${CSV_FILE}`);
  if (!ONCE) console.log(`  → Next update in ${INTERVAL/1000}s  (Ctrl+C to stop)`);
}

async function tick() {
  process.stdout.write('  Querying DynamoDB...');
  const stats = await collectStats();
  appendCsv(stats);
  fs.writeFileSync(JSON_FILE, JSON.stringify(stats, null, 2));
  printSummary(stats);
}

async function main() {
  console.log('GigRadar Live Stats — starting...\n');
  await tick();
  if (ONCE) return;
  setInterval(async () => {
    try { await tick(); } catch (e) { console.error('Stat error:', e.message); }
  }, INTERVAL);
}

main().catch(e => { console.error(e); process.exit(1); });
