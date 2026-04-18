import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import { getToken } from '../utils/cognito.js';
import { CONFIG } from '../utils/config.js';
import Footer from '../components/Footer.jsx';

function useSpotifyConnection(user) {
  const key = user?.sub ? `gigradar_spotify_${user.sub}` : null;
  if (typeof window === 'undefined' || !key) return null;
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

export default function Profile() {
  const router = useRouter();
  const { user } = useAuth();
  const { following, unfollow } = useFollow();
  const spotifyConn = useSpotifyConnection(user);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectPrompt, setDisconnectPrompt] = useState(false);

  if (user === undefined) return null;
  if (!user) { if (typeof window !== 'undefined') router.replace('/'); return null; }

  const initials = (user.name || user.email)?.[0]?.toUpperCase();

  return (
    <>
      <Head><title>Profile — GigRadar</title></Head>
      <div className="min-h-screen bg-surface">

        {/* Header */}
        <div className="bg-surface-1 border-b border-white/5">
          <div className="section py-12">
            <p className="text-sm text-brand-light font-medium mb-2 uppercase tracking-widest">Account</p>
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-brand/20 border border-brand/30 flex items-center justify-center text-brand text-2xl font-black flex-shrink-0">
                {initials}
              </div>
              <div>
                <h1 className="text-3xl font-black text-white">{user.name || 'Your account'}</h1>
                <p className="text-zinc-400 text-sm mt-0.5">{user.email}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="section py-8 pb-16 space-y-5 max-w-2xl">

          {/* Following */}
          <div className="bg-surface-2 border border-white/5 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white text-lg">Following</h2>
              <span className="badge-gray">{following.size} artists</span>
            </div>
            {following.size === 0 ? (
              <div className="text-center py-6">
                <p className="text-zinc-500 text-sm mb-3">You're not following any artists yet.</p>
                <Link href="/artists" className="btn-secondary px-5 py-2 rounded-xl text-sm">Browse artists →</Link>
              </div>
            ) : (
              <div className="space-y-0.5">
                {[...following].map(id => (
                  <div
                    key={id}
                    className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0"
                  >
                    <Link
                      href={`/artists/${id}`}
                      className="text-sm text-zinc-300 hover:text-white transition-colors capitalize"
                    >
                      {id.replace(/-/g, ' ')}
                    </Link>
                    <button
                      onClick={() => unfollow(id)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      Unfollow
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Connected accounts */}
          <div className="bg-surface-2 border border-white/5 rounded-2xl p-6">
            <h2 className="font-bold text-white text-lg mb-4">Connected accounts</h2>

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#1DB954' }}>
                  <svg className="w-5 h-5 text-black" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Spotify</p>
                  {spotifyConn?.connected ? (
                    <p className="text-xs text-zinc-500">
                      Connected {spotifyConn.connectedAt
                        ? new Date(spotifyConn.connectedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : ''}
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-500">Not connected</p>
                  )}
                </div>
              </div>

              {spotifyConn?.connected ? (
                <button
                  onClick={() => setDisconnectPrompt(true)}
                  className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => router.push('/onboarding/connect')}
                  className="btn-primary text-xs px-4 py-2 rounded-lg"
                >
                  Connect
                </button>
              )}
            </div>

            {disconnectPrompt && (
              <div className="mt-4 p-4 bg-surface-3 rounded-xl border border-white/10">
                <p className="text-sm text-zinc-300 mb-3">Disconnect Spotify? This won't unfollow any artists.</p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setDisconnecting(true);
                      try {
                        const token = await getToken();
                        if (token) {
                          await fetch(`${CONFIG.apiBaseUrl}/api/auth/spotify/disconnect`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}` },
                          });
                        }
                      } finally {
                        localStorage.removeItem(`gigradar_spotify_${user.sub}`);
                        setDisconnectPrompt(false);
                        setDisconnecting(false);
                        window.location.reload();
                      }
                    }}
                    disabled={disconnecting}
                    className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-2 rounded-lg transition-colors"
                  >
                    {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
                  </button>
                  <button
                    onClick={() => setDisconnectPrompt(false)}
                    className="btn-ghost text-xs px-4 py-2 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <Footer />
      </div>
    </>
  );
}
