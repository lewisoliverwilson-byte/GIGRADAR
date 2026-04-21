#!/usr/bin/env node
// Find the working Dice.fm endpoint
async function test() {
  // Try the web app's API calls
  const endpoints = [
    'https://api.dice.fm/events?types=linkout,event&country_codes[]=GB&page=1&per_page=10',
    'https://dice.fm/_rsc?country_codes[]=GB',
    'https://api.dice.fm/v1/events?country_codes[]=GB&per_page=10',
    'https://dice.fm/api/v1/countries/GB/events?per_page=10',
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/120' } });
      console.log(url.split('dice.fm')[1].substring(0,40), '->', r.status, r.headers.get('content-type'));
      if (r.ok) {
        const text = await r.text();
        console.log('  preview:', text.substring(0, 200));
      }
    } catch(e) { console.log('error:', e.message); }
  }

  // Also try Dice frontend to find their API calls
  const page = await fetch('https://dice.fm/browse/music?country_codes[]=GB', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', Accept: 'text/html' }
  });
  console.log('\nDice browse page:', page.status);
  if (page.ok) {
    const html = await page.text();
    // Look for API endpoints in the JS
    const apis = html.match(/https:\/\/api\.dice\.fm\/[^"'\s]+/g);
    console.log('API URLs found:', [...new Set(apis)].slice(0, 10));
    const hasEvents = html.includes('"events"') || html.includes('MusicEvent');
    console.log('Has events data:', hasEvents);
    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (ldMatch) { try { const d = JSON.parse(ldMatch[1]); console.log('JSON-LD:', JSON.stringify(d).substring(0,200)); } catch {} }
  }
}
test().catch(console.error);
