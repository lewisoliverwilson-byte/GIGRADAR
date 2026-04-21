#!/usr/bin/env node
async function test() {
  // RA - EventListing has id, listingDate, event — query via .event sub-field
  const r = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
    body: JSON.stringify({ query: `query { __type(name: "Event") { fields { name type { name kind ofType { name } } } } }` }),
  });
  const d = await r.json();
  console.log('RA Event fields:', d?.data?.__type?.fields?.map(f => f.name));

  // Try querying with event sub-field
  const r2 = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
    body: JSON.stringify({
      query: `query { eventListings(filters: { areas: { slug: "uk" }, listingDate: { gte: "2026-04-05" } }, pageSize: 5, page: 1) { data { id listingDate event { id title date venue { name area { name } } artists { name } ticketLink } } } }`,
    }),
  });
  const d2 = await r2.json();
  const listings = d2?.data?.eventListings?.data;
  console.log('\nRA listings (slug=uk):', listings ? `${listings.length} results` : JSON.stringify(d2?.errors?.[0]?.message).substring(0,100));
  if (listings?.length) listings.slice(0,3).forEach(l => console.log(' ', l.event?.title, l.event?.date));

  // Try with IntFilterInputDtoInput introspection for areas
  const r3 = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
    body: JSON.stringify({ query: `{ __type(name: "FilterInputDtoInput") { inputFields { name type { name kind ofType { name kind } } } } }` }),
  });
  const d3 = await r3.json();
  console.log('\nRA full filter fields:');
  d3?.data?.__type?.inputFields?.forEach(f => console.log(`  ${f.name}: ${f.type.name || f.type.ofType?.name} (${f.type.kind})`));

  // Eventbrite __SERVER_DATA__ full dump
  const eb = await fetch('https://www.eventbrite.co.uk/d/united-kingdom/music/?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  if (eb.ok) {
    const html = await eb.text();
    const m = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});\s*<\/script>/);
    if (m) {
      const data = JSON.parse(m[1]);
      console.log('\nEB top-level keys:', Object.keys(data));
      // Walk to find event arrays
      function findArrays(obj, path = '', depth = 0) {
        if (depth > 4) return;
        if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
          console.log(`  Array at ${path}: ${obj.length} items, keys: ${Object.keys(obj[0]).slice(0,8).join(',')}`);
          return;
        }
        if (typeof obj === 'object' && obj) {
          for (const [k, v] of Object.entries(obj)) {
            findArrays(v, `${path}.${k}`, depth + 1);
          }
        }
      }
      findArrays(data);
    }
  }
}
test().catch(console.error);
