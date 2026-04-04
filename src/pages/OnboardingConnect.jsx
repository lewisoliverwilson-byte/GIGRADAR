import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { initiateSpotifyAuth } from '../utils/spotify.js';

export default function OnboardingConnect() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [infoMsg, setInfoMsg] = useState('');

  // Decode connection state from localStorage
  const spotifyKey = user?.sub ? `gigradar_spotify_${user.sub}` : null;
  const spotifyConnected = spotifyKey
    ? JSON.parse(localStorage.getItem(spotifyKey) || 'null')?.connected === true
    : false;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'access_denied') {
      setInfoMsg("No problem — you can connect Spotify anytime from your profile.");
    } else if (err) {
      setInfoMsg("Something went wrong. Please try again.");
    }
  }, []);

  async function handleConnectSpotify() {
    setSpotifyLoading(true);
    try {
      await initiateSpotifyAuth(); // redirects away
    } catch {
      setSpotifyLoading(false);
      setInfoMsg('Could not start Spotify connection. Please try again.');
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4">
      {/* Progress dots */}
      <div className="flex gap-2 mb-10">
        <div className="w-2 h-2 rounded-full bg-brand" />
        <div className="w-2 h-2 rounded-full bg-white/20" />
      </div>

      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-white text-center mb-2">Find your artists</h1>
        <p className="text-gray-400 text-center mb-8 text-sm leading-relaxed">
          Connect your music to instantly follow the artists you listen to
        </p>

        {infoMsg && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-4 text-center text-sm text-gray-300">
            {infoMsg}
          </div>
        )}

        <div className="space-y-3">
          {/* Spotify */}
          <button
            onClick={handleConnectSpotify}
            disabled={spotifyLoading || spotifyConnected}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-semibold transition-all disabled:cursor-not-allowed"
            style={{
              backgroundColor: spotifyConnected ? '#1ed760' : '#1DB954',
              color: '#000',
              opacity: spotifyLoading ? 0.8 : 1,
            }}
          >
            {spotifyConnected ? (
              <>
                <CheckIcon />
                Spotify Connected
              </>
            ) : spotifyLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <SpotifyIcon />
                Connect Spotify
              </>
            )}
          </button>

          {/* Apple Music — coming soon */}
          <button
            disabled
            className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-semibold bg-white/90 text-gray-900 opacity-40 cursor-not-allowed"
          >
            <AppleIcon />
            Connect Apple Music
            <span className="text-xs font-normal text-gray-500 ml-1">(coming soon)</span>
          </button>
        </div>

        <div className="text-center mt-8">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Skip for now →
          </button>
        </div>
      </div>
    </div>
  );
}

function SpotifyIcon() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}
