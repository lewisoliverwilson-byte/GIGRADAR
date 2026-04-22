import React from 'react';
import Link from 'next/link';
import { useFollow } from '../context/FollowContext.jsx';
import Footer from '../components/Footer.jsx';

const SELLER_LABELS = {
  'Ticketmaster': 'Ticketmaster', 'Bandsintown': 'Bandsintown',
  'Skiddle': 'Skiddle', 'DICE': 'DICE', 'See Tickets': 'See Tickets',
  'Gigantic': 'Gigantic', 'WeGotTickets': 'WeGotTickets',
  'Eventbrite': 'Eventbrite', 'Resident Advisor': 'Resident Advisor',
  'Songkick': 'Songkick', 'Ticketline': 'Ticketline',
  'Fatsoma': 'Fatsoma', 'Ents24': 'Ents24',
};

function parsePrice(priceStr) {
  if (!priceStr || priceStr === 'See site' || priceStr === 'See venue') return null;
  if (priceStr === 'Free') return 0;
  const m = priceStr.match(/£([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function formatDate(dateStr) {
  if (!dateStr) return 'Date TBC';
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return dateStr; }
}

export default function GigDetail({ gig }) {
  const { following, toggleFollow } = useFollow();

  if (!gig) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-5xl mb-4">🎵</p>
          <h1 className="text-2xl font-black text-white mb-2">Gig not found</h1>
          <p className="text-zinc-400 text-sm mb-6">This gig may have been removed or doesn't exist.</p>
          <Link href="/gigs" className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm">
            Browse all gigs
          </Link>
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const isPast = gig.date && gig.date < today;
  const tickets = gig.tickets || [];
  const isSoldOut = !isPast && (gig.isSoldOut || (tickets.length > 0 && tickets.every(t => !t.available)));

  const sellerMap = new Map();
  for (const t of tickets) {
    if (!t.url || t.url === '#' || t.seller === 'Setlist.fm') continue;
    if (!t.available && t.available !== undefined) continue;
    const existing = sellerMap.get(t.seller);
    const tPrice = parsePrice(t.price);
    const exPrice = existing ? parsePrice(existing.price) : null;
    if (!existing || (tPrice !== null && (exPrice === null || tPrice < exPrice))) {
      sellerMap.set(t.seller, { ...t, _parsedPrice: tPrice });
    }
  }
  const buyLinks = [...sellerMap.values()].sort((a, b) => {
    if (a._parsedPrice !== null && b._parsedPrice !== null) return a._parsedPrice - b._parsedPrice;
    if (a._parsedPrice !== null) return -1;
    if (b._parsedPrice !== null) return 1;
    return 0;
  });

  const isFollowing = following.has(gig.artistId);
  const d = gig.date ? new Date(gig.date + 'T12:00:00') : null;

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="flex items-center gap-2 text-sm text-zinc-500 mb-4">
            <Link href="/gigs" className="hover:text-white transition-colors">Gigs</Link>
            <span>/</span>
            {gig.artistId && (
              <>
                <Link href={`/artists/${gig.artistId}`} className="hover:text-white transition-colors capitalize">
                  {gig.artistName || gig.artistId.replace(/-/g, ' ')}
                </Link>
                <span>/</span>
              </>
            )}
            <span className="text-zinc-400">{gig.date}</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-black text-white capitalize mb-1">
                {gig.artistName || (gig.artistId || '').replace(/-/g, ' ')}
              </h1>
              <p className="text-lg text-zinc-300">
                {gig.venueName || 'Venue TBC'}
                {gig.venueCity ? `, ${gig.venueCity}` : ''}
              </p>
            </div>
            {gig.artistId && (
              <button
                onClick={() => toggleFollow(gig.artistId, 'artist', gig.artistName)}
                className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                  isFollowing
                    ? 'bg-violet-600 border-violet-500 text-white hover:bg-violet-700'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-violet-500 hover:text-violet-300'
                }`}>
                {isFollowing ? '✓ Following' : '+ Follow artist'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Main info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Date & venue card */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Event details</h2>

              <div className="flex items-start gap-4">
                {d && (
                  <div className="w-14 h-14 rounded-xl bg-zinc-800 flex flex-col items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                      {d.toLocaleDateString('en-GB', { month: 'short' })}
                    </span>
                    <span className="text-2xl font-black text-white leading-none">{d.getDate()}</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                      {d.toLocaleDateString('en-GB', { weekday: 'short' })}
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-white font-semibold">{formatDate(gig.date)}</p>
                  {gig.doorsOpen && <p className="text-sm text-zinc-400 mt-0.5">Doors: {gig.doorsOpen}</p>}
                  {isPast && <span className="inline-block mt-1 text-xs font-semibold text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-lg">Past event</span>}
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Venue</p>
                {gig.canonicalVenueId ? (
                  <Link href={`/venues/${gig.canonicalVenueId}`} className="text-white font-semibold hover:text-violet-400 transition-colors">
                    {gig.venueName || 'Venue TBC'}
                  </Link>
                ) : (
                  <p className="text-white font-semibold">{gig.venueName || 'Venue TBC'}</p>
                )}
                {gig.venueCity && <p className="text-sm text-zinc-400 mt-0.5">{gig.venueCity}</p>}
                {gig.venueAddress && <p className="text-xs text-zinc-500 mt-0.5">{gig.venueAddress}</p>}
              </div>

              {gig.genre && (
                <div className="border-t border-zinc-800 pt-4">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Genre</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Array.isArray(gig.genre) ? gig.genre : [gig.genre]).map(g => (
                      <Link key={g} href={`/gigs?genre=${encodeURIComponent(g)}`}
                        className="text-xs px-2.5 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 hover:text-white hover:border-zinc-500 capitalize transition-colors">
                        {g}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Ticket sources */}
            {!isPast && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">Tickets</h2>

                {isSoldOut ? (
                  <p className="text-red-400 font-bold">Sold out</p>
                ) : gig.isFreeEntry ? (
                  <div>
                    <p className="text-emerald-400 font-bold text-lg mb-2">Free entry</p>
                    {gig.ticketUrl && (
                      <a href={gig.ticketUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors">
                        More info →
                      </a>
                    )}
                  </div>
                ) : gig.ticketType === 'door' ? (
                  <p className="text-amber-400 font-semibold">Pay on door</p>
                ) : buyLinks.length > 0 ? (
                  <div className="space-y-2">
                    {buyLinks.length >= 2 && (
                      <p className="text-xs text-zinc-500 mb-3">Compare prices across {buyLinks.length} sellers</p>
                    )}
                    {buyLinks.map((t, i) => {
                      const isCheapest = buyLinks.length >= 2 && i === 0 && t._parsedPrice !== null;
                      return (
                        <a key={i} href={t.url} target="_blank" rel="noopener noreferrer"
                          className={`flex items-center justify-between w-full px-4 py-3 rounded-xl border font-semibold text-sm transition-colors ${
                            isCheapest
                              ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300 hover:bg-emerald-700 hover:text-white'
                              : 'bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700 hover:border-zinc-500'
                          }`}>
                          <span className="flex items-center gap-2">
                            {isCheapest && <span className="text-xs font-bold text-emerald-400 bg-emerald-900/60 px-1.5 py-0.5 rounded">Cheapest</span>}
                            {SELLER_LABELS[t.seller] || t.seller}
                          </span>
                          <span className={isCheapest ? 'text-emerald-300' : 'text-zinc-300'}>
                            {t._parsedPrice === 0 ? 'Free' : t._parsedPrice !== null
                              ? `£${t._parsedPrice % 1 === 0 ? t._parsedPrice : t._parsedPrice.toFixed(2)}`
                              : t.price || 'See site'}
                            <span className="ml-2 text-zinc-500">→</span>
                          </span>
                        </a>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">No ticket links available. Check the venue website.</p>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {gig.artistId && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Artist</h3>
                <Link href={`/artists/${gig.artistId}`}
                  className="font-bold text-white hover:text-violet-400 transition-colors capitalize text-lg block mb-1">
                  {gig.artistName || gig.artistId.replace(/-/g, ' ')}
                </Link>
                {gig.genre && (
                  <p className="text-xs text-zinc-500 capitalize mb-3">
                    {Array.isArray(gig.genre) ? gig.genre[0] : gig.genre}
                  </p>
                )}
                <Link href={`/artists/${gig.artistId}`}
                  className="text-sm text-violet-400 hover:text-violet-300 transition-colors">
                  View all gigs →
                </Link>
              </div>
            )}

            {gig.canonicalVenueId && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Venue</h3>
                <Link href={`/venues/${gig.canonicalVenueId}`}
                  className="font-bold text-white hover:text-violet-400 transition-colors text-base block mb-1">
                  {gig.venueName}
                </Link>
                {gig.venueCity && <p className="text-xs text-zinc-500 mb-3">{gig.venueCity}</p>}
                <Link href={`/venues/${gig.canonicalVenueId}`}
                  className="text-sm text-violet-400 hover:text-violet-300 transition-colors">
                  View venue →
                </Link>
              </div>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Share</h3>
              <div className="space-y-2">
                <button
                  onClick={() => navigator.clipboard?.writeText(window.location.href)}
                  className="w-full text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white font-medium px-4 py-2 rounded-xl transition-colors text-left">
                  Copy link
                </button>
                <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${gig.artistName} at ${gig.venueName}, ${gig.venueCity} — ${formatDate(gig.date)}`)}&url=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="block w-full text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white font-medium px-4 py-2 rounded-xl transition-colors">
                  Share on Twitter
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
