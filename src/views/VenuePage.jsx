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
  const palette = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#6366f1'];
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
  const { query: { slug } } = useRouter();
  const { user } = useAuth();
  const { isFollowingVenue, followVenue, unfollowVenue } = useFollow();

  const [venue, setVenue] = useState(null);
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('upcoming');

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
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4 text-lg">Venue not found.</p>
          <Link href="/venues" className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors">
            ← Browse venues
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );

  const today = new Date().toISOString().split('T')[0];
  const upcoming = gigs.filter(g => g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = gigs.filter(g => g.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const followed = isFollowingVenue(venue.venueId);
  const color = venueColor(venue.venueId);

  function toggleFollow() {
    if (!user) return;
    followed ? unfollowVenue(venue.venueId) : followVenue(venue.venueId);
  }

  return (
    <div className="min-h-screen bg-zinc-950">

      {/* Hero */}
      <div className="relative h-56 sm:h-72 overflow-hidden" style={{ background: color + '33' }}>
        {(venue.photoUrl || venue.imageUrl) ? (
          <img
            src={venue.photoUrl || venue.imageUrl}
            alt={venue.name}
            className="w-full h-full object-cover opacity-60"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-8xl font-black opacity-10" style={{ color }}>{venueInitials(venue.name)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent" />
      </div>

      <div className="max-w-5xl mx-auto px-6 -mt-20 relative pb-10">

        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-6 items-start mb-6">
          <div
            className="w-28 h-28 rounded-2xl border-4 border-zinc-950 overflow-hidden flex-shrink-0 shadow-2xl flex items-center justify-center"
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
                {venue.venueType && venue.venueType !== 'other' && (
                  <span className="inline-block bg-zinc-800 text-zinc-300 text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded mb-2">
                    {TYPE_LABELS[venue.venueType] || 'Venue'}
                  </span>
                )}
                <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-1">{venue.name}</h1>
                <div className="flex items-center gap-3 text-sm text-zinc-400 flex-wrap">
                  {venue.city && <span>{venue.city}</span>}
                  {venue.capacity && (
                    <span className="text-zinc-600">· Cap. {venue.capacity.toLocaleString()}</span>
                  )}
                  {upcoming.length > 0 && (
                    <span className="inline-flex items-center bg-violet-900 text-violet-300 text-xs font-semibold px-2 py-0.5 rounded-md border border-violet-700">
                      {upcoming.length} upcoming {upcoming.length === 1 ? 'gig' : 'gigs'}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={toggleFollow}
                  className={`text-sm px-4 py-2 rounded-xl font-semibold transition-colors ${
                    followed
                      ? 'bg-violet-900 text-violet-300 border border-violet-700 hover:bg-red-900 hover:text-red-400 hover:border-red-700'
                      : 'bg-violet-600 hover:bg-violet-500 text-white'
                  }`}
                >
                  {followed ? 'Following' : 'Follow'}
                </button>
                <AlertButton targetId={venue.venueId} targetType="venue" targetName={venue.name} />
              </div>
            </div>

            {venue.bio && (
              <p className="text-zinc-400 text-sm leading-relaxed max-w-2xl mt-3">{venue.bio}</p>
            )}

            {venue.address && (
              <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1">
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                {venue.address}
              </p>
            )}

            {venue.capacity && (
              <p className="text-xs text-zinc-500 mt-1">Capacity: {venue.capacity.toLocaleString()}</p>
            )}

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
              {venue.wikiUrl && (
                <a href={venue.wikiUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                  Wikipedia <span className="opacity-60">↗</span>
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-800 mb-6" />

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit mb-6">
          {[['upcoming', `Upcoming (${upcoming.length})`], ['past', `Past (${past.length})`]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {(tab === 'upcoming' ? upcoming : past).length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
            <p className="text-5xl mb-4">{tab === 'upcoming' ? '🎸' : '📅'}</p>
            <p className="text-white font-bold">
              {tab === 'upcoming' ? 'No upcoming gigs' : 'No past gigs on record'}
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              {tab === 'upcoming'
                ? 'Follow this venue to get alerted when new gigs are added.'
                : 'We only have data going back a short while.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
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
    <div className="min-h-screen bg-zinc-950">
      <div className="h-56 sm:h-72 bg-zinc-800 animate-pulse" />
      <div className="max-w-5xl mx-auto px-6 -mt-20 relative pb-10">
        <div className="flex gap-6 items-start">
          <div className="w-28 h-28 bg-zinc-800 animate-pulse rounded-2xl flex-shrink-0" />
          <div className="flex-1 pt-4 space-y-3">
            <div className="h-9 bg-zinc-800 animate-pulse rounded-xl w-64" />
            <div className="h-4 bg-zinc-800 animate-pulse rounded w-32" />
          </div>
        </div>
        <div className="border-t border-zinc-800 mt-6 mb-6" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-zinc-800 animate-pulse rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}
