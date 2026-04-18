import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useFollow } from '../context/FollowContext.jsx';

export default function OnboardingArtists() {
  const router = useRouter();
  const { following, bulkFollow } = useFollow();
  const [artists, setArtists] = useState(null); // null = loading
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('spotify_matched_artists');
    if (raw === null) {
      router.push('/onboarding/connect');
      return;
    }
    try {
      const data = JSON.parse(raw);
      // Filter out artists already followed
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

  // Loading state
  if (artists === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Empty state — no matched UK artists
  if (artists.length === 0) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-4xl mb-4">🎵</p>
          <h2 className="text-xl font-bold text-white mb-3">
            We couldn't find your artists in our UK database yet.
          </h2>
          <p className="text-gray-400 text-sm mb-6">
            GigRadar covers UK artists. If you mainly listen to international acts, try searching for UK artists you love.
          </p>
          <button onClick={() => router.push('/discover')} className="btn-primary w-full mb-3">
            Explore UK artists →
          </button>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Go to homepage
          </button>
        </div>
      </div>
    );
  }

  const selectedCount = selected.size;
  const isNewFollows = artists.length < (JSON.parse(sessionStorage.getItem('spotify_matched_artists') || '[]').length);

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Progress dots */}
      <div className="flex justify-center gap-2 pt-8 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-white/30" />
        <div className="w-2 h-2 rounded-full bg-brand" />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-sm mx-auto w-full">
        <h1 className="text-2xl font-bold text-white mb-1">We found your artists</h1>
        <p className="text-gray-400 text-sm mb-3 leading-relaxed">
          These are the UK artists we found from your listening history. Uncheck any you don't want to follow.
        </p>

        <div className="flex items-center gap-2 mb-5">
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
            style={{ backgroundColor: 'rgba(29,185,84,0.1)', borderColor: 'rgba(29,185,84,0.3)', color: '#1DB954' }}>
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            From Spotify
          </span>
        </div>

        {/* Select controls */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-400">
            {selectedCount} of {artists.length} selected
          </span>
          <div className="flex gap-3">
            <button onClick={selectAll} className="text-xs text-brand hover:underline">
              Select all
            </button>
            <button onClick={deselectAll} className="text-xs text-gray-500 hover:underline">
              Deselect all
            </button>
          </div>
        </div>

        {/* Artist list */}
        <div className="space-y-2">
          {artists.map(artist => {
            const isChecked = selected.has(artist.artistId);
            return (
              <button
                key={artist.artistId}
                onClick={() => toggle(artist.artistId)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                  isChecked
                    ? 'bg-white/5 border-white/10'
                    : 'bg-transparent border-white/5 opacity-40'
                }`}
              >
                {artist.imageUrl ? (
                  <img
                    src={artist.imageUrl}
                    alt={artist.name}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0 flex items-center justify-center text-sm font-bold text-white/40">
                    {artist.name[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{artist.name}</p>
                  {artist.genres?.length > 0 && (
                    <p className="text-xs text-gray-500 truncate capitalize">
                      {artist.genres.slice(0, 2).join(' · ')}
                    </p>
                  )}
                </div>
                <div className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                  isChecked ? 'bg-brand border-brand' : 'border-white/20 bg-transparent'
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

      {/* Sticky CTA */}
      <div className="flex-shrink-0 border-t border-white/5 px-4 py-4 bg-surface max-w-sm mx-auto w-full">
        <button
          onClick={handleFollow}
          disabled={selectedCount === 0 || saving}
          className="btn-primary w-full py-3"
        >
          {saving
            ? 'Following…'
            : `Follow ${selectedCount} artist${selectedCount !== 1 ? 's' : ''} →`}
        </button>
        <button
          onClick={() => { sessionStorage.removeItem('spotify_matched_artists'); router.push('/'); }}
          className="w-full text-center text-sm text-gray-500 hover:text-gray-300 transition-colors mt-3"
        >
          Skip and explore manually
        </button>
      </div>
    </div>
  );
}
