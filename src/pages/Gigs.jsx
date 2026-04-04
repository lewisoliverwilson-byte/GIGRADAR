import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../utils/api.js';
import { useFollow } from '../context/FollowContext.jsx';
import GigCard from '../components/GigCard.jsx';

const CITIES = ['All', 'London', 'Manchester', 'Glasgow', 'Birmingham', 'Leeds', 'Bristol', 'Edinburgh', 'Liverpool', 'Newcastle'];

export default function Gigs() {
  const [searchParams] = useSearchParams();
  const { following }  = useFollow();
  const [gigs, setGigs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity]   = useState('All');
  const [filter, setFilter] = useState(searchParams.get('filter') || 'all');
  const [page, setPage]   = useState(1);
  const PER_PAGE = 20;

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    api.getGigs().then(setGigs).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = gigs.filter(g => g.date >= today);
    if (filter === 'following') list = list.filter(g => following.has(g.artistId));
    if (city !== 'All') list = list.filter(g => g.venueCity?.toLowerCase().includes(city.toLowerCase()));
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [gigs, filter, city, following, today]);

  const paged   = filtered.slice(0, page * PER_PAGE);
  const hasMore = paged.length < filtered.length;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold mb-5">Upcoming Gigs</h1>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex gap-2">
          {[['all', 'All gigs'], ['following', 'Artists I follow']].map(([val, label]) => (
            <button key={val} onClick={() => { setFilter(val); setPage(1); }}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filter === val ? 'bg-brand text-white' : 'bg-surface-2 text-gray-400 hover:text-white border border-white/5'
              }`}>
              {label}
            </button>
          ))}
        </div>
        <select
          value={city}
          onChange={e => { setCity(e.target.value); setPage(1); }}
          className="input max-w-[160px] py-1.5 text-sm"
        >
          {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse h-20 bg-surface-2 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-gray-500 text-sm">
          {filter === 'following' ? 'No upcoming gigs for artists you follow.' : 'No gigs found.'}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">{filtered.length} gigs</p>
          <div className="space-y-2">
            {paged.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
          </div>
          {hasMore && (
            <div className="text-center mt-6">
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
