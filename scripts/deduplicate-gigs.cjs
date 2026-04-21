#!/usr/bin/env node
/**
 * GigRadar — Deduplicate gig records
 *
 * Multiple scrapers (TM, Songkick, Skiddle, Ents24, etc.) often produce
 * duplicate gig records for the same show. This script:
 *
 * 1. Scans all future gigs grouped by artistId + date
 * 2. Within each group, clusters gigs by venue similarity
 * 3. For each cluster of 2+ duplicates: keeps the richest record,
 *    merges all ticket links into it, deletes the rest
 *
 * Usage:
 *   node scripts/deduplicate-gigs.cjs
 *   node scripts/deduplicate-gigs.cjs --dry-run
 */

'use strict';

const path = require('path');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }     = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand, BatchWriteCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb     = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const DRY_RUN = process.argv.includes('--dry-run');
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const today   = new Date().toISOString().split('T')[0];

const GIGS_TABLE = 'gigradar-gigs';

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function venueKey(gig) {
  // Normalise venue name for fuzzy matching — strip "the", punctuation, whitespace
  return normalise(gig.venueName || '').replace(/^the/, '');
}

function areDuplicates(a, b) {
  const va = venueKey(a), vb = venueKey(b);
  if (!va || !vb) return false;
  // Exact match OR one contains the other (handles "O2 Academy" vs "O2 Academy Brixton")
  return va === vb || va.includes(vb) || vb.includes(va);
}

function mergeGigs(gigs) {
  // Pick the richest record as canonical (most ticket links, then most fields)
  const canonical = gigs.slice().sort((a, b) => {
    const ta = (a.tickets || []).length, tb = (b.tickets || []).length;
    if (tb !== ta) return tb - ta;
    return Object.keys(b).length - Object.keys(a).length;
  })[0];

  // Collect all unique ticket links
  const seen = new Set();
  const allTickets = [];
  for (const g of gigs) {
    for (const t of (g.tickets || [])) {
      const key = normalise(t.seller || '') + normalise(t.url || '');
      if (!seen.has(key)) {
        seen.add(key);
        allTickets.push(t);
      }
    }
  }

  // Collect all sources
  const sources = [...new Set(gigs.flatMap(g => g.sources || []))];

  // Merge canonicalVenueId — prefer non-null
  const canonicalVenueId = gigs.map(g => g.canonicalVenueId).find(Boolean) || null;

  const duplicateIds = gigs.filter(g => g.gigId !== canonical.gigId).map(g => g.gigId);

  return { canonical, allTickets, sources, canonicalVenueId, duplicateIds };
}

async function batchDelete(gigIds) {
  for (let i = 0; i < gigIds.length; i += 25) {
    const chunk = gigIds.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [GIGS_TABLE]: chunk.map(id => ({ DeleteRequest: { Key: { gigId: id } } })),
      },
    })).catch(e => console.error('  Delete error:', e.message));
    if (i + 25 < gigIds.length) await sleep(50);
  }
}

async function main() {
  console.log('=== GigRadar Gig Deduplication ===');
  if (DRY_RUN) console.log('[DRY RUN — no writes]\n');
  else console.log();

  // ── Step 1: Scan all future gigs ──────────────────────────────────────────
  console.log('Scanning future gigs...');
  const byArtistDate = new Map(); // `${artistId}|${date}` → gig[]
  let lastKey, total = 0;
  do {
    const p = {
      TableName: GIGS_TABLE,
      FilterExpression: '#d >= :today AND attribute_exists(artistId)',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':today': today },
    };
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p));
    for (const gig of (r.Items || [])) {
      const key = `${gig.artistId}|${gig.date}`;
      if (!byArtistDate.has(key)) byArtistDate.set(key, []);
      byArtistDate.get(key).push(gig);
      total++;
    }
    lastKey = r.LastEvaluatedKey;
    process.stdout.write(`\r  Scanned ${total.toLocaleString()} gigs...`);
  } while (lastKey);

  console.log(`\n  ${total.toLocaleString()} gigs across ${byArtistDate.size.toLocaleString()} artist-date slots\n`);

  // ── Step 2: Find and merge duplicates ──────────────────────────────────────
  console.log('Finding duplicates...');
  let dupClusters = 0, gigsDeleted = 0, gigsUpdated = 0;
  let processed = 0;
  const allKeys = [...byArtistDate.entries()];

  for (const [, gigs] of allKeys) {
    processed++;
    if (gigs.length < 2) continue; // no duplicates possible

    // Cluster by venue similarity
    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < gigs.length; i++) {
      if (assigned.has(i)) continue;
      const cluster = [gigs[i]];
      assigned.add(i);
      for (let j = i + 1; j < gigs.length; j++) {
        if (!assigned.has(j) && areDuplicates(gigs[i], gigs[j])) {
          cluster.push(gigs[j]);
          assigned.add(j);
        }
      }
      clusters.push(cluster);
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      dupClusters++;

      const { canonical, allTickets, sources, canonicalVenueId, duplicateIds } = mergeGigs(cluster);

      if (!DRY_RUN) {
        // Update canonical record with merged tickets + sources
        await ddb.send(new UpdateCommand({
          TableName: GIGS_TABLE,
          Key: { gigId: canonical.gigId },
          UpdateExpression: 'SET tickets = :t, sources = :s, canonicalVenueId = :v, lastUpdated = :u',
          ExpressionAttributeValues: {
            ':t': allTickets,
            ':s': sources,
            ':v': canonicalVenueId,
            ':u': new Date().toISOString(),
          },
        })).catch(() => {});
        gigsUpdated++;

        await batchDelete(duplicateIds);
      }
      gigsDeleted += duplicateIds.length;
    }

    if (processed % 5000 === 0) {
      process.stdout.write(`\r  Processed ${processed.toLocaleString()} slots | ${dupClusters} duplicate clusters | ${gigsDeleted} to delete   `);
    }
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Duplicate clusters : ${dupClusters.toLocaleString()}`);
  console.log(`Gigs ${DRY_RUN ? 'would delete' : 'deleted'}  : ${gigsDeleted.toLocaleString()}`);
  console.log(`Canonical updated  : ${gigsUpdated.toLocaleString()}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing written]');
}

main().catch(e => { console.error(e); process.exit(1); });
