#!/usr/bin/env node
async function test() {
  // Songkick UK metro areas - get all events per city (much faster than per-artist)
  const metros = [
    { id: 24426, name: 'London' },
    { id: 24417, name: 'Manchester' },
    { id: 24418, name: 'Birmingham' },
    { id: 24415, name: 'Bristol' },
    { id: 24416, name: 'Glasgow' },
    { id: 24454, name: 'Leeds' },
    { id: 24456, name: 'Edinburgh' },
    { id: 24428, name: 'Brighton' },
    { id: 24440, name: 'Newcastle' },
    { id: 24452, name: 'Liverpool' },
    { id: 24449, name: 'Sheffield' },
    { id: 24426, name: 'Nottingham' }, // might have a diff ID
  ];

  for (const metro of metros.slice(0, 5)) {
    const url = `https://www.songkick.com/metro-areas/${metro.id}/calendar`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' } });
    console.log(`${metro.name} (${metro.id}): ${r.status}`);
    if (r.ok) {
      const html = await r.text();
      const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      let eventCount = 0;
      for (const [, json] of ldBlocks) {
        try {
          const d = JSON.parse(json);
          if (Array.isArray(d)) eventCount += d.filter(e => e['@type'] === 'MusicEvent').length;
          else if (d['@type'] === 'MusicEvent') eventCount++;
        } catch {}
      }
      console.log(`  Events in JSON-LD: ${eventCount}`);
      // Sample first event
      if (ldBlocks.length) {
        try {
          const d = JSON.parse(ldBlocks[0][1]);
          const ev = Array.isArray(d) ? d[0] : d;
          if (ev) console.log(`  Sample: "${ev.name}" on ${ev.startDate?.split('T')[0]}`);
        } catch {}
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Ticketweb music URL
  const tw = await fetch('https://www.ticketweb.uk/search?q=music&page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }
  });
  console.log('\nTicketweb music search:', tw.status);
  if (tw.ok) {
    const html = await tw.text();
    const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    let musicEvents = 0;
    for (const [, json] of ldBlocks) {
      try {
        const d = JSON.parse(json);
        const arr = Array.isArray(d) ? d : [d];
        for (const ev of arr) {
          if (ev['@type'] === 'MusicEvent') {
            musicEvents++;
            if (musicEvents <= 3) console.log(`  MusicEvent: "${ev.name}" | ${ev.startDate?.split('T')[0]}`);
          }
        }
      } catch {}
    }
    console.log(`  Total MusicEvent entries: ${musicEvents}`);
    // Try to find all events via a broader search
    const allEvents = html.match(/"@type":"MusicEvent"/g);
    console.log('  "@type":"MusicEvent" occurrences:', allEvents?.length);
  }

  // Ticketweb with genre=music
  const tw2 = await fetch('https://www.ticketweb.uk/genre/music?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }
  });
  console.log('\nTicketweb /genre/music:', tw2.status);
  if (tw2.ok) {
    const html = await tw2.text();
    const allEvents = html.match(/"@type":"MusicEvent"/g);
    console.log('  MusicEvent count:', allEvents?.length);
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    console.log('  JSON-LD blocks:', ld?.length);
  }
}
test().catch(console.error);
