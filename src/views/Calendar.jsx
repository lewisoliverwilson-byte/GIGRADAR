import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { api } from '../utils/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import Footer from '../components/Footer.jsx';

const CITIES = ['All', 'London', 'Manchester', 'Birmingham', 'Glasgow', 'Liverpool', 'Leeds', 'Bristol', 'Edinburgh', 'Newcastle', 'Brighton'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMonthYear(date) {
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function formatDayNum(date) {
  return date.getDate();
}

function isToday(date) {
  return toISO(date) === toISO(new Date());
}

function isPast(date) {
  return toISO(date) < toISO(new Date());
}

export default function Calendar() {
  const today = new Date();
  const { user } = useAuth();
  const { following, followingVenues } = useFollow();
  const personalised = following.size > 0 || followingVenues.size > 0;

  const [viewMode, setViewMode]       = useState('month');
  const [currentDate, setCurrentDate] = useState(today);
  const [city, setCity]               = useState('All');
  const [gigs, setGigs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);

  // Derive date range for current view
  const { rangeFrom, rangeTo, weeks } = useMemo(() => {
    if (viewMode === 'week') {
      const mon = getMondayOfWeek(currentDate);
      const sun = addDays(mon, 6);
      return {
        rangeFrom: toISO(mon),
        rangeTo: toISO(sun),
        weeks: [[0, 1, 2, 3, 4, 5, 6].map(i => addDays(mon, i))],
      };
    }
    // Month view — full weeks containing the month
    const firstOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastOfMonth  = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const gridStart    = getMondayOfWeek(firstOfMonth);
    const gridEnd      = addDays(getMondayOfWeek(lastOfMonth), 6);
    const ws = [];
    let cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      ws.push([0, 1, 2, 3, 4, 5, 6].map(i => addDays(cursor, i)));
      cursor = addDays(cursor, 7);
    }
    return { rangeFrom: toISO(gridStart), rangeTo: toISO(gridEnd), weeks: ws };
  }, [viewMode, currentDate]);

  // Fetch gigs when range, city, or followed artists change.
  // Personalised (user has follows): fetch per-artist so only their gigs show.
  // All-gigs mode: fetch by date range, one request per week in parallel.
  useEffect(() => {
    setLoading(true);

    if (personalised) {
      const artistFetches = [...following].map(id => api.getArtistGigs(id).catch(() => []));
      const venueFetches  = [...followingVenues].map(id => api.getVenueGigs(id).catch(() => []));
      Promise.all([...artistFetches, ...venueFetches])
        .then(results => {
          const all = results.flat().filter(g => g.date >= rangeFrom && g.date <= rangeTo);
          const seen = new Set();
          const deduped = all.filter(g => { if (seen.has(g.gigId)) return false; seen.add(g.gigId); return true; });
          setGigs(deduped);
        })
        .finally(() => setLoading(false));
      return;
    }

    const cityParam = city !== 'All' ? city : undefined;

    if (viewMode === 'week') {
      const params = { from: rangeFrom, to: rangeTo, limit: 2000 };
      if (cityParam) params.city = cityParam;
      api.getGigs(params)
        .then(g => setGigs(Array.isArray(g) ? g : []))
        .catch(() => setGigs([]))
        .finally(() => setLoading(false));
    } else {
      // One request per week in parallel so each week gets its own budget
      const weekFetches = weeks.map(week => {
        const from = toISO(week[0]);
        const to   = toISO(week[6]);
        const params = { from, to, limit: 500 };
        if (cityParam) params.city = cityParam;
        return api.getGigs(params).catch(() => []);
      });
      Promise.all(weekFetches)
        .then(results => setGigs(results.flat().filter(Boolean)))
        .finally(() => setLoading(false));
    }
  }, [rangeFrom, rangeTo, city, viewMode, weeks, personalised, following]);

  // Group gigs by date
  const gigsByDate = useMemo(() => {
    const map = {};
    gigs.forEach(g => {
      if (!map[g.date]) map[g.date] = [];
      map[g.date].push(g);
    });
    return map;
  }, [gigs]);

  const selectedGigs = selectedDay ? (gigsByDate[selectedDay] || []) : [];

  function prevPeriod() {
    if (viewMode === 'week') {
      setCurrentDate(d => addDays(d, -7));
    } else {
      setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    }
    setSelectedDay(null);
  }

  function nextPeriod() {
    if (viewMode === 'week') {
      setCurrentDate(d => addDays(d, 7));
    } else {
      setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    }
    setSelectedDay(null);
  }

  function goToday() {
    setCurrentDate(new Date());
    setSelectedDay(toISO(new Date()));
  }

  const headerLabel = viewMode === 'month'
    ? formatMonthYear(currentDate)
    : (() => {
        const mon = getMondayOfWeek(currentDate);
        const sun = addDays(mon, 6);
        return `${mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${sun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      })();

  const currentMonth = currentDate.getMonth();

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-2">Browse</p>
          <h1 className="text-4xl font-black text-white mb-1">Gig Calendar</h1>
          <p className="text-zinc-400 text-sm">
            {personalised
              ? `Gigs from your ${following.size} followed artist${following.size !== 1 ? 's' : ''}${followingVenues.size > 0 ? ` and ${followingVenues.size} venue${followingVenues.size !== 1 ? 's' : ''}` : ''}, laid out by date.`
              : 'Every UK gig, laid out by date.'}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-zinc-900 border-b border-zinc-800 sticky top-14 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">

          {/* View toggle */}
          <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 shrink-0">
            {[['month', 'Month'], ['week', 'Week']].map(([v, label]) => (
              <button key={v} onClick={() => { setViewMode(v); setSelectedDay(null); }}
                className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  viewMode === v ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {/* Nav */}
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={prevPeriod}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors text-lg">
              ‹
            </button>
            <span className="text-white font-semibold text-sm min-w-40 text-center">{headerLabel}</span>
            <button onClick={nextPeriod}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors text-lg">
              ›
            </button>
            <button onClick={goToday}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors font-medium">
              Today
            </button>
          </div>

          {/* City filter — hidden in personalised mode */}
          {personalised ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-violet-400 font-medium">
                ✦ {following.size} artist{following.size !== 1 ? 's' : ''}{followingVenues.size > 0 ? ` · ${followingVenues.size} venue${followingVenues.size !== 1 ? 's' : ''}` : ''}
              </span>
              <Link href="/profile" className="text-xs text-zinc-500 hover:text-white transition-colors">
                Edit follows →
              </Link>
            </div>
          ) : (
          <div className="flex gap-1.5 flex-wrap ml-auto">
            {CITIES.map(c => (
              <button key={c} onClick={() => setCity(c)}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                  city === c
                    ? 'bg-violet-600 border-violet-600 text-white'
                    : 'bg-transparent border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
                }`}>
                {c}
              </button>
            ))}
          </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        <div className={selectedDay ? 'grid grid-cols-1 lg:grid-cols-3 gap-0 lg:gap-6 pt-6' : 'pt-6'}>

          {/* Calendar grid */}
          <div className={selectedDay ? 'lg:col-span-2' : ''}>
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map(d => (
                <div key={d} className="text-center text-xs font-semibold text-zinc-500 uppercase tracking-widest py-2">
                  {d}
                </div>
              ))}
            </div>

            {/* Weeks */}
            <div className="space-y-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1">
                  {week.map(date => {
                    const iso = toISO(date);
                    const dayGigs = gigsByDate[iso] || [];
                    const inMonth = date.getMonth() === currentMonth;
                    const selected = selectedDay === iso;
                    const todayCell = isToday(date);
                    const past = isPast(date) && !todayCell;

                    return (
                      <button
                        key={iso}
                        onClick={() => setSelectedDay(selected ? null : iso)}
                        className={`
                          min-h-16 sm:min-h-20 rounded-xl p-1.5 sm:p-2 text-left transition-all border
                          ${selected
                            ? 'bg-violet-600 border-violet-500'
                            : todayCell
                            ? 'bg-zinc-800 border-violet-700 ring-1 ring-violet-600'
                            : past && !inMonth
                            ? 'bg-zinc-950 border-zinc-900 opacity-40'
                            : past
                            ? 'bg-zinc-950 border-zinc-800 opacity-60'
                            : inMonth
                            ? 'bg-zinc-900 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800'
                            : 'bg-zinc-950 border-zinc-900 opacity-50'
                          }
                        `}
                      >
                        <span className={`text-xs font-bold block mb-1 ${
                          selected ? 'text-white' : todayCell ? 'text-violet-400' : inMonth ? 'text-zinc-300' : 'text-zinc-600'
                        }`}>
                          {formatDayNum(date)}
                        </span>

                        {loading ? (
                          dayGigs.length === 0 && inMonth ? (
                            <div className="h-2 w-8 bg-zinc-700 rounded animate-pulse" />
                          ) : null
                        ) : dayGigs.length > 0 ? (
                          <div className="space-y-0.5">
                            {dayGigs.slice(0, viewMode === 'week' ? 6 : 3).map(g => (
                              <div key={g.gigId}
                                className={`text-[10px] sm:text-xs truncate rounded px-1 py-0.5 font-medium ${
                                  selected ? 'bg-violet-500 text-white' : 'bg-zinc-700 text-zinc-300'
                                }`}>
                                {g.artistName || g.artistId?.replace(/-/g, ' ')}
                              </div>
                            ))}
                            {dayGigs.length > (viewMode === 'week' ? 6 : 3) && (
                              <p className={`text-[10px] font-medium ${selected ? 'text-violet-200' : 'text-zinc-500'}`}>
                                +{dayGigs.length - (viewMode === 'week' ? 6 : 3)} more
                              </p>
                            )}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {!loading && (
              <p className="text-xs text-zinc-600 mt-4 text-right">
                {gigs.length.toLocaleString()} gig{gigs.length !== 1 ? 's' : ''}{' '}
                {personalised
                  ? `from ${following.size + followingVenues.size} followed`
                  : city !== 'All' ? `in ${city}` : 'across UK'}
                {' · click a day for details'}
              </p>
            )}
          </div>

          {/* Day detail panel */}
          {selectedDay && (
            <div className="lg:col-span-1 mt-6 lg:mt-0">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 lg:sticky lg:top-32">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-white text-base">
                    {new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-GB', {
                      weekday: 'long', day: 'numeric', month: 'long',
                    })}
                  </h2>
                  <button onClick={() => setSelectedDay(null)} className="text-zinc-500 hover:text-white transition-colors text-lg leading-none">×</button>
                </div>

                {selectedGigs.length === 0 ? (
                  <p className="text-zinc-500 text-sm">
                    {personalised ? 'None of your followed artists play on this day.' : `No gigs${city !== 'All' ? ` in ${city}` : ''} on this day.`}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                    {selectedGigs.map(g => (
                      <div key={g.gigId} className="bg-zinc-800 rounded-xl p-3">
                        <Link href={`/artists/${g.artistId}`}
                          className="text-sm font-semibold text-white hover:text-violet-300 transition-colors capitalize block truncate">
                          {g.artistName || g.artistId?.replace(/-/g, ' ')}
                        </Link>
                        <p className="text-xs text-zinc-400 mt-0.5 truncate">
                          {g.venueName}{g.venueCity ? `, ${g.venueCity}` : ''}
                        </p>
                        {g.minPrice != null && (
                          <p className="text-xs text-zinc-500 mt-0.5">from £{g.minPrice}</p>
                        )}
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {(g.tickets || []).slice(0, 3).map((t, i) => (
                            <a key={i} href={t.url} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] bg-violet-600 hover:bg-violet-500 text-white font-semibold px-2 py-1 rounded-md transition-colors">
                              {t.seller}
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedGigs.length > 0 && (
                  <p className="text-xs text-zinc-600 mt-3">{selectedGigs.length} gig{selectedGigs.length !== 1 ? 's' : ''}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
