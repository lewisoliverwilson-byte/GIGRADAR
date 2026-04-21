import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { api } from '../utils/api.js';
import GigCard from '../components/GigCard.jsx';
import Footer from '../components/Footer.jsx';

const GENRES = ['All','rock','indie','pop','electronic','dance','jazz','classical','hip-hop','folk','metal','punk','alternative'];

export default function CityGigsPage({ city, genre: initialGenre, initialGigs = [], grassrootsVenues = [] }) {
  const [gigs, setGigs] = useState(initialGigs);
  const [venues, setVenues] = useState(grassrootsVenues);
  const [genre, setGenre] = useState(initialGenre || 'All');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const PER_PAGE = 30;

  // If no initial data, fetch client-side
  useEffect(() => {
    if (initialGigs.length === 0) {
      setLoading(true);
      Promise.all([
        api.getGigs({ city, limit: 200 }),
        api.getVenuesFiltered({ city, grassroots: true }),
      ])
        .then(([g, v]) => { setGigs(g); setVenues(v); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [city]);

  const filtered = useMemo(() => {
    let list = gigs;
    if (genre !== 'All') list = list.filter(g => (g.genres || []).some(gg => gg.toLowerCase().includes(genre)));
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [gigs, genre]);

  const paged = filtered.slice(0, page * PER_PAGE);

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Hero */}
      <section className="bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-14">
          <div className="flex items-center gap-2 mb-3">
            <Link href="/gigs" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Gigs</Link>
            <span className="text-zinc-700">/</span>
            <span className="text-xs text-zinc-400">{city}</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-white mb-3">
            Live Gigs in {city}
          </h1>
          <p className="text-zinc-400 text-base max-w-xl leading-relaxed">
            {filtered.length > 0
              ? `${filtered.length.toLocaleString()} upcoming shows in ${city} across every ticket platform — from arenas to grassroots venues.`
              : `Every upcoming show in ${city} across all ticket platforms.`}
          </p>

          {/* Genre tabs */}
          <div className="flex flex-wrap gap-2 mt-6">
            {GENRES.map(g => (
              <button key={g} onClick={() => { setGenre(g); setPage(1); }}
                className={`text-sm px-4 py-1.5 rounded-xl font-medium transition-colors ${
                  genre === g
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-900 border border-zinc-700 text-zinc-300 hover:border-zinc-500'
                }`}>
                {g === 'All' ? 'All genres' : g}
              </button>
            ))}
          </div>

          {/* City quick-links */}
          <div className="flex flex-wrap gap-2 mt-4">
            {['rock','indie','electronic','jazz'].filter(g => g !== genre.toLowerCase()).map(g => (
              <Link key={g} href={`/gigs/${city.toLowerCase()}/${g}`}
                className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
                {g} in {city} →
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex gap-8">
          {/* Gig list */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-zinc-800 animate-pulse" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-4xl mb-3">🎵</p>
                <p className="text-white font-bold">No {genre !== 'All' ? genre + ' ' : ''}gigs found in {city}</p>
                <p className="text-zinc-400 text-sm mt-2">Try a different genre or <Link href="/gigs" className="text-violet-400 hover:underline">browse all UK gigs</Link>.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {paged.map(g => <GigCard key={g.gigId} gig={g} showArtist isGrassroots={g._isGrassroots} />)}
                </div>
                {paged.length < filtered.length && (
                  <div className="text-center mt-8">
                    <button onClick={() => setPage(p => p + 1)}
                      className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-10 py-3 rounded-xl transition-colors text-sm">
                      Load more ({filtered.length - paged.length} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sidebar: grassroots venues */}
          {venues.length > 0 && (
            <aside className="w-56 shrink-0 hidden lg:block">
              <div className="sticky top-6">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Grassroots venues</h2>
                </div>
                <p className="text-xs text-zinc-500 mb-4">Support {city}'s independent live music scene.</p>
                <div className="space-y-2">
                  {venues.slice(0, 8).map(v => (
                    <Link key={v.venueId} href={`/venues/${v.slug}`}
                      className="block bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl p-3 transition-colors">
                      <p className="text-sm font-semibold text-white truncate">{v.name}</p>
                      {v.upcoming > 0 && <p className="text-xs text-zinc-500 mt-0.5">{v.upcoming} upcoming shows</p>}
                    </Link>
                  ))}
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Mobile grassroots venues */}
      {venues.length > 0 && (
        <section className="border-t border-zinc-800 lg:hidden">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <div className="flex items-center gap-1.5 mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-widest">Grassroots venues in {city}</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {venues.slice(0, 6).map(v => (
                <Link key={v.venueId} href={`/venues/${v.slug}`}
                  className="bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl p-3 transition-colors">
                  <p className="text-sm font-semibold text-white truncate">{v.name}</p>
                  {v.upcoming > 0 && <p className="text-xs text-zinc-500 mt-0.5">{v.upcoming} upcoming</p>}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
}
