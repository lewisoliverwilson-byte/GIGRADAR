import React from 'react';
import Link from 'next/link';
import Footer from '../components/Footer.jsx';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-4">
          <p className="text-8xl font-black text-surface-3 mb-4 leading-none">404</p>
          <div className="w-24 h-1 bg-brand/30 rounded-full mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-white mb-2">Page not found</h1>
          <p className="text-zinc-400 text-sm mb-8 max-w-sm mx-auto">
            This page doesn't exist. It may have moved, or the URL may be wrong.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Link href="/" className="btn-primary px-7 py-3 rounded-xl">Go home</Link>
            <Link href="/gigs" className="btn-secondary px-7 py-3 rounded-xl">Browse gigs</Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
