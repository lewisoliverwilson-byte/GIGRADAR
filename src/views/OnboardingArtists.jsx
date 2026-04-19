import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useFollow } from '../context/FollowContext.jsx';

export default function OnboardingArtists() {
  const router = useRouter();
  const { following, bulkFollow } = useFollow();
  const [artists, setArtists] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('spotify_matched_artists');
    if (raw === null) { router.push('/onboarding/connect'); return; }
    try {
      const data = JSON.parse(raw);
      const unFollowed = data.filter(a => !following.has(a.artistId));
      setArtists(unFollowed);
      setSelected(new Set(unFollowed.map(a => a.artistId)));
    } catch {
      router.push('/onboarding/connect');
    }
  }, []);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(artists.map(a => a.artistId))); }
  function deselectAll() { setSelected(new Set()); }

  function handleFollow() {
    setSaving(true);
    bulkFollow([...selected]);
    sessionStorage.removeItem('spotify_matched_artists');
    router.push('/');
  }

  if (artists === null) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (artists.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-4xl mb-4">🎵</p>
          <h2 className="text-xl font-bold text-white mb-3">
            We couldn't find your artists in our UK database yet.
          </h2>
          <p className="text-zinc-400 text-sm mb-6">
            GigRadar covers UK artists. If you mainly listen to international acts, try searching for UK artists you love.
          </p>
          <button onClick={() => router.push('/discover')}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-3 rounded-xl transition-colors mb-3">
            Explore UK artists →
          </button>
          <button onClick={() => router.push('/')}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
            Go to homepage
          </button>
        </div>
      </div>
    );
  }

  const selectedCount = selected.size;

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="flex justify-center gap-2 pt-8 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-zinc-600" />
        <div className="w-2 h-2 rounded-full bg-violet-600" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-sm mx-auto w-full">
        <h1 className="text-2xl font-bold text-white mb-1">We found your artists</h1>
        <p className="text-zinc-400 text-sm mb-3 leading-relaxed">
          These are the UK artists we found from your listening history. Uncheck any you don't want to follow.
        </p>

        <div className="flex items-center gap-2 mb-5">
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-green-700 bg-green-900 text-green-400">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            From Spotify
          </span>
        </div>

        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-zinc-400">{selectedCount} of {artists.length} selected</span>
          <div className="flex gap-3">
            <button onClick={selectAll} className="text-xs text-violet-400 hover:underline">Select all</button>
            <button onClick={deselectAll} className="text-xs text-zinc-500 hover:underline">Deselect all</button>
          </div>
        </div>

        <div className="space-y-2">
          {artists.map(artist => {
            const isChecked = selected.has(artist.artistId);
            return (
              <button key={artist.artistId} onClick={() => toggle(artist.artistId)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                  isChecked ? 'bg-zinc-900 border-zinc-700' : 'bg-transparent border-zinc-800 opacity-40'
                }`}>
                {artist.imageUrl ? (
                  <img src={artist.imageUrl} alt={artist.name}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-zinc-700 flex-shrink-0 flex items-center justify-center text-sm font-bold text-zinc-400">
                    {artist.name[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{artist.name}</p>
                  {artist.genres?.length > 0 && (
                    <p className="text-xs text-zinc-500 truncate capitalize">
                      {artist.genres.slice(0, 2).join(' · ')}
                    </p>
                  )}
                </div>
                <div className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                  isChecked ? 'bg-violet-600 border-violet-600' : 'border-zinc-600 bg-transparent'
                }`}>
                  {isChecked && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-zinc-800 px-4 py-4 bg-zinc-950 max-w-sm mx-auto w-full">
        <button onClick={handleFollow} disabled={selectedCount === 0 || saving}
          className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50">
          {saving ? 'Following…' : `Follow ${selectedCount} artist${selectedCount !== 1 ? 's' : ''} →`}
        </button>
        <button onClick={() => { sessionStorage.removeItem('spotify_matched_artists'); router.push('/'); }}
          className="w-full text-center text-sm text-zinc-500 hover:text-zinc-300 transition-colors mt-3">
          Skip and explore manually
        </button>
      </div>
    </div>
  );
}
