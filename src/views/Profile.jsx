import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import { getToken } from '../utils/cognito.js';
import { api } from '../utils/api.js';
import { CONFIG } from '../utils/config.js';
import Footer from '../components/Footer.jsx';

function useSpotifyConnection(user) {
  const key = user?.sub ? `gigradar_spotify_${user.sub}` : null;
  if (typeof window === 'undefined' || !key) return null;
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function Profile() {
  const router = useRouter();
  const { user } = useAuth();
  const { following, unfollow, followingVenues, unfollowVenue } = useFollow();
  const spotifyConn = useSpotifyConnection(user);
  const [disconnecting, setDisconnecting]     = useState(false);
  const [disconnectPrompt, setDisconnectPrompt] = useState(false);
  const [upcomingGigs, setUpcomingGigs]       = useState([]);
  const [gigsLoading, setGigsLoading]         = useState(false);

  useEffect(() => {
    if (!following.size) { setUpcomingGigs([]); return; }
    setGigsLoading(true);
    const today = new Date().toISOString().split('T')[0];
    Promise.all([...following].map(id => api.getArtistGigs(id).catch(() => [])))
      .then(results => {
        const all = results.flat()
          .filter(g => g.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date));
        setUpcomingGigs(all.slice(0, 30));
      })
      .finally(() => setGigsLoading(false));
  }, [following]);

  if (user === undefined) return null;
  if (!user) { if (typeof window !== 'undefined') router.replace('/'); return null; }

  const initials = (user.name || user.email)?.[0]?.toUpperCase();

  return (
    <>
      <Head><title>Profile — GigRadar</title></Head>
      <div className="min-h-screen bg-zinc-950">

        <div className="bg-zinc-950 border-b border-zinc-800">
          <div className="max-w-2xl mx-auto px-6 py-10">
            <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest mb-2">Account</p>
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-violet-900 border border-violet-700 flex items-center justify-center text-violet-300 text-2xl font-black flex-shrink-0">
                {initials}
              </div>
              <div>
                <h1 className="text-3xl font-black text-white">{user.name || 'Your account'}</h1>
                <p className="text-zinc-400 text-sm mt-0.5">{user.email}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-6 py-8 pb-20 space-y-5">

          {/* Upcoming gigs feed */}
          {(following.size > 0 || followingVenues.size > 0) && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <h2 className="font-bold text-white text-lg mb-4">Your upcoming gigs</h2>
              {gigsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-14 bg-zinc-800 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : upcomingGigs.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-zinc-500 text-sm mb-3">No upcoming gigs from artists you follow.</p>
                  <Link href="/gigs" className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-5 py-2 rounded-xl transition-colors text-sm">
                    Browse gigs →
                  </Link>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {upcomingGigs.map(g => (
                    <div key={g.gigId} className="flex items-center justify-between py-2.5 border-b border-zinc-800 last:border-0 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-zinc-500 w-20 shrink-0">{formatDate(g.date)}</span>
                        <div className="min-w-0">
                          <p className="text-sm text-white font-medium truncate capitalize">{g.artistId?.replace(/-/g, ' ')}</p>
                          <p className="text-xs text-zinc-500 truncate">{g.venueName}{g.venueCity ? `, ${g.venueCity}` : ''}</p>
                        </div>
                      </div>
                      {g.tickets?.[0]?.url && (
                        <a href={g.tickets[0].url} target="_blank" rel="noopener noreferrer"
                          className="shrink-0 text-xs bg-violet-600 hover:bg-violet-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
                          Tickets
                        </a>
                      )}
                    </div>
                  ))}
                  {upcomingGigs.length === 30 && (
                    <p className="text-xs text-zinc-600 pt-2 text-center">Showing next 30 gigs</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Following artists */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white text-lg">Following</h2>
              <span className="bg-zinc-800 text-zinc-400 text-xs px-2.5 py-1 rounded-md font-medium">
                {following.size} artist{following.size !== 1 ? 's' : ''}
              </span>
            </div>
            {following.size === 0 ? (
              <div className="text-center py-6">
                <p className="text-zinc-500 text-sm mb-3">You're not following any artists yet.</p>
                <Link href="/artists"
                  className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-5 py-2 rounded-xl transition-colors text-sm">
                  Browse artists →
                </Link>
              </div>
            ) : (
              <div className="space-y-0.5">
                {[...following].map(id => (
                  <div key={id} className="flex items-center justify-between py-2.5 border-b border-zinc-800 last:border-0">
                    <Link href={`/artists/${id}`}
                      className="text-sm text-zinc-300 hover:text-white transition-colors capitalize">
                      {id.replace(/-/g, ' ')}
                    </Link>
                    <button onClick={() => unfollow(id)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors">
                      Unfollow
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Following venues */}
          {followingVenues.size > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-white text-lg">Venues</h2>
                <span className="bg-zinc-800 text-zinc-400 text-xs px-2.5 py-1 rounded-md font-medium">
                  {followingVenues.size} venue{followingVenues.size !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-0.5">
                {[...followingVenues].map(id => (
                  <div key={id} className="flex items-center justify-between py-2.5 border-b border-zinc-800 last:border-0">
                    <Link href={`/venues/${id}`}
                      className="text-sm text-zinc-300 hover:text-white transition-colors capitalize">
                      {id.replace(/-/g, ' ')}
                    </Link>
                    <button onClick={() => unfollowVenue(id)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors">
                      Unfollow
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connected accounts */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
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
                <button onClick={() => setDisconnectPrompt(true)}
                  className="text-xs text-zinc-500 hover:text-red-400 transition-colors">
                  Disconnect
                </button>
              ) : (
                <button onClick={() => router.push('/onboarding/connect')}
                  className="bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors">
                  Connect
                </button>
              )}
            </div>

            {disconnectPrompt && (
              <div className="mt-4 p-4 bg-zinc-800 rounded-xl border border-zinc-700">
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
                    className="text-xs bg-red-900 hover:bg-red-800 text-red-300 border border-red-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                    {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
                  </button>
                  <button onClick={() => setDisconnectPrompt(false)}
                    className="text-xs text-zinc-400 hover:text-white px-4 py-2 rounded-lg transition-colors">
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
