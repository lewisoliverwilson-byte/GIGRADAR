#!/usr/bin/env node
async function test() {
  const r = await fetch('https://www.skiddle.com/whats-on/venues/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  const html = await r.text();

  // Look for venue links like /whats-on/events/venues/{slug}/
  const venueLinks = [...html.matchAll(/href="\/whats-on\/events\/venues\/([^/"]+)\//g)];
  const uniqueSlugs = [...new Set(venueLinks.map(m => m[1]))];
  console.log('Unique venue slugs:', uniqueSlugs.length);
  console.log('Sample slugs:', uniqueSlugs.slice(0, 10));

  // Look for venue IDs in the HTML
  const venueIds = [...html.matchAll(/\/venues\/(\d+)/g)];
  const uniqueIds = [...new Set(venueIds.map(m => m[1]))];
  console.log('\nUnique venue IDs:', uniqueIds.length);
  console.log('Sample IDs:', uniqueIds.slice(0, 10));

  // Look for JSON data embedded in the page
  const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextData) {
    const d = JSON.parse(nextData[1]);
    console.log('\n__NEXT_DATA__ keys:', Object.keys(d));
    console.log('props keys:', Object.keys(d.props || {}));
  }

  // Look for window.__data or similar
  const windowData = html.match(/window\.__([A-Z_]+)\s*=\s*({[\s\S]{0,2000}?});/g);
  console.log('\nWindow vars:', windowData?.map(m => m.substring(0, 50)));

  // Look at a venue page directly
  if (uniqueSlugs.length > 0) {
    const slug = uniqueSlugs[0];
    const vr = await fetch(`https://www.skiddle.com/whats-on/events/venues/${slug}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
    });
    if (vr.ok) {
      const vhtml = await vr.text();
      // Look for website URL
      const website = vhtml.match(/(?:website|official site)[^<]*href="([^"]+)"/i);
      const phone = vhtml.match(/tel:([^"]+)/);
      console.log('\nVenue page for', slug);
      console.log('  Website:', website?.[1]);
      console.log('  Phone:', phone?.[1]);
      // Look for JSON-LD
      const ld = vhtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (ld) { try { const d = JSON.parse(ld[1]); console.log('  JSON-LD:', JSON.stringify(d).substring(0,300)); } catch {} }
    }
  }
}
test().catch(console.error);
