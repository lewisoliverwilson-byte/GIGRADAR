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
  const { user, openAuth }      = useAuth();
  const { following }           = useFollow();
  const [artists, setArtists]   = useState([]);
  const [gigs,    setGigs]      = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search,  setSearch]    = useState('');
  const router = useRouter();

  useEffect(() => {
    Promise.all([api.getArtists(), api.getGigs()])
      .then(([a, g]) => { setArtists(a); setGigs(g); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const today           = new Date().toISOString().split('T')[0];
  const followedArtists = artists.filter(a => following.has(a.artistId));
  const followedGigs    = gigs.filter(g => following.has(g.artistId) && g.date >= today);
  const featuredArtists = [...artists]
    .filter(a => a.upcoming > 0)
    .sort((a, b) => (b.upcoming - a.upcoming) || ((a.lastfmRank || 999999) - (b.lastfmRank || 999999)))
    .slice(0, 12);
  const upcomingGigs = gigs.filter(g => g.date >= today).slice(0, 10);

  function handleSearch(e) {
    e.preventDefault();
    if (search.trim()) router.push(`/search?q=${encodeURIComponent(search.trim())}`);
  }

  return (
    <div className="min-h-screen bg-surface">

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-20"
            style={{ background: 'radial-gradient(ellipse at center, #8b5cf6 0%, transparent 70%)' }} />
          <div className="absolute top-20 left-1/4 w-[400px] h-[400px] rounded-full opacity-5 blur-3xl bg-pink" />
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-brand/20 to-transparent" />
        </div>

        <div className="section relative pt-24 pb-20 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-brand/10 border border-brand/20 rounded-full px-4 py-1.5 text-sm text-brand-light mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
            Updated every 6 hours · 10+ ticket sources
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05] mb-6">
            <span className="text-white">Every UK gig.</span>
            <br />
            <span className="bg-gradient-to-r from-brand-light via-purple-300 to-pink-light bg-clip-text text-transparent">
              One place.
            </span>
          </h1>

          <p className="text-lg text-zinc-400 max-w-xl mx-auto mb-10 leading-relaxed">
            GigRadar tracks 18,000+ UK artists across Ticketmaster, Dice, Skiddle, Songkick and 6 more sources. Follow artists, get alerts, never miss a show.
          </p>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="max-w-lg mx-auto mb-8 flex gap-2">
            <div className="flex-1 relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search artists or venues…"
                className="input pl-10 py-3 text-base rounded-xl"
              />
            </div>
            <button type="submit" className="btn-primary px-6 py-3 rounded-xl text-base">Search</button>
          </form>

          {/* CTAs */}
          <div className="flex gap-3 justify-center flex-wrap">
            <Link href="/gigs"    className="btn-primary px-7 py-3 rounded-xl text-base">Browse gigs</Link>
            <Link href="/artists" className="btn-secondary px-7 py-3 rounded-xl text-base">Find artists</Link>
            {!user && (
              <button onClick={() => openAuth('signup')} className="btn-ghost px-7 py-3 text-base">
                Sign up free →
              </button>
            )}
          </div>

          {/* Stats bar */}
          <div className="mt-16 grid grid-cols-3 gap-6 max-w-sm mx-auto">
            {[
              ['18K+', 'Artists tracked'],
              ['4.7K', 'UK venues'],
              ['37K+', 'Upcoming gigs'],
            ].map(([val, label]) => (
              <div key={label} className="text-center">
                <p className="text-2xl font-black text-white">{val}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── My gigs ────────────────────────────────────────── */}
      {user && followedArtists.length > 0 && (
        <section className="section py-14">
          <SectionHeader
            title="Your upcoming gigs"
            linkTo="/gigs?filter=following"
            linkText={followedGigs.length > 8 ? `View all ${followedGigs.length}` : null}
          />
          {followedGigs.length > 0 ? (
            <div className="space-y-2.5">
              {followedGigs.slice(0, 8).map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
            </div>
          ) : (
            <EmptyState
              icon="🎸"
              title="No upcoming gigs"
              desc="None of your followed artists have announced shows yet."
            />
          )}
        </section>
      )}

      {/* ── On tour now ─────────────────────────────────────── */}
      {!loading && (
        <section className="section py-14">
          <SectionHeader
            title="On tour now"
            subtitle="Top UK artists with upcoming shows"
            linkTo="/artists"
            linkText="See all artists"
          />
          {loading ? (
            <ArtistGridSkeleton count={12} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {featuredArtists.map(a => <ArtistCard key={a.artistId} artist={a} />)}
            </div>
          )}
        </section>
      )}

      {/* ── Upcoming gigs ──────────────────────────────────── */}
      <section className="section py-14">
        <SectionHeader title="Upcoming gigs" linkTo="/gigs" linkText="See all gigs" />

        {loading ? (
          <GigListSkeleton count={8} />
        ) : upcomingGigs.length > 0 ? (
          <div className="space-y-2.5">
            {upcomingGigs.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
          </div>
        ) : (
          <EmptyState icon="🎵" title="No gigs yet" desc="Check back after the first scrape runs." />
        )}

        <div className="mt-8 text-center">
          <Link href="/gigs" className="btn-secondary px-8 py-3 rounded-xl">
            View all upcoming gigs →
          </Link>
        </div>
      </section>

      {/* ── Feature callouts ───────────────────────────────── */}
      <section className="section py-14">
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              icon: '🔔',
              title: 'Gig alerts',
              desc: 'Get an email the moment a new gig is announced for any artist you follow. Never miss a sale.',
              cta: 'Browse artists',
              href: '/artists',
            },
            {
              icon: '🗺️',
              title: 'Browse by city',
              desc: 'Filter gigs by London, Manchester, Glasgow, Bristol and 16 more UK cities.',
              cta: 'Find local gigs',
              href: '/gigs',
            },
            {
              icon: '🎵',
              title: 'Spotify import',
              desc: 'Connect Spotify to auto-follow your top listened artists and see all their upcoming shows.',
              cta: 'Connect Spotify',
              href: '/onboarding/connect',
            },
          ].map(({ icon, title, desc, cta, href }) => (
            <div key={title} className="bg-surface-2 border border-white/5 rounded-2xl p-6 hover:border-brand/20 transition-colors">
              <span className="text-3xl">{icon}</span>
              <h3 className="text-base font-bold text-white mt-3 mb-2">{title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed mb-4">{desc}</p>
              <Link href={href} className="text-sm text-brand-light hover:text-brand font-medium transition-colors">
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

function SectionHeader({ title, subtitle, linkTo, linkText }) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {subtitle && <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>}
      </div>
      {linkTo && linkText && (
        <Link href={linkTo} className="text-sm text-brand-light hover:text-brand font-medium transition-colors flex-shrink-0 ml-4">
          {linkText} →
        </Link>
      )}
    </div>
  );
}

function EmptyState({ icon, title, desc }) {
  return (
    <div className="bg-surface-2 border border-white/5 rounded-2xl p-10 text-center">
      <span className="text-4xl">{icon}</span>
      <p className="text-white font-semibold mt-3">{title}</p>
      <p className="text-sm text-zinc-500 mt-1">{desc}</p>
    </div>
  );
}

function ArtistGridSkeleton({ count }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton aspect-square rounded-2xl" />
      ))}
    </div>
  );
}

function GigListSkeleton({ count }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton h-20 rounded-2xl" />
      ))}
    </div>
  );
}
