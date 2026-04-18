import React from 'react';
import Link from 'next/link';

// Full seller names for ticket buttons
const SELLER_LABELS = {
  'Ticketmaster':    'Ticketmaster',
  'Bandsintown':     'Bandsintown',
  'Skiddle':         'Skiddle',
  'Dice':            'Dice',
  'See Tickets':     'See Tickets',
  'Gigantic':        'Gigantic',
  'WeGotTickets':    'WeGotTickets',
  'Eventbrite':      'Eventbrite',
  'Resident Advisor':'RA',
  'Songkick':        'Songkick',
  'Setlist.fm':      'Setlist.fm',
};

export default function GigCard({ gig, showArtist = false }) {
  const tickets   = gig.tickets || [];
  const today     = new Date().toISOString().split('T')[0];
  const isPast    = gig.date && gig.date < today;
  const isSoldOut = !isPast && (gig.isSoldOut || (tickets.length > 0 && tickets.every(t => !t.available)));
  // Deduplicate by seller — keep the one with a real price over "See site"
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
    <div className={`card overflow-hidden transition-colors hover:border-white/10 ${isPast ? 'opacity-70' : ''}`}>
      <div className="flex items-stretch min-h-[72px]">

        {/* Date column */}
        <div className="flex-shrink-0 w-14 flex flex-col items-center justify-center bg-surface-2 border-r border-white/5 py-3 gap-0.5">
          {d ? (
            <>
              <span className="text-[10px] text-gray-500 uppercase tracking-wide leading-none">
                {d.toLocaleDateString('en-GB', { month: 'short' })}
              </span>
              <span className="text-xl font-extrabold text-white leading-none">
                {d.getDate()}
              </span>
              <span className="text-[10px] text-gray-500 leading-none">
                {d.toLocaleDateString('en-GB', { weekday: 'short' })}
              </span>
            </>
          ) : (
            <span className="text-xs text-gray-500">TBC</span>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-center gap-1">

          {/* Artist name — primary text when showArtist */}
          {showArtist && gig.artistName && (
            <Link
              href={`/artists/${gig.artistId}`}
              className="font-bold text-sm text-white hover:text-brand-light transition-colors truncate leading-tight"
            >
              {gig.artistName}
            </Link>
          )}

          {/* Venue + city */}
          <div className="min-w-0">
            <p className={`truncate leading-tight ${showArtist ? 'text-xs text-gray-400' : 'text-sm font-semibold text-white'}`}>
              {gig.venueName || 'Venue TBC'}
            </p>
            {gig.venueCity && (
              <p className="text-xs text-gray-500 truncate leading-tight">{gig.venueCity}</p>
            )}
          </div>

          {/* Support acts */}
          {gig.supportActs?.length > 0 && (
            <p className="text-[11px] text-gray-600 truncate">
              + {gig.supportActs.join(', ')}
            </p>
          )}

          {/* Ticket links or status */}
          {isSoldOut ? (
            <div className="mt-0.5">
              <span className="badge-sold-out">Sold out</span>
            </div>
          ) : isPast ? (
            <p className="text-[11px] text-gray-600">Past event</p>
          ) : gig.isFreeEntry ? (
            <div className="mt-0.5">
              <span className="inline-block text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-md px-2 py-0.5">Free entry</span>
            </div>
          ) : gig.ticketType === 'door' ? (
            <div className="mt-0.5">
              <span className="inline-block text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-md px-2 py-0.5">Pay on door</span>
            </div>
          ) : buyLinks.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {buyLinks.slice(0, 4).map((t, i) => (
                <a
                  key={i}
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-brand/10 text-brand-light border border-brand/25 hover:bg-brand/20 hover:border-brand/50 rounded-md px-2 py-1 transition-colors whitespace-nowrap"
                >
                  <span>{SELLER_LABELS[t.seller] || t.seller}</span>
                  {t.price && t.price !== 'See site' && (
                    <span className="text-white/60 font-normal">{t.price}</span>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-600 mt-0.5">Check venue for tickets</p>
          )}
        </div>
      </div>
    </div>
  );
}
