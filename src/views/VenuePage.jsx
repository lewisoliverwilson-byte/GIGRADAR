import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { api } from '../utils/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import GigCard from '../components/GigCard.jsx';
import AlertButton from '../components/AlertButton.jsx';
import Footer from '../components/Footer.jsx';

function venueColor(venueId) {
  const palette = ['#8b5cf6','#06b6d4','#10b981','#f59e0b','#ec4899','#ef4444','#6366f1'];
  let h = 0;
  for (let i = 0; i < (venueId || '').length; i++) h = (h * 31 + venueId.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function venueInitials(name) {
  return (name || '').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'V';
}

const TYPE_LABELS = {
  pub: 'Pub', club: 'Club', theatre: 'Theatre', academy: 'Academy',
  arena: 'Arena', 'arts-centre': 'Arts Centre', other: 'Venue',
};

export default function VenuePage() {
  const { query: { slug } }   = useRouter();
  const { user }               = useAuth();
  const { isFollowingVenue, followVenue, unfollowVenue } = useFollow();

  const [venue,   setVenue]   = useState(null);
  const [gigs,    setGigs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState('upcoming');

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    Promise.all([api.getVenue(slug), api.getVenueGigs(slug)])
      .then(([v, g]) => { setVenue(v); setGigs(g); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <Skeleton />;

  if (!venue) return (
    <div className="min-h-screen bg-surface flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4 text-lg">Venue not found.</p>
          <Link href="/venues" className="btn-secondary px-6 py-2.5 rounded-xl">← Browse venues</Link>
        </div>
      </div>
      <Footer />
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
    <div className="min-h-screen bg-surface">

      {/* Hero */}
      <div className="relative h-56 sm:h-72 overflow-hidden" style={{ background: color + '22' }}>
        {(venue.photoUrl || venue.imageUrl) ? (
          <img
            src={venue.photoUrl || venue.imageUrl}
            alt={venue.name}
            className="w-full h-full object-cover opacity-60"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-8xl font-black opacity-20" style={{ color }}>{venueInitials(venue.name)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/50 to-transparent" />
      </div>

      <div className="section -mt-20 relative pb-10">

        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-6 items-start mb-6">
          {/* Venue avatar */}
          <div
            className="w-28 h-28 rounded-2xl border-4 border-surface overflow-hidden flex-shrink-0 shadow-2xl flex items-center justify-center"
            style={{ background: color + '33' }}
          >
            {(venue.photoUrl || venue.imageUrl)
              ? <img src={venue.photoUrl || venue.imageUrl} alt={venue.name} className="w-full h-full object-cover" />
              : <span className="text-4xl font-black" style={{ color }}>{venueInitials(venue.name)}</span>
            }
          </div>

          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {venue.venueType && venue.venueType !== 'other' && (
                    <span className="badge-gray text-xs uppercase tracking-wider">
                      {TYPE_LABELS[venue.venueType] || 'Venue'}
                    </span>
                  )}
                </div>
                <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-1">{venue.name}</h1>
                <div className="flex items-center gap-3 text-sm text-zinc-400 flex-wrap">
                  {venue.city && <span>{venue.city}</span>}
                  {venue.capacity && (
                    <span className="text-zinc-600">· Cap. {venue.capacity.toLocaleString()}</span>
                  )}
                  {upcoming.length > 0 && (
                    <span className="badge-brand text-xs">
                      {upcoming.length} upcoming {upcoming.length === 1 ? 'gig' : 'gigs'}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={toggleFollow}
                  className={`text-sm px-4 py-2 rounded-xl font-semibold transition-all duration-150 ${
                    followed
                      ? 'bg-brand/15 text-brand-light border border-brand/30 hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/30'
                      : 'btn-primary py-2 px-4 rounded-xl'
                  }`}
                >
                  {followed ? 'Following' : 'Follow'}
                </button>
                <AlertButton targetId={venue.venueId} targetType="venue" targetName={venue.name} />
              </div>
            </div>

            {/* Bio */}
            {venue.bio && (
              <p className="text-zinc-400 text-sm leading-relaxed max-w-2xl mt-3">{venue.bio}</p>
            )}

            {/* Links */}
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              {venue.website && (
                <a href={venue.website} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                  Website <span className="opacity-60">↗</span>
                </a>
              )}
              {venue.instagram && (
                <a href={`https://instagram.com/${venue.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                  Instagram <span className="opacity-60">↗</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="divider mb-6" />

        {/* Tabs */}
        <div className="flex gap-1 bg-surface-2 rounded-xl p-1 w-fit mb-6">
          {[['upcoming', `Upcoming (${upcoming.length})`], ['past', `Past (${past.length})`]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                tab === key ? 'bg-surface-1 text-white shadow' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Gig list */}
        {(tab === 'upcoming' ? upcoming : past).length === 0 ? (
          <div className="bg-surface-2 border border-white/5 rounded-2xl p-12 text-center">
            <span className="text-4xl block mb-3">{tab === 'upcoming' ? '🎸' : '📅'}</span>
            <p className="text-white font-semibold">
              {tab === 'upcoming' ? 'No upcoming gigs' : 'No past gigs on record'}
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              {tab === 'upcoming'
                ? 'Follow this venue to get alerted when new gigs are added.'
                : 'We only have data going back a short while.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {(tab === 'upcoming' ? upcoming : past).map(g => (
              <GigCard key={g.gigId} gig={g} showArtist />
            ))}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="h-56 sm:h-72 skeleton" />
      <div className="section -mt-20 relative pb-10">
        <div className="flex gap-6 items-start">
          <div className="w-28 h-28 skeleton rounded-2xl flex-shrink-0" />
          <div className="flex-1 pt-4 space-y-3">
            <div className="h-9 skeleton rounded-xl w-64" />
            <div className="h-4 skeleton rounded w-32" />
          </div>
        </div>
        <div className="divider mt-6 mb-6" />
        <div className="space-y-2.5">
          {[1,2,3,4].map(i => <div key={i} className="h-20 skeleton rounded-2xl" />)}
        </div>
      </div>
    </div>
  );
}
