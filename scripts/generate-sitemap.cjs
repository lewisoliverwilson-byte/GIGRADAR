'use strict';
const path = require('path');
const fs   = require('fs');
const SDK  = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }           = require(path.join(SDK, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand } = require(path.join(SDK, '@aws-sdk/lib-dynamodb'));

const ddb      = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const SITE_URL = 'https://gigradar.co.uk';
const OUT_DIR  = path.join(__dirname, '../public');

async function scanAll(table, attrs, filter, vals, names) {
  const items = [];
  let lastKey;
  do {
    const p = { TableName: table, ProjectionExpression: attrs };
    if (filter) p.FilterExpression = filter;
    if (vals)   p.ExpressionAttributeValues = vals;
    if (names)  p.ExpressionAttributeNames  = names;
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const r = await ddb.send(new ScanCommand(p)).catch(e => { console.error(e.message); return { Items: [] }; });
    items.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

function xml(urls) {
  const entries = urls.map(({ loc, lastmod, priority, changefreq }) => `
  <url>
    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}${changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : ''}${priority != null ? `\n    <priority>${priority}</priority>` : ''}
  </url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}\n</urlset>`;
}

function sitemapIndex(sitemaps) {
  const entries = sitemaps.map(loc => `\n  <sitemap>\n    <loc>${loc}</loc>\n  </sitemap>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}\n</sitemapindex>`;
}

(async () => {
  const today = new Date().toISOString().split('T')[0];
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Fetching artists...');
  const artists = await scanAll(
    'gigradar-artists',
    'artistId',
    'upcoming > :z',
    { ':z': 0 }
  );
  console.log(`  ${artists.length} artists with upcoming gigs`);

  console.log('Fetching venues...');
  const venues = await scanAll(
    'gigradar-venues',
    'slug',
    'isActive = :a',
    { ':a': true }
  );
  console.log(`  ${venues.length} active venues`);

  // Static pages
  const staticXml = xml([
    { loc: `${SITE_URL}/`,        changefreq: 'daily',   priority: '1.0' },
    { loc: `${SITE_URL}/gigs`,    changefreq: 'daily',   priority: '0.9' },
    { loc: `${SITE_URL}/artists`, changefreq: 'daily',   priority: '0.8' },
    { loc: `${SITE_URL}/venues`,  changefreq: 'weekly',  priority: '0.8' },
    { loc: `${SITE_URL}/discover`,changefreq: 'daily',   priority: '0.7' },
  ]);
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap-static.xml'), staticXml);

  // Artists sitemap
  const artistXml = xml(
    artists
      .filter(a => a.artistId)
      .map(a => ({
        loc: `${SITE_URL}/artists/${encodeURIComponent(a.artistId)}`,
        changefreq: 'weekly',
        priority: '0.6',
      }))
  );
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap-artists.xml'), artistXml);

  // Venues sitemap
  const venueXml = xml(
    venues
      .filter(v => v.slug)
      .map(v => ({
        loc: `${SITE_URL}/venues/${encodeURIComponent(v.slug)}`,
        changefreq: 'weekly',
        priority: '0.6',
      }))
  );
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap-venues.xml'), venueXml);

  // Sitemap index
  const index = sitemapIndex([
    `${SITE_URL}/sitemap-static.xml`,
    `${SITE_URL}/sitemap-artists.xml`,
    `${SITE_URL}/sitemap-venues.xml`,
  ]);
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), index);

  console.log(`\nWrote:`);
  console.log(`  public/sitemap.xml         (index)`);
  console.log(`  public/sitemap-static.xml  (${5} pages)`);
  console.log(`  public/sitemap-artists.xml (${artists.length} artists)`);
  console.log(`  public/sitemap-venues.xml  (${venues.length} venues)`);
})();
