import React from 'react';
import Link from 'next/link';

const SELLER_LABELS = {
  'Ticketmaster': 'TM', 'Bandsintown': 'BIT',
  'Skiddle': 'Skiddle', 'DICE': 'DICE', 'See Tickets': 'See',
  'Gigantic': 'Gigantic', 'WeGotTickets': 'WGT',
  'Eventbrite': 'Eventbrite', 'Resident Advisor': 'RA',
  'Songkick': 'SK', 'Ticketline': 'TL',
  'Fatsoma': 'Fatsoma', 'Ents24': 'Ents24',
};

function parseTicketPrice(priceStr) {
  if (!priceStr || priceStr === 'See site' || priceStr === 'See venue') return null;
  if (priceStr === 'Free') return 0;
  const m = priceStr.match(/£([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

export default function GigCard({ gig, showArtist = false, distanceMiles, isGrassroots, grassroots }) {
  const showGrassroots = isGrassroots || grassroots || gig._isGrassroots;
  const tickets = gig.tickets || [];
  const today = new Date().toISOString().split('T')[0];
  const isPast = gig.date && gig.date < today;
  const isSoldOut = !isPast && (gig.isSoldOut || (tickets.length > 0 && tickets.every(t => !t.available)));

  const sellerMap = new Map();
  for (const t of tickets) {
    if (!t.url || t.url === '#' || t.seller === 'Setlist.fm') continue;
    if (!t.available && t.available !== undefined) continue;
    const existing = sellerMap.get(t.seller);
    const tPrice = parseTicketPrice(t.price);
    const exPrice = existing ? parseTicketPrice(existing.price) : null;
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
  const d = gig.date ? new Date(gig.date + 'T12:00:00') : null;

  return (
    <div className={`flex bg-black border-b border-zinc-900 hover:bg-zinc-950 transition-colors ${isPast ? 'opacity-30' : ''}`}>
      {/* Date */}
      <Link href={`/gig/${gig.gigId}`} className="w-14 shrink-0 flex flex-col items-center justify-center py-4 border-r border-zinc-900 hover:bg-zinc-950 transition-colors">
        {d ? (
          <>
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
              {d.toLocaleDateString('en-GB', { month: 'short' })}
            </span>
            <span className="font-display text-3xl text-white leading-none">
              {d.getDate()}
            </span>
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
              {d.toLocaleDateString('en-GB', { weekday: 'short' })}
            </span>
          </>
        ) : (
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">TBC</span>
        )}
      </Link>

      {/* Main info */}
      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center gap-0.5">
        {showArtist && gig.artistName && (
          <Link href={`/artists/${gig.artistId}`}
            className="font-black text-xs uppercase tracking-wide text-white hover:text-zinc-400 transition-colors truncate">
            {gig.artistName}
          </Link>
        )}
        <p className={`truncate ${showArtist ? 'text-xs text-zinc-500' : 'text-sm font-bold text-white'}`}>
          {gig.venueName || 'Venue TBC'}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {gig.venueCity && <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">{gig.venueCity}</span>}
          {distanceMiles != null && <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{distanceMiles} mi</span>}
          {showGrassroots && <span className="text-[10px] font-black uppercase tracking-wider text-emerald-500">Grassroots</span>}
        </div>
      </div>

      {/* Ticket status / links */}
      <div className="flex items-center px-3 shrink-0">
        {isSoldOut ? (
          <span className="text-[9px] font-black uppercase tracking-widest text-red-500">Sold out</span>
        ) : isPast ? (
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-700">Past</span>
        ) : gig.isFreeEntry ? (
          <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Free</span>
        ) : gig.ticketType === 'door' ? (
          <span className="text-[9px] font-black uppercase tracking-widest text-amber-500">Door</span>
        ) : buyLinks.length > 0 ? (
          <div className="flex flex-col gap-1 items-end">
            {buyLinks.slice(0, 3).map((t, i) => (
              <a key={i} href={t.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors whitespace-nowrap">
                {SELLER_LABELS[t.seller] || t.seller}
                {t._parsedPrice !== null && (
                  <span className="text-zinc-600">
                    · {t._parsedPrice === 0 ? 'Free' : `£${t._parsedPrice % 1 === 0 ? t._parsedPrice : t._parsedPrice.toFixed(2)}`}
                  </span>
                )}
              </a>
            ))}
          </div>
        ) : (
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-700">TBC</span>
        )}
      </div>
    </div>
  );
}
