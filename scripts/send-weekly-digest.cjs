#!/usr/bin/env node
/**
 * GigRadar — Send Weekly Digest
 *
 * Every Friday, sends a "this week at venues you follow" email to all followers.
 * Runs after data refresh in weekly-refresh.sh so show data is fresh.
 *
 * For each follower:
 *   - Collects upcoming shows from all venues they follow
 *   - Sends one digest email (max 10 shows, soonest first)
 *   - If all followed venues have no shows: sends a "quiet week" email
 *   - Skips followers with no followed venues
 *
 * Usage:
 *   node scripts/send-weekly-digest.cjs
 *   node scripts/send-weekly-digest.cjs --dry-run
 */
'use strict';

const path = require('path');
const DDB_SDK = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }           = require(path.join(DDB_SDK, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, QueryCommand } = require(path.join(DDB_SDK, '@aws-sdk/lib-dynamodb'));

const ddb      = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const GIGS_TABLE   = 'gigradar-gigs';
const FOLLOWS_TABLE = 'gigradar-follows';
const FROM_EMAIL    = process.env.FROM_EMAIL    || 'GigRadar <onboarding@resend.dev>';
const RESEND_KEY    = process.env.RESEND_API_KEY || '';
const SITE_URL      = 'https://gigradar.co.uk';
const DRY_RUN       = process.argv.includes('--dry-run');
const sleep         = ms => new Promise(r => setTimeout(r, ms));

async function scanAll(tableName, filter, names, values) {
  const items = [];
  let lastKey;
  do {
    const params = { TableName: tableName };
    if (filter) { params.FilterExpression = filter; params.ExpressionAttributeNames = names; params.ExpressionAttributeValues = values; }
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(params)).catch(() => ({ Items: [] }));
    items.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function getFollowersByTarget(targetId) {
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
  try { return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/London' }); }
  catch { return d; }
}

function gigRow(gig) {
  const ticketBtn = gig.ticketUrl || gig.tickets?.[0]?.url
    ? `<a href="${gig.ticketUrl || gig.tickets[0].url}" style="display:inline-block;margin-top:8px;padding:6px 14px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;">Tickets</a>`
    : '';
  const price = gig.tickets?.find(t => t.price && t.price !== 'See site')?.price;
  return `
<div style="border-bottom:1px solid #27272a;padding:14px 0;">
  <p style="margin:0 0 2px;font-size:17px;font-weight:700;color:#fff;">${gig.artistName}</p>
  <p style="margin:0;font-size:13px;color:#a1a1aa;">
    📍 ${gig.venueName || 'Venue TBC'}${gig.venueCity ? `, ${gig.venueCity}` : ''}<br>
    📅 ${formatDate(gig.date)}${price ? `<br>🎟️ From ${price}` : ''}
  </p>
  ${ticketBtn}
  <p style="margin-top:6px;font-size:12px;">
    <a href="${SITE_URL}/artists/${encodeURIComponent(gig.artistId)}" style="color:#818cf8;">View artist →</a>
  </p>
</div>`;
}

function buildDigestEmail(shows, followedVenueNames, unsubUrl) {
  const hasShows = shows.length > 0;
  const subject  = hasShows
    ? `This week at venues you follow${shows.length > 1 ? ` — ${shows.length} shows` : ''}`
    : 'Quiet week at your venues';

  const bodyHtml = hasShows
    ? shows.slice(0, 10).map(gigRow).join('')
    : `<p style="color:#a1a1aa;font-size:14px;margin:0 0 8px;">No upcoming shows this week at venues you follow:</p>
       <ul style="margin:0;padding-left:18px;color:#71717a;font-size:13px;">
         ${followedVenueNames.map(n => `<li>${n}</li>`).join('')}
       </ul>
       <p style="color:#a1a1aa;font-size:13px;margin-top:12px;">We'll alert you the moment new shows are announced.</p>`;

  const headerHtml = hasShows
    ? `<h1 style="margin:0 0 4px;font-size:22px;color:#fff;">This week at venues you follow</h1>
       <p style="margin:0 0 20px;font-size:14px;color:#71717a;">Upcoming shows — grab tickets before they sell out.</p>`
    : `<h1 style="margin:0 0 4px;font-size:22px;color:#fff;">Quiet week</h1>
       <p style="margin:0 0 20px;font-size:14px;color:#71717a;">Nothing announced yet this week — we're watching.</p>`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:auto;background:#111;color:#eee;padding:32px;border-radius:12px;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
    <div style="background:#6366f1;border-radius:8px;padding:6px 10px;font-weight:900;font-size:16px;color:#fff;letter-spacing:-0.5px;">GR</div>
    <span style="font-size:14px;color:#a1a1aa;">GigRadar Weekly Digest</span>
  </div>
  ${headerHtml}
  ${bodyHtml}
  <p style="margin-top:28px;font-size:12px;color:#52525b;">
    <a href="${SITE_URL}" style="color:#6366f1;">GigRadar</a> ·
    <a href="${unsubUrl}" style="color:#52525b;">Unsubscribe</a>
  </p>
</div>`;

  return { subject, html };
}

async function sendEmail(to, subject, html) {
  if (DRY_RUN) {
    console.log(`  [DRY] Would send to ${to}: "${subject}"`);
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) { console.error(`  Resend error for ${to}: ${await res.text()}`); return false; }
    return true;
  } catch (e) {
    console.error(`  Send error for ${to}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('=== GigRadar Weekly Digest ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');
  if (!RESEND_KEY && !DRY_RUN) {
    console.log('RESEND_API_KEY not set — skipping.');
    return;
  }

  // Load all venue follows
  console.log('Loading venue follows...');
  const allFollows = await scanAll(
    FOLLOWS_TABLE,
    'targetType = :tv AND confirmed = :y',
    null,
    { ':tv': 'venue', ':y': true }
  );
  if (!allFollows.length) { console.log('No venue followers yet.'); return; }

  // Build per-email follow map: email → [targetId, ...]
  const emailToVenues = new Map();
  const emailToUnsub  = new Map();
  for (const f of allFollows) {
    if (!emailToVenues.has(f.email)) emailToVenues.set(f.email, []);
    emailToVenues.get(f.email).push(f.targetId);
    if (!emailToUnsub.has(f.email)) emailToUnsub.set(f.email, f.unsubToken || f.followId);
  }
  console.log(`${emailToVenues.size} followers across ${allFollows.length} venue follows\n`);

  // Load upcoming gigs (next 14 days) grouped by venueId
  const today    = new Date().toISOString().split('T')[0];
  const twoWeeks = new Date(Date.now() + 14 * 864e5).toISOString().split('T')[0];
  console.log(`Loading gigs from ${today} to ${twoWeeks}...`);
  const gigs = await scanAll(
    GIGS_TABLE,
    '#d >= :today AND #d <= :two AND attribute_exists(canonicalVenueId)',
    { '#d': 'date' },
    { ':today': today, ':two': twoWeeks }
  );

  const gigsByVenue = new Map();
  for (const g of gigs) {
    if (!gigsByVenue.has(g.canonicalVenueId)) gigsByVenue.set(g.canonicalVenueId, []);
    gigsByVenue.get(g.canonicalVenueId).push(g);
  }
  console.log(`${gigs.length} upcoming gigs across ${gigsByVenue.size} venues\n`);

  // Build and send digest per follower
  let sent = 0, errors = 0, quiet = 0;

  for (const [email, venueIds] of emailToVenues) {
    const shows = venueIds
      .flatMap(vid => gigsByVenue.get(vid) || [])
      .sort((a, b) => a.date.localeCompare(b.date));

    const unsubUrl = `${SITE_URL}/unsubscribe?token=${encodeURIComponent(emailToUnsub.get(email) || '')}`;

    // Gather venue names for the quiet-week fallback (best effort from gig data)
    const venueNames = [...new Set(
      venueIds.map(vid => (gigsByVenue.get(vid) || [])[0]?.venueName).filter(Boolean)
    )];

    const { subject, html } = buildDigestEmail(shows, venueNames, unsubUrl);
    if (!shows.length) quiet++;

    const ok = await sendEmail(email, subject, html);
    if (ok) sent++; else errors++;
    await sleep(100);
  }

  console.log(`\n=== Complete ===`);
  console.log(`Sent   : ${sent}`);
  console.log(`Quiet  : ${quiet} (no upcoming shows)`);
  if (errors) console.log(`Errors : ${errors}`);
  if (DRY_RUN) console.log('\n[DRY RUN — nothing sent]');
}

main().catch(e => { console.error(e); process.exit(1); });
