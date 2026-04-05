import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken } from '../utils/cognito.js';
import { CONFIG } from '../utils/config.js';

export default function SpotifyCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Connecting your Spotify…');

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
      const codeVerifier = sessionStorage.getItem('spotify_code_verifier');
      const redirectUri = `${window.location.origin}/auth/spotify/callback`;

      // Exchange code for tokens directly in the browser (PKCE — no secret needed)
      setStatus('Exchanging tokens…');
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  redirectUri,
          client_id:     import.meta.env.VITE_SPOTIFY_CLIENT_ID,
          code_verifier: codeVerifier,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(`Spotify error: ${err.error_description || err.error || tokenRes.status}`);
      }

      const { access_token } = await tokenRes.json();

      // Fetch top artists directly from Spotify (2 pages = up to 100)
      setStatus('Fetching your top artists…');
      const spotifyArtists = [];
      for (const offset of [0, 50]) {
        const res = await fetch(
          `https://api.spotify.com/v1/me/top/artists?time_range=long_term&limit=50&offset=${offset}`,
          { headers: { Authorization: `Bearer ${access_token}` } }
        );
        if (!res.ok) break;
        const data = await res.json();
        if (data.items) spotifyArtists.push(...data.items);
      }

      // Send artist names to Lambda for matching against GigRadar DB
      setStatus('Finding your UK artists…');
      const gigRadarToken = await getToken();
      const matchRes = await fetch(`${CONFIG.apiBaseUrl}/api/artists/match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(gigRadarToken ? { Authorization: `Bearer ${gigRadarToken}` } : {}),
        },
        body: JSON.stringify({
          artists: spotifyArtists.map(a => ({ id: a.id, name: a.name })),
        }),
      });

      const { artists: matched } = matchRes.ok ? await matchRes.json() : { artists: [] };

      // Clean up
      sessionStorage.removeItem('spotify_code_verifier');
      sessionStorage.removeItem('spotify_auth_state');
      sessionStorage.setItem('spotify_matched_artists', JSON.stringify(matched || []));

      // Mark connected in localStorage
      if (gigRadarToken) {
        const payload = gigRadarToken.split('.')[1];
        const { sub } = JSON.parse(atob(payload));
        localStorage.setItem(`gigradar_spotify_${sub}`, JSON.stringify({
          connected: true,
          connectedAt: new Date().toISOString(),
        }));
      }

      navigate('/onboarding/artists');
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
