import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../utils/api.js';
import ArtistCard from '../components/ArtistCard.jsx';
import Footer from '../components/Footer.jsx';

const GENRES = ['All', 'Rock', 'Pop', 'Indie', 'Electronic', 'Hip-Hop', 'Metal', 'R&B', 'Alternative', 'Folk', 'Jazz', 'Punk'];
const PER_PAGE = 48;

export default function Artists() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('All');
  const [page, setPage] = useState(1);

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

  const paged = filtered.slice(0, page * PER_PAGE);
  const hasMore = paged.length < filtered.length;

  function handleSearch(val) { setSearch(val); setPage(1); }
  function handleGenre(val)  { setGenre(val);  setPage(1); }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-white/5 bg-white/2">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-2">Discover</p>
          <h1 className="text-4xl font-black text-white mb-2">UK Artists</h1>
          <p className="text-zinc-400 text-sm">18,000+ UK artists tracked. Follow to get gig alerts.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-6 pt-6 pb-4">
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search artists…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500/50 text-sm"
            />
          </div>
          {search && (
            <button onClick={() => handleSearch('')} className="text-sm text-zinc-500 hover:text-white px-3 py-2 rounded-xl bg-white/5 transition-colors">
              Clear
            </button>
          )}
        </div>

        {/* Genre pills */}
        <div className="flex gap-2 flex-wrap">
          {GENRES.map(g => (
            <button
              key={g}
              onClick={() => handleGenre(g)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all duration-150 ${
                genre === g
                  ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
                  : 'bg-transparent border-white/10 text-zinc-400 hover:text-white hover:border-white/20'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-7xl mx-auto px-6 pb-16 pt-4">
        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-zinc-500">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-white font-semibold">No artists found</p>
            <p className="text-sm mt-1">{search ? `No results for "${search}"` : 'Try a different filter.'}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-5">{filtered.length.toLocaleString()} artists</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {paged.map(a => <ArtistCard key={a.artistId} artist={a} />)}
            </div>
            {hasMore && (
              <div className="text-center mt-10">
                <button
                  onClick={() => setPage(p => p + 1)}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold px-10 py-3 rounded-xl transition-colors text-sm"
                >
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
