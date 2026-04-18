import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CONFIG } from '../utils/config.js';

export default function Unsubscribe() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!token) { setStatus('error'); return; }
    fetch(`${CONFIG.apiBaseUrl}/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(r => r.ok ? setStatus('done') : setStatus('error'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center">
      {status === 'loading' && <p className="text-gray-400">Unsubscribing…</p>}
      {status === 'done' && (
        <>
          <h1 className="text-2xl font-bold mb-3">Unsubscribed</h1>
          <p className="text-gray-400 mb-6">You won't receive any more alerts from this subscription.</p>
          <Link to="/" className="text-brand hover:underline">Back to GigRadar</Link>
        </>
      )}
      {status === 'error' && (
        <>
          <h1 className="text-2xl font-bold mb-3">Link expired</h1>
          <p className="text-gray-400 mb-6">This unsubscribe link is invalid or has already been used.</p>
          <Link to="/" className="text-brand hover:underline">Back to GigRadar</Link>
        </>
      )}
    </div>
  );
}
