'use strict';
const path = require('path');
const SDK = p => require(path.join(__dirname, '../lambda/scraper/node_modules', p));
const { DynamoDBClient } = SDK('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = SDK('@aws-sdk/lib-dynamodb');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

(async () => {
  let venues = [], lastKey;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: 'gigradar-venues',
      ProjectionExpression: 'venueId, #n, city, website, wikiUrl, mbid, ticketingUrls, tmVenueId, skiddleId',
      ExpressionAttributeNames: { '#n': 'name' }
    })).catch(() => ({ Items: [] }));
    venues.push(...(r.Items || [])); lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  const t = venues.length;
  const pct = n => Math.round(100*n/t) + '%';
  const hasWebsite   = venues.filter(v => v.website).length;
  const hasWiki      = venues.filter(v => v.wikiUrl).length;
  const hasMbid      = venues.filter(v => v.mbid).length;
  const hasSongkick  = venues.filter(v => v.ticketingUrls?.songkick).length;
  const hasTM        = venues.filter(v => v.tmVenueId).length;
  const hasSkiddle   = venues.filter(v => v.skiddleId).length;
  const noSources    = venues.filter(v => !v.website && !v.ticketingUrls?.songkick && !v.tmVenueId && !v.skiddleId).length;

  console.log('Total venues:        ', t);
  console.log('Has own website:     ', hasWebsite,  pct(hasWebsite));
  console.log('Has Wikipedia URL:   ', hasWiki,     pct(hasWiki));
  console.log('Has MusicBrainz ID:  ', hasMbid,     pct(hasMbid));
  console.log('Has Songkick URL:    ', hasSongkick, pct(hasSongkick));
  console.log('Has TM venue ID:     ', hasTM,       pct(hasTM));
  console.log('Has Skiddle ID:      ', hasSkiddle,  pct(hasSkiddle));
  console.log('No ticketing source: ', noSources,   pct(noSources));
})();
