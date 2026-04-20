#!/usr/bin/env node
/**
 * Skiddle Venue Scraper
 *
 * Goes through every Skiddle city's A-Z venue listing (5 alphabet ranges per city),
 * collects all venue page URLs, then fetches each venue's full profile including
 * website URL from __NEXT_DATA__ and upserts into gigradar-venues DynamoDB.
 *
 * Bypasses AWS WAF by auto-fetching an aws-waf-token via the gstack browse binary.
 *
 * Usage (from project root):
 *   node scripts/scrape-skiddle-venues.cjs
 *   node scripts/scrape-skiddle-venues.cjs --dry-run
 *   node scripts/scrape-skiddle-venues.cjs --cities London,Manchester,Bristol
 *   node scripts/scrape-skiddle-venues.cjs --waf-token <token>   (skip auto-fetch)
 */

'use strict';

const path           = require('path');
const fs             = require('fs');
const { execSync }   = require('child_process');

const SDK_PATH = path.join(__dirname, '../lambda/scraper/node_modules');
const { DynamoDBClient }                                       = require(path.join(SDK_PATH, '@aws-sdk/client-dynamodb'));
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand }   = require(path.join(SDK_PATH, '@aws-sdk/lib-dynamodb'));

const ddb      = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const VENUES_TABLE = 'gigradar-venues';
const CACHE_FILE    = path.join(__dirname, 'venues-skiddle-scraped.json');
const PROGRESS_FILE = path.join(__dirname, 'venues-scrape-progress.json');
const DRY_RUN       = process.argv.includes('--dry-run');
const sleep         = ms => new Promise(r => setTimeout(r, ms));

// ─── Progress helpers ─────────────────────────────────────────────────────────

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
  }
  return null;
}

function saveProgress(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data));
}

// ─── WAF token ───────────────────────────────────────────────────────────────

function getWafTokenArg() {
  const idx = process.argv.indexOf('--waf-token');
  return idx !== -1 ? process.argv[idx + 1] : null;
}

async function fetchWafToken() {
  // Try the gstack browse binary to get a real browser session with WAF cookie
  // Support both Windows (.exe) and Unix binaries
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const browsePaths = [
    path.join(home, '.claude/skills/gstack/browse/dist/browse.exe'),
    path.join(home, '.claude/skills/gstack/browse/dist/browse'),
    path.join(__dirname, '../.claude/skills/gstack/browse/dist/browse.exe'),
    path.join(__dirname, '../.claude/skills/gstack/browse/dist/browse'),
  ];
  const browseBin = browsePaths.find(p => fs.existsSync(p));
  if (!browseBin) {
    throw new Error('gstack browse binary not found. Pass --waf-token <token> manually.');
  }

  console.log('Fetching WAF token via headless browser...');
  try {
    // Navigate to Skiddle to get a valid WAF cookie
    execSync(`"${browseBin}" goto https://www.skiddle.com/`, { stdio: 'ignore', timeout: 30000 });
    const cookies = execSync(`"${browseBin}" js "document.cookie"`, { timeout: 10000 }).toString().trim();
    const match = cookies.match(/aws-waf-token=([^\s;]+)/);
    if (!match) throw new Error('aws-waf-token not found in cookies after browsing');
    console.log('  WAF token obtained.');
    return match[1];
  } catch (e) {
    throw new Error(`Failed to fetch WAF token: ${e.message}`);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function makeHeaders(wafToken) {
  return {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
    'Cookie':          `aws-waf-token=${wafToken}`,
    'Referer':         'https://www.skiddle.com/',
  };
}

function isWafChallenge(html) {
  // WAF returns HTTP 200 with a challenge page — detect it by the absence of real content
  // and presence of WAF-specific markers
  if (!html) return false;
  if (html.includes('awswaf') || html.includes('aws-waf') || html.includes('challenge.js')) return true;
  // If the page is very short and has no __NEXT_DATA__, it's likely a challenge
  if (html.length < 5000 && !html.includes('__NEXT_DATA__')) return true;
  return false;
}

async function fetchHtml(url, headers, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers });
      if (r.status === 429) {
        console.log(`  Rate limited on ${url}, waiting 15s...`);
        await sleep(15000);
        continue;
      }
      if (r.status === 403) {
        return { html: null, status: 403 };
      }
      if (!r.ok) return { html: null, status: r.status };
      const html = await r.text();
      // WAF sometimes returns 200 with a challenge page instead of 403
      if (isWafChallenge(html)) return { html: null, status: 403 };
      return { html, status: r.status };
    } catch (e) {
      if (attempt === retries) return { html: null, status: 0, error: e.message };
      await sleep(2000 * attempt);
    }
  }
  return { html: null, status: 0 };
}

