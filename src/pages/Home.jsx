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

  const followedArtists = artists.filter(a => following.has(a.artistId));
  const followedGigs    = gigs.filter(g => following.has(g.artistId));
  const topArtists      = artists.slice(0, 12);
  const upcomingGigs    = gigs.filter(g => g.date >= new Date().toISOString().split('T')[0]).slice(0, 10);

  if (loading) return <PageSkeleton />;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-12">

      {/* Hero */}
      <section className="text-center py-8">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-3">
          Every UK gig.<br />
          <span className="text-brand">One place.</span>
        </h1>
        <p className="text-gray-400 text-lg max-w-xl mx-auto">
          We scan Ticketmaster, Songkick, Dice, Bandsintown and dozens more — every 6 hours — for the top 1,000 UK artists.
        </p>
        {!user && (
          <button onClick={() => openAuth('signup')} className="btn-primary mt-6 px-8 py-3 text-base">
            Get started free
          </button>
        )}
      </section>

      {/* My gigs — logged in + following */}
      {user && followedArtists.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-4">Your upcoming gigs</h2>
          {followedGigs.length > 0 ? (
            <div className="space-y-2">
              {followedGigs.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
              {followedGigs.length > 8 && (
                <Link to="/gigs?filter=following" className="block text-center text-brand text-sm hover:underline pt-2">
                  View all {followedGigs.length} gigs →
                </Link>
              )}
            </div>
          ) : (
            <div className="card p-6 text-center text-gray-400 text-sm">
              No upcoming gigs found for your artists right now.
            </div>
          )}
        </section>
      )}

      {/* Followed artists */}
      {user && followedArtists.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Artists you follow</h2>
            <Link to="/artists" className="text-sm text-brand hover:underline">Browse all</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {followedArtists.slice(0, 6).map(a => <ArtistCard key={a.artistId} artist={a} />)}
          </div>
        </section>
      )}

      {/* Top artists */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Top UK artists</h2>
          <Link to="/artists" className="text-sm text-brand hover:underline">See all 1,000 →</Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {topArtists.map(a => <ArtistCard key={a.artistId} artist={a} />)}
        </div>
      </section>

      {/* Upcoming gigs */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Upcoming gigs</h2>
          <Link to="/gigs" className="text-sm text-brand hover:underline">See all →</Link>
        </div>
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

function PageSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-3 rounded w-1/2 mx-auto" />
        <div className="h-4 bg-surface-2 rounded w-1/3 mx-auto" />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-8">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square bg-surface-2 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
