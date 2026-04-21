#!/usr/bin/env node
async function test() {
  // Check a specific Skiddle venue page
  // Skiddle venue URL format: /whats-on/{city}/{venue-name}/
  // Let's try a known venue - The Boiler Room Guildford
  const testVenues = [
    'https://www.skiddle.com/whats-on/Guildford/The-Boiler-Room/',
    'https://www.skiddle.com/whats-on/London/Fabric/',
    'https://www.skiddle.com/whats-on/Manchester/The-Warehouse-Project/',
    'https://www.skiddle.com/whats-on/Bristol/Thekla/',
  ];

  for (const url of testVenues) {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
    });
    console.log(url.split('skiddle.com')[1], '->', r.status);
    if (r.ok) {
      const html = await r.text();
      // Look for website link
      const websiteMatch = html.match(/(?:website|official)[^<]{0,100}href="(https?:\/\/(?!(?:www\.)?skiddle)[^"]+)"/i) ||
                           html.match(/href="(https?:\/\/(?!(?:www\.)?skiddle)[^"]+)"[^>]*>(?:visit|website|official)/i);
      console.log('  Website:', websiteMatch?.[1]);
      // Look in JSON-LD
      const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
      for (const block of (ld || [])) {
        try {
          const d = JSON.parse(block.replace(/<script[^>]*>|<\/script>/g,''));
          if (d['@type'] === 'MusicVenue' || d.name || d.url) {
            console.log('  JSON-LD:', JSON.stringify(d).substring(0, 300));
          }
        } catch {}
      }
      // Look for __NEXT_DATA__ venue info
      const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nd) {
        const d = JSON.parse(nd[1]);
        const pp = d.props?.pageProps;
        if (pp) {
          // Find website in pageProps
          const str = JSON.stringify(pp);
          const websiteInData = str.match(/"(?:website|websiteUrl|externalUrl|contactWebsite)"\s*:\s*"([^"]+)"/);
          console.log('  Website in data:', websiteInData?.[1]);
          // Find venue name
          const venueName = str.match(/"(?:venueName|venue_name)"\s*:\s*"([^"]+)"/);
          console.log('  Venue name in data:', venueName?.[1]);
          console.log('  pageProps keys:', Object.keys(pp).slice(0, 15));
        }
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Also check if there's a city-based listing we can paginate
  const cityUrl = 'https://www.skiddle.com/whats-on/London/';
  const cr = await fetch(cityUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }
  });
  console.log('\nLondon city page:', cr.status);
  if (cr.ok) {
    const html = await cr.text();
    // Find venue links
    const venueLinks = [...html.matchAll(/href="\/whats-on\/London\/([^/"]+)\/"/g)];
    const venues = [...new Set(venueLinks.map(m => m[1]))];
    console.log('  Venue links found:', venues.length, venues.slice(0,5));
  }
}
test().catch(console.error);
