import React from 'react';
import Link from 'next/link';
import Footer from '../components/Footer.jsx';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-4">
          <p className="text-8xl font-black text-zinc-800 mb-4 leading-none">404</p>
          <div className="w-24 h-1 bg-violet-700 rounded-full mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-white mb-2">Page not found</h1>
          <p className="text-zinc-400 text-sm mb-8 max-w-sm mx-auto">
            This page doesn't exist. It may have moved, or the URL may be wrong.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Link href="/" className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-7 py-3 rounded-xl transition-colors">
              Go home
            </Link>
            <Link href="/gigs" className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-7 py-3 rounded-xl transition-colors">
              Browse gigs
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
