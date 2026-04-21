#!/usr/bin/env node
async function test() {
  // RA - try the `location` and `name` filter fields from the schema
  // Also try ra.co/events/uk to get the area slug used
  const tests = [
    { filters: { location: "United Kingdom", listingDate: { gte: "2026-04-05" } } },
    { filters: { areas: { name: "United Kingdom" }, listingDate: { gte: "2026-04-05" } } },
    { filters: { areas: { slug: "uk" }, listingDate: { gte: "2026-04-05" } } },
  ];
  for (const variables of tests) {
    const r = await fetch('https://ra.co/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
      body: JSON.stringify({
        query: `query GetListings($filters: FilterInputDtoInput) { eventListings(filters: $filters, pageSize: 3, page: 1) { data { id title date } } }`,
        variables,
      }),
    });
    const d = await r.json();
    const events = d?.data?.eventListings?.data;
    console.log('RA', JSON.stringify(variables.filters).substring(0, 60), '->', events ? `${events.length} events` : d?.errors?.[0]?.message?.substring(0, 80));
    if (events?.length) events.forEach(e => console.log(' ', e.title, e.date));
  }

  // WGT - check homepage for event links and structure
  const wgt = await fetch('https://www.wegottickets.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  if (wgt.ok) {
    const html = await wgt.text();
    // Look for any links to events
    const allLinks = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(l => l.includes('event') || l.includes('ticket') || l.includes('gig'));
    console.log('\nWGT links with event/ticket/gig:', allLinks.slice(0, 10));
    // Look for any date patterns
    const dates = html.match(/\b(April|May|June|July|August|September|October|November|December|January|February|March)\s+\d{1,2},?\s+202[5-9]/gi);
    console.log('WGT date patterns:', dates?.slice(0,5));
  }

  // Eventbrite - get full name from URL slug
  const eb = await fetch('https://www.eventbrite.co.uk/d/united-kingdom/music/?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  if (eb.ok) {
    const html = await eb.text();
    const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    let eventCount = 0;
    for (const [, json] of ldBlocks) {
      try {
        const d = JSON.parse(json);
        if (d.itemListElement) {
          d.itemListElement.slice(0, 3).forEach(item => {
            const ev = item.item || item;
            // Extract artist name from URL slug
            const urlSlug = (ev.url || '').match(/\/e\/([^\/\?]+)/)?.[1] || '';
            // Get name from description or URL
            const nameParts = urlSlug.split('-tickets-')[0].replace(/-/g, ' ');
            console.log(`EB event: "${nameParts}" | ${ev.startDate} | ${ev.url?.substring(0,60)}`);
            eventCount++;
          });
        }
      } catch {}
    }
    console.log('Eventbrite total JSON-LD events:', eventCount);
  }
}
test().catch(console.error);
