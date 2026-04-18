import React from 'react';
import Link from 'next/link';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import AccountPrompt from './AccountPrompt.jsx';

const VENUE_TYPE_LABELS = {
  pub:           'Pub',
  club:          'Club',
  theatre:       'Theatre',
  academy:       'Academy',
  arena:         'Arena',
  'arts-centre': 'Arts Centre',
  other:         'Venue',
};

function venueInitials(name) {
  return (name || '').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'V';
}

function venueColor(venueId) {
  const palette = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#6366f1'];
  let h = 0;
  for (let i = 0; i < (venueId || '').length; i++) h = (h * 31 + venueId.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function VenueCard({ venue }) {
  const { user }                                               = useAuth();
  const { isFollowingVenue, followVenue, unfollowVenue }       = useFollow();
  const [prompt, setPrompt]                                    = React.useState(false);
  const followed = isFollowingVenue(venue.venueId);
  const color    = venueColor(venue.venueId);

  function toggle(e) {
    e.preventDefault();
    if (!user) { setPrompt(true); return; }
    followed ? unfollowVenue(venue.venueId) : followVenue(venue.venueId);
  }

  return (
    <div className="card-hover group">
      {/* Image */}
      <Link href={`/venues/${venue.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden" style={{ background: color + '22' }}>
          {(venue.photoUrl || venue.imageUrl) ? (
            <img
              src={venue.photoUrl || venue.imageUrl}
              alt={venue.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-5xl font-black" style={{ color }}>{venueInitials(venue.name)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

          {/* Type badge */}
          {venue.venueType && venue.venueType !== 'other' && (
            <span className="absolute top-2.5 left-2.5 badge-gray text-[10px] uppercase tracking-widest">
              {VENUE_TYPE_LABELS[venue.venueType] || 'Venue'}
            </span>
          )}

          {/* Gig count */}
          {venue.upcoming > 0 && (
            <div className="absolute bottom-2.5 left-2.5">
              <span className="badge-brand text-xs">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {venue.upcoming} {venue.upcoming === 1 ? 'gig' : 'gigs'}
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/venues/${venue.slug}`}
            className="font-semibold text-sm text-white hover:text-brand-light truncate transition-colors">
            {venue.name}
          </Link>
          <button
            onClick={toggle}
            className={`flex-shrink-0 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all duration-150 ${
              followed
                ? 'bg-brand/15 text-brand-light border border-brand/30 hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/30'
                : 'bg-brand hover:bg-brand-dark text-white'
            }`}
          >
            {followed ? 'Following' : 'Follow'}
          </button>
        </div>
        {venue.city && (
          <p className="text-xs text-zinc-500 mt-0.5">{venue.city}</p>
        )}
      </div>

      {prompt && <AccountPrompt onClose={() => setPrompt(false)} />}
    </div>
  );
}
