import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import ArtistCard from '../components/ArtistCard.jsx';
import GigCard from '../components/GigCard.jsx';

export default function Home() {
  const { user, openAuth } = useAuth();
  const { following } = useFollow();
  const [artists, setArtists] = useState([]);
  const [gigs, setGigs]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getArtists(), api.getGigs()])
      .then(([a, g]) => { setArtists(a); setGigs(g); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const today           = new Date().toISOString().split('T')[0];
  const followedArtists = artists.filter(a => following.has(a.artistId));
  const followedGigs    = gigs.filter(g => following.has(g.artistId) && g.date >= today);
  const featuredArtists = artists
    .filter(a => a.upcoming > 0)
    .sort((a, b) => (b.upcoming - a.upcoming) || (a.lastfmRank - b.lastfmRank))
    .slice(0, 12);
  const upcomingGigs = gigs
    .filter(g => g.date >= today)
    .slice(0, 12);

  if (loading) return <PageSkeleton />;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-10 pb-12">

      {/* Hero */}
      <section className="relative -mx-4 sm:-mx-6 px-4 sm:px-6 py-10 sm:py-14 text-center overflow-hidden">
        {/* Subtle radial glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(139,92,246,0.12) 0%, transparent 70%)' }} />

        <h1 className="relative text-4xl sm:text-5xl font-extrabold tracking-tight mb-3 leading-tight">
          Every UK gig.<br />
          <span className="text-brand">One place.</span>
        </h1>
        <p className="relative text-gray-400 text-base sm:text-lg max-w-lg mx-auto">
          We scan Ticketmaster, Songkick, Dice, Bandsintown and more — every 6 hours — for the top 1,000 UK artists.
        </p>

        {!user ? (
          <button onClick={() => openAuth('signup')} className="btn-primary mt-5 px-8 py-2.5 text-base">
            Get started free
          </button>
        ) : null}

        {/* Stats */}
        <div className="relative flex justify-center gap-6 sm:gap-10 mt-6 text-center">
          {[
            ['1,000', 'UK artists'],
            ['10+', 'ticket sources'],
            ['Every 6h', 'updated'],
          ].map(([val, label]) => (
            <div key={label}>
              <p className="text-base font-bold text-white">{val}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* My gigs — logged in + following */}
      {user && followedArtists.length > 0 && (
        <section>
          <SectionHeader title="Your upcoming gigs" linkTo="/gigs?filter=following"
            linkText={followedGigs.length > 8 ? `View all ${followedGigs.length} →` : null} />
          {followedGigs.length > 0 ? (
            <div className="space-y-2">
              {followedGigs.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
            </div>
          ) : (
            <div className="card p-6 text-center text-gray-400 text-sm">
              No upcoming gigs for your artists right now.
            </div>
          )}
        </section>
      )}

      {/* Followed artists */}
      {user && followedArtists.length > 0 && (
        <section>
          <SectionHeader title="Artists you follow" linkTo="/artists" linkText="Browse all" />
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {followedArtists.slice(0, 6).map(a => <ArtistCard key={a.artistId} artist={a} />)}
          </div>
        </section>
      )}

      {/* On tour now */}
      <section>
        <SectionHeader
          title="On tour now"
          subtitle="Top UK artists with upcoming gigs"
          linkTo="/artists"
          linkText="See all 1,000 →"
        />
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {featuredArtists.map(a => <ArtistCard key={a.artistId} artist={a} />)}
        </div>
      </section>

      {/* Upcoming gigs */}
      <section>
        <SectionHeader title="Upcoming gigs" linkTo="/gigs" linkText="See all →" />
        {upcomingGigs.length > 0 ? (
          <div className="space-y-2">
            {upcomingGigs.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
          </div>
        ) : (
          <div className="card p-8 text-center text-gray-500 text-sm">
            No gigs loaded yet — check back after the first scrape runs.
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({ title, subtitle, linkTo, linkText }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {linkTo && linkText && (
        <Link to={linkTo} className="text-sm text-brand hover:underline flex-shrink-0 ml-4">{linkText}</Link>
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-surface-3 rounded w-1/2 mx-auto" />
        <div className="h-4 bg-surface-2 rounded w-1/3 mx-auto" />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-10">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square bg-surface-2 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
