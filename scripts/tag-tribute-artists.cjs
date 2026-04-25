/**
 * tag-tribute-artists.cjs
 *
 * Scans all artist records and sets isTribute=true on any whose name
 * matches the tribute regex. Dry-run by default.
 *
 *   node scripts/tag-tribute-artists.cjs --dry-run
 *   node scripts/tag-tribute-artists.cjs --live
 */

const path = require('path');
const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient } = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const DRY_RUN = !process.argv.includes('--live');
if (DRY_RUN) console.log('🔍  DRY RUN — pass --live to tag\n');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const ARTISTS_TABLE = 'gigradar-artists';

const TRIBUTE_RE = /tribute|cover band|covers band|\bcovers\b|salute to|the music of|celebrating the music|songs of|the songs of|in the style of|a night of|an evening of|lives on|symphony of|story of|the story of|legacy of|anniversary show|anniversary tour|anniversary concert|plays the hits|performs the hits|greatest hits show|years of hits|through the years|honouring|honoring|in memory of|in tribute|a tribute to|vs\s|feat\.|featuring\s+the|experience\b|celebrating \w|performed by|starring/i;

async function scanAll(params) {
  const items = [];
  let key;
  do {
    const res = await ddb.send(new ScanCommand({ ...params, ExclusiveStartKey: key }));
    if (res.Items) items.push(...res.Items);
    key = res.LastEvaluatedKey;
  } while (key);
  return items;
}

async function main() {
  const artists = await scanAll({
    TableName: ARTISTS_TABLE,
    FilterExpression: 'attribute_not_exists(isTribute) OR isTribute = :f',
    ExpressionAttributeValues: { ':f': false },
    ProjectionExpression: 'artistId, #n',
    ExpressionAttributeNames: { '#n': 'name' },
  });

  const tributes = artists.filter(a => TRIBUTE_RE.test(a.name || ''));
  console.log(`Found ${tributes.length} tribute artists to tag (from ${artists.length} total)\n`);

  let tagged = 0;
  for (const artist of tributes) {
    console.log(`  TAG "${artist.name}" (${artist.artistId})`);
    if (!DRY_RUN) {
      await ddb.send(new UpdateCommand({
        TableName: ARTISTS_TABLE,
        Key: { artistId: artist.artistId },
        UpdateExpression: 'SET isTribute = :t',
        ExpressionAttributeValues: { ':t': true },
      })).catch(e => console.error('    Error:', e.message));
    }
    tagged++;
  }

  console.log(`\n${DRY_RUN ? 'Would tag' : 'Tagged'} ${tagged} artists with isTribute=true`);
  if (DRY_RUN) console.log('Re-run with --live to execute.');
}

main().catch(console.error);
