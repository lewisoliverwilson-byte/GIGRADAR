import React, { useState, useEffect } from 'react';
import { api } from '../utils/api.js';

const EMAIL_KEY = 'gr_alert_email';

export default function AlertButton({ targetId, targetType, targetName, className = '' }) {
  const [email, setEmail]         = useState(() => localStorage.getItem(EMAIL_KEY) || '');
  const [following, setFollowing] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [input, setInput]         = useState('');
  const [status, setStatus]       = useState('idle'); // idle | saving | done | error

  useEffect(() => {
    if (email && targetId) {
      api.checkFollow(email, targetId)
        .then(r => setFollowing(r.following))
        .catch(() => {});
    }
  }, [email, targetId]);

  async function handleFollow(e) {
    e.preventDefault();
    const addr = input.trim();
    if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return;
    setStatus('saving');
    try {
      await api.followTarget(addr, targetId, targetType, targetName);
      localStorage.setItem(EMAIL_KEY, addr);
      setEmail(addr);
      setFollowing(true);
      setShowInput(false);
      setInput('');
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  async function handleUnfollow() {
    if (!email) return;
    await api.unfollowTarget(email, targetId).catch(() => {});
    setFollowing(false);
  }

  if (following) {
    return (
      <button
        onClick={handleUnfollow}
        className={`text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-red-400 hover:border-red-400/30 transition-colors ${className}`}
      >
        🔔 Alerts on · turn off
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
          className="input text-sm py-1.5 w-48"
        />
        <button type="submit" disabled={status === 'saving'}
          className="btn-primary text-xs px-3 py-1.5">
          {status === 'saving' ? '…' : 'Alert me'}
        </button>
        <button type="button" onClick={() => setShowInput(false)}
          className="text-xs text-gray-500 hover:text-white">✕</button>
        {status === 'error' && <span className="text-xs text-red-400">Try again</span>}
      </form>
    );
  }

  return (
    <button
      onClick={() => { setInput(email); setShowInput(true); }}
      className={`text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors ${className}`}
    >
      🔔 Get gig alerts
    </button>
  );
}
