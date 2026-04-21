#!/usr/bin/env node
async function test() {
  const r = await fetch('https://www.skiddle.com/whats-on/venues/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  const html = await r.text();

  // Parse __NEXT_DATA__ fully
  const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextData) {
    const d = JSON.parse(nextData[1]);
    const props = d.props?.pageProps;
    console.log('pageProps keys:', Object.keys(props || {}));

    // Walk the tree for venue arrays
    function walk(obj, path = '', depth = 0) {
      if (depth > 5 || !obj || typeof obj !== 'object') return;
      if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
        const keys = Object.keys(obj[0] || {});
        if (keys.some(k => ['name','venue','id','slug','title'].includes(k))) {
          console.log(`Array[${obj.length}] at ${path}: keys=${keys.slice(0,8)}`);
          if (obj[0]) console.log('  sample:', JSON.stringify(obj[0]).substring(0, 200));
        }
        return;
      }
      for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`, depth + 1);
    }
    walk(props);
  }

  // Check if there's an API endpoint in the network calls
  // Look for fetch/XHR patterns in the HTML
  const apiCalls = html.match(/api\.skiddle\.com[^"'\s]*/g);
  console.log('\nAPI calls found:', [...new Set(apiCalls || [])].slice(0, 10));

  // Look for the venue listing API endpoint in the page JS
  const venueApi = html.match(/\/api\/v1\/venues[^"'\s]*/g);
  console.log('Venue API paths:', [...new Set(venueApi || [])].slice(0, 5));

  // Check if there's pagination data
  const paginationMatch = html.match(/"totalPages?"\s*:\s*(\d+)/);
  const totalMatch = html.match(/"total(?:Count|Venues|Results)?"\s*:\s*(\d+)/i);
  console.log('Total pages:', paginationMatch?.[1]);
  console.log('Total count:', totalMatch?.[0]);
}
test().catch(console.error);
