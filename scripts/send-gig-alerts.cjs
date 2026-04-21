#!/usr/bin/env node
/**
 * GigRadar — Send Gig Alerts
 *
 * Scans for gigs added since the last run (tracked via alertsProgress.json),
 * finds followers for each artist/venue, and sends email alerts via SES.
 *
 * Run after each scraping wave in quick-refresh.sh and weekly-refresh.sh.
 *
 * Usage:
 *   node scripts/send-gig-alerts.cjs
 *   node scripts/send-gig-alerts.cjs --dry-run
 */
'use strict';

const path = require('path');
const fs   = require('fs');

const DDB_SDK = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }           = require(path.join(DDB_SDK, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand } = require(path.join(DDB_SDK, '@aws-sdk/lib-dynamodb'));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const GIGS_TABLE    = 'gigradar-gigs';
const FOLLOWS_TABLE = 'gigradar-follows';
const PROGRESS_FILE = path.join(__dirname, 'alerts-progress.json');
// FROM_EMAIL: once domain is owned + SES verified, switch to 'noreply@gigradar.co.uk'
const FROM_EMAIL    = process.env.FROM_EMAIL    || 'GigRadar <onboarding@resend.dev>';
const RESEND_KEY    = process.env.RESEND_API_KEY || '';
const SITE_URL      = 'https://gigradar.co.uk';
const DRY_RUN       = process.argv.includes('--dry-run');
const sleep         = ms => new Promise(r => setTimeout(r, ms));

function loadAlertedIds() {
  try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); } catch {}
  return new Set();
}
function saveAlertedIds(ids) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...ids]));
}

async function getFollowers(targetId) {
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: FOLLOWS_TABLE,
      IndexName: 'targetId-index',
      KeyConditionExpression: 'targetId = :t',
      FilterExpression: 'confirmed = :y',
      ExpressionAttributeValues: { ':t': targetId, ':y': true },
    }));
    return r.Items || [];
  } catch { return []; }
}

function formatDate(d) {
  try { return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return d; }
}

