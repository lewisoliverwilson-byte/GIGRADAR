import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { api } from '../utils/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import ArtistCard from '../components/ArtistCard.jsx';
import GigCard from '../components/GigCard.jsx';
import Footer from '../components/Footer.jsx';

export default function Home() {
  const { user, openAuth } = useAuth();
  const { following } = useFollow();
  const [artists, setArtists] = useState([]);
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const router = useRouter();

  useEffect(() => {
    Promise.all([api.getArtists(), api.getGigs()])
      .then(([a, g]) => { setArtists(a); setGigs(g); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().split('T')[0];
  const featuredArtists = [...artists]
    .filter(a => a.upcoming > 0)
    .sort((a, b) => (b.upcoming - a.upcoming) || ((a.lastfmRank || 999999) - (b.lastfmRank || 999999)))
    .slice(0, 18);
  const upcomingGigs = gigs.filter(g => g.date >= today).slice(0, 8);
  const followedGigs = gigs.filter(g => following.has(g.artistId) && g.date >= today);

  function handleSearch(e) {
    e.preventDefault();
    if (search.trim()) router.push(`/search?q=${encodeURIComponent(search.trim())}`);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">

      {/* ── Hero ── */}
      <section className="relative border-b border-white/5">
        <div className="absolute inset-0 bg-gradient-to-b from-violet-950/30 to-transparent pointer-events-none" />
        <div className="max-w-5xl mx-auto px-6 py-20 text-center relative">
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 text-sm text-violet-300 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            Updated every 6 hours · 10+ ticket sources
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight mb-5 leading-[1.05]">
            <span className="text-white">Every UK gig.</span>
            <br />
            <span className="text-violet-400">One place.</span>
          </h1>

          <p className="text-zinc-400 text-lg max-w-lg mx-auto mb-10 leading-relaxed">
            Track 18,000+ UK artists across Ticketmaster, Dice, Skiddle, Songkick and more.
            Follow artists, get email alerts, never miss a show.
          </p>

          <form onSubmit={handleSearch} className="max-w-md mx-auto flex gap-2 mb-8">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search artists or venues…"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500/50 text-base"
            />
            <button type="submit" className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors">
              Search
            </button>
          </form>

          <div className="flex justify-center gap-3 flex-wrap">
            <Link href="/gigs" className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm">
              Browse gigs
            </Link>
            <Link href="/artists" className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm">
              Find artists
            </Link>
            {!user && (
              <button onClick={() => openAuth('signup')} className="text-zinc-400 hover:text-white font-medium px-4 py-2.5 text-sm transition-colors">
                Sign up free →
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-8 max-w-xs mx-auto mt-14">
            {[['18K+', 'Artists tracked'], ['4.7K', 'UK venues'], ['37K+', 'Upcoming gigs']].map(([val, label]) => (
              <div key={label}>
                <p className="text-2xl font-black text-white">{val}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── My gigs (logged in + following) ── */}
      {user && following.size > 0 && (
        <section className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-white">Your upcoming gigs</h2>
            {followedGigs.length > 8 && (
              <Link href="/gigs?filter=following" className="text-sm text-violet-400 hover:text-violet-300">
                View all {followedGigs.length} →
              </Link>
            )}
          </div>
          {followedGigs.length > 0 ? (
            <div className="space-y-2">
              {followedGigs.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
            </div>
          ) : (
            <div className="bg-white/3 border border-white/5 rounded-2xl p-10 text-center text-zinc-500 text-sm">
              None of your followed artists have announced shows yet.
            </div>
          )}
        </section>
      )}

      {/* ── Artists on tour ── */}
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Artists on tour now</h2>
            <p className="text-sm text-zinc-500 mt-0.5">UK artists with upcoming shows</p>
          </div>
          <Link href="/artists" className="text-sm text-violet-400 hover:text-violet-300 transition-colors">
            See all artists →
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {featuredArtists.map(a => <ArtistCard key={a.artistId} artist={a} />)}
          </div>
        )}
      </section>

      {/* ── Upcoming gigs ── */}
      <section className="max-w-5xl mx-auto px-6 py-12 border-t border-white/5">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Upcoming gigs</h2>
          <Link href="/gigs" className="text-sm text-violet-400 hover:text-violet-300 transition-colors">
            See all gigs →
          </Link>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : upcomingGigs.length > 0 ? (
          <div className="space-y-2">
            {upcomingGigs.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
          </div>
        ) : (
          <p className="text-zinc-500 text-sm">No upcoming gigs found.</p>
        )}

        <div className="mt-6 text-center">
          <Link href="/gigs" className="inline-block bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold px-8 py-3 rounded-xl transition-colors text-sm">
            View all upcoming gigs →
          </Link>
        </div>
      </section>

      {/* ── Feature cards ── */}
      <section className="max-w-5xl mx-auto px-6 py-12 border-t border-white/5">
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { icon: '🔔', title: 'Gig alerts', desc: 'Get an email the moment a new gig is announced for any artist you follow.', cta: 'Browse artists', href: '/artists' },
            { icon: '🗺️', title: 'Browse by city', desc: 'Filter gigs by London, Manchester, Glasgow, Bristol and 16 more UK cities.', cta: 'Find local gigs', href: '/gigs' },
            { icon: '🎵', title: 'Spotify import', desc: 'Connect Spotify to auto-follow your top artists and see all their upcoming shows.', cta: 'Connect Spotify', href: '/onboarding/connect' },
          ].map(({ icon, title, desc, cta, href }) => (
            <div key={title} className="bg-white/3 border border-white/8 rounded-2xl p-6 hover:border-violet-500/20 transition-colors">
              <span className="text-3xl">{icon}</span>
              <h3 className="text-base font-bold text-white mt-3 mb-2">{title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed mb-4">{desc}</p>
              <Link href={href} className="text-sm text-violet-400 hover:text-violet-300 font-medium transition-colors">
                {cta} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}
