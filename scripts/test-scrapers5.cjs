#!/usr/bin/env node
async function test() {
  // RA - fix the EventListing fields — introspect the actual type
  const r = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
    body: JSON.stringify({ query: `query { __type(name: "EventListing") { fields { name type { name kind ofType { name } } } } }` }),
  });
  const d = await r.json();
  console.log('RA EventListing fields:', d?.data?.__type?.fields?.map(f => f.name));

  // Also check IntFilterInputDtoInput to understand its structure
  const r2 = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
    body: JSON.stringify({ query: `query { __type(name: "AreaFilterInputDtoInput") { inputFields { name type { name kind } } } }` }),
  });
  const d2 = await r2.json();
  console.log('RA AreaFilterInput fields:', d2?.data?.__type?.inputFields?.map(f => f.name));

  // Eventbrite - check if there are more events per page via __SERVER_DATA__
  const eb = await fetch('https://www.eventbrite.co.uk/d/united-kingdom/music/?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  if (eb.ok) {
    const html = await eb.text();
    const m = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});\s*<\/script>/);
    if (m) {
      const data = JSON.parse(m[1]);
      // Walk the tree to find events
      const str = JSON.stringify(data);
      // Find event names
      const names = str.match(/"name":\s*"([^"]{5,80})"/g)?.slice(0,10);
      console.log('\nEB SERVER_DATA names:', names);
      const topKeys = Object.keys(data);
      console.log('EB top keys:', topKeys);
      for (const k of topKeys) {
        if (typeof data[k] === 'object' && data[k]) {
          const sub = Object.keys(data[k]);
          if (sub.length < 20) console.log(`  ${k}:`, sub);
        }
      }
    }
  }
}
test().catch(console.error);
