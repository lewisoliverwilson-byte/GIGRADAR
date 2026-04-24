import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext.jsx';
import { useFollow } from '../context/FollowContext.jsx';

const NAV_LINKS = [
  { href: '/gigs',      label: 'Gigs' },
  { href: '/calendar',  label: 'Calendar' },
  { href: '/artists',   label: 'Artists' },
  { href: '/venues',    label: 'Venues' },
  { href: '/cities',    label: 'Cities' },
  { href: '/discover',  label: 'Discover' },
];

export default function Navbar() {
  const { user, signOut, openAuth } = useAuth();
  const { following } = useFollow();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  useEffect(() => { setMenuOpen(false); setDropdownOpen(false); }, [router.pathname]);

  const isActive = (href) => router.pathname === href || router.pathname.startsWith(href + '/');

  return (
    <nav className={`sticky top-0 z-50 border-b ${scrolled ? 'bg-black border-zinc-800' : 'bg-black border-zinc-900'}`}>
      <div className="max-w-7xl mx-auto px-4 lg:px-8 h-14 flex items-center gap-8">

        {/* Logo */}
        <Link href="/" className="shrink-0">
          <span className="font-display text-2xl text-white tracking-wider">GIGRADAR</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1 flex-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link key={href} href={href}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-[0.15em] transition-colors ${
                isActive(href) ? 'text-white' : 'text-zinc-500 hover:text-white'
              }`}>
              {label}
            </Link>
          ))}
        </div>

        {/* Auth */}
        <div className="flex items-center gap-2 ml-auto">
          {user ? (
            <div className="relative">
              <button onClick={() => setDropdownOpen(o => !o)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors">
                <div className="w-7 h-7 bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {(user.name || user.email)?.[0]?.toUpperCase()}
                </div>
                <span className="hidden sm:block truncate max-w-32 text-xs font-bold uppercase tracking-wider">{user.name || user.email}</span>
                <svg className="w-3 h-3 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden">
                  <Link href="/profile" className="flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wider text-zinc-400 hover:bg-zinc-900 hover:text-white transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    Profile
                  </Link>
                  {following.size > 0 && (
                    <Link href="/gigs?filter=following" className="flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wider text-zinc-400 hover:bg-zinc-900 hover:text-white transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                      My gigs
                    </Link>
                  )}
                  <div className="border-t border-zinc-800" />
                  <button onClick={signOut} className="w-full flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-red-400 hover:bg-zinc-900 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <button onClick={() => openAuth('login')} className="hidden sm:block text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 hover:text-white px-3 py-2 transition-colors">
                Log in
              </button>
              <button onClick={() => openAuth('signup')} className="text-[11px] font-bold uppercase tracking-[0.15em] bg-white text-black px-4 py-2 hover:bg-zinc-200 transition-colors">
                Create account
              </button>
            </>
          )}
          <button onClick={() => setMenuOpen(o => !o)} className="md:hidden p-2 text-zinc-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-zinc-900 bg-black px-4 py-3 space-y-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link key={href} href={href}
              className={`block px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.15em] transition-colors ${
                isActive(href) ? 'text-white' : 'text-zinc-500 hover:text-white'
              }`}>
              {label}
            </Link>
          ))}
          {!user && (
            <div className="pt-3 border-t border-zinc-900 flex gap-2">
              <button onClick={() => { openAuth('login'); setMenuOpen(false); }}
                className="flex-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400 border border-zinc-800 px-3 py-2.5 hover:border-zinc-600 hover:text-white transition-colors">
                Log in
              </button>
              <button onClick={() => { openAuth('signup'); setMenuOpen(false); }}
                className="flex-1 text-[11px] font-bold uppercase tracking-wider bg-white text-black px-3 py-2.5 hover:bg-zinc-200 transition-colors">
                Create account
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
