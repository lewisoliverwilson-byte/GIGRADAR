import React from 'react';
import Link from 'next/link';

const SELLER_LABELS = {
  'Ticketmaster':     'Ticketmaster',
  'Bandsintown':      'Bandsintown',
  'Skiddle':          'Skiddle',
  'Dice':             'Dice',
  'See Tickets':      'See Tickets',
  'Gigantic':         'Gigantic',
  'WeGotTickets':     'WeGotTickets',
  'Eventbrite':       'Eventbrite',
  'Resident Advisor': 'RA',
  'Songkick':         'Songkick',
  'Setlist.fm':       'Setlist.fm',
};

export default function GigCard({ gig, showArtist = false }) {
  const tickets   = gig.tickets || [];
  const today     = new Date().toISOString().split('T')[0];
  const isPast    = gig.date && gig.date < today;
  const isSoldOut = !isPast && (gig.isSoldOut || (tickets.length > 0 && tickets.every(t => !t.available)));

  const _sellerMap = new Map();
  for (const t of tickets) {
    if (!t.available || !t.url || t.url === '#' || t.seller === 'Setlist.fm') continue;
    const existing = _sellerMap.get(t.seller);
    if (!existing || (t.price && t.price !== 'See site' && (!existing.price || existing.price === 'See site'))) {
      _sellerMap.set(t.seller, t);
    }
  }
  const buyLinks = [..._sellerMap.values()];

  const d = gig.date ? new Date(gig.date + 'T12:00:00') : null;

  return (
    <div className={`bg-surface-2 border border-white/5 rounded-2xl overflow-hidden
      hover:border-white/10 hover:bg-surface-3 transition-all duration-150
      ${isPast ? 'opacity-50' : ''}`}>
      <div className="flex items-stretch">

        {/* Date column */}
        <div className="flex-shrink-0 w-[60px] flex flex-col items-center justify-center
          bg-surface-3 border-r border-white/5 py-4 gap-0.5">
          {d ? (
            <>
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                {d.toLocaleDateString('en-GB', { month: 'short' })}
              </span>
              <span className="text-2xl font-black text-white leading-none">
                {d.getDate()}
              </span>
              <span className="text-[9px] font-medium uppercase tracking-widest text-zinc-500">
                {d.toLocaleDateString('en-GB', { weekday: 'short' })}
              </span>
            </>
          ) : (
            <span className="text-xs text-zinc-500 font-medium">TBC</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center gap-1.5">

          {showArtist && gig.artistName && (
            <Link
              href={`/artists/${gig.artistId}`}
              className="font-bold text-sm text-white hover:text-brand-light transition-colors truncate leading-tight"
            >
              {gig.artistName}
            </Link>
          )}

          <div className="min-w-0">
            <p className={`truncate leading-snug ${
              showArtist
                ? 'text-xs text-zinc-400'
                : 'text-sm font-semibold text-white'
            }`}>
              {gig.venueName || 'Venue TBC'}
            </p>
            {gig.venueCity && (
              <p className="text-xs text-zinc-500 truncate leading-snug">{gig.venueCity}</p>
            )}
          </div>

          {gig.supportActs?.length > 0 && (
            <p className="text-[11px] text-zinc-600 truncate">
              + {gig.supportActs.join(', ')}
            </p>
          )}

          {/* Status / tickets */}
          {isSoldOut ? (
            <div><span className="badge-sold-out">Sold out</span></div>
          ) : isPast ? (
            <span className="text-[11px] text-zinc-600">Past event</span>
          ) : gig.isFreeEntry ? (
            <div><span className="badge-green">Free entry</span></div>
          ) : gig.ticketType === 'door' ? (
            <div><span className="badge-amber">Pay on door</span></div>
          ) : buyLinks.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {buyLinks.slice(0, 4).map((t, i) => (
                <a
                  key={i}
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold
                    bg-brand/10 text-brand-light border border-brand/25
                    hover:bg-brand hover:text-white hover:border-brand
                    rounded-lg px-2.5 py-1 transition-all duration-150 whitespace-nowrap"
                >
                  {SELLER_LABELS[t.seller] || t.seller}
                  {t.price && t.price !== 'See site' && (
                    <span className="opacity-60 font-normal">· {t.price}</span>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-zinc-600">Check venue for tickets</span>
          )}
        </div>
      </div>
    </div>
  );
}
