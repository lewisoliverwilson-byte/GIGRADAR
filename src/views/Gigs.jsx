import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { api } from '../utils/api.js';
import { useFollow } from '../context/FollowContext.jsx';
import GigCard from '../components/GigCard.jsx';
import Footer from '../components/Footer.jsx';

const CITIES = ['All','London','Manchester','Birmingham','Glasgow','Liverpool','Leeds','Bristol','Edinburgh','Newcastle','Sheffield','Nottingham','Cardiff','Brighton','Oxford','Leicester','Southampton','Belfast'];
const GENRES = ['All','rock','indie','pop','electronic','dance','jazz','classical','hip-hop','folk','metal','punk','alternative','rnb','soul','country','reggae','blues','experimental'];
const RADII  = [5, 10, 15, 25, 50];

function todayStr() { return new Date().toISOString().split('T')[0]; }

export default function Gigs() {
  const router = useRouter();
  const { following } = useFollow();
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [city, setCity] = useState('All');
  const [genre, setGenre] = useState('All');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState('all');
  const [ready, setReady] = useState(false);
  const PER_PAGE = 24;

  // Near me state
  const [nearMode, setNearMode] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [userCoords, setUserCoords] = useState(null);
  const [radius, setRadius] = useState(15);
  const [maxPrice, setMaxPrice] = useState('');
  const [grassroots, setGrassroots] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    setCity(router.query.city || 'All');
    setGenre(router.query.genre || 'All');
    setFrom(router.query.from || '');
    setTo(router.query.to || '');
    setFilter(router.query.filter || 'all');
    setGrassroots(router.query.grassroots === 'true');
    // Auto-activate near me if redirected from homepage
    if (router.query.nearme === '1') {
      try {
        const stored = sessionStorage.getItem('nearme_coords');
        if (stored) {
          const coords = JSON.parse(stored);
          sessionStorage.removeItem('nearme_coords');
          setUserCoords(coords);
          setNearMode(true);
          fetchNearby(coords, 15, 'All');
        }
      } catch {}
    }
    setReady(true);
  }, [router.isReady]);

  const fetchNearby = useCallback((coords, r, g) => {
    setLoading(true);
    api.getNearbyGigs(coords.lat, coords.lng, r, g !== 'All' ? g : undefined)
      .then(setGigs)
      .catch(() => setGigs([]))
      .finally(() => setLoading(false));
  }, []);

  const fetchGigs = useCallback(() => {
    if (!ready || nearMode) return;
    setLoading(true); setPage(1);
    const params = { limit: 500 };
    if (city !== 'All') params.city = city;
    if (genre !== 'All') params.genre = genre;
    if (from) params.from = from;
    if (to) params.to = to;
    api.getGigs(params).then(setGigs).catch(() => setGigs([])).finally(() => setLoading(false));
  }, [city, genre, from, to, ready, nearMode]);

  useEffect(() => { fetchGigs(); }, [fetchGigs]);

  // Re-fetch nearby when radius or genre changes while in near mode
  useEffect(() => {
    if (nearMode && userCoords) {
      setPage(1);
      fetchNearby(userCoords, radius, genre);
    }
  }, [radius, nearMode, userCoords]);

  useEffect(() => {
    if (!ready || nearMode) return;
    const p = {};
    if (city !== 'All') p.city = city;
    if (genre !== 'All') p.genre = genre;
    if (from) p.from = from;
    if (to) p.to = to;
    if (filter !== 'all') p.filter = filter;
    router.replace({ pathname: '/gigs', query: p }, undefined, { shallow: true });
  }, [city, genre, from, to, filter, ready, nearMode]);

  function activateNearMe() {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }
    setGeoLoading(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserCoords(coords);
        setNearMode(true);
        setCity('All');
        setPage(1);
        setGeoLoading(false);
        fetchNearby(coords, radius, genre);
      },
      err => {
        setGeoLoading(false);
        setGeoError(err.code === 1 ? 'Location access denied. Please allow location in your browser.' : 'Could not get your location. Try again.');
      },
      { timeout: 10000 }
    );
  }

  function clearNearMe() {
    setNearMode(false);
    setUserCoords(null);
    setGeoError('');
    setPage(1);
    fetchGigs();
  }

  const filtered = useMemo(() => {
    let list = gigs;
    if (filter === 'following') list = list.filter(g => following.has(g.artistId));
    if (grassroots) list = list.filter(g => g._isGrassroots);
    if (maxPrice !== '') {
      const cap = parseFloat(maxPrice);
      if (!isNaN(cap)) list = list.filter(g => g.minPrice != null && g.minPrice <= cap);
    }
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
    return deduped.sort((a, b) => {
      if (nearMode) return (a._distanceMiles || 99) - (b._distanceMiles || 99) || a.date.localeCompare(b.date);
      return a.date.localeCompare(b.date);
    });
  }, [gigs, filter, following, nearMode]);

  const paged = filtered.slice(0, page * PER_PAGE);
  const hasMore = paged.length < filtered.length;
  const hasFilters = city !== 'All' || genre !== 'All' || from || to || filter !== 'all' || nearMode || maxPrice !== '' || grassroots;

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-2">Browse</p>
          <h1 className="text-4xl font-black text-white mb-2">Upcoming Gigs</h1>
          <p className="text-zinc-400 text-sm">Every UK gig across 14 ticket platforms, updated weekly.</p>
        </div>
      </div>

      <div className="bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3">

          {/* Row 1: mode toggles + near me + city + genre */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 shrink-0">
              {[['all', 'All'], ['following', 'Following']].map(([val, label]) => (
                <button key={val} onClick={() => { setFilter(val); setPage(1); }}
                  className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    filter === val ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {nearMode ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-emerald-900/50 border border-emerald-700 rounded-xl px-3 py-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span className="text-sm text-emerald-300 font-medium">Near me</span>
                </div>
                <select value={radius} onChange={e => { setRadius(Number(e.target.value)); setPage(1); }}
                  className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500">
                  {RADII.map(r => <option key={r} value={r}>{r} mi</option>)}
                </select>
                <button onClick={clearNearMe} className="text-zinc-500 hover:text-white transition-colors text-lg leading-none">×</button>
              </div>
            ) : (
              <button onClick={activateNearMe} disabled={geoLoading}
                className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-emerald-600 text-white text-sm font-medium px-3 py-2 rounded-xl transition-colors disabled:opacity-50 shrink-0">
                {geoLoading
                  ? <><span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin"></span> Locating…</>
                  : <>📍 Near me</>}
              </button>
            )}

            {!nearMode && (
              <select value={city} onChange={e => { setCity(e.target.value); setPage(1); }}
                className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 min-w-0">
                {CITIES.map(c => <option key={c} value={c}>{c === 'All' ? 'All cities' : c}</option>)}
              </select>
            )}

            <select value={genre} onChange={e => { setGenre(e.target.value); setPage(1); if (nearMode && userCoords) fetchNearby(userCoords, radius, e.target.value); }}
              className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 capitalize min-w-0">
              {GENRES.map(g => <option key={g} value={g}>{g === 'All' ? 'All genres' : g}</option>)}
            </select>

            {hasFilters && (
              <button onClick={() => { setCity('All'); setGenre('All'); setFrom(''); setTo(''); setFilter('all'); setMaxPrice(''); setGrassroots(false); setPage(1); clearNearMe(); }}
                className="text-sm text-zinc-500 hover:text-white transition-colors ml-auto">
                Clear ×
              </button>
            )}
          </div>

          {/* Row 2: price pills + grassroots + date range */}
          <div className="flex flex-wrap gap-2 items-center mt-2">
            <div className="flex gap-1 flex-wrap">
              {[['', 'Any price'], ['0', 'Free'], ['10', '£10'], ['20', '£20'], ['30', '£30'], ['50', '£50']].map(([val, label]) => (
                <button key={val} onClick={() => { setMaxPrice(val); setPage(1); }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                    maxPrice === val
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            <button onClick={() => { setGrassroots(g => !g); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                grassroots
                  ? 'bg-emerald-900/60 border-emerald-700 text-emerald-300'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
              }`}>
              🎸 Grassroots
            </button>

            {!nearMode && (
              <div className="flex items-center gap-1.5 ml-auto">
                <input type="date" value={from} min={todayStr()} onChange={e => { setFrom(e.target.value); setPage(1); }}
                  className="bg-zinc-800 border border-zinc-700 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500 w-32" />
                <span className="text-zinc-600 text-xs">→</span>
                <input type="date" value={to} min={from || todayStr()} onChange={e => { setTo(e.target.value); setPage(1); }}
                  className="bg-zinc-800 border border-zinc-700 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500 w-32" />
              </div>
            )}
          </div>

          {geoError && <p className="text-xs text-red-400 mt-2">{geoError}</p>}
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
              {nearMode ? `No gigs found within ${radius} miles. Try increasing the radius.`
                : filter === 'following' ? 'None of your followed artists have upcoming shows.'
                : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-5">
              {filtered.length.toLocaleString()} gigs
              {nearMode ? ` within ${radius} miles` : ''}
              {!nearMode && genre !== 'All' ? ` · ${genre}` : ''}
              {!nearMode && city !== 'All' ? ` in ${city}` : ''}
              {maxPrice === '0' ? ' · free' : maxPrice !== '' ? ` · under £${maxPrice}` : ''}
              {grassroots ? ' · grassroots venues' : ''}
            </p>
            <div className="space-y-2">
              {paged.map(g => (
                <GigCard key={g.gigId} gig={g} showArtist
                  distanceMiles={nearMode ? g._distanceMiles : undefined}
                  isGrassroots={g._isGrassroots} />
              ))}
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
