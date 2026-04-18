import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../utils/api.js';
import VenueCard from '../components/VenueCard.jsx';

const CITIES = ['All', 'London', 'Manchester', 'Birmingham', 'Glasgow', 'Leeds', 'Bristol',
  'Edinburgh', 'Liverpool', 'Sheffield', 'Newcastle', 'Nottingham', 'Brighton'];

export default function Venues() {
  const [venues,  setVenues]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [city,    setCity]    = useState('All');
  const [page,    setPage]    = useState(1);
  const PER_PAGE = 48;

  useEffect(() => {
    api.getVenues()
      .then(setVenues)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = venues.filter(v => v.isActive !== false);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(v =>
        v.name?.toLowerCase().includes(q) ||
        v.city?.toLowerCase().includes(q)
      );
    }
    if (city !== 'All') {
      list = list.filter(v => v.city?.toLowerCase().includes(city.toLowerCase()));
    }
    // Sort: venues with upcoming gigs first, then by name
    return list.sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0) || a.name?.localeCompare(b.name));
  }, [venues, search, city]);

  const paged   = filtered.slice(0, page * PER_PAGE);
  const hasMore = paged.length < filtered.length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">UK Venues</h1>

        <input
          className="input max-w-sm mb-4"
          type="text"
          placeholder="Search venues or cities…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          autoFocus
        />

        <div className="flex gap-2 flex-wrap">
          {CITIES.map(c => (
            <button
              key={c}
              onClick={() => { setCity(c); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                city === c
                  ? 'bg-brand text-white'
                  : 'bg-surface-2 text-gray-400 hover:text-white border border-white/5'
              }`}
            >
              {c}
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
          {search ? `No venues found for "${search}"` : 'No venues found.'}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">{filtered.length.toLocaleString()} venues</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {paged.map(v => <VenueCard key={v.venueId} venue={v} />)}
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