// ─── City list ────────────────────────────────────────────────────────────────

// All UK cities from Skiddle's /whats-on/cities.html (deduplicated)
const ALL_CITIES = [
  'Aberdeen','Airdrie','Andover','Armagh','Ayr',
  'Banbridge','Banbury','Bangor','Bangor-Wales','Barnsley',
  'Basildon','Basingstoke','Bath','Bedford','Belfast',
  'Berwick-upon-Tweed','Birkenhead','Birmingham','Blackburn','Blackpool',
  'Bolton','Bognor-Regis','Borehamwood','Bournemouth','Bradford',
  'Bracknell','Bridgend','Bridlington','Brierley-Hill','Brighton',
  'Bristol','Bromley','Burnley','Bury',
  'Cambridge','Canterbury','Cardiff','Carlisle','Chatham',
  'Chelmsford','Cheltenham','Chester','Chichester','Clacton-on-Sea',
  'Cleethorpes','Coatbridge','Colchester','Coventry','Crawley',
  'Crewe','Croydon','Cumbernauld',
  'Darlington','Dartford','Derby','Derry','Doncaster',
  'Dorchester','Dudley','Dumfries','Dundee','Dunfermline','Durham',
  'East-Kilbride','Eastbourne','Eastleigh','Edinburgh','Ely','Enfield','Exeter',
  'Falkirk','Falmouth','Fareham','Falmouth',
  'Gateshead','Gillingham','Glasgow','Glenrothes','Gloucester',
  'Gosport','Great-Yarmouth','Greenock','Grimsby','Guiseley','Guildford',
  'Halifax','Hamilton','Harlow','Harrogate','Harrow','Hartlepool',
  'Hastings','Hemel-Hempstead','Hereford','Hertford','High-Wycombe',
  'Huddersfield','Hull',
  'Ilford','Inverness','Ipswich','Isle-of-Wight',
  'Kendal','Kidderminster','Kilmarnock','Kingston-Upon-Thames','Kingswinford',
  'Kirkcaldy','Kirkwall',
  'Lancaster','Leeds','Leicester','Lerwick','Lincoln','Lisburn',
  'Liverpool','Livingston','Llandrindod-Wells','Llandudno','Llangollen','London','Lowestoft','Luton',
  'Maidenhead','Maidstone','Manchester','Margate','Medway-Rochester',
  'Middlesbrough','Milton-Keynes','Motherwell',
  'Newcastle','Newcastle-on-Tyne','Newcastle-under-lyme','Newbury','Newport','Newport-Shropshire',
  'Newquay','Newry','Norwich','Northampton','Nottingham',
  'Oldham','Oxford',
  'Paisley','Perth','Peterborough','Plymouth','Poole','Portland','Portsmouth','Preston',
  'Reading','Redditch','RedHill','Rhyl','Rochdale','Romford','Rotherham',
  'Salford','Salisbury','Scarborough','Scunthorpe','Sheffield','Shrewsbury',
  'Skegness','Slough','Solihull','Southampton','Southend-on-Sea','South-Shields',
  'Southminster','Southport','St-Albans','St-Austell','StHelens',
  'Stafford','Stevenage','Stirling','Stockport','Stockton-on-tees','Stoke-On-Trent',
  'Stourbridge','Stourport-On-Severn','Stratford-upon-avon','Sunderland','Sutton',
  'Sutton-Coldfield','Swansea','Swindon',
  'Taunton','Telford','Tipton','Torquay','Truro','Tunbridge-Wells','Twickenham',
  'Uxbridge',
  'Wakefield','Walsall','Warrington','Watford','West-Bromwich','Weston-super-Mare',
  'Weymouth','Whitehaven','Wigan','Winchester','Wolverhampton','Worcester','Workington','Worthing','Wrexham',
  'Yarm','York',
];

