import React, { useState, useEffect } from 'react';
import { api } from '../utils/api.js';

const EMAIL_KEY   = 'gr_alert_email';
const VENUES_KEY  = 'gr_followed_venues';

function getFollowedVenues() {
  try { return JSON.parse(localStorage.getItem(VENUES_KEY) || '[]'); } catch { return []; }
}
function setFollowedVenues(ids) {
  localStorage.setItem(VENUES_KEY, JSON.stringify(ids));
}

export default function AlertButton({ targetId, targetType, targetName, className = '' }) {
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_KEY) || '');
  const [following, setFollowing] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (email && targetId) {
      api.checkFollow(email, targetId).then(r => setFollowing(r.following)).catch(() => {});
    }
  }, [email, targetId]);

  function localFollow(id) {
    if (targetType !== 'venue') return;
    const ids = getFollowedVenues();
    if (!ids.includes(id)) setFollowedVenues([...ids, id]);
  }

  function localUnfollow(id) {
    if (targetType !== 'venue') return;
    setFollowedVenues(getFollowedVenues().filter(v => v !== id));
  }

  async function doFollow(addr) {
    setStatus('saving');
    try {
      await api.followTarget(addr, targetId, targetType, targetName);
      localStorage.setItem(EMAIL_KEY, addr);
      setEmail(addr);
      setFollowing(true);
      setShowInput(false);
      setInput('');
      setStatus('done');
      localFollow(targetId);
    } catch {
      setStatus('error');
    }
  }

  async function handleFollow(e) {
    e.preventDefault();
    const addr = input.trim();
    if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return;
    await doFollow(addr);
  }

  async function handleUnfollow() {
    if (!email) return;
    await api.unfollowTarget(email, targetId).catch(() => {});
    setFollowing(false);
    localUnfollow(targetId);
  }

  const isVenue = targetType === 'venue';
  const label   = isVenue ? 'Follow' : 'Get alerts';

  if (following) {
    return (
      <button onClick={handleUnfollow}
        className={`text-sm px-4 py-2 rounded-xl font-semibold border transition-colors ${
          isVenue
            ? 'bg-violet-900 text-violet-300 border-violet-700 hover:bg-red-900 hover:text-red-400 hover:border-red-700'
            : 'text-xs px-3 py-1.5 border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-700'
        } ${className}`}>
        {isVenue ? '✓ Following' : '🔔 Alerts on · turn off'}
      </button>
    );
  }

  // If email is already known, one-click follow — no form shown
  if (email && !showInput) {
    return (
      <button
        onClick={() => doFollow(email)}
        disabled={status === 'saving'}
        className={`text-sm px-4 py-2 rounded-xl font-semibold transition-colors disabled:opacity-50 ${
          isVenue
            ? 'bg-violet-600 hover:bg-violet-500 text-white'
            : 'text-xs px-3 py-1.5 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
        } ${className}`}>
        {status === 'saving' ? '…' : label}
      </button>
    );
  }

  if (showInput) {
    return (
      <form onSubmit={handleFollow} className={`flex gap-2 items-center ${className}`}>
        <input
          autoFocus
          type="email"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="your@email.com"
          className="bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 placeholder-zinc-500 w-48 transition-colors"
        />
        <button type="submit" disabled={status === 'saving'}
          className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
          {status === 'saving' ? '…' : 'Follow'}
        </button>
        <button type="button" onClick={() => setShowInput(false)}
          className="text-xs text-zinc-500 hover:text-white transition-colors">✕</button>
        {status === 'error' && <span className="text-xs text-red-400">Try again</span>}
      </form>
    );
  }

  return (
    <button onClick={() => { setInput(''); setShowInput(true); }}
      className={`text-sm px-4 py-2 rounded-xl font-semibold transition-colors ${
        isVenue
          ? 'bg-violet-600 hover:bg-violet-500 text-white'
          : 'text-xs px-3 py-1.5 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
      } ${className}`}>
      {label}
    </button>
  );
}
