import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import ArtistCard from '../components/ArtistCard.jsx';
import VenueCard from '../components/VenueCard.jsx';

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [artists,  setArtists]  = useState([]);
  const [venues,   setVenues]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [query,    setQuery]    = useState(searchParams.get('q') || '');

  useEffect(() => {
    Promise.all([api.getArtists(), api.getVenues()])
      .then(([a, v]) => { setArtists(a); setVenues(v); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    setSearchParams(val ? { q: val } : {}, { replace: true });
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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">

      {/* Search input */}
      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          autoFocus
          type="text"
          placeholder="Search artists, venues, cities..."
          value={query}
          onChange={handleChange}
          className="input pl-12 pr-4 py-3 text-base w-full"
        />
        {query && (
          <button onClick={() => { setQuery(''); setSearchParams({}); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
            ×
          </button>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-surface-2 rounded-lg" />)}
        </div>
      ) : !q ? (
        <div className="text-center text-gray-500 text-sm py-8">
          Start typing to search artists and venues.
        </div>
      ) : !hasResults ? (
        <div className="card p-10 text-center text-gray-500 text-sm">
          <p>No results for <span className="text-white">"{query}"</span></p>
          <p className="mt-2 text-xs">
            If they're a UK act, they may appear soon as we scan more venues.
          </p>
          <Link to="/discover" className="mt-4 inline-block text-brand hover:underline text-sm">
            Browse all gigs →
          </Link>
        </div>
      ) : (
        <>
          {/* Artists */}
          {matchedArtists.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Artists ({matchedArtists.length})
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {matchedArtists.map(a => <ArtistCard key={a.artistId} artist={a} />)}
              </div>
            </section>
          )}

          {/* Venues */}
          {matchedVenues.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Venues ({matchedVenues.length})
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {matchedVenues.map(v => <VenueCard key={v.venueId} venue={v} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