const ALPHABET_RANGES = ['0-9', 'a-g', 'h-m', 'n-s', 't-z'];

// ─── Venue URL extraction from az.html ────────────────────────────────────────

function extractVenueUrls(html, city) {
  // Venue links are like /whats-on/{City}/{Venue-Name}/
  // The listing HTML uses single-quote hrefs: href='/whats-on/...'
  // Navigation/sidebar use double quotes: href="/whats-on/..."
  // We capture both and deduplicate.
  const seen = new Set();
  const urls = [];
  // Match both single- and double-quoted href attributes
  const re = /href=['"](\/(whats-on)\/([^'"\/]+)\/([^'"\/]+)\/)['"](?!\s*>Events)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, url, , urlCity] = m;
    if (url.includes('az.html') || url.includes('cities') || url.includes('online')) continue;
    if (urlCity.toLowerCase() === city.toLowerCase()) {
      if (!seen.has(url)) { seen.add(url); urls.push(url); }
    }
  }
  return urls;
}

// ─── Venue detail extraction ──────────────────────────────────────────────────

function extractVenueData(html, venueUrl) {
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nd) return null;
  try {
    const d    = JSON.parse(nd[1]);
    const vd   = d.props?.pageProps?.venueData;
    if (!vd || !vd.id || !vd.name) return null;
    return {
      skiddleId:    vd.id,
      name:         vd.name,
      city:         vd.town || '',
      address:      vd.address || '',
      postcode:     vd.postcode || '',
      lat:          parseFloat(vd.latitude)  || null,
      lon:          parseFloat(vd.longitude) || null,
      venueType:    vd.type || '',
      description:  vd.description || '',
      phone:        vd.phone || '',
      imageUrl:     (vd.imageUrl && vd.imageUrl !== 'false') ? vd.imageUrl : null,
      website:      vd.url || null,
      skiddleUrl:   vd.fullUrl || `https://www.skiddle.com${venueUrl}`,
      capacity:     vd.capacity ? parseInt(vd.capacity) : null,
      musicPolicy:  vd.musicPolicy  || null,
      openingHours: vd.openingHours || null,
      foodServed:   vd.foodServed   || null,
      drinksServed: vd.drinksServed || null,
      ambience:     vd.ambience     || null,
      dressCode:    vd.dressCode    || null,
      nearestTube:  vd.nearestTubeStop || null,
      nearestTrain: vd.nearestTrainStation || null,
    };
  } catch { return null; }
}

// ─── DynamoDB helpers ─────────────────────────────────────────────────────────

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, '');
}
function toVenueId(name, city) {
  return `venue#${normaliseName(name)}#${normaliseName(city)}`;
}
function toVenueSlug(name, city) {
  const slugify = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return city ? `${slugify(city)}-${slugify(name)}` : slugify(name);
}

