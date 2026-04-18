import React from 'react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#0a0a0f] mt-16">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" className="flex items-center gap-2 font-black text-base mb-3">
              <span className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center text-xs">🎸</span>
              <span className="text-white">Gig<span className="text-violet-400">Radar</span></span>
            </Link>
            <p className="text-xs text-zinc-500 leading-relaxed">Every UK gig, one place. Updated every 6 hours from 10+ ticket sources.</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Discover</p>
            <div className="space-y-2">
              {[['Gigs', '/gigs'], ['Artists', '/artists'], ['Venues', '/venues'], ['Discover', '/discover']].map(([label, href]) => (
                <Link key={href} href={href} className="block text-sm text-zinc-500 hover:text-white transition-colors">{label}</Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Account</p>
            <div className="space-y-2">
              {[['Sign up', '/'], ['Log in', '/'], ['Profile', '/profile']].map(([label, href]) => (
                <Link key={label} href={href} className="block text-sm text-zinc-500 hover:text-white transition-colors">{label}</Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Sources</p>
            <div className="space-y-2">
              {['Ticketmaster', 'Dice', 'Skiddle', 'Songkick', 'See Tickets', 'Bandsintown'].map(s => (
                <p key={s} className="text-sm text-zinc-500">{s}</p>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-white/5 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-zinc-600">© {new Date().getFullYear()} GigRadar. Not affiliated with any ticket vendor.</p>
          <p className="text-xs text-zinc-600">Data updated every 6 hours · 18,000+ artists · 4,700+ venues</p>
        </div>
      </div>
    </footer>
  );
}
