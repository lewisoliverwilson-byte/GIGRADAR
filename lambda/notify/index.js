'use strict';

const { DynamoDBClient }                                    = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand }  = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand }                       = require('@aws-sdk/client-ses');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const ses = new SESClient({ region: 'us-east-1' });

const FOLLOWS_TABLE = 'gigradar-follows';
const ARTISTS_TABLE = 'gigradar-artists';
const VENUES_TABLE  = 'gigradar-venues';
const FROM_EMAIL    = process.env.FROM_EMAIL || 'noreply@gigradar.co.uk';
const SITE_URL      = process.env.SITE_URL   || 'https://gigradar.co.uk';

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

async function getArtist(artistId) {
  const r = await ddb.send(new GetCommand({ TableName: ARTISTS_TABLE, Key: { artistId } })).catch(() => ({}));
  return r.Item || null;
}

async function getVenue(venueId) {
  const r = await ddb.send(new GetCommand({ TableName: VENUES_TABLE, Key: { venueId } })).catch(() => ({}));
  return r.Item || null;
}

async function sendAlert(email, subject, html, unsubToken) {
  const unsubUrl = `${SITE_URL}/unsubscribe?token=${unsubToken}`;
  const fullHtml = `${html}
<p style="margin-top:32px;font-size:12px;color:#888;">
  <a href="${unsubUrl}" style="color:#888;">Unsubscribe</a> from these alerts.
</p>`;

  await ses.send(new SendEmailCommand({
    Source: `GigRadar <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: fullHtml, Charset: 'UTF-8' } },
    },
  })).catch(e => console.error('SES error for', email, e.message));
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
      // Unmarshall simple string/number attributes
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

    // Merge, deduplicate by email
    const allFollowers = [...artistFollowers, ...venueFollowers];
    const byEmail = new Map();
    for (const f of allFollowers) {
      if (!byEmail.has(f.email)) byEmail.set(f.email, f);
    }

    if (!byEmail.size) continue;

    const dateStr = formatDate(gig.date);
    const ticketBtn = gig.ticketUrl
      ? `<a href="${gig.ticketUrl}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;">Get Tickets</a>`
      : '';

    const subject = `${gig.artistName} at ${gig.venueName} — ${dateStr}`;
    const html = `
<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#111;color:#eee;padding:32px;border-radius:12px;">
  <h2 style="margin:0 0 4px;font-size:20px;">New gig alert</h2>
  <h1 style="margin:0 0 16px;font-size:26px;color:#fff;">${gig.artistName}</h1>
  <p style="margin:0;font-size:16px;color:#ccc;">
    📍 ${gig.venueName}${gig.venueCity ? `, ${gig.venueCity}` : ''}<br>
    📅 ${dateStr}
  </p>
  ${ticketBtn}
  <p style="margin-top:24px;font-size:14px;">
    <a href="${SITE_URL}/artists/${encodeURIComponent(gig.artistId)}" style="color:#818cf8;">View artist page →</a>
  </p>
</div>`;

    for (const [email, follow] of byEmail) {
      await sendAlert(email, subject, html, follow.unsubToken || follow.followId);
    }

    console.log(`Sent alerts for "${gig.artistName}" to ${byEmail.size} followers`);
  }
};