async function upsertVenue(venue) {
  const venueId = toVenueId(venue.name, venue.city);
  const slug    = toVenueSlug(venue.name, venue.city);

  // Build update expression dynamically to only set fields we have
  const updates = [
    '#n        = if_not_exists(#n,        :n)',
    'city       = if_not_exists(city,       :c)',
    'slug       = if_not_exists(slug,       :s)',
    'isActive   = if_not_exists(isActive,   :a)',
    'upcoming   = if_not_exists(upcoming,   :u)',
    'skiddleId  = if_not_exists(skiddleId,  :sid)',
    'skiddleUrl = if_not_exists(skiddleUrl, :surl)',
    'lastUpdated = :t',
  ];
  const names  = { '#n': 'name' };
  const values = {
    ':n':    venue.name,
    ':c':    venue.city      || '',
    ':s':    slug,
    ':a':    true,
    ':u':    0,
    ':sid':  venue.skiddleId || null,
    ':surl': venue.skiddleUrl || null,
    ':t':    new Date().toISOString(),
  };

  // Conditionally update optional fields only if non-null (don't overwrite existing data with nulls)
  // Fields that clash with DynamoDB reserved words use expression attribute name aliases.
  const optionals = [
    // [field, placeholder, alias, value]
    ['website',     ':w',    null,   venue.website],
    ['address',     ':addr', null,   venue.address     || null],
    ['postcode',    ':pc',   null,   venue.postcode    || null],
    ['lat',         ':lat',  null,   venue.lat         || null],
    ['lon',         ':lon',  null,   venue.lon         || null],
    ['phone',       ':ph',   null,   venue.phone       || null],
    ['description', ':desc', null,   venue.description || null],
    ['imageUrl',    ':img',  null,   venue.imageUrl    || null],
    ['venueType',   ':vt',   null,   venue.venueType   || null],
    ['capacity',    ':cap',  '#cap', venue.capacity    || null],  // reserved keyword
    ['musicPolicy', ':mp',   null,   venue.musicPolicy || null],
    ['openingHours',':oh',   null,   venue.openingHours|| null],
    ['foodServed',  ':fs',   null,   venue.foodServed  || null],
    ['drinksServed',':ds',   null,   venue.drinksServed|| null],
    ['ambience',    ':amb',  null,   venue.ambience    || null],
    ['dressCode',   ':dc',   null,   venue.dressCode   || null],
    ['nearestTube', ':tube', null,   venue.nearestTube || null],
    ['nearestTrain',':train',null,   venue.nearestTrain|| null],
  ];
  for (const [field, placeholder, alias, val] of optionals) {
    if (val !== null && val !== undefined && val !== '') {
      const ref = alias || field;
      if (alias) names[alias] = field;
      updates.push(`${ref} = if_not_exists(${ref}, ${placeholder})`);
      values[placeholder] = val;
    }
  }

  await ddb.send(new UpdateCommand({
    TableName: VENUES_TABLE,
    Key: { venueId },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GigRadar Skiddle Venue Scraper ===\n');

  // Determine city list
  let cities = ALL_CITIES;
  const citiesArg = process.argv.find(a => a.startsWith('--cities='))?.split('=')[1]
                 || (process.argv.indexOf('--cities') !== -1 ? process.argv[process.argv.indexOf('--cities') + 1] : null);
  if (citiesArg) {
    cities = citiesArg.split(',').map(c => c.trim());
    console.log(`Running for specific cities: ${cities.join(', ')}\n`);
  }

  // Get WAF token
  let wafToken = getWafTokenArg();
  if (!wafToken) {
    wafToken = await fetchWafToken();
  } else {
    console.log('Using provided WAF token.\n');
  }

  let headers = makeHeaders(wafToken);
  let requestsSinceRefresh = 0;
  const WAF_REFRESH_INTERVAL = 300;

  async function refreshWafToken(reason = 'proactive') {
    console.log(`\n  WAF token refresh (${reason})...`);
    wafToken = await fetchWafToken();
    headers  = makeHeaders(wafToken);
    requestsSinceRefresh = 0;
    console.log('  Token refreshed.\n');
  }

  async function fetchHtmlTracked(url) {
    // Proactively refresh WAF token before it expires
    if (requestsSinceRefresh > 0 && requestsSinceRefresh % WAF_REFRESH_INTERVAL === 0) {
      await refreshWafToken('proactive');
    }
    requestsSinceRefresh++;
    const result = await fetchHtml(url, headers);
    if (result.status === 403) {
      await refreshWafToken('reactive 403');
      return fetchHtml(url, headers);
    }
    return result;
  }

  // ── Check for existing progress (resume support) ──────────────────────────

  const progress = loadProgress();
  let allVenueUrls;
  let processedUrls = new Set();
  let resumedVenues = [];

  if (progress && progress.urls && progress.urls.length > 0) {
    allVenueUrls = new Set(progress.urls);
    processedUrls = new Set(progress.processedUrls || []);
    console.log(`Resuming from previous run:`);
    console.log(`  Venue URLs collected : ${allVenueUrls.size}`);
    console.log(`  Already profiled     : ${processedUrls.size}`);
    // Load existing cache to preserve already-written venues
    if (fs.existsSync(CACHE_FILE)) {
      try { resumedVenues = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
    }
    console.log(`  Cache entries loaded : ${resumedVenues.length}\n`);
  } else {
    allVenueUrls = new Set();

    // ── Phase 1: Collect venue URLs from A-Z listings ────────────────────────

    console.log(`Phase 1: Collecting venue URLs from A-Z listings (${cities.length} cities × 5 ranges)...`);

    for (const city of cities) {
      const cityVenueUrls = new Set();

      for (const range of ALPHABET_RANGES) {
        const url = `https://www.skiddle.com/whats-on/${city}/az.html?range=${range}`;
        const { html, status } = await fetchHtmlTracked(url);

        if (!html) {
          console.log(`  Skipping ${city} ${range} (${status})`);
        } else {
          extractVenueUrls(html, city).forEach(u => { cityVenueUrls.add(u); allVenueUrls.add(u); });
        }

        await sleep(400);
      }

      process.stdout.write(`\r  ${city}: ${cityVenueUrls.size} venues | Total so far: ${allVenueUrls.size}   `);

      // Save progress after each city so Phase 1 is resumable
      saveProgress({ urls: [...allVenueUrls], processedUrls: [] });
    }

    console.log(`\n\nTotal unique venue URLs found: ${allVenueUrls.size}`);
  }

  // ── Phase 2: Fetch each venue page + write to DynamoDB inline ────────────

  console.log('\nPhase 2: Fetching venue profiles...');
  const venueUrlList = [...allVenueUrls].filter(u => !processedUrls.has(u));
  const venues = [...resumedVenues];
  let fetched = 0, failed = 0, withWebsite = 0;

  withWebsite = venues.filter(v => v.website).length;

  for (let i = 0; i < venueUrlList.length; i++) {
    const venueUrl = venueUrlList[i];
    const fullUrl  = `https://www.skiddle.com${venueUrl}`;
    const { html } = await fetchHtmlTracked(fullUrl);

    let venue = null;
    if (html) venue = extractVenueData(html, venueUrl);

    if (venue) {
      venues.push(venue);
      if (venue.website) withWebsite++;
      fetched++;

      // Write to DynamoDB immediately (unless dry run)
      if (!DRY_RUN) {
        try {
          await upsertVenue(venue);
        } catch (e) {
          if (failed <= 5) console.error(`\n  DynamoDB error for ${venue.name}: ${e.message}`);
        }
      }
    } else {
      failed++;
    }

    processedUrls.add(venueUrl);

    // Flush cache and progress every 25 venues
    if ((i + 1) % 25 === 0 || i === venueUrlList.length - 1) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(venues, null, 2));
      saveProgress({ urls: [...allVenueUrls], processedUrls: [...processedUrls] });
      process.stdout.write(
        `\r  [${processedUrls.size}/${allVenueUrls.size}] Profiled: ${fetched} | With website: ${withWebsite} | Failed: ${failed}   `
      );
    }

    await sleep(500);
  }

  console.log(`\n\nVenues scraped     : ${venues.length}`);
  console.log(`With website URL   : ${withWebsite}`);
  console.log(`Failed/skipped     : ${failed}`);
  console.log(`\nSaved to ${CACHE_FILE}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: skipping DynamoDB writes');
    console.log('\nSample venues with websites:');
    venues.filter(v => v.website).slice(0, 15).forEach(v =>
      console.log(`  [${String(v.skiddleId).padEnd(6)}] ${v.name.padEnd(40)} ${(v.city||'').padEnd(20)} ${v.website}`)
    );
  } else {
    console.log(`\n✓ Done — all venues written to DynamoDB incrementally`);
  }

  // Clean up progress file on successful completion
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  console.log('Progress file cleared.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
