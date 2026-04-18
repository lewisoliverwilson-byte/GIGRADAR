import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { api } from '../utils/api.js';
import { useFollow } from '../context/FollowContext.jsx';
import GigCard from '../components/GigCard.jsx';

const CITIES = [
  'All', 'London', 'Manchester', 'Birmingham', 'Glasgow', 'Liverpool',
  'Leeds', 'Bristol', 'Edinburgh', 'Newcastle', 'Sheffield', 'Nottingham',
  'Cardiff', 'Brighton', 'Oxford', 'Cambridge', 'Leicester', 'Southampton',
  'Reading', 'Belfast',
];

function todayStr() { return new Date().toISOString().split('T')[0]; }

export default function Gigs() {
  const router = useRouter();
  const { following } = useFollow();

  const [gigs, setGigs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const PER_PAGE = 24;

  // Filter state — initialise from URL params
  const [city,   setCity]   = useState('All');
  const [from,   setFrom]   = useState('');
  const [to,     setTo]     = useState('');
  const [filter, setFilter] = useState('all');
  const [ready,  setReady]  = useState(false);

  // Hydrate from URL once router is ready
  useEffect(() => {
    if (!router.isReady) return;
    setCity(router.query.city || 'All');
    setFrom(router.query.from || '');
    setTo(router.query.to || '');
    setFilter(router.query.filter || 'all');
    setReady(true);
  }, [router.isReady]);

  const fetchGigs = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    setPage(1);
    const params = { limit: 500 };
    if (city !== 'All') params.city = city;
    if (from)           params.from = from;
    if (to)             params.to   = to;
    api.getGigs(params)
      .then(setGigs)
      .catch(() => setGigs([]))
      .finally(() => setLoading(false));
  }, [city, from, to, ready]);

  useEffect(() => { fetchGigs(); }, [fetchGigs]);

  // Sync filters to URL
  useEffect(() => {
    if (!ready) return;
    const p = {};
    if (city !== 'All') p.city = city;
    if (from)           p.from = from;
    if (to)             p.to   = to;
    if (filter !== 'all') p.filter = filter;
    router.replace({ pathname: '/gigs', query: p }, undefined, { shallow: true });
  }, [city, from, to, filter, ready]);

  const filtered = useMemo(() => {
    let list = gigs;
    if (filter === 'following') list = list.filter(g => following.has(g.artistId));

    const normVenue = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
    const seen = new Map();
    const deduped = [];
    for (const g of list) {
      const key = `${g.artistId}|${g.date}|${normVenue(g.venueName)}`;
      if (seen.has(key)) {
        seen.get(key).tickets = [...(seen.get(key).tickets || []), ...(g.tickets || [])];
      } else {
        const merged = { ...g, tickets: [...(g.tickets || [])] };
        seen.set(key, merged);
        deduped.push(merged);
      }
    }
    return deduped.sort((a, b) => a.date.localeCompare(b.date));
  }, [gigs, filter, following]);

  const paged   = filtered.slice(0, page * PER_PAGE);
  const hasMore = paged.length < filtered.length;

  const clearDates = () => { setFrom(''); setTo(''); };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold mb-5">Upcoming Gigs</h1>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-6">
        {/* Row 1: view toggle + city */}
        <div className="flex flex-wrap gap-2 items-center">
          {[['all', 'All gigs'], ['following', 'Artists I follow']].map(([val, label]) => (
            <button key={val} onClick={() => { setFilter(val); setPage(1); }}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filter === val ? 'bg-brand text-white' : 'bg-surface-2 text-gray-400 hover:text-white border border-white/5'
              }`}>
              {label}
            </button>
          ))}
          <select
            value={city}
            onChange={e => setCity(e.target.value)}
            className="input max-w-[180px] py-1.5 text-sm ml-auto"
          >
            {CITIES.map(c => <option key={c} value={c}>{c === 'All' ? 'All cities' : c}</option>)}
          </select>
        </div>

        {/* Row 2: date range */}
        <div className="flex flex-wrap gap-2 items-center text-sm text-gray-400">
          <span className="text-xs uppercase tracking-wide text-gray-500">Dates:</span>
          <input
            type="date"
            value={from}
            min={todayStr()}
            onChange={e => setFrom(e.target.value)}
            className="input py-1.5 text-sm w-36"
            placeholder="From"
          />
          <span className="text-gray-600">→</span>
          <input
            type="date"
            value={to}
            min={from || todayStr()}
            onChange={e => setTo(e.target.value)}
            className="input py-1.5 text-sm w-36"
            placeholder="To"
          />
          {(from || to) && (
            <button onClick={clearDates} className="text-xs text-gray-500 hover:text-white underline">
              Clear
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="animate-pulse h-20 bg-surface-2 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-gray-500 text-sm">
          {filter === 'following'
            ? 'No upcoming gigs for artists you follow.'
            : city !== 'All'
              ? `No gigs found in ${city}${from ? ` from ${from}` : ''}.`
              : 'No gigs found.'}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            {filtered.length} gig{filtered.length !== 1 ? 's' : ''}
            {city !== 'All' ? ` in ${city}` : ''}
            {from ? ` from ${from}` : ''}
            {to   ? ` to ${to}`     : ''}
          </p>
          <div className="space-y-2">
            {paged.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
          </div>
          {hasMore && (
            <div className="text-center mt-6">
              <button onClick={() => setPage(p => p + 1)} className="btn-secondary px-8">
                Load more ({filtered.length - paged.length} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
