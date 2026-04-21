#!/usr/bin/env node
async function test() {
  // Introspect IntFilterInputDtoInput
  const r = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
    body: JSON.stringify({ query: `{ __type(name: "IntFilterInputDtoInput") { inputFields { name type { name } } } }` }),
  });
  const d = await r.json();
  console.log('IntFilter fields:', d?.data?.__type?.inputFields?.map(f => f.name));

  // Try area with eq: 13 (common RA UK area ID)
  for (const areaId of [13, 1, 3, 8, 14]) {
    const r2 = await fetch('https://ra.co/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
      body: JSON.stringify({
        query: `query { eventListings(filters: { areas: { eq: ${areaId} }, listingDate: { gte: "2026-04-05" } }, pageSize: 3, page: 1) { data { id event { title date venue { name area { name } } } } } }`,
      }),
    });
    const d2 = await r2.json();
    const listings = d2?.data?.eventListings?.data;
    if (listings?.length) {
      console.log(`Area ${areaId} (${listings[0]?.event?.venue?.area?.name || '?'}): ${listings.length} events`);
      listings.slice(0,2).forEach(l => console.log(' ', l.event?.title, l.event?.date, l.event?.venue?.name));
    } else {
      console.log(`Area ${areaId}: no results`, d2?.errors?.[0]?.message?.substring(0,60) || '');
    }
  }

  // Try location filter for UK
  const r3 = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
    body: JSON.stringify({ query: `{ __type(name: "LocationFilterInputDtoInput") { inputFields { name type { name } } } }` }),
  });
  const d3 = await r3.json();
  console.log('\nLocationFilter fields:', d3?.data?.__type?.inputFields?.map(f => f.name));

  // Eventbrite - check __SERVER_DATA__ structure more carefully
  const eb = await fetch('https://www.eventbrite.co.uk/d/united-kingdom/music/?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  if (eb.ok) {
    const html = await eb.text();
    const m = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});\s*<\/script>/);
    if (m) {
      const data = JSON.parse(m[1]);
      // Deep search for arrays with 'name' fields that look like events
      function findEventArrays(obj, path = '', depth = 0) {
        if (depth > 6 || !obj || typeof obj !== 'object') return;
        if (Array.isArray(obj) && obj.length > 2) {
          const first = obj[0];
          if (first && typeof first === 'object' && (first.name || first.title || first.start)) {
            console.log(`Array[${obj.length}] at ${path}: keys=${Object.keys(first).slice(0,8)}`);
          }
        } else {
          for (const [k, v] of Object.entries(obj)) findEventArrays(v, `${path}.${k}`, depth + 1);
        }
      }
      findEventArrays(data);
    }
  }
}
test().catch(console.error);
