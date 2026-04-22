'use strict';

const https = require('https');
const { DynamoDBClient }                                    = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand }  = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const FOLLOWS_TABLE   = 'gigradar-follows';
const ARTISTS_TABLE   = 'gigradar-artists';
const VENUES_TABLE    = 'gigradar-venues';
const RESEND_API_KEY  = process.env.RESEND_API_KEY  || '';
const FROM_EMAIL      = process.env.FROM_EMAIL      || 'GigRadar <onboarding@resend.dev>';
const SITE_URL        = process.env.SITE_URL        || 'https://gigradar.co.uk';

function resendSend(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`Resend ${res.statusCode}: ${data}`));
        else resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getFollowers(targetId) {
  const r = await ddb.send(new QueryCommand({
    TableName: FOLLOWS_TABLE,
    IndexName: 'targetId-index',
    KeyConditionExpression: 'targetId = :t',
    FilterExpression: 'confirmed = :y',
    ExpressionAttributeValues: { ':t': targetId, ':y': true },
  })).catch(() => ({ Items: [] }));
  return r.Items || [];
}

async function sendAlert(email, subject, html, unsubToken) {
  if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY not set'); return; }
  const unsubUrl = `${SITE_URL}/unsubscribe?token=${unsubToken}`;
  const fullHtml = `${html}
<p style="margin-top:32px;font-size:12px;color:#888;">
  <a href="${unsubUrl}" style="color:#888;">Unsubscribe</a> from these alerts.
</p>`;

  await resendSend({ from: FROM_EMAIL, to: [email], subject, html: fullHtml })
    .catch(e => console.error('Resend error for', email, e.message));
}

function formatDate(d) {
  try {
    return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return d; }
}

exports.handler = async (event) => {
  const newGigs = (event.Records || [])
    .filter(r => r.eventName === 'INSERT' && r.dynamodb?.NewImage)
    .map(r => {
      const img = r.dynamodb.NewImage;
      const get = (key, type = 'S') => img[key]?.[type] || null;
      return {
        gigId:       get('gigId'),
        artistId:    get('artistId'),
        artistName:  get('artistName'),
        venueId:     get('canonicalVenueId'),
        venueName:   get('venueName'),
        venueCity:   get('city') || get('venueCity'),
        date:        get('date'),
        ticketUrl:   get('ticketUrl'),
      };
    })
    .filter(g => g.artistId && g.date);

  if (!newGigs.length) return;

  console.log(`Processing ${newGigs.length} new gigs`);

  for (const gig of newGigs) {
    const [artistFollowers, venueFollowers] = await Promise.all([
      getFollowers(gig.artistId),
      gig.venueId ? getFollowers(gig.venueId) : Promise.resolve([]),
    ]);

    const allFollowers = [...artistFollowers, ...venueFollowers];
    const byEmail = new Map();
    for (const f of allFollowers) {
      if (!byEmail.has(f.email)) byEmail.set(f.email, f);
    }

    if (!byEmail.size) continue;

    const dateStr = formatDate(gig.date);
    const gigUrl = `${SITE_URL}/gigs/${encodeURIComponent(gig.gigId)}`;
    const ticketBtn = gig.ticketUrl
      ? `<a href="${gig.ticketUrl}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Get Tickets</a>`
      : '';

    const subject = `${gig.artistName} at ${gig.venueName} — ${dateStr}`;
    const html = `
<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#111;color:#eee;padding:32px;border-radius:12px;">
  <p style="margin:0 0 8px;font-size:13px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;">New gig alert</p>
  <h1 style="margin:0 0 4px;font-size:28px;color:#fff;font-weight:900;">${gig.artistName}</h1>
  <p style="margin:0 0 20px;font-size:16px;color:#ccc;">
    📍 ${gig.venueName}${gig.venueCity ? `, ${gig.venueCity}` : ''}<br>
    📅 ${dateStr}
  </p>
  ${ticketBtn}
  <div style="margin-top:24px;border-top:1px solid #333;padding-top:20px;display:flex;gap:12px;">
    <a href="${SITE_URL}/artists/${encodeURIComponent(gig.artistId)}" style="color:#818cf8;font-size:14px;">View artist →</a>
    <a href="${gigUrl}" style="color:#818cf8;font-size:14px;">View gig →</a>
  </div>
</div>`;

    for (const [email, follow] of byEmail) {
      await sendAlert(email, subject, html, follow.unsubToken || follow.followId);
    }

    console.log(`Sent alerts for "${gig.artistName}" to ${byEmail.size} followers`);
  }
};
