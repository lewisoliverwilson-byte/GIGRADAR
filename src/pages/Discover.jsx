import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../utils/api.js';
import GigCard from '../components/GigCard.jsx';
import VenueCard from '../components/VenueCard.jsx';

const GENRES = [
  'Rock', 'Pop', 'Indie', 'Electronic / Dance', 'Hip-Hop / Rap',
  'Folk / Acoustic', 'Jazz', 'Metal / Heavy', 'Punk', 'R&B / Soul',
  'Alternative', 'Classical', 'Reggae / Ska', 'Blues', 'Experimental',
];

const PER_PAGE = 20;

export default function Discover() {
  const [gigs,    setGigs]    = useState([]);
  const [artists, setArtists] = useState([]);
  const [venues,  setVenues]  = useState([]);
  const [loading, setLoading] = useState(true);

  const [city,    setCity]    = useState('');
  const [genre,   setGenre]   = useState('');
  const [view,    setView]    = useState('gigs'); // 'gigs' | 'venues'
  const [page,    setPage]    = useState(1);

  useEffect(() => {
    Promise.all([api.getGigs(), api.getArtists(), api.getVenues()])
      .then(([g, a, v]) => { setGigs(g); setArtists(a); setVenues(v); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Build artistId → artist map for genre lookup + grassroots flag
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

  const pagedGigs   = filteredGigs.slice(0, page * PER_PAGE);
  const hasMore     = pagedGigs.length < filteredGigs.length;

  function clearFilters() { setCity(''); setGenre(''); setPage(1); }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Discover</h1>
        <p className="text-gray-500 text-sm mt-1">Every UK gig, from arenas to pub back rooms.</p>
      </div>

      {/* Search + view toggle */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <input
            type="text"
            placeholder="Filter by city or town..."
            value={city}
            onChange={e => { setCity(e.target.value); setPage(1); }}
            className="input pl-9 w-full"
          />
        </div>
        <div className="flex gap-1.5">
          {[['gigs', 'Gigs'], ['venues', 'Venues']].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${
                view === v ? 'bg-brand text-white' : 'bg-surface-2 text-gray-400 hover:text-white border border-white/5'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Genre chips — only for gig view */}
      {view === 'gigs' && (
        <div className="flex flex-wrap gap-2">
          {GENRES.map(g => (
            <button key={g} onClick={() => { setGenre(genre === g ? '' : g); setPage(1); }}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-colors border ${
                genre === g
                  ? 'bg-brand/20 text-brand border-brand/40'
                  : 'bg-surface-2 text-gray-400 border-white/5 hover:border-white/15 hover:text-gray-300'
              }`}>
              {g}
            </button>
          ))}
          {(city || genre) && (
            <button onClick={clearFilters} className="text-xs px-3 py-1 rounded-full text-gray-500 hover:text-white border border-white/5 transition-colors">
              Clear filters ×
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse h-20 bg-surface-2 rounded-xl" />
          ))}
        </div>
      ) : view === 'venues' ? (
        <>
          <p className="text-xs text-gray-500">{filteredVenues.length} venues</p>
          {filteredVenues.length === 0 ? (
            <div className="card p-12 text-center text-gray-500 text-sm">No venues found.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filteredVenues.slice(0, 50).map(v => <VenueCard key={v.venueId} venue={v} />)}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500">{filteredGigs.length} gigs{city ? ` in ${city}` : ''}</p>
          {filteredGigs.length === 0 ? (
            <div className="card p-12 text-center text-gray-500 text-sm">No gigs found. Try a different city or genre.</div>
          ) : (
            <>
              <div className="space-y-2">
                {pagedGigs.map(g => {
                  const artist    = artistMap[g.artistId];
                  const isGrassroots = !artist?.lastfmRank || artist.lastfmRank > 500;
                  return (
                    <div key={g.gigId} className="relative">
                      {isGrassroots && (
                        <span className="absolute -top-1 right-2 z-10 text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded px-1.5 py-0.5">
                          Grassroots
                        </span>
                      )}
                      <GigCard gig={g} showArtist />
                    </div>
                  );
                })}
              </div>
              {hasMore && (
                <div className="text-center mt-4">
                  <button onClick={() => setPage(p => p + 1)} className="btn-secondary px-8">
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
