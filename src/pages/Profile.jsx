import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import { getToken } from '../utils/cognito.js';
import { CONFIG } from '../utils/config.js';

function useSpotifyConnection(user) {
  const key = user?.sub ? `gigradar_spotify_${user.sub}` : null;
  const raw = key ? localStorage.getItem(key) : null;
  return raw ? JSON.parse(raw) : null;
}

export default function Profile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { following, unfollow } = useFollow();
  const spotifyConn = useSpotifyConnection(user);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectPrompt, setDisconnectPrompt] = useState(false);

  if (user === undefined) return null;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">Profile</h1>

      <div className="card p-5 mb-5">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand text-xl font-bold">
            {(user.name || user.email)?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-white">{user.name || user.email}</p>
            <p className="text-sm text-gray-400">{user.email}</p>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Following ({following.size})</h2>
        </div>
        {following.size === 0 ? (
          <p className="text-gray-500 text-sm">
            You're not following any artists yet.{' '}
            <Link to="/artists" className="text-brand hover:underline">Browse artists →</Link>
          </p>
        ) : (
          <div className="space-y-2">
            {[...following].map(id => (
              <div key={id} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                <Link to={`/artists/${id}`} className="text-sm text-white hover:text-brand-light transition-colors capitalize">
                  {id.replace(/-/g, ' ')}
                </Link>
                <button onClick={() => unfollow(id)} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
                  Unfollow
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connected Accounts */}
      <div className="card p-5 mt-5">
        <h2 className="font-semibold mb-4">Connected Accounts</h2>

        {/* Spotify row */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: '#1DB954' }}>
              <svg className="w-5 h-5 text-black" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-white">Spotify</p>
              {spotifyConn?.connected ? (
                <p className="text-xs text-gray-500">
                  Connected {spotifyConn.connectedAt
                    ? new Date(spotifyConn.connectedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    : ''}
                </p>
              ) : (
                <p className="text-xs text-gray-500">Not connected</p>
              )}
            </div>
          </div>

          {spotifyConn?.connected ? (
            <button
              onClick={() => setDisconnectPrompt(true)}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => navigate('/onboarding/connect')}
              className="text-xs text-brand hover:underline"
            >
              Connect
            </button>
          )}
        </div>

        {/* Disconnect confirmation */}
        {disconnectPrompt && (
          <div className="mt-4 p-3 bg-surface-3 rounded-lg border border-white/10">
            <p className="text-sm text-gray-300 mb-3">
              Disconnect Spotify? This won't unfollow any artists — you'll just stop receiving updates from Spotify.
            </p>
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
                    const key = `gigradar_spotify_${user.sub}`;
                    localStorage.removeItem(key);
                    setDisconnectPrompt(false);
                    setDisconnecting(false);
                    // Force re-render
                    window.location.reload();
                  }
                }}
                disabled={disconnecting}
                className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 px-3 py-1.5 rounded transition-colors"
              >
                {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
              </button>
              <button
                onClick={() => setDisconnectPrompt(false)}
                className="text-xs text-gray-500 hover:text-white px-3 py-1.5 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Apple Music row — coming soon */}
        <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-white/5 opacity-40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/90 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-gray-900" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-white">Apple Music</p>
              <p className="text-xs text-gray-500">Coming soon</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Link to="/settings/notifications" className="text-sm text-brand hover:underline">
          Notification settings →
        </Link>
      </div>
    </div>
  );
}
