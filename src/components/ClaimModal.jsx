import React, { useState } from 'react';
import { api } from '../utils/api.js';
import { getToken } from '../utils/cognito.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ClaimModal({ artist, onClose, onSuccess }) {
  const { user } = useAuth();
  const [note, setNote]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again.');
      await api.claimArtist(artist.artistId, { email: user.email, note }, token);
      onSuccess();
    } catch (err) {
      setError(err.message.includes('409') ? 'This artist has already been claimed.' : err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-1 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-xl font-bold mb-1">Claim {artist.name}</h2>
        <p className="text-gray-400 text-sm mb-5">
          Are you in this band? Submit a claim and we'll review it within a few days. Once approved, you'll be able to edit the artist profile.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Your email</label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="input w-full opacity-60 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Note <span className="text-gray-600">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. I'm the guitarist — here's our Instagram: @bandname"
              rows={3}
              className="input w-full resize-none"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="btn-primary w-full"
          >
            {saving ? 'Submitting…' : 'Submit claim'}
          </button>
        </form>
      </div>
    </div>
  );
}
