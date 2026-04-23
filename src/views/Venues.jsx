import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../utils/api.js';
import VenueCard from '../components/VenueCard.jsx';
import Footer from '../components/Footer.jsx';

const CITIES = [
  'All', 'London', 'Manchester', 'Birmingham', 'Glasgow', 'Leeds', 'Bristol',
  'Edinburgh', 'Liverpool', 'Sheffield', 'Newcastle', 'Nottingham', 'Brighton',
];

const PER_PAGE = 48;

export default function Venues() {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('All');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.getVenues().then(setVenues).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = venues.filter(v => v.isActive !== false);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(v => v.name?.toLowerCase().includes(q) || v.city?.toLowerCase().includes(q));
    }
    if (city !== 'All') {
      list = list.filter(v => v.city?.toLowerCase().includes(city.toLowerCase()));
    }
    return list.sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0) || a.name?.localeCompare(b.name));
  }, [venues, search, city]);

  const paged = filtered.slice(0, page * PER_PAGE);
  const hasMore = paged.length < filtered.length;

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-2">Discover</p>
          <h1 className="text-4xl font-black text-white mb-2">UK Venues</h1>
          <p className="text-zinc-400 text-sm">8,000+ UK venues tracked. Follow a venue to get alerts whenever new gigs are announced.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search venues or cities…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              autoFocus
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 text-sm transition-colors"
            />
          </div>
          {search && (
            <button onClick={() => { setSearch(''); setPage(1); }}
              className="text-sm text-zinc-400 hover:text-white px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors">
              Clear
            </button>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {CITIES.map(c => (
            <button key={c} onClick={() => { setCity(c); setPage(1); }}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                city === c
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : 'bg-transparent border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 pb-20">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-zinc-800 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">🔍</p>
            <p className="text-white font-bold text-lg">No venues found</p>
            <p className="text-zinc-400 text-sm mt-2">{search ? `No results for "${search}"` : 'Try a different filter.'}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-5">
              {filtered.length.toLocaleString()} venue{filtered.length !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {paged.map(v => <VenueCard key={v.venueId} venue={v} />)}
            </div>
            {hasMore && (
              <div className="text-center mt-10">
                <button onClick={() => setPage(p => p + 1)}
                  className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-10 py-3 rounded-xl transition-colors text-sm">
                  Load more venues
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
