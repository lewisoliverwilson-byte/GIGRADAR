import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';

export default function Profile() {
  const { user } = useAuth();
  const { following, unfollow } = useFollow();

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

      <div className="mt-4">
        <Link to="/settings/notifications" className="text-sm text-brand hover:underline">
          Notification settings →
        </Link>
      </div>
    </div>
  );
}
