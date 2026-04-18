import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext.jsx';

const NAV_LINKS = [
  { href: '/gigs',     label: 'Gigs' },
  { href: '/artists',  label: 'Artists' },
  { href: '/venues',   label: 'Venues' },
  { href: '/discover', label: 'Discover' },
];

export default function Navbar() {
  const { user, logout, openAuth } = useAuth();
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled,   setScrolled]   = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); setMenuOpen(false); }, [router.pathname]);

  const isActive = (href) =>
    href === '/' ? router.pathname === '/' : router.pathname.startsWith(href);

  return (
    <>
      <header className={`sticky top-0 z-40 transition-all duration-200
        ${scrolled ? 'bg-surface/95 backdrop-blur-xl shadow-lg shadow-black/20 border-b border-white/5'
                   : 'bg-surface/80 backdrop-blur-md border-b border-white/5'}`}>
        <div className="section">
          <div className="flex items-center h-16 gap-6">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 flex-shrink-0 group">
              <div className="w-8 h-8 rounded-lg bg-brand/20 border border-brand/30 flex items-center justify-center group-hover:bg-brand/30 transition-colors">
                <svg className="w-4 h-4 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M12 3v4M12 17v4M3 12h4M17 12h4" />
                </svg>
              </div>
              <span className="text-lg font-black tracking-tight">
                <span className="text-brand">Gig</span><span className="text-white">Radar</span>
              </span>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map(({ href, label }) => (
                <Link key={href} href={href}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150
                    ${isActive(href)
                      ? 'text-white bg-white/5'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                  {label}
                </Link>
              ))}
            </nav>

            <div className="flex-1" />

            {/* Search */}
            <button
              onClick={() => router.push('/search')}
              className="hidden sm:flex items-center gap-2 bg-surface-2 border border-white/8 rounded-xl px-3.5 py-2 text-zinc-500 text-sm hover:border-brand/30 hover:text-zinc-300 transition-all duration-150 group"
            >
              <svg className="w-3.5 h-3.5 group-hover:text-brand transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Search…</span>
              <kbd className="hidden lg:inline-flex items-center gap-0.5 text-xs text-zinc-600 bg-surface-3 border border-white/5 rounded px-1.5 py-0.5">⌘K</kbd>
            </button>

            {/* Auth */}
            {user === undefined ? null : user ? (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(o => !o)}
                  className="flex items-center gap-2 text-sm text-zinc-300 hover:text-white transition-colors"
                >
                  <span className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand text-sm font-bold">
                    {(user.name || user.email)?.[0]?.toUpperCase()}
                  </span>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-surface-2 border border-white/10 rounded-2xl shadow-2xl shadow-black/40 py-1.5 z-50 animate-fade-in">
                      <div className="px-4 py-2.5 border-b border-white/5 mb-1">
                        <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                      </div>
                      <Link href="/profile" onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-zinc-300 hover:text-white hover:bg-white/5 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        Profile
                      </Link>
                      <button
                        onClick={() => { logout(); setMenuOpen(false); }}
                        className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-white/5 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <button onClick={() => openAuth('login')}  className="btn-ghost text-sm py-2 px-4">Log in</button>
                <button onClick={() => openAuth('signup')} className="btn-primary text-sm py-2 px-4">Sign up free</button>
              </div>
            )}

            {/* Mobile menu button */}
            <button
              className="md:hidden p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
              onClick={() => setMobileOpen(o => !o)}
              aria-label="Toggle menu"
            >
              {mobileOpen
                ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              }
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-white/5 bg-surface-1 animate-fade-in">
            <div className="section py-4 space-y-1">
              {NAV_LINKS.map(({ href, label }) => (
                <Link key={href} href={href}
                  className={`flex items-center px-4 py-3 rounded-xl text-sm font-medium transition-colors
                    ${isActive(href) ? 'bg-brand/10 text-brand-light' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                  {label}
                </Link>
              ))}
              <Link href="/search"
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                Search
              </Link>
              <div className="pt-3 border-t border-white/5 flex gap-2">
                {user ? (
                  <>
                    <Link href="/profile" className="btn-secondary flex-1 text-sm py-2.5">Profile</Link>
                    <button onClick={logout} className="btn-ghost flex-1 text-sm py-2.5 text-red-400">Sign out</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => openAuth('login')}  className="btn-secondary flex-1 text-sm py-2.5">Log in</button>
                    <button onClick={() => openAuth('signup')} className="btn-primary  flex-1 text-sm py-2.5">Sign up</button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
