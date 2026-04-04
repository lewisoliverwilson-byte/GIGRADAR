import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken } from '../utils/cognito.js';
import { CONFIG } from '../utils/config.js';

export default function SpotifyCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    handleCallback();
  }, []);

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const spotifyError = params.get('error');

    if (state !== sessionStorage.getItem('spotify_auth_state')) {
      navigate('/onboarding/connect?error=state_mismatch');
      return;
    }

    if (spotifyError) {
      navigate(`/onboarding/connect?error=${spotifyError}`);
      return;
    }

    if (!code) {
      navigate('/onboarding/connect?error=no_code');
      return;
    }

    try {
      const token = await getToken();
      if (!token) {
        navigate('/');
        return;
      }

      const codeVerifier = sessionStorage.getItem('spotify_code_verifier');
      const redirectUri = `${window.location.origin}/auth/spotify/callback`;

      // Exchange code for tokens (server-side)
      const exchangeRes = await fetch(`${CONFIG.apiBaseUrl}/api/auth/spotify/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code, codeVerifier, redirectUri }),
      });

      if (!exchangeRes.ok) {
        throw new Error('Token exchange failed');
      }

      // Fetch matched UK artists
      const artistsRes = await fetch(`${CONFIG.apiBaseUrl}/api/auth/spotify/artists`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!artistsRes.ok) {
        throw new Error('Could not fetch artists');
      }

      const { artists } = await artistsRes.json();

      sessionStorage.removeItem('spotify_code_verifier');
      sessionStorage.removeItem('spotify_auth_state');

      // Store matched artists for the confirm screen
      sessionStorage.setItem('spotify_matched_artists', JSON.stringify(artists || []));

      // Track connection in localStorage keyed by user (resolved server-side)
      const payload = token.split('.')[1];
      const { sub } = JSON.parse(atob(payload));
      localStorage.setItem(`gigradar_spotify_${sub}`, JSON.stringify({
        connected: true,
        connectedAt: new Date().toISOString(),
      }));

      if (!artists || artists.length === 0) {
        navigate('/onboarding/artists'); // shows empty state
      } else {
        navigate('/onboarding/artists');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong connecting Spotify.');
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={() => navigate('/onboarding/connect')} className="btn-primary">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Connecting your Spotify…</p>
      </div>
    </div>
  );
}
