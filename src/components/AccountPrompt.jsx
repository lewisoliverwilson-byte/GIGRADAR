import React from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function AccountPrompt({ onClose }) {
  const { openAuth } = useAuth();

  function go(tab) {
    openAuth(tab);
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center"
        onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-zinc-500 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <h2 className="text-xl font-bold text-white mb-2">Create a free account</h2>
        <p className="text-zinc-400 text-sm mb-6">Follow artists, get gig alerts, and never miss a show.</p>
        <div className="space-y-3">
          <button onClick={() => go('signup')}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2.5 rounded-xl transition-colors">
            Sign up with email
          </button>
          <button onClick={() => go('login')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-2.5 rounded-xl transition-colors">
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}
