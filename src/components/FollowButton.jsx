import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';
import AccountPrompt from './AccountPrompt.jsx';

export default function FollowButton({ artistId, size = 'md' }) {
  const { user } = useAuth();
  const { isFollowing, follow, unfollow } = useFollow();
  const [prompt, setPrompt] = useState(false);
  const following = isFollowing(artistId);

  function toggle() {
    if (!user) { setPrompt(true); return; }
    following ? unfollow(artistId) : follow(artistId);
  }

  const base = size === 'sm'
    ? 'text-xs px-3 py-1 rounded-md font-medium transition-colors'
    : 'text-sm px-4 py-2 rounded-lg font-semibold transition-colors';

  return (
    <>
      <button onClick={toggle}
        className={`${base} ${following
          ? 'bg-violet-900 text-violet-300 border border-violet-700 hover:bg-red-900 hover:text-red-400 hover:border-red-700'
          : 'bg-violet-600 hover:bg-violet-500 text-white'
        }`}>
        {following ? (
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Following
          </span>
        ) : 'Follow'}
      </button>
      {prompt && <AccountPrompt onClose={() => setPrompt(false)} />}
    </>
  );
}
