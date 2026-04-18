import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import GigCard from '../components/GigCard.jsx';
import AlertButton from '../components/AlertButton.jsx';

function venueColor(venueId) {
  const palette = ['#8b5cf6','#06b6d4','#10b981','#f59e0b','#ec4899','#ef4444','#6366f1'];
  let h = 0;
  for (let i = 0; i < (venueId || '').length; i++) h = (h * 31 + venueId.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function venueInitials(name) {
  return (name || '').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'V';
}

export default function VenuePage() {
  const { slug }                = useParams();
  const { user }                = useAuth();
  const { isFollowingVenue, followVenue, unfollowVenue } = useFollow();

  const [venue,   setVenue]   = useState(null);
  const [gigs,    setGigs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState('upcoming');

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getVenue(slug), api.getVenueGigs(slug)])
      .then(([v, g]) => { setVenue(v); setGigs(g); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-pulse space-y-4">
      <div className="h-48 bg-surface-2 rounded-2xl" />
      <div className="h-6 bg-surface-2 rounded w-1/3" />
      <div className="h-4 bg-surface-2 rounded w-1/4" />
    </div>
  );

  if (!venue) return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-20 text-center text-gray-500">
      Venue not found. <Link to="/discover" className="text-brand hover:underline">Browse gigs</Link>
    </div>
  );

  const today    = new Date().toISOString().split('T')[0];
  const upcoming = gigs.filter(g => g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past     = gigs.filter(g => g.date <  today).sort((a, b) => b.date.localeCompare(a.date));
  const followed = isFollowingVenue(venue.venueId);
  const color    = venueColor(venue.venueId);

  function toggleFollow() {
    if (!user) return;
    followed ? unfollowVenue(venue.venueId) : followVenue(venue.venueId);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-12">

      {/* Header */}
      <div className="relative -mx-4 sm:-mx-6 overflow-hidden mb-8">
        {(venue.photoUrl || venue.imageUrl) ? (
          <img src={venue.photoUrl || venue.imageUrl} alt={venue.name} className="w-full h-56 object-cover" />
        ) : (
          <div className="w-full h-56 flex items-center justify-center" style={{ background: color + '22' }}>
            <span className="text-7xl font-bold" style={{ color }}>{venueInitials(venue.name)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 px-4 sm:px-6 pb-5">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">{venue.name}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-300">
            {venue.city && <span>{venue.city}</span>}
            {venue.capacity && <span>· Cap. {venue.capacity.toLocaleString()}</span>}
            {venue.venueType && <span className="capitalize">· {venue.venueType}</span>}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={toggleFollow}
          className={`text-sm px-4 py-2 rounded-lg font-semibold transition-all duration-150 ${
            followed
              ? 'bg-brand/20 text-brand border border-brand/40 hover:bg-red-900/30 hover:text-red-400 hover:border-red-500/40'
              : 'bg-brand hover:bg-brand-dark text-white'
          }`}
        >
          {followed ? 'Following' : 'Follow venue'}
        </button>
        <AlertButton
          targetId={venue.venueId}
          targetType="venue"
          targetName={venue.name}
        />
        {venue.website && (
          <a href={venue.website} target="_blank" rel="noopener noreferrer"
            className="text-sm text-gray-400 hover:text-white transition-colors">
            Website →
          </a>
        )}
        {venue.instagram && (
          <a href={`https://instagram.com/${venue.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
            className="text-sm text-gray-400 hover:text-white transition-colors">
            Instagram
          </a>
        )}
      </div>

      {/* Bio */}
      {venue.bio && <p className="text-gray-400 text-sm mb-6 max-w-2xl">{venue.bio}</p>}

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-white/5">
        {[['upcoming', `Upcoming (${upcoming.length})`], ['past', `Past (${past.length})`]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === key ? 'border-brand text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Gig list */}
      {(tab === 'upcoming' ? upcoming : past).length === 0 ? (
        <div className="card p-10 text-center text-gray-500 text-sm">
          {tab === 'upcoming' ? 'No upcoming gigs found yet.' : 'No past gigs on record yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {(tab === 'upcoming' ? upcoming : past).map(g => (
            <GigCard key={g.gigId} gig={g} showArtist />
          ))}
        </div>
      )}
    </div>
  );
}
