import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../utils/api.js';
import ArtistCard from '../components/ArtistCard.jsx';
import Footer from '../components/Footer.jsx';

const GENRES = ['All', 'Rock', 'Pop', 'Indie', 'Electronic', 'Hip-Hop', 'Metal', 'R&B', 'Alternative', 'Folk', 'Jazz', 'Punk'];
const PER_PAGE = 48;

export default function Artists() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [genre,   setGenre]   = useState('All');
  const [page,    setPage]    = useState(1);

  useEffect(() => {
    api.getArtists()
      .then(setArtists)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = artists;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(a => a.name.toLowerCase().includes(q));
    }
    if (genre !== 'All') {
      list = list.filter(a => a.genres?.some(g => g.toLowerCase().includes(genre.toLowerCase())));
    }
    return list;
  }, [artists, search, genre]);

  const paged   = filtered.slice(0, page * PER_PAGE);
  const hasMore = paged.length < filtered.length;

  function handleSearch(val) { setSearch(val); setPage(1); }
  function handleGenre(val)  { setGenre(val);  setPage(1); }

  return (
    <div className="min-h-screen bg-surface">
      {/* Page header */}
      <div className="bg-surface-1 border-b border-white/5">
        <div className="section py-12">
          <p className="text-sm text-brand-light font-medium mb-2 uppercase tracking-widest">Discover</p>
          <h1 className="text-4xl font-black text-white mb-3">UK Artists</h1>
          <p className="text-zinc-400 max-w-lg">
            18,000+ UK artists tracked across every major ticket platform. Follow artists to get gig alerts.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="section pt-6 pb-4">
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search artists…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="input pl-10"
              autoFocus
            />
          </div>
          {search && (
            <button onClick={() => handleSearch('')} className="btn-ghost text-sm">Clear</button>
          )}
        </div>

        {/* Genre pills */}
        <div className="flex gap-2 flex-wrap">
          {GENRES.map(g => (
            <button
              key={g}
              onClick={() => handleGenre(g)}
              className={genre === g ? 'pill-active' : 'pill'}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="section pb-16 pt-4">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="skeleton aspect-square rounded-2xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-zinc-500">
            <span className="text-4xl block mb-3">🔍</span>
            <p className="text-white font-semibold">No artists found</p>
            <p className="text-sm mt-1">{search ? `No results for "${search}"` : 'Try a different filter.'}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-5">
              {filtered.length.toLocaleString()} artist{filtered.length !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {paged.map(a => <ArtistCard key={a.artistId} artist={a} />)}
            </div>
            {hasMore && (
              <div className="text-center mt-10">
                <button onClick={() => setPage(p => p + 1)} className="btn-secondary px-10 py-3 rounded-xl">
                  Load more artists
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <Footer />
    </div>
  );
}
