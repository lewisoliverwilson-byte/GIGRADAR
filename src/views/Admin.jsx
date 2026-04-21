import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api.js';

const GENRES = [
  'Rock', 'Pop', 'Indie', 'Electronic / Dance', 'Hip-Hop / Rap',
  'Folk / Acoustic', 'Jazz', 'Metal / Heavy', 'Punk', 'R&B / Soul',
  'Alternative', 'Classical', 'Reggae / Ska', 'Blues', 'Experimental',
];

export default function Admin() {
  const [adminKey, setAdminKey]   = useState(() => sessionStorage.getItem('gigradar_admin_key') || '');
  const [keyInput, setKeyInput]   = useState('');
  const [authed, setAuthed]       = useState(false);
  const [authErr, setAuthErr]     = useState('');
  const [tab, setTab]             = useState('genres');

  // Genre queue state
  const [artists, setArtists]     = useState([]);
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [selected, setSelected]   = useState(null); // artist being edited
  const [pendingGenres, setPendingGenres] = useState([]);
  const [savingGenres, setSavingGenres]   = useState(false);
  const [genreFilter, setGenreFilter]     = useState('all'); // 'all' | 'untagged'

  // Claims state
  const [claims, setClaims]         = useState([]);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [actioning, setActioning]   = useState('');

  // Venue claims state
  const [venueClaims, setVenueClaims]       = useState([]);
  const [loadingVenueClaims, setLoadingVenueClaims] = useState(false);

  async function tryAuth() {
    setAuthErr('');
    try {
      await api.adminGetArtists(keyInput);
      sessionStorage.setItem('gigradar_admin_key', keyInput);
      setAdminKey(keyInput);
      setAuthed(true);
    } catch {
      setAuthErr('Invalid key or unable to connect.');
    }
  }

  const loadArtists = useCallback(async () => {
    setLoadingArtists(true);
    try {
      const data = await api.adminGetArtists(adminKey);
      setArtists(data);
    } catch { /* ignore */ }
    finally { setLoadingArtists(false); }
  }, [adminKey]);

  const loadClaims = useCallback(async () => {
    setLoadingClaims(true);
    try {
      const data = await api.adminGetClaims(adminKey);
      setClaims(data);
    } catch { /* ignore */ }
    finally { setLoadingClaims(false); }
  }, [adminKey]);

  const loadVenueClaims = useCallback(async () => {
    setLoadingVenueClaims(true);
    try {
      const data = await api.adminGetVenueClaims(adminKey);
      setVenueClaims(data);
    } catch { /* ignore */ }
    finally { setLoadingVenueClaims(false); }
  }, [adminKey]);

  useEffect(() => {
    if (!authed) return;
    loadArtists();
    loadClaims();
    loadVenueClaims();
  }, [authed, loadArtists, loadClaims, loadVenueClaims]);

  // Auto-auth if key is already in sessionStorage
  useEffect(() => {
    if (adminKey) {
      api.adminGetArtists(adminKey)
        .then(() => setAuthed(true))
        .catch(() => { sessionStorage.removeItem('gigradar_admin_key'); });
    }
  }, []); // eslint-disable-line

  function openGenreEdit(artist) {
    setSelected(artist);
    setPendingGenres(artist.genres || []);
  }

  function toggleGenre(g) {
    setPendingGenres(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
    );
  }

  async function saveGenres() {
    if (!selected) return;
    setSavingGenres(true);
    try {
      await api.adminSetGenres(selected.artistId, pendingGenres, adminKey);
      setArtists(prev => prev.map(a =>
        a.artistId === selected.artistId ? { ...a, genres: pendingGenres } : a
      ));
      setSelected(null);
    } catch { /* ignore */ }
    finally { setSavingGenres(false); }
  }

  async function handleClaim(artistId, action) {
    setActioning(artistId + action);
    try {
      if (action === 'approve') await api.adminApproveClaim(artistId, adminKey);
      else                      await api.adminRejectClaim(artistId, adminKey);
      setClaims(prev => prev.filter(a => a.artistId !== artistId));
    } catch { /* ignore */ }
    finally { setActioning(''); }
  }

  if (!authed) {
    return (
      <div className="max-w-sm mx-auto px-4 py-24 space-y-4">
        <h1 className="text-2xl font-bold text-center">Admin</h1>
        <input
          type="password"
          placeholder="Admin key"
          value={keyInput}
          onChange={e => setKeyInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && tryAuth()}
          className="input w-full"
          autoFocus
        />
        {authErr && <p className="text-red-400 text-sm text-center">{authErr}</p>}
        <button onClick={tryAuth} className="btn-primary w-full">Enter</button>
      </div>
    );
  }

  const displayArtists = genreFilter === 'untagged'
    ? artists.filter(a => !a.genres?.length)
    : artists;

  const untaggedCount = artists.filter(a => !a.genres?.length).length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Admin</h1>
        <button
          onClick={() => { sessionStorage.removeItem('gigradar_admin_key'); setAuthed(false); setAdminKey(''); }}
          className="text-xs text-gray-500 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-2 rounded-lg p-1 w-fit mb-6">
        {[
          ['genres', `Genre Queue (${untaggedCount} untagged)`],
          ['claims', `Artist Claims (${claims.length})`],
          ['venue-claims', `Venue Claims (${venueClaims.length})`],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-surface-1 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Genre tagging tab */}
      {tab === 'genres' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">{artists.length} artists total</span>
            <div className="flex gap-1 bg-surface-2 rounded-lg p-1">
              {[['all','All'],['untagged','Untagged only']].map(([v,l]) => (
                <button key={v} onClick={() => setGenreFilter(v)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    genreFilter === v ? 'bg-surface-1 text-white' : 'text-gray-400 hover:text-white'
                  }`}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={loadArtists} className="text-xs text-gray-500 hover:text-white transition-colors ml-auto">
              Refresh
            </button>
          </div>

          {loadingArtists ? (
            <div className="space-y-2 animate-pulse">
              {[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-surface-2 rounded-xl" />)}
            </div>
          ) : (
            <div className="space-y-1">
              {displayArtists.map(artist => (
                <div key={artist.artistId}
                  className="flex items-center gap-4 px-4 py-3 bg-surface-2 rounded-xl hover:bg-surface-3 cursor-pointer transition-colors"
                  onClick={() => openGenreEdit(artist)}>
                  <div className="w-5 text-xs text-gray-600 text-right flex-shrink-0">
                    {artist.lastfmRank || '—'}
                  </div>
                  <div className="font-medium text-sm flex-1 min-w-0 truncate">
                    {artist.name}
                    {artist.verified && (
                      <svg className="inline w-3.5 h-3.5 text-brand ml-1 mb-0.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {artist.genres?.length > 0
                      ? artist.genres.map(g => (
                          <span key={g} className="text-xs bg-brand/10 text-brand px-2 py-0.5 rounded">{g}</span>
                        ))
                      : <span className="text-xs text-gray-600 italic">No genres</span>
                    }
                  </div>
                  <svg className="w-4 h-4 text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              ))}
              {displayArtists.length === 0 && (
                <div className="text-center text-gray-500 text-sm py-12">
                  {genreFilter === 'untagged' ? 'All artists have genres tagged.' : 'No artists found.'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Claims tab */}
      {tab === 'claims' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">{claims.length} pending claim{claims.length !== 1 ? 's' : ''}</span>
            <button onClick={loadClaims} className="text-xs text-gray-500 hover:text-white transition-colors">
              Refresh
            </button>
          </div>

          {loadingClaims ? (
            <div className="space-y-2 animate-pulse">
              {[1,2].map(i => <div key={i} className="h-28 bg-surface-2 rounded-xl" />)}
            </div>
          ) : claims.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-12">No pending claims.</div>
          ) : (
            <div className="space-y-3">
              {claims.map(artist => (
                <div key={artist.artistId} className="card p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{artist.name}</p>
                      <p className="text-sm text-gray-400 mt-0.5">
                        <span className="text-white">{artist.pendingClaim?.email}</span>
                        {' · '}
                        {artist.pendingClaim?.timestamp
                          ? new Date(artist.pendingClaim.timestamp).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
                          : 'Unknown date'}
                      </p>
                      {artist.pendingClaim?.note && (
                        <p className="text-sm text-gray-400 mt-2 italic">"{artist.pendingClaim.note}"</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleClaim(artist.artistId, 'reject')}
                        disabled={!!actioning}
                        className="btn-ghost text-sm py-1.5 px-3 text-red-400 hover:text-red-300">
                        {actioning === artist.artistId + 'reject' ? '…' : 'Reject'}
                      </button>
                      <button
                        onClick={() => handleClaim(artist.artistId, 'approve')}
                        disabled={!!actioning}
                        className="btn-primary text-sm py-1.5 px-3">
                        {actioning === artist.artistId + 'approve' ? '…' : 'Approve'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Venue claims tab */}
      {tab === 'venue-claims' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">{venueClaims.length} pending claim{venueClaims.length !== 1 ? 's' : ''}</span>
            <button onClick={loadVenueClaims} className="text-xs text-gray-500 hover:text-white transition-colors">Refresh</button>
          </div>
          {loadingVenueClaims ? (
            <div className="space-y-2 animate-pulse">{[1,2].map(i => <div key={i} className="h-28 bg-surface-2 rounded-xl" />)}</div>
          ) : venueClaims.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-12">No pending venue claims.</div>
          ) : (
            <div className="space-y-3">
              {venueClaims.map(venue => (
                <div key={venue.venueId} className="card p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{venue.name} <span className="text-sm text-gray-500">{venue.city}</span></p>
                      <p className="text-sm text-gray-400 mt-0.5">
                        <span className="text-white">{venue.pendingClaim?.email}</span>
                        {' · '}{venue.pendingClaim?.role}
                        {' · '}
                        {venue.pendingClaim?.timestamp
                          ? new Date(venue.pendingClaim.timestamp).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
                          : 'Unknown date'}
                      </p>
                      {venue.pendingClaim?.note && (
                        <p className="text-sm text-gray-400 mt-2 italic">"{venue.pendingClaim.note}"</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={async () => { setActioning(venue.venueId+'reject'); try { await api.adminRejectVenueClaim(venue.venueId, adminKey); setVenueClaims(prev => prev.filter(v => v.venueId !== venue.venueId)); } catch {} finally { setActioning(''); } }}
                        disabled={!!actioning}
                        className="btn-ghost text-sm py-1.5 px-3 text-red-400 hover:text-red-300">
                        {actioning === venue.venueId+'reject' ? '…' : 'Reject'}
                      </button>
                      <button
                        onClick={async () => { setActioning(venue.venueId+'approve'); try { await api.adminApproveVenueClaim(venue.venueId, adminKey); setVenueClaims(prev => prev.filter(v => v.venueId !== venue.venueId)); } catch {} finally { setActioning(''); } }}
                        disabled={!!actioning}
                        className="btn-primary text-sm py-1.5 px-3">
                        {actioning === venue.venueId+'approve' ? '…' : 'Approve'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Genre edit drawer/modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative bg-surface-1 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <button onClick={() => setSelected(null)} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-xl font-bold mb-1">{selected.name}</h2>
            <p className="text-sm text-gray-400 mb-4">Select all applicable genres</p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {GENRES.map(g => (
                <button
                  key={g}
                  onClick={() => toggleGenre(g)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors text-left ${
                    pendingGenres.includes(g)
                      ? 'bg-brand/15 border-brand/40 text-brand'
                      : 'bg-surface-2 border-white/5 text-gray-400 hover:border-white/15 hover:text-white'
                  }`}>
                  {g}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={saveGenres} disabled={savingGenres} className="btn-primary flex-1">
                {savingGenres ? 'Saving…' : `Save (${pendingGenres.length} selected)`}
              </button>
              <button onClick={() => setSelected(null)} className="btn-ghost px-4">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
