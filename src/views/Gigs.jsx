import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { api } from '../utils/api.js';
import { useFollow } from '../context/FollowContext.jsx';
import GigCard from '../components/GigCard.jsx';
import Footer from '../components/Footer.jsx';

const CITIES = ['All','London','Manchester','Birmingham','Glasgow','Liverpool','Leeds','Bristol','Edinburgh','Newcastle','Sheffield','Nottingham','Cardiff','Brighton','Oxford','Leicester','Southampton','Belfast'];

function todayStr() { return new Date().toISOString().split('T')[0]; }

export default function Gigs() {
  const router = useRouter();
  const { following } = useFollow();
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [city, setCity] = useState('All');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState('all');
  const [ready, setReady] = useState(false);
  const PER_PAGE = 24;

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
    setLoading(true); setPage(1);
    const params = { limit: 500 };
    if (city !== 'All') params.city = city;
    if (from) params.from = from;
    if (to) params.to = to;
    api.getGigs(params).then(setGigs).catch(() => setGigs([])).finally(() => setLoading(false));
  }, [city, from, to, ready]);

  useEffect(() => { fetchGigs(); }, [fetchGigs]);

  useEffect(() => {
    if (!ready) return;
    const p = {};
    if (city !== 'All') p.city = city;
    if (from) p.from = from;
    if (to) p.to = to;
    if (filter !== 'all') p.filter = filter;
    router.replace({ pathname: '/gigs', query: p }, undefined, { shallow: true });
  }, [city, from, to, filter, ready]);

  const filtered = useMemo(() => {
    let list = gigs;
    if (filter === 'following') list = list.filter(g => following.has(g.artistId));
    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
    const seen = new Map();
    const deduped = [];
    for (const g of list) {
      const key = `${g.artistId}|${g.date}|${norm(g.venueName)}`;
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

  const paged = filtered.slice(0, page * PER_PAGE);
  const hasMore = paged.length < filtered.length;

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-2">Browse</p>
          <h1 className="text-4xl font-black text-white mb-2">Upcoming Gigs</h1>
          <p className="text-zinc-400 text-sm">Every UK gig across 10+ ticket platforms, updated every 6 hours.</p>
        </div>
      </div>

      <div className="bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex gap-1 bg-zinc-800 rounded-xl p-1">
              {[['all', 'All gigs'], ['following', 'Following']].map(([val, label]) => (
                <button key={val} onClick={() => { setFilter(val); setPage(1); }}
                  className={`text-sm px-4 py-1.5 rounded-lg font-medium transition-colors ${
                    filter === val ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            <select value={city} onChange={e => { setCity(e.target.value); setPage(1); }}
              className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500">
              {CITIES.map(c => <option key={c} value={c}>{c === 'All' ? 'All cities' : c}</option>)}
            </select>

            <div className="flex items-center gap-2">
              <input type="date" value={from} min={todayStr()} onChange={e => { setFrom(e.target.value); setPage(1); }}
                className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 w-36" />
              <span className="text-zinc-600">→</span>
              <input type="date" value={to} min={from || todayStr()} onChange={e => { setTo(e.target.value); setPage(1); }}
                className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 w-36" />
            </div>

            {(city !== 'All' || from || to || filter !== 'all') && (
              <button onClick={() => { setCity('All'); setFrom(''); setTo(''); setFilter('all'); setPage(1); }}
                className="text-sm text-zinc-500 hover:text-white transition-colors">
                Clear ×
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 pb-20">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-zinc-800 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">🎵</p>
            <p className="text-white font-bold text-lg">No gigs found</p>
            <p className="text-zinc-400 text-sm mt-2">
              {filter === 'following' ? 'None of your followed artists have upcoming shows.' : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-5">
              {filtered.length.toLocaleString()} gigs{city !== 'All' ? ` in ${city}` : ''}
            </p>
            <div className="space-y-2">
              {paged.map(g => <GigCard key={g.gigId} gig={g} showArtist />)}
            </div>
            {hasMore && (
              <div className="text-center mt-10">
                <button onClick={() => setPage(p => p + 1)}
                  className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-10 py-3 rounded-xl transition-colors text-sm">
                  Load more ({filtered.length - paged.length} remaining)
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
