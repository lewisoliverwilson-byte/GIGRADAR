import React, { useEffect, useState, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { api } from '../utils/api.js';
import ArtistCard from '../components/ArtistCard.jsx';
import VenueCard from '../components/VenueCard.jsx';
import Footer from '../components/Footer.jsx';

export default function Search() {
  const router = useRouter();
  const [artists, setArtists] = useState([]);
  const [venues,  setVenues]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [query,   setQuery]   = useState(router.query?.q || '');

  useEffect(() => {
    if (router.query?.q && !query) setQuery(router.query.q);
  }, [router.query?.q]);

  useEffect(() => {
    Promise.all([api.getArtists(), api.getVenues()])
      .then(([a, v]) => { setArtists(a); setVenues(v); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    router.replace(val ? `?q=${encodeURIComponent(val)}` : '/search', undefined, { shallow: true });
  }

  const q = query.trim().toLowerCase();

  const matchedArtists = useMemo(() => {
    if (!q) return [];
    return artists.filter(a => a.name?.toLowerCase().includes(q)).slice(0, 12);
  }, [artists, q]);

  const matchedVenues = useMemo(() => {
    if (!q) return [];
    return venues.filter(v =>
      v.name?.toLowerCase().includes(q) || v.city?.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [venues, q]);

  const hasResults = matchedArtists.length > 0 || matchedVenues.length > 0;

  return (
    <>
      <Head>
        <title>{query ? `"${query}" — GigRadar` : 'Search — GigRadar'}</title>
      </Head>
      <div className="min-h-screen bg-surface">
        {/* Search hero */}
        <div className="bg-surface-1 border-b border-white/5">
          <div className="section py-12">
            <p className="text-sm text-brand-light font-medium mb-2 uppercase tracking-widest">Search</p>
            <h1 className="text-4xl font-black text-white mb-6">Find artists & venues</h1>

            <div className="relative max-w-xl">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                autoFocus
                type="text"
                placeholder="Search artists, venues, cities…"
                value={query}
                onChange={handleChange}
                className="input pl-12 pr-10 py-3.5 text-base w-full rounded-xl"
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); router.replace('/search', undefined, { shallow: true }); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors text-lg"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="section py-8 pb-16">
          {loading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 skeleton rounded-xl" />
              ))}
            </div>

          ) : !q ? (
            <div className="text-center py-20">
              <span className="text-4xl block mb-3">🔍</span>
              <p className="text-white font-semibold">Start typing to search</p>
              <p className="text-sm text-zinc-500 mt-1">Search across 18,000+ artists and 4,700+ UK venues.</p>
              <div className="flex gap-3 justify-center mt-6">
                <Link href="/artists" className="btn-secondary px-5 py-2.5 rounded-xl text-sm">Browse artists</Link>
                <Link href="/venues"  className="btn-secondary px-5 py-2.5 rounded-xl text-sm">Browse venues</Link>
              </div>
            </div>

          ) : !hasResults ? (
            <div className="text-center py-20">
              <span className="text-4xl block mb-3">😕</span>
              <p className="text-white font-semibold">No results for "{query}"</p>
              <p className="text-sm text-zinc-500 mt-1">
                If they're a UK act, they may appear soon as we scan more venues.
              </p>
              <Link href="/discover" className="inline-block mt-5 btn-secondary px-5 py-2.5 rounded-xl text-sm">
                Browse all gigs →
              </Link>
            </div>

          ) : (
            <div className="space-y-10">
              {matchedArtists.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-white">Artists</h2>
                    <span className="text-sm text-zinc-500">{matchedArtists.length} result{matchedArtists.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
                    {matchedArtists.map(a => <ArtistCard key={a.artistId} artist={a} />)}
                  </div>
                </section>
              )}

              {matchedVenues.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-white">Venues</h2>
                    <span className="text-sm text-zinc-500">{matchedVenues.length} result{matchedVenues.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {matchedVenues.map(v => <VenueCard key={v.venueId} venue={v} />)}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <Footer />
      </div>
    </>
  );
}
