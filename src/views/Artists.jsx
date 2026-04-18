import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../utils/api.js';
import ArtistCard from '../components/ArtistCard.jsx';

const GENRES = ['All', 'Rock', 'Pop', 'Electronic', 'Hip-Hop', 'Indie', 'Metal', 'R&B', 'Alternative'];

export default function Artists() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [genre, setGenre]     = useState('All');
  const [page, setPage]       = useState(1);
  const PER_PAGE = 48;

  useEffect(() => {
    api.getArtists()
      .then(setArtists)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = artists;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a => a.name.toLowerCase().includes(q));
    }
    if (genre !== 'All') {
      list = list.filter(a => a.genres?.some(g => g.toLowerCase().includes(genre.toLowerCase())));
    }
    return list;
  }, [artists, search, genre]);

  const paged    = filtered.slice(0, page * PER_PAGE);
  const hasMore  = paged.length < filtered.length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">Top 1,000 UK Artists</h1>

        {/* Search */}
        <input
          className="input max-w-sm mb-4"
          type="text"
          placeholder="Search artists…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          autoFocus
        />

        {/* Genre filter */}
        <div className="flex gap-2 flex-wrap">
          {GENRES.map(g => (
            <button
              key={g}
              onClick={() => { setGenre(g); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                genre === g
                  ? 'bg-brand text-white'
                  : 'bg-surface-2 text-gray-400 hover:text-white border border-white/5'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="animate-pulse aspect-square bg-surface-2 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {search ? `No artists found for "${search}"` : 'No artists loaded yet.'}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">{filtered.length} artists</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {paged.map(a => <ArtistCard key={a.artistId} artist={a} />)}
          </div>
          {hasMore && (
            <div className="text-center mt-8">
              <button onClick={() => setPage(p => p + 1)} className="btn-secondary px-8">
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
