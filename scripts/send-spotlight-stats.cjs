#!/usr/bin/env node
/**
 * GigRadar — Send Spotlight Stats to Venues
 *
 * Every Friday, sends a weekly stats email to all Spotlight venues.
 * Stats: follower count + upcoming gig count.
 *
 * Usage:
 *   node scripts/send-spotlight-stats.cjs
 *   node scripts/send-spotlight-stats.cjs --dry-run
 */
'use strict';

const path = require('path');
const DDB_SDK = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }           = require(path.join(DDB_SDK, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand } = require(path.join(DDB_SDK, '@aws-sdk/lib-dynamodb'));

const ddb       = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const VENUES_TABLE = 'gigradar-venues';
const GIGS_TABLE   = 'gigradar-gigs';
const FROM_EMAIL   = process.env.FROM_EMAIL    || 'GigRadar <onboarding@resend.dev>';
const RESEND_KEY   = process.env.RESEND_API_KEY || '';
const SITE_URL     = 'https://gigradar.co.uk';
const DRY_RUN      = process.argv.includes('--dry-run');
const sleep        = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('=== GigRadar Spotlight Stats ===');
  if (DRY_RUN) console.log('[DRY RUN]\n');
  if (!RESEND_KEY && !DRY_RUN) { console.log('RESEND_API_KEY not set — skipping.'); return; }

  // Get all Spotlight venues with a booking email
  const vRes = await ddb.send(new ScanCommand({
    TableName: VENUES_TABLE,
    FilterExpression: 'isSpotlight = :t AND attribute_exists(bookingEmail)',
    ExpressionAttributeValues: { ':t': true },
  })).catch(() => ({ Items: [] }));
  const venues = vRes.Items || [];
  if (!venues.length) { console.log('No Spotlight venues with booking email.'); return; }
  console.log(`${venues.length} Spotlight venue(s) to email\n`);

  const today = new Date().toISOString().split('T')[0];

  for (const venue of venues) {
    // Count upcoming gigs
    const gRes = await ddb.send(new ScanCommand({
      TableName: GIGS_TABLE,
      FilterExpression: '(canonicalVenueId = :vid OR venueName = :vname) AND #d >= :today',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':vid': venue.venueId, ':vname': venue.name, ':today': today },
      Select: 'COUNT',
    })).catch(() => ({ Count: 0 }));

    const upcomingCount   = gRes.Count || 0;
    const followerCount   = venue.followerCount || 0;
    const venueUrl        = `${SITE_URL}/venues/${venue.slug}`;
    const to              = venue.bookingEmail;

    const subject = `Your GigRadar stats — ${venue.name}`;
    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:auto;background:#111;color:#eee;padding:32px;border-radius:12px;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
    <div style="background:#6366f1;border-radius:8px;padding:6px 10px;font-weight:900;font-size:16px;color:#fff;">GR</div>
    <span style="font-size:14px;color:#a1a1aa;">GigRadar Spotlight</span>
  </div>
  <h1 style="margin:0 0 4px;font-size:20px;color:#fff;">Weekly stats for <a href="${venueUrl}" style="color:#818cf8;text-decoration:none;">${venue.name}</a></h1>
  <p style="margin:0 0 24px;font-size:14px;color:#71717a;">Here's how your venue is doing on GigRadar this week.</p>
  <div style="display:flex;gap:16px;margin-bottom:24px;">
    <div style="flex:1;background:#1c1c1e;border:1px solid #27272a;border-radius:12px;padding:16px;text-align:center;">
      <div style="font-size:32px;font-weight:900;color:#fff;">${followerCount.toLocaleString()}</div>
      <div style="font-size:12px;color:#71717a;margin-top:4px;">Followers</div>
    </div>
    <div style="flex:1;background:#1c1c1e;border:1px solid #27272a;border-radius:12px;padding:16px;text-align:center;">
      <div style="font-size:32px;font-weight:900;color:#fff;">${upcomingCount.toLocaleString()}</div>
      <div style="font-size:12px;color:#71717a;margin-top:4px;">Upcoming gigs</div>
    </div>
  </div>
  <a href="${venueUrl}" style="display:block;background:#6366f1;color:#fff;text-decoration:none;text-align:center;font-weight:700;padding:12px;border-radius:10px;font-size:14px;">View your venue page →</a>
  <p style="margin-top:24px;font-size:12px;color:#52525b;">
    You're receiving this as a GigRadar Spotlight venue. Questions? Reply to this email.
  </p>
</div>`;

    if (DRY_RUN) {
      console.log(`  [DRY] Would send to ${to}: "${subject}"`);
      console.log(`        Followers: ${followerCount}, Upcoming: ${upcomingCount}`);
      continue;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    }).catch(() => null);

    if (res?.ok) console.log(`  Sent to ${to} (${venue.name})`);
    else console.error(`  Failed to send to ${to}`);
    await sleep(200);
  }

  console.log('\n=== Complete ===');
}

main().catch(e => { console.error(e); process.exit(1); });
