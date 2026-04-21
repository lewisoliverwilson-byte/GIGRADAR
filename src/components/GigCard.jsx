import React from 'react';
import Link from 'next/link';

const SELLER_LABELS = {
  'Ticketmaster': 'Ticketmaster', 'Bandsintown': 'Bandsintown',
  'Skiddle': 'Skiddle', 'DICE': 'DICE', 'See Tickets': 'See Tickets',
  'Gigantic': 'Gigantic', 'WeGotTickets': 'WGT',
  'Eventbrite': 'Eventbrite', 'Resident Advisor': 'RA',
  'Songkick': 'Songkick', 'Ticketline': 'Ticketline',
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
  // Sort: known price cheapest-first, then unknown price sellers
  const buyLinks = [...sellerMap.values()].sort((a, b) => {
    if (a._parsedPrice !== null && b._parsedPrice !== null) return a._parsedPrice - b._parsedPrice;
    if (a._parsedPrice !== null) return -1;
    if (b._parsedPrice !== null) return 1;
    return 0;
  });
  const priceLinks = buyLinks.filter(t => t._parsedPrice !== null);
  const hasComparison = priceLinks.length >= 2;
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
            {gig.minPrice === 0 && <span className="text-xs font-semibold text-emerald-400">Free</span>}
            {hasComparison && (
              <span className="text-xs text-amber-400 font-medium">Compare:</span>
            )}
            {buyLinks.slice(0, 5).map((t, i) => {
              const isCheapest = hasComparison && i === 0 && t._parsedPrice !== null;
              return (
                <a key={i} href={t.url} target="_blank" rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1 text-xs font-semibold border rounded-lg px-2.5 py-1 transition-all whitespace-nowrap ${
                    isCheapest
                      ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700 hover:bg-emerald-700 hover:text-white hover:border-emerald-600'
                      : 'bg-violet-900 text-violet-300 border-violet-700 hover:bg-violet-600 hover:text-white hover:border-violet-600'
                  }`}>
                  {SELLER_LABELS[t.seller] || t.seller}
                  {t._parsedPrice !== null
                    ? <span className={`font-normal ${isCheapest ? 'text-emerald-400' : 'text-violet-400'}`}>
                        · {t._parsedPrice === 0 ? 'Free' : `£${t._parsedPrice % 1 === 0 ? t._parsedPrice : t._parsedPrice.toFixed(2)}`}
                      </span>
                    : t.price && t.price !== 'See site' && t.price !== 'See venue'
                      ? <span className="text-violet-400 font-normal">· {t.price}</span>
                      : null
                  }
                </a>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-zinc-600">Check venue for tickets</span>
        )}
      </div>
    </div>
  );
}
