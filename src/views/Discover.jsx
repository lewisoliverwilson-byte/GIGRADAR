import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../utils/api.js';
import GigCard from '../components/GigCard.jsx';
import VenueCard from '../components/VenueCard.jsx';
import Footer from '../components/Footer.jsx';

const GENRES = [
  'Rock', 'Pop', 'Indie', 'Electronic', 'Hip-Hop',
  'Folk', 'Jazz', 'Metal', 'Punk', 'R&B',
  'Alternative', 'Classical', 'Reggae', 'Blues', 'Experimental',
];

const PER_PAGE = 20;

export default function Discover() {
  const [gigs,    setGigs]    = useState([]);
  const [artists, setArtists] = useState([]);
  const [venues,  setVenues]  = useState([]);
  const [loading, setLoading] = useState(true);

  const [city,  setCity]  = useState('');
  const [genre, setGenre] = useState('');
  const [view,  setView]  = useState('gigs');
  const [page,  setPage]  = useState(1);

  useEffect(() => {
    Promise.all([api.getGigs(), api.getArtists(), api.getVenues()])
      .then(([g, a, v]) => { setGigs(g); setArtists(a); setVenues(v); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const artistMap = useMemo(() => {
    const m = {};
    artists.forEach(a => { m[a.artistId] = a; });
    return m;
  }, [artists]);

  const today = new Date().toISOString().split('T')[0];

  const filteredGigs = useMemo(() => {
    let list = gigs.filter(g => g.date >= today);
    if (city.trim()) {
      const q = city.trim().toLowerCase();
      list = list.filter(g => g.venueCity?.toLowerCase().includes(q));
    }
    if (genre) {
      list = list.filter(g => {
        const a = artistMap[g.artistId];
        return a?.genres?.some(gen => gen.toLowerCase().includes(genre.toLowerCase()));
      });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [gigs, city, genre, artistMap, today]);

  const filteredVenues = useMemo(() => {
    let list = venues.filter(v => v.isActive);
    if (city.trim()) {
      const q = city.trim().toLowerCase();
      list = list.filter(v => v.city?.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0));
  }, [venues, city]);

  const pagedGigs = filteredGigs.slice(0, page * PER_PAGE);
  const hasMore   = pagedGigs.length < filteredGigs.length;

  function clearFilters() { setCity(''); setGenre(''); setPage(1); }
  const hasFilters = city.trim() || genre;

  return (
    <div className="min-h-screen bg-surface">
      {/* Page header */}
      <div className="bg-surface-1 border-b border-white/5">
        <div className="section py-12">
          <p className="text-sm text-brand-light font-medium mb-2 uppercase tracking-widest">Explore</p>
          <h1 className="text-4xl font-black text-white mb-3">Discover</h1>
          <p className="text-zinc-400 max-w-lg">
            Every UK gig, from arenas to pub back rooms. Filter by city, genre, or venue type.
          </p>
        </div>
      </div>

      {/* Filters bar */}
      <div className="bg-surface-1/50 border-b border-white/5">
        <div className="section py-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">

            {/* View toggle */}
            <div className="flex gap-1 bg-surface-2 rounded-xl p-1">
              {[['gigs', 'Gigs'], ['venues', 'Venues']].map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => { setView(v); setPage(1); }}
                  className={`text-sm px-4 py-1.5 rounded-lg font-medium transition-all duration-150 ${
                    view === v ? 'bg-brand text-white shadow' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* City search */}
            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <input
                type="text"
                placeholder="Filter by city…"
                value={city}
                onChange={e => { setCity(e.target.value); setPage(1); }}
                className="input pl-10 py-2 text-sm w-44"
              />
            </div>

            {hasFilters && (
              <button onClick={clearFilters} className="text-sm text-zinc-500 hover:text-white transition-colors">
                Clear filters ×
              </button>
            )}
          </div>

          {/* Genre pills (gig view only) */}
          {view === 'gigs' && (
            <div className="flex flex-wrap gap-2 mt-3">
              {GENRES.map(g => (
                <button
                  key={g}
                  onClick={() => { setGenre(genre === g ? '' : g); setPage(1); }}
                  className={genre === g ? 'pill-active' : 'pill'}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="section py-8 pb-16">
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-20 rounded-2xl" />
            ))}
          </div>

        ) : view === 'venues' ? (
          <>
            <p className="text-sm text-zinc-500 mb-5">
              {filteredVenues.length.toLocaleString()} venues{city ? ` in ${city}` : ''}
            </p>
            {filteredVenues.length === 0 ? (
              <EmptyState icon="🏛️" text={city ? `No venues found in ${city}` : 'No venues found.'} />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredVenues.slice(0, 50).map(v => <VenueCard key={v.venueId} venue={v} />)}
              </div>
            )}
          </>

        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-5">
              {filteredGigs.length.toLocaleString()} gig{filteredGigs.length !== 1 ? 's' : ''}
              {city ? ` in ${city}` : ''}
              {genre ? ` · ${genre}` : ''}
            </p>
            {filteredGigs.length === 0 ? (
              <EmptyState icon="🎵" text="No gigs found. Try a different city or genre." />
            ) : (
              <>
                <div className="space-y-2.5">
                  {pagedGigs.map(g => {
                    const artist = artistMap[g.artistId];
                    const isGrassroots = !artist?.lastfmRank || artist.lastfmRank > 500;
                    return (
                      <div key={g.gigId} className="relative">
                        {isGrassroots && (
                          <span className="absolute -top-1.5 right-2 z-10 text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-md px-1.5 py-0.5">
                            Grassroots
                          </span>
                        )}
                        <GigCard gig={g} showArtist />
                      </div>
                    );
                  })}
                </div>
                {hasMore && (
                  <div className="text-center mt-10">
                    <button
                      onClick={() => setPage(p => p + 1)}
                      className="btn-secondary px-10 py-3 rounded-xl"
                    >
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
      <span className="text-4xl block mb-3">{icon}</span>
      <p className="text-white font-semibold">Nothing here</p>
      <p className="text-sm text-zinc-500 mt-1">{text}</p>
    </div>
  );
}
