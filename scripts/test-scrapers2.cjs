#!/usr/bin/env node
async function test() {
  // 1. RA - introspect the schema to find valid filter fields
  const ra = await fetch('https://ra.co/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://ra.co/events/uk' },
    body: JSON.stringify({ query: `query { __type(name: "FilterInputDtoInput") { inputFields { name type { name kind } } } }` }),
  });
  const rad = await ra.json();
  console.log('RA FilterInput fields:', JSON.stringify(rad?.data?.__type?.inputFields?.map(f => f.name)));

  // 2. Eventbrite - find event data in __SERVER_DATA__
  const eb = await fetch('https://www.eventbrite.co.uk/d/united-kingdom/music/?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  if (eb.ok) {
    const html = await eb.text();
    const m = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});\s*<\/script>/);
    if (m) {
      try {
        const d = JSON.parse(m[1]);
        console.log('\nEventbrite SERVER_DATA top keys:', Object.keys(d));
        // Find where events are
        const str = JSON.stringify(d);
        const evIdx = str.indexOf('"events"');
        if (evIdx > -1) console.log('events context:', str.substring(evIdx, evIdx + 300));
        // Try search_data path
        const sd = d?.search_data || d?.data || d?.pageProps;
        console.log('search_data keys:', sd ? Object.keys(sd) : 'not found');
      } catch(e) { console.log('Parse error:', e.message); }
    } else {
      // Try JSON-LD
      const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
      console.log('\nEventbrite JSON-LD blocks:', ld?.length);
      if (ld?.[0]) {
        try { const d = JSON.parse(ld[0].replace(/<script[^>]*>|<\/script>/g,'')); console.log('First LD:', JSON.stringify(d).substring(0,400)); } catch {}
      }
    }
  }

  // 3. WeGotTickets - check current HTML structure
  const wgt = await fetch('https://www.wegottickets.com/searchresults/page/1/all', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  if (wgt.ok) {
    const html = await wgt.text();
    // Find first event block
    const bodyStart = html.indexOf('<body');
    const snippet = html.substring(bodyStart, bodyStart + 5000);
    console.log('\nWGT body start:', snippet.replace(/\s+/g, ' ').substring(0, 1000));
    // Look for any anchor with event-like content
    const links = html.match(/href="\/event\/[^"]+"/g);
    console.log('WGT event links:', links?.slice(0,5));
  }
}
test().catch(console.error);
