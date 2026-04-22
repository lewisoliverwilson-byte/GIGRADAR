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

function gigRow(gig, showVenue = false) {
  const ticketBtn = gig.ticketUrl || gig.tickets?.[0]?.url
    ? `<a href="${gig.ticketUrl || gig.tickets[0].url}" style="display:inline-block;margin-top:10px;padding:8px 18px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;">Get Tickets</a>`
    : '';
  const price = gig.tickets?.find(t => t.price && t.price !== 'See site')?.price;
  const location = showVenue
    ? `📍 ${gig.venueName || 'Venue TBC'}${gig.venueCity ? `, ${gig.venueCity}` : ''}<br>`
    : '';
  return `
<div style="border-bottom:1px solid #27272a;padding:16px 0;">
  <p style="margin:0 0 2px;font-size:18px;font-weight:700;color:#fff;">${gig.artistName}</p>
  <p style="margin:0;font-size:14px;color:#a1a1aa;">
    ${location}📅 ${formatDate(gig.date)}${price ? `<br>🎟️ From ${price}` : ''}
  </p>
  ${ticketBtn}
  <p style="margin-top:8px;font-size:12px;">
    <a href="${SITE_URL}/artists/${encodeURIComponent(gig.artistId)}" style="color:#818cf8;">View artist →</a>
  </p>
</div>`;
}

function emailWrapper(headerHtml, bodyHtml, unsubUrl) {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:auto;background:#111;color:#eee;padding:32px;border-radius:12px;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
    <div style="background:#6366f1;border-radius:8px;padding:6px 10px;font-weight:900;font-size:16px;color:#fff;letter-spacing:-0.5px;">GR</div>
    <span style="font-size:14px;color:#a1a1aa;">GigRadar Gig Alert</span>
  </div>
  ${headerHtml}
  ${bodyHtml}
  <p style="margin-top:28px;font-size:12px;color:#52525b;">
    <a href="${SITE_URL}" style="color:#6366f1;">GigRadar</a> ·
    <a href="${unsubUrl}" style="color:#52525b;">Unsubscribe</a>
  </p>
</div>`;
}

function buildArtistEmail(recipientGigs, unsubUrl) {
  const multiple = recipientGigs.length > 1;
  const subjectGig = recipientGigs[0].gig;
  const subject = multiple
    ? `${recipientGigs.length} new gigs from artists you follow`
    : `${subjectGig.artistName} at ${subjectGig.venueName} — ${formatDate(subjectGig.date)}`;
  const rows = recipientGigs
    .sort((a, b) => a.gig.date.localeCompare(b.gig.date))
    .slice(0, 10)
    .map(({ gig }) => gigRow(gig, true))
    .join('');
  const header = `
    <h1 style="margin:0 0 4px;font-size:22px;color:#fff;">${multiple ? 'New shows from artists you follow' : 'New gig announced'}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#71717a;">You're following these artists — don't miss your chance to grab tickets.</p>`;
  return { subject, html: emailWrapper(header, rows, unsubUrl) };
}

