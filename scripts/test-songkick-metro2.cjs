#!/usr/bin/env node
// Find working UK Songkick metro IDs and check Ticketweb pagination
async function test() {
  // Songkick - London works with /calendar. Try /gigography for upcoming
  const londonPages = [
    'https://www.songkick.com/metro-areas/24426/calendar',
    'https://www.songkick.com/metro-areas/24426/calendar?page=2',
    'https://www.songkick.com/metro-areas/24426/gigography?upcoming=true',
  ];
  for (const url of londonPages) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } });
    console.log(url.split('songkick.com')[1], '->', r.status);
    if (r.ok) {
      const html = await r.text();
      const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      let count = 0;
      for (const [, json] of ld) {
        try { const d = JSON.parse(json); count += Array.isArray(d) ? d.length : 1; } catch {}
      }
      console.log('  Events:', count);
    }
  }

  // Try to find other UK metro areas from Songkick sitemap/links
  const r = await fetch('https://www.songkick.com/metro-areas/24426/calendar', {
    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' }
  });
  if (r.ok) {
    const html = await r.text();
    // Find links to other UK metro areas
    const metroLinks = [...html.matchAll(/href="\/metro-areas\/(\d+)[-\/][^"]*(?:uk|manchester|glasgow|birmingham|bristol|leeds|edinburgh|newcastle|liverpool|sheffield|bristol)[^"]*"/gi)];
    console.log('\nOther UK metro links found:', metroLinks.map(m => m[0]).slice(0,10));
  }

  // Ticketweb - check multiple pages and find total event count
  let totalEvents = 0;
  for (let pg = 1; pg <= 3; pg++) {
    const r = await fetch(`https://www.ticketweb.uk/search?q=music&page=${pg}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' }
    });
    if (!r.ok) { console.log(`Ticketweb page ${pg}: ${r.status}`); break; }
    const html = await r.text();
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    let pageEvents = 0;
    for (const [, json] of ld) {
      try {
        const d = JSON.parse(json);
        const arr = Array.isArray(d) ? d : [d];
        pageEvents += arr.filter(e => e['@type'] === 'MusicEvent').length;
      } catch {}
    }
    totalEvents += pageEvents;
    console.log(`Ticketweb page ${pg}: ${pageEvents} MusicEvents`);
    await new Promise(r => setTimeout(r, 500));
  }

  // Ticketweb - try UK-wide search without genre filter
  const tw = await fetch('https://www.ticketweb.uk/search?q=&page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' }
  });
  console.log('\nTicketweb q= (all):', tw.status);
  if (tw.ok) {
    const html = await tw.text();
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    let count = 0;
    for (const [, json] of ld) {
      try { const d = JSON.parse(json); const a = Array.isArray(d) ? d : [d]; count += a.length; } catch {}
    }
    console.log('  Total events:', count);
    // Get sample names
    for (const [, json] of ld.slice(0,1)) {
      try {
        const d = JSON.parse(json);
        const arr = Array.isArray(d) ? d : [d];
        arr.slice(0,5).forEach(e => console.log(`  ${e['@type']}: ${e.name} | ${e.startDate?.split('T')[0]}`));
      } catch {}
    }
  }
}
test().catch(console.error);
