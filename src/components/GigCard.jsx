import React from 'react';
import Link from 'next/link';

const SELLER_LABELS = {
  'Ticketmaster': 'Ticketmaster', 'Bandsintown': 'Bandsintown',
  'Skiddle': 'Skiddle', 'Dice': 'Dice', 'See Tickets': 'See Tickets',
  'Gigantic': 'Gigantic', 'WeGotTickets': 'WeGotTickets',
  'Eventbrite': 'Eventbrite', 'Resident Advisor': 'RA',
  'Songkick': 'Songkick',
};

export default function GigCard({ gig, showArtist = false, distanceMiles, isGrassroots, grassroots }) {
  const showGrassroots = isGrassroots || grassroots || gig._isGrassroots;
  const tickets = gig.tickets || [];
  const today = new Date().toISOString().split('T')[0];
  const isPast = gig.date && gig.date < today;
  const isSoldOut = !isPast && (gig.isSoldOut || (tickets.length > 0 && tickets.every(t => !t.available)));

  const sellerMap = new Map();
  for (const t of tickets) {
    if (!t.available || !t.url || t.url === '#' || t.seller === 'Setlist.fm') continue;
    const existing = sellerMap.get(t.seller);
    if (!existing || (t.price && t.price !== 'See site' && (!existing.price || existing.price === 'See site'))) {
      sellerMap.set(t.seller, t);
    }
  }
  const buyLinks = [...sellerMap.values()];
  const d = gig.date ? new Date(gig.date + 'T12:00:00') : null;

  return (
    <div className={`flex bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-600 transition-colors ${isPast ? 'opacity-40' : ''}`}>
      {/* Date block */}
      <div className="w-16 shrink-0 flex flex-col items-center justify-center bg-zinc-800 border-r border-zinc-700 py-4 gap-0.5">
        {d ? (
          <>
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">
              {d.toLocaleDateString('en-GB', { month: 'short' })}
            </span>
            <span className="text-2xl font-black text-white leading-none">
              {d.getDate()}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">
              {d.toLocaleDateString('en-GB', { weekday: 'short' })}
            </span>
          </>
        ) : (
          <span className="text-xs text-zinc-500 font-medium">TBC</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center gap-1.5">
        {showArtist && gig.artistName && (
          <Link href={`/artists/${gig.artistId}`}
            className="font-bold text-sm text-white hover:text-violet-400 transition-colors truncate">
            {gig.artistName}
          </Link>
        )}
        <div className="min-w-0">
          <p className={`truncate ${showArtist ? 'text-xs text-zinc-400' : 'text-sm font-semibold text-white'}`}>
            {gig.venueName || 'Venue TBC'}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {gig.venueCity && <p className="text-xs text-zinc-500 truncate">{gig.venueCity}</p>}
            {distanceMiles != null && <span className="text-xs text-violet-400 font-medium">{distanceMiles} mi</span>}
            {showGrassroots && <span className="text-xs text-emerald-400 font-medium">Grassroots</span>}
          </div>
        </div>

        {isSoldOut ? (
          <span className="text-xs font-bold text-red-400 uppercase tracking-wide">Sold out</span>
        ) : isPast ? (
          <span className="text-xs text-zinc-600">Past event</span>
        ) : gig.isFreeEntry ? (
          <span className="text-xs font-semibold text-emerald-400">Free entry</span>
        ) : gig.ticketType === 'door' ? (
          <span className="text-xs font-semibold text-amber-400">Pay on door</span>
        ) : buyLinks.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 items-center">
            {gig.minPrice != null && gig.minPrice > 0 && !buyLinks.some(t => t.price && t.price !== 'See site') && (
              <span className="text-xs text-zinc-400 font-medium">from £{gig.minPrice % 1 === 0 ? gig.minPrice : gig.minPrice.toFixed(2)}</span>
            )}
            {gig.minPrice === 0 && <span className="text-xs font-semibold text-emerald-400">Free</span>}
            {buyLinks.slice(0, 4).map((t, i) => (
              <a key={i} href={t.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold bg-violet-900 text-violet-300 border border-violet-700 hover:bg-violet-600 hover:text-white hover:border-violet-600 rounded-lg px-2.5 py-1 transition-all whitespace-nowrap">
                {SELLER_LABELS[t.seller] || t.seller}
                {t.price && t.price !== 'See site' && <span className="text-violet-400 font-normal">· {t.price}</span>}
              </a>
            ))}
          </div>
        ) : (
          <span className="text-xs text-zinc-600">Check venue for tickets</span>
        )}
      </div>
    </div>
  );
}