function buildEmail(recipientGigs, isGrassroots) {
  const multiple = recipientGigs.length > 1;
  const grassrootsTag = isGrassroots ? `<span style="display:inline-block;background:#052e16;color:#4ade80;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;margin-left:6px;">Grassroots</span>` : '';

  const gigRows = recipientGigs.map(({ gig }) => {
    const ticketBtn = gig.ticketUrl || gig.tickets?.[0]?.url
      ? `<a href="${gig.ticketUrl || gig.tickets[0].url}" style="display:inline-block;margin-top:10px;padding:8px 18px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;">Get Tickets</a>`
      : '';
    const price = gig.tickets?.find(t => t.price && t.price !== 'See site')?.price;
    return `
<div style="border-bottom:1px solid #27272a;padding:16px 0;">
  <p style="margin:0 0 2px;font-size:18px;font-weight:700;color:#fff;">${gig.artistName}${grassrootsTag}</p>
  <p style="margin:0;font-size:14px;color:#a1a1aa;">
    📍 ${gig.venueName || 'Venue TBC'}${gig.venueCity ? `, ${gig.venueCity}` : ''}<br>
    📅 ${formatDate(gig.date)}${price ? `<br>🎟️ From ${price}` : ''}
  </p>
  ${ticketBtn}
  <p style="margin-top:8px;font-size:12px;">
    <a href="${SITE_URL}/artists/${encodeURIComponent(gig.artistId)}" style="color:#818cf8;">View artist →</a>
  </p>
</div>`;
  }).join('');

  const subjectGig = recipientGigs[0].gig;
  const subject = multiple
    ? `${recipientGigs.length} new gigs from artists you follow`
    : `${subjectGig.artistName} at ${subjectGig.venueName} — ${formatDate(subjectGig.date)}`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:auto;background:#111;color:#eee;padding:32px;border-radius:12px;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
    <div style="background:#6366f1;border-radius:8px;padding:6px 10px;font-weight:900;font-size:16px;color:#fff;letter-spacing:-0.5px;">GR</div>
    <span style="font-size:14px;color:#a1a1aa;">GigRadar Gig Alert</span>
  </div>
  <h1 style="margin:0 0 4px;font-size:22px;color:#fff;">${multiple ? 'New shows from artists you follow' : 'New gig announced'}</h1>
  <p style="margin:0 0 20px;font-size:14px;color:#71717a;">You're following these artists — don't miss your chance to grab tickets.</p>
  ${gigRows}
  <p style="margin-top:28px;font-size:12px;color:#52525b;">
    <a href="${SITE_URL}" style="color:#6366f1;">GigRadar</a> ·
    <a href="${SITE_URL}/profile" style="color:#52525b;">Manage follows</a>
  </p>
</div>`;

  return { subject, html };
}

async function main() {
  console.log('=== GigRadar Gig Alerts ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');
  if (!RESEND_KEY && !DRY_RUN) {
    console.log('RESEND_API_KEY not set — skipping. Set it in quick-refresh.sh to enable alerts.');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const alreadyAlerted = loadAlertedIds();
  console.log(`Previously alerted: ${alreadyAlerted.size} gig IDs`);

  // Scan all future gigs not yet alerted
  console.log('Scanning future gigs...');
  const allGigs = [];
  let lastKey;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: GIGS_TABLE,
      FilterExpression: '#d >= :today',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':today': today },
      ProjectionExpression: 'gigId, artistId, artistName, venueName, venueCity, canonicalVenueId, #d, ticketUrl, tickets, genres',
      ExpressionAttributeNames: { '#d': 'date' },
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    })).catch(() => ({ Items: [] }));
    allGigs.push(...(r.Items || []).filter(g => g.gigId && g.artistId && !alreadyAlerted.has(g.gigId)));
    lastKey = r.LastEvaluatedKey;
    process.stdout.write(`\r  Found ${allGigs.length.toLocaleString()} new gigs to check...`);
  } while (lastKey);
  console.log(`\n  ${allGigs.length.toLocaleString()} new gigs to process\n`);

  if (!allGigs.length) {
    console.log('No new gigs — nothing to send.');
    return;
  }

  // Group by artistId
  const byArtist = new Map();
  for (const gig of allGigs) {
    if (!byArtist.has(gig.artistId)) byArtist.set(gig.artistId, []);
    byArtist.get(gig.artistId).push(gig);
  }
  console.log(`  ${byArtist.size} unique artists with new gigs\n`);

  // For each artist, find followers and queue alerts
  const recipientQueue = new Map(); // email → [{gig, unsubToken}]
  let artistsWithFollowers = 0;

  for (const [artistId, artistGigs] of byArtist) {
    const followers = await getFollowers(artistId);
    if (!followers.length) continue;
    artistsWithFollowers++;
    for (const follow of followers) {
      if (!recipientQueue.has(follow.email)) recipientQueue.set(follow.email, []);
      for (const gig of artistGigs.slice(0, 3)) { // max 3 gigs per artist per email
        recipientQueue.get(follow.email).push({ gig, unsubToken: follow.unsubToken || follow.followId });
      }
    }
    await sleep(50);
  }

  console.log(`  ${artistsWithFollowers} artists have followers`);
  console.log(`  ${recipientQueue.size} recipients to notify\n`);

  let sent = 0, errors = 0;
  for (const [email, items] of recipientQueue) {
    // Sort by date, cap at 10 gigs per email
    const sorted = items.sort((a, b) => a.gig.date.localeCompare(b.gig.date)).slice(0, 10);
    const unsubToken = sorted[0].unsubToken;
    const { subject, html } = buildEmail(sorted, false);
    const unsubUrl = `${SITE_URL}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
    const fullHtml = `${html}\n<p style="margin-top:24px;font-size:11px;color:#52525b;"><a href="${unsubUrl}" style="color:#52525b;">Unsubscribe</a> from gig alerts.</p>`;

    if (!DRY_RUN) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject, html: fullHtml }),
        });
        if (!res.ok) {
          const err = await res.text();
          console.error(`  Resend error for ${email}: ${err}`);
          errors++;
        } else {
          sent++;
        }
        await sleep(100);
      } catch (e) {
        console.error(`  Send error for ${email}: ${e.message}`);
        errors++;
      }
    } else {
      console.log(`  [DRY] Would send to ${email}: "${subject}"`);
      sent++;
    }
  }

  // Mark all processed gigs as alerted
  const newAlerted = new Set([...alreadyAlerted, ...allGigs.map(g => g.gigId)]);
  if (!DRY_RUN) saveAlertedIds(newAlerted);

  console.log(`\n=== Complete ===`);
  console.log(`Emails sent: ${sent.toLocaleString()}`);
  if (errors) console.log(`Errors:      ${errors}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing sent or saved]');
}

main().catch(e => { console.error(e); process.exit(1); });