function buildVenueEmail(venueName, venueSlug, recipientGigs, unsubUrl) {
  const sorted = recipientGigs.sort((a, b) => a.gig.date.localeCompare(b.gig.date)).slice(0, 10);
  const multiple = sorted.length > 1;
  const subject = multiple
    ? `${sorted.length} new gigs at ${venueName}`
    : `${sorted[0].gig.artistName} at ${venueName} — ${formatDate(sorted[0].gig.date)}`;
  const venueUrl = venueSlug ? `${SITE_URL}/venues/${venueSlug}` : SITE_URL;
  const rows = sorted.map(({ gig }) => gigRow(gig, false)).join('');
  const header = `
    <h1 style="margin:0 0 4px;font-size:22px;color:#fff;">${multiple ? `${sorted.length} new gigs` : 'New gig'} at <a href="${venueUrl}" style="color:#818cf8;text-decoration:none;">${venueName}</a></h1>
    <p style="margin:0 0 20px;font-size:14px;color:#71717a;">You're following this venue — here's what's just been announced.</p>`;
  return { subject, html: emailWrapper(header, rows, unsubUrl) };
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
      ProjectionExpression: 'gigId, artistId, artistName, venueName, venueCity, venueSlug, canonicalVenueId, #d, ticketUrl, tickets',
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

  // ── Artist follows ───────────────────────────────────────────────────────────
  const byArtist = new Map();
  for (const gig of allGigs) {
    if (!gig.artistId) continue;
    if (!byArtist.has(gig.artistId)) byArtist.set(gig.artistId, []);
    byArtist.get(gig.artistId).push(gig);
  }
  console.log(`  ${byArtist.size} unique artists with new gigs`);

  const artistQueue = new Map(); // email → [{gig, unsubToken}]
  for (const [artistId, artistGigs] of byArtist) {
    const followers = await getFollowers(artistId);
    if (!followers.length) continue;
    for (const follow of followers) {
      if (!artistQueue.has(follow.email)) artistQueue.set(follow.email, []);
      for (const gig of artistGigs.slice(0, 3)) {
        artistQueue.get(follow.email).push({ gig, unsubToken: follow.unsubToken || follow.followId });
      }
    }
    await sleep(50);
  }
  console.log(`  ${artistQueue.size} artist-follow recipients\n`);

  // ── Venue follows ─────────────────────────────────────────────────────────
  const byVenue = new Map();
  for (const gig of allGigs) {
    if (!gig.canonicalVenueId) continue;
    if (!byVenue.has(gig.canonicalVenueId)) byVenue.set(gig.canonicalVenueId, []);
    byVenue.get(gig.canonicalVenueId).push(gig);
  }
  console.log(`  ${byVenue.size} unique venues with new gigs`);

  // email → { venueName, venueSlug, items: [{gig, unsubToken}] }
  const venueQueue = new Map();
  for (const [venueId, venueGigs] of byVenue) {
    const followers = await getFollowers(venueId);
    if (!followers.length) continue;
    const venueName = venueGigs[0].venueName || venueId;
    const venueSlug = venueGigs[0].venueSlug || null;
    for (const follow of followers) {
      if (!venueQueue.has(follow.email)) venueQueue.set(follow.email, { venueName, venueSlug, items: [] });
      for (const gig of venueGigs.slice(0, 5)) {
        venueQueue.get(follow.email).items.push({ gig, unsubToken: follow.unsubToken || follow.followId });
      }
    }
    await sleep(50);
  }
  console.log(`  ${venueQueue.size} venue-follow recipients\n`);

  // ── Send emails ───────────────────────────────────────────────────────────
  let sent = 0, errors = 0;

  async function sendEmail(to, subject, html) {
    if (DRY_RUN) {
      console.log(`  [DRY] Would send to ${to}: "${subject}"`);
      sent++;
      return;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
      });
      if (!res.ok) {
        console.error(`  Resend error for ${to}: ${await res.text()}`);
        errors++;
      } else {
        sent++;
      }
      await sleep(100);
    } catch (e) {
      console.error(`  Send error for ${to}: ${e.message}`);
      errors++;
    }
  }

  for (const [email, items] of artistQueue) {
    const unsubUrl = `${SITE_URL}/unsubscribe?token=${encodeURIComponent(items[0].unsubToken)}`;
    const { subject, html } = buildArtistEmail(items, unsubUrl);
    await sendEmail(email, subject, html);
  }

  for (const [email, { venueName, venueSlug, items }] of venueQueue) {
    const unsubUrl = `${SITE_URL}/unsubscribe?token=${encodeURIComponent(items[0].unsubToken)}`;
    const { subject, html } = buildVenueEmail(venueName, venueSlug, items, unsubUrl);
    await sendEmail(email, subject, html);
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
