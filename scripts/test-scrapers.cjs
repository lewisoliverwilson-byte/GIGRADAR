#!/usr/bin/env node
async function test() {
  // 1. Dice - try different endpoints
  for (const url of [
    'https://api.dice.fm/v1/events?country_codes[]=GB&page=1&per_page=5',
    'https://dice.fm/api/v2/events?country_codes[]=GB&per_page=5',
  ]) {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } }).catch(e => ({ status: 'err', statusText: e.message }));
    console.log('Dice', url.split('dice.fm')[1].substring(0,30), '->', r.status, r.statusText || '');
    if (r.ok) { const d = await r.json(); console.log('  keys:', Object.keys(d)); }
  }

  // 2. RA - try different country filters
  const raQueries = [
    { query: `query { eventListings(filters: { countries: { isoCode: "GB" }, listingDate: { gte: "2026-04-05" } }, pageSize: 5, page: 1) { data { id title } } }` },
    { query: `query { eventListings(filters: { listingDate: { gte: "2026-04-05" }, country: "GB" }, pageSize: 5, page: 1) { data { id title } } }` },
  ];
  for (const body of raQueries) {
    const r = await fetch('https://ra.co/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    const events = d?.data?.eventListings?.data;
    console.log('RA query ->', events ? `${events.length} events` : JSON.stringify(d).substring(0, 150));
  }

  // 3. See Tickets
  const see = await fetch('https://www.seetickets.com/tour/search?q=&genre=music&country=GB&page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  console.log('\nSee Tickets:', see.status);
  if (see.ok) {
    const html = await see.text();
    console.log('  Has event-listing:', html.includes('event-listing'));
    console.log('  Has listingCard:', html.includes('listingCard') || html.includes('listing-card'));
    console.log('  Has JSON-LD:', html.includes('application/ld+json'));
    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (jsonLd) { try { const d = JSON.parse(jsonLd[1]); console.log('  JSON-LD type:', d['@type'], 'items:', d.length || d.itemListElement?.length); } catch {} }
    // Snippet around first event
    const idx = html.indexOf('2026-');
    if (idx > -1) console.log('  Date context:', html.substring(idx - 200, idx + 100).replace(/\s+/g, ' '));
  }

  // 4. Gigantic
  const gig = await fetch('https://www.gigantic.com/gigs-and-concerts?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  console.log('\nGigantic:', gig.status);
  if (gig.ok) {
    const html = await gig.text();
    console.log('  Has event-item:', html.includes('event-item'));
    console.log('  Has JSON-LD:', html.includes('application/ld+json'));
    console.log('  Has schema:', html.includes('MusicEvent') || html.includes('schema.org'));
    const idx = html.indexOf('2026-');
    if (idx > -1) console.log('  Date context:', html.substring(idx - 200, idx + 100).replace(/\s+/g, ' '));
  }

  // 5. WeGotTickets
  const wgt = await fetch('https://www.wegottickets.com/searchresults/page/1/all', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  console.log('\nWeGotTickets:', wgt.status, wgt.statusText);
  if (wgt.ok) {
    const html = await wgt.text();
    console.log('  Has event_title:', html.includes('event_title'));
    console.log('  Has JSON-LD:', html.includes('application/ld+json'));
    console.log('  HTML length:', html.length);
    const idx = html.indexOf('2026');
    if (idx > -1) console.log('  Context:', html.substring(idx - 200, idx + 200).replace(/\s+/g, ' '));
  }

  // 6. Eventbrite
  const eb = await fetch('https://www.eventbrite.co.uk/d/united-kingdom/music/?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  console.log('\nEventbrite:', eb.status);
  if (eb.ok) {
    const html = await eb.text();
    console.log('  Has __SERVER_DATA__:', html.includes('__SERVER_DATA__'));
    console.log('  Has __NEXT_DATA__:', html.includes('__NEXT_DATA__'));
    console.log('  Has JSON-LD:', html.includes('application/ld+json'));
    const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextData) { try { const d = JSON.parse(nextData[1]); console.log('  NEXT_DATA keys:', Object.keys(d)); } catch {} }
  }
}
test().catch(console.error);
