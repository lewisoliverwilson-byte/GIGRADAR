#!/usr/bin/env node
async function test() {
  // RA - try area filter with UK area IDs (RA uses numeric area IDs)
  // ra.co/events/uk is area 13 in RA's system
  for (const areaId of [13, '13']) {
    const r = await fetch('https://ra.co/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
      body: JSON.stringify({ query: `query { eventListings(filters: { areas: { id: ${areaId} }, listingDate: { gte: "2026-04-05" } }, pageSize: 5, page: 1) { data { id title date venue { name area { name } } } } }` }),
    });
    const d = await r.json();
    const events = d?.data?.eventListings?.data;
    console.log(`RA area ${areaId}:`, events ? `${events.length} events` : d?.errors?.[0]?.message);
    if (events?.length) console.log('  Sample:', events[0].title, events[0].date);
  }

  // WGT - try different paths
  for (const path of ['/browse/all', '/events', '/search?q=music', '/']) {
    const r = await fetch('https://www.wegottickets.com' + path, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
    });
    console.log(`WGT ${path}:`, r.status);
    if (r.ok) {
      const html = await r.text();
      const eventLinks = html.match(/href="\/event\/\d+[^"]*"/g);
      console.log('  event links:', eventLinks?.length || 0, eventLinks?.slice(0,2));
      const hasEventTitle = html.includes('event-title') || html.includes('event_title') || html.includes('EventTitle');
      console.log('  has title class:', hasEventTitle);
    }
  }

  // Eventbrite - get full JSON-LD structure
  const eb = await fetch('https://www.eventbrite.co.uk/d/united-kingdom/music/?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  if (eb.ok) {
    const html = await eb.text();
    const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    for (const [, json] of ldBlocks) {
      try {
        const d = JSON.parse(json);
        if (d.itemListElement) {
          console.log('\nEventbrite itemList, first 2 items:');
          d.itemListElement.slice(0, 2).forEach(item => {
            console.log(JSON.stringify(item.item || item).substring(0, 300));
          });
        }
      } catch {}
    }
  }
}
test().catch(console.error);
