#!/usr/bin/env node
async function test() {
  // Fatsoma - UK grassroots ticketing
  const fat = await fetch('https://www.fatsoma.com/events?country=GB&category=music&page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', Accept: 'text/html' }
  });
  console.log('Fatsoma:', fat.status);
  if (fat.ok) {
    const html = await fat.text();
    console.log('  Has JSON-LD:', html.includes('application/ld+json'));
    console.log('  Has event-card:', html.includes('event-card') || html.includes('EventCard'));
    console.log('  Has MusicEvent:', html.includes('MusicEvent'));
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (ld) { try { const d = JSON.parse(ld[1]); console.log('  LD:', JSON.stringify(d).substring(0,300)); } catch {} }
    const idx = html.indexOf('2026');
    if (idx > -1) console.log('  Date context:', html.substring(idx-100, idx+100).replace(/\s+/g,' '));
  }

  // Ticketweb UK
  const tw = await fetch('https://www.ticketweb.uk/search?q=&type=music&page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', Accept: 'text/html' }
  });
  console.log('\nTicketweb:', tw.status);
  if (tw.ok) {
    const html = await tw.text();
    console.log('  Has JSON-LD:', html.includes('application/ld+json'));
    console.log('  Has MusicEvent:', html.includes('MusicEvent'));
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    console.log('  LD blocks:', ld?.length);
    if (ld?.[0]) { try { const d = JSON.parse(ld[0].replace(/<script[^>]*>|<\/script>/g,'')); console.log('  LD:', JSON.stringify(d).substring(0,300)); } catch {} }
  }

  // AXS
  const axs = await fetch('https://www.axs.com/gb/search?q=music&pg=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }
  });
  console.log('\nAXS:', axs.status);

  // Ticketline (Scottish focused)
  const tl = await fetch('https://www.ticketline.co.uk/music/?page=1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }
  });
  console.log('\nTicketline:', tl.status);
  if (tl.ok) {
    const html = await tl.text();
    console.log('  Has JSON-LD:', html.includes('application/ld+json'));
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (ld) { try { const d = JSON.parse(ld[1]); console.log('  LD type:', d['@type'], d.length || d.itemListElement?.length); } catch {} }
  }

  // Songkick - check if it still works (top artist, different slug approach)
  const sk = await fetch('https://www.songkick.com/metro-areas/24426-uk-london/calendar', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' }
  });
  console.log('\nSongkick metro London:', sk.status);
  if (sk.ok) {
    const html = await sk.text();
    console.log('  Has JSON-LD:', html.includes('application/ld+json'));
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (ld) { try { const d = JSON.parse(ld[1]); console.log('  LD:', Array.isArray(d) ? d.length + ' events' : d['@type']); if (Array.isArray(d) && d[0]) console.log('  First:', JSON.stringify(d[0]).substring(0,200)); } catch {} }
  }
}
test().catch(console.error);
