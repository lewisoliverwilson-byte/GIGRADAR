import React from 'react';
import Link from 'next/link';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import AccountPrompt from './AccountPrompt.jsx';

const VENUE_TYPE_LABELS = {
  pub: 'Pub', club: 'Club', theatre: 'Theatre', academy: 'Academy',
  arena: 'Arena', 'arts-centre': 'Arts Centre', other: 'Venue',
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
  const { user } = useAuth();
  const { isFollowingVenue, followVenue, unfollowVenue } = useFollow();
  const [prompt, setPrompt] = React.useState(false);
  const followed = isFollowingVenue(venue.venueId);
  const color = venueColor(venue.venueId);

  function toggle(e) {
    e.preventDefault();
    if (!user) { setPrompt(true); return; }
    followed ? unfollowVenue(venue.venueId) : followVenue(venue.venueId);
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-600 transition-colors group">
      <Link href={`/venues/${venue.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden rounded-t-xl" style={{ background: color + '33' }}>
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

          {venue.venueType && venue.venueType !== 'other' && (
            <span className="absolute top-2.5 left-2.5 bg-zinc-800 text-zinc-300 text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded">
              {VENUE_TYPE_LABELS[venue.venueType] || 'Venue'}
            </span>
          )}

          {venue.upcoming > 0 && (
            <div className="absolute bottom-2.5 left-2.5">
              <span className="inline-flex items-center gap-1 bg-violet-900 text-violet-300 text-xs font-semibold px-2 py-0.5 rounded-md border border-violet-700">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {venue.upcoming} {venue.upcoming === 1 ? 'gig' : 'gigs'}
              </span>
            </div>
          )}
        </div>
      </Link>

      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/venues/${venue.slug}`}
            className="font-semibold text-sm text-white hover:text-violet-400 truncate transition-colors">
            {venue.name}
          </Link>
          <button
            onClick={toggle}
            className={`flex-shrink-0 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
              followed
                ? 'bg-violet-900 text-violet-300 border border-violet-700 hover:bg-red-900 hover:text-red-400 hover:border-red-700'
                : 'bg-violet-600 hover:bg-violet-500 text-white'
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
