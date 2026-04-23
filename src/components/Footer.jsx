import React from 'react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-zinc-950 border-t border-zinc-800 mt-20">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center font-black text-sm text-white">G</div>
              <span className="font-black text-base text-white">GigRadar</span>
            </Link>
            <p className="text-sm text-zinc-500 leading-relaxed">Every UK gig, one place. Updated weekly from 14 ticket sources.</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">Discover</p>
            <div className="space-y-2.5">
              {[['Gigs', '/gigs'], ['Calendar', '/calendar'], ['Artists', '/artists'], ['Venues', '/venues'], ['Cities', '/cities'], ['Discover', '/discover']].map(([l, h]) => (
                <Link key={h} href={h} className="block text-sm text-zinc-500 hover:text-white transition-colors">{l}</Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">For venues</p>
            <div className="space-y-2.5">
              {[['List your venue', '/list-your-venue'], ['Venue Spotlight', '/list-your-venue'], ['Sign up', '/'], ['Log in', '/'], ['Profile', '/profile']].map(([l, h]) => (
                <Link key={l} href={h} className="block text-sm text-zinc-500 hover:text-white transition-colors">{l}</Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">Ticket sources</p>
            <div className="space-y-2.5">
              {['Ticketmaster', 'Dice', 'Skiddle', 'Songkick', 'See Tickets', 'Bandsintown'].map(s => (
                <p key={s} className="text-sm text-zinc-500">{s}</p>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-zinc-600">© {new Date().getFullYear()} GigRadar. Not affiliated with any ticket vendor.</p>
          <p className="text-xs text-zinc-600">40K+ artists · 8K+ venues · 86K+ gigs</p>
        </div>
      </div>
    </footer>
  );
}
