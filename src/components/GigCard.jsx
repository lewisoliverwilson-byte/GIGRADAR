import React from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../utils/format.js';

const SOURCE_LABELS = {
  ticketmaster: 'TM',
  bandsintown:  'BIT',
  songkick:     'SK',
  skiddle:      'SKI',
  dice:         'DICE',
  seetickets:   'SEE',
  gigantic:     'GIG',
  wegottickets: 'WGT',
  eventbrite:   'EB',
  residentadvisor: 'RA',
};

export default function GigCard({ gig, showArtist = false }) {
  const tickets     = gig.tickets || [];
  const isSoldOut   = gig.isSoldOut || tickets.every(t => !t.available);
  const available   = tickets.filter(t => t.available);
  const price       = available.find(t => t.price && t.price !== 'See site')?.price
    || (available.length ? 'See site' : null);
  const sources     = [...new Set((gig.sources || [gig.source]).filter(Boolean))];
  const buyUrl      = available[0]?.url || tickets[0]?.url || '#';

  return (
    <div className="card flex gap-0 overflow-hidden hover:border-white/10 transition-colors">
      {/* Date strip */}
      <div className="flex-shrink-0 w-16 flex flex-col items-center justify-center bg-surface-2 px-2 py-3 border-r border-white/5">
        {gig.date ? (
          <>
            <span className="text-xs text-gray-500 uppercase">
              {new Date(gig.date + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short' })}
            </span>
            <span className="text-2xl font-bold text-white leading-none">
              {new Date(gig.date + 'T12:00:00').getDate()}
            </span>
            <span className="text-xs text-gray-500">
              {new Date(gig.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}
            </span>
          </>
        ) : <span className="text-xs text-gray-500">TBC</span>}
      </div>

      {/* Main info */}
      <div className="flex-1 px-3 py-3 min-w-0">
        {showArtist && gig.artistName && (
          <Link to={`/artists/${gig.artistId}`} className="text-brand-light text-xs font-medium hover:underline block mb-0.5 truncate">
            {gig.artistName}
          </Link>
        )}
        <p className="font-semibold text-sm text-white truncate">{gig.venueName || 'Venue TBC'}</p>
        <p className="text-gray-400 text-xs truncate mt-0.5">{[gig.venueCity, gig.venueCountry === 'GB' ? null : gig.venueCountry].filter(Boolean).join(', ')}</p>

        {/* Support acts */}
        {gig.supportActs?.length > 0 && (
          <p className="text-gray-500 text-xs mt-1 truncate">+ {gig.supportActs.join(', ')}</p>
        )}

        {/* Bottom row */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {isSoldOut && <span className="badge-sold-out">Sold out</span>}
          {sources.map(s => (
            <span key={s} className="badge-source">{SOURCE_LABELS[s] || s}</span>
          ))}
          {price && !isSoldOut && (
            <span className="text-xs text-gray-400 ml-auto">{price}</span>
          )}
        </div>
      </div>

      {/* Ticket button */}
      <div className="flex-shrink-0 flex items-center pr-3">
        {!isSoldOut && tickets.length > 0 ? (
          <a
            href={buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-brand hover:text-brand-light border border-brand/40 hover:border-brand/70 rounded-lg px-2.5 py-1.5 transition-colors whitespace-nowrap"
          >
            Tickets
          </a>
        ) : isSoldOut ? (
          <span className="text-xs text-gray-600 font-medium">Sold out</span>
        ) : null}
      </div>
    </div>
  );
}
