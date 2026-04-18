import React from 'react';
import Link from 'next/link';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import AccountPrompt from './AccountPrompt.jsx';

const VENUE_TYPE_LABELS = {
  pub:         'Pub',
  club:        'Club',
  theatre:     'Theatre',
  academy:     'Academy',
  arena:       'Arena',
  'arts-centre': 'Arts Centre',
  other:       'Venue',
};

function venueInitials(name) {
  return (name || '').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'V';
}

function venueColor(venueId) {
  const palette = ['#8b5cf6','#06b6d4','#10b981','#f59e0b','#ec4899','#ef4444','#6366f1'];
  let h = 0;
  for (let i = 0; i < (venueId || '').length; i++) h = (h * 31 + venueId.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function VenueCard({ venue }) {
  const { user }                       = useAuth();
  const { isFollowingVenue, followVenue, unfollowVenue } = useFollow();
  const [prompt, setPrompt]            = React.useState(false);
  const followed = isFollowingVenue(venue.venueId);
  const color    = venueColor(venue.venueId);

  function toggle(e) {
    e.preventDefault();
    if (!user) { setPrompt(true); return; }
    followed ? unfollowVenue(venue.venueId) : followVenue(venue.venueId);
  }

  return (
    <div className="card group hover:border-white/10 transition-all hover:-translate-y-0.5 duration-200">
      <Link href={`/venues/${venue.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden" style={{ background: color + '22' }}>
          {(venue.photoUrl || venue.imageUrl) ? (
            <img src={venue.photoUrl || venue.imageUrl} alt={venue.name} className="w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl font-bold" style={{ color }}>{venueInitials(venue.name)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          {venue.venueType && (
            <span className="absolute top-2 left-2 text-[9px] font-semibold uppercase tracking-wide bg-black/50 text-gray-300 rounded px-1.5 py-0.5">
              {VENUE_TYPE_LABELS[venue.venueType] || 'Venue'}
            </span>
          )}
        </div>
      </Link>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <Link href={`/venues/${venue.slug}`} className="font-semibold text-sm text-white hover:text-brand-light truncate transition-colors">
            {venue.name}
          </Link>
          <button
            onClick={toggle}
            className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-md font-medium transition-all duration-150 ${
              followed
                ? 'bg-brand/20 text-brand border border-brand/40 hover:bg-red-900/30 hover:text-red-400 hover:border-red-500/40'
                : 'bg-brand hover:bg-brand-dark text-white'
            }`}
          >
            {followed ? 'Following' : 'Follow'}
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {venue.city && <span className="truncate">{venue.city}</span>}
          {venue.upcoming > 0 && (
            <span className="text-brand-light font-medium">{venue.upcoming} upcoming</span>
          )}
        </div>
      </div>

      {prompt && <AccountPrompt onClose={() => setPrompt(false)} />}
    </div>
  );
}
