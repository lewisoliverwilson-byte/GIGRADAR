import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../utils/api.js';
import GigCard from '../components/GigCard.jsx';
import VenueCard from '../components/VenueCard.jsx';
import Footer from '../components/Footer.jsx';

const GENRES = [
  'Rock', 'Pop', 'Indie', 'Electronic', 'Hip-Hop',
  'Folk', 'Jazz', 'Metal', 'Punk', 'R&B',
  'Alternative', 'Classical', 'Reggae', 'Blues', 'Experimental',
];

const PER_PAGE = 40;

export default function Discover() {
  const [gigs, setGigs]       = useState([]);
  const [venues, setVenues]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity]       = useState('');
  const [genre, setGenre]     = useState('');
  const [view, setView]       = useState('gigs');
  const [page, setPage]       = useState(1);
  const debounceRef           = useRef(null);

  const fetchData = useCallback((cityVal, genreVal) => {
    setLoading(true);
    setPage(1);
    const gigParams = { limit: 200 };
    if (cityVal.trim())  gigParams.city  = cityVal.trim();
    if (genreVal)        gigParams.genre = genreVal;
    Promise.all([
      api.getGigs(gigParams),
      api.getVenuesFiltered({ ...(cityVal.trim() ? { city: cityVal.trim() } : {}), limit: 200 }),
    ])
      .then(([g, v]) => { setGigs(Array.isArray(g) ? g : []); setVenues(Array.isArray(v) ? v : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData('', ''); }, [fetchData]);

  function handleCityChange(val) {
    setCity(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchData(val, genre), 400);
  }

  function handleGenreChange(val) {
    setGenre(val);
    fetchData(city, val);
  }

  function clearFilters() {
    setCity(''); setGenre('');
    fetchData('', '');
  }

  const pagedGigs   = gigs.slice(0, page * PER_PAGE);
  const hasMore     = pagedGigs.length < gigs.length;
  const hasFilters  = city.trim() || genre;

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-2">Explore</p>
          <h1 className="text-4xl font-black text-white mb-2">Discover</h1>
          <p className="text-zinc-400 text-sm">Every UK gig, from arenas to pub back rooms. Filter by city, genre, or venue type.</p>
        </div>
      </div>

      <div className="bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">

            <div className="flex gap-1 bg-zinc-800 rounded-xl p-1">
              {[['gigs', 'Gigs'], ['venues', 'Venues']].map(([v, label]) => (
                <button key={v} onClick={() => { setView(v); setPage(1); }}
                  className={`text-sm px-4 py-1.5 rounded-lg font-medium transition-colors ${
                    view === v ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <input
                type="text"
                placeholder="Filter by city…"
                value={city}
                onChange={e => handleCityChange(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 text-white rounded-xl pl-10 pr-3 py-2 text-sm w-44 focus:outline-none focus:border-violet-500 placeholder-zinc-500 transition-colors"
              />
            </div>

            {hasFilters && (
              <button onClick={clearFilters} className="text-sm text-zinc-500 hover:text-white transition-colors">
                Clear filters ×
              </button>
            )}
          </div>

          {view === 'gigs' && (
            <div className="flex flex-wrap gap-2 mt-3">
              {GENRES.map(g => (
                <button key={g} onClick={() => handleGenreChange(genre === g ? '' : g)}
                  className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                    genre === g
                      ? 'bg-violet-600 border-violet-600 text-white'
                      : 'bg-transparent border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
                  }`}>
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 pb-20">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-20 bg-zinc-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : view === 'venues' ? (
          <>
            <p className="text-sm text-zinc-500 mb-5">
              {venues.length.toLocaleString()} venues{city ? ` in ${city}` : ''}
            </p>
            {venues.length === 0 ? (
              <EmptyState icon="🏛️" text={city ? `No venues found in ${city}` : 'No venues found.'} />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {venues.slice(0, 50).map(v => <VenueCard key={v.venueId} venue={v} />)}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-5">
              {gigs.length.toLocaleString()} gig{gigs.length !== 1 ? 's' : ''}
              {city ? ` in ${city}` : ''}
              {genre ? ` · ${genre}` : ''}
            </p>
            {gigs.length === 0 ? (
              <EmptyState icon="🎵" text="No gigs found. Try a different city or genre." />
            ) : (
              <>
                <div className="space-y-2">
                  {pagedGigs.map(g => (
                    <GigCard key={g.gigId} gig={g} showArtist />
                  ))}
                </div>
                {hasMore && (
                  <div className="text-center mt-10">
                    <button onClick={() => setPage(p => p + 1)}
                      className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-10 py-3 rounded-xl transition-colors text-sm">
                      Load more
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <Footer />
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div className="text-center py-20">
      <p className="text-5xl mb-4">{icon}</p>
      <p className="text-white font-bold text-lg">Nothing here</p>
      <p className="text-zinc-400 text-sm mt-1">{text}</p>
    </div>
  );
}
