import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getToken } from '../utils/cognito.js';
import { CONFIG } from '../utils/config.js';

export default function SpotifyCallback() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Connecting your Spotify…');

  useEffect(() => { handleCallback(); }, []);

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const spotifyError = params.get('error');

    if (state !== sessionStorage.getItem('spotify_auth_state')) {
      router.push('/onboarding/connect?error=state_mismatch'); return;
    }
    if (spotifyError) {
      router.push(`/onboarding/connect?error=${spotifyError}`); return;
    }
    if (!code) {
      router.push('/onboarding/connect?error=no_code'); return;
    }

    try {
      const codeVerifier = sessionStorage.getItem('spotify_code_verifier');
      const redirectUri = `${window.location.origin}/auth/spotify/callback`;

      setStatus('Exchanging tokens…');
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID,
          code_verifier: codeVerifier,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(`Spotify error: ${err.error_description || err.error || tokenRes.status}`);
      }

      const { access_token } = await tokenRes.json();

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

      setStatus('Finding your UK artists…');
      const gigRadarToken = await getToken();
      const matchRes = await fetch(`${CONFIG.apiBaseUrl}/api/artists/match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(gigRadarToken ? { Authorization: `Bearer ${gigRadarToken}` } : {}),
        },
        body: JSON.stringify({ artists: spotifyArtists.map(a => ({ id: a.id, name: a.name })) }),
      });

      const { artists: matched } = matchRes.ok ? await matchRes.json() : { artists: [] };

      sessionStorage.removeItem('spotify_code_verifier');
      sessionStorage.removeItem('spotify_auth_state');
      sessionStorage.setItem('spotify_matched_artists', JSON.stringify(matched || []));

      if (gigRadarToken) {
        const payload = gigRadarToken.split('.')[1];
        const { sub } = JSON.parse(atob(payload));
        localStorage.setItem(`gigradar_spotify_${sub}`, JSON.stringify({
          connected: true,
          connectedAt: new Date().toISOString(),
        }));
      }

      router.push('/onboarding/artists');
    } catch (err) {
      setError(err.message || 'Something went wrong connecting Spotify.');
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={() => router.push('/onboarding/connect')}
            className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-zinc-400">{status}</p>
      </div>
    </div>
  );
}
