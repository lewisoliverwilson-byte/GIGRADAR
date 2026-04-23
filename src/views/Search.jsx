import React, { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { api } from '../utils/api.js';
import ArtistCard from '../components/ArtistCard.jsx';
import VenueCard from '../components/VenueCard.jsx';
import Footer from '../components/Footer.jsx';

export default function Search() {
  const router = useRouter();
  const [results, setResults] = useState({ artists: [], venues: [] });
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query?.q || '';
    setQuery(q);
    if (q.length >= 2) runSearch(q);
  }, [router.isReady]);

  function runSearch(q) {
    if (q.length < 2) { setResults({ artists: [], venues: [] }); setSearched(false); return; }
    setLoading(true);
    api.search(q)
      .then(r => { setResults(r); setSearched(true); })
      .catch(() => setResults({ artists: [], venues: [] }))
      .finally(() => setLoading(false));
  }

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    router.replace(val ? `?q=${encodeURIComponent(val)}` : '/search', undefined, { shallow: true });
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 300);
  }

  const hasResults = results.artists.length > 0 || results.venues.length > 0;

  return (
    <>
      <Head>
        <title>{query ? `"${query}" — GigRadar` : 'Search — GigRadar'}</title>
        <meta name="description" content="Search 40,000+ artists and 8,000+ UK venues on GigRadar." />
      </Head>
      <div className="min-h-screen bg-zinc-950">
        <div className="bg-zinc-950 border-b border-zinc-800">
          <div className="max-w-5xl mx-auto px-6 py-10">
            <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-2">Search</p>
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
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-12 pr-10 py-3.5 text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 text-base transition-colors"
              />
              {loading && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
              )}
              {!loading && query && (
                <button
                  onClick={() => { setQuery(''); setResults({ artists: [], venues: [] }); setSearched(false); router.replace('/search', undefined, { shallow: true }); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors text-lg"
                >×</button>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 pb-20">
          {!query || query.length < 2 ? (
            <div className="text-center py-20">
              <p className="text-5xl mb-4">🔍</p>
              <p className="text-white font-bold text-lg">Start typing to search</p>
              <p className="text-zinc-400 text-sm mt-2">Search across 40,000+ artists and 8,000+ UK venues.</p>
              <div className="flex gap-3 justify-center mt-6">
                <Link href="/artists" className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm">
                  Browse artists
                </Link>
                <Link href="/venues" className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm">
                  Browse venues
                </Link>
              </div>
            </div>
          ) : searched && !hasResults ? (
            <div className="text-center py-20">
              <p className="text-5xl mb-4">😕</p>
              <p className="text-white font-bold text-lg">No results for "{query}"</p>
              <p className="text-zinc-400 text-sm mt-2">
                If they're a UK act, they may appear soon as we scan more venues.
              </p>
              <Link href="/discover" className="inline-block mt-5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm">
                Browse all gigs →
              </Link>
            </div>
          ) : hasResults ? (
            <div className="space-y-10">
              {results.artists.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-white">Artists</h2>
                    <span className="text-sm text-zinc-500">{results.artists.length} result{results.artists.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
                    {results.artists.map(a => <ArtistCard key={a.artistId} artist={a} />)}
                  </div>
                </section>
              )}
              {results.venues.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-white">Venues</h2>
                    <span className="text-sm text-zinc-500">{results.venues.length} result{results.venues.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {results.venues.map(v => <VenueCard key={v.venueId} venue={v} />)}
                  </div>
                </section>
              )}
            </div>
          ) : null}
        </div>

        <Footer />
      </div>
    </>
  );
}
