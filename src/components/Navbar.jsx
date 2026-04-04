import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Navbar() {
  const { user, logout, openAuth } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const navLinkClass = ({ isActive }) =>
    `text-sm font-medium transition-colors ${isActive ? 'text-white' : 'text-gray-400 hover:text-white'}`;

  return (
    <header className="sticky top-0 z-40 bg-surface/80 backdrop-blur-md border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-14 gap-6">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0">
          <span className="text-brand font-bold text-lg tracking-tight">GigRadar</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden sm:flex items-center gap-5">
          <NavLink to="/"        end className={navLinkClass}>Home</NavLink>
          <NavLink to="/artists"     className={navLinkClass}>Artists</NavLink>
          <NavLink to="/gigs"        className={navLinkClass}>Gigs</NavLink>
        </nav>

        <div className="flex-1" />

        {/* Search */}
        <button
          onClick={() => navigate('/artists')}
          className="hidden sm:flex items-center gap-2 bg-surface-2 border border-white/5 rounded-lg px-3 py-1.5 text-gray-400 text-sm hover:border-brand/40 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Search artists...
        </button>

        {/* Auth */}
        {user === undefined ? null : user ? (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
            >
              <span className="w-7 h-7 rounded-full bg-brand/30 border border-brand/40 flex items-center justify-center text-brand text-xs font-bold">
                {(user.name || user.email)?.[0]?.toUpperCase()}
              </span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-44 bg-surface-2 border border-white/10 rounded-xl shadow-xl py-1 z-50">
                <Link to="/profile" onClick={() => setMenuOpen(false)}
                  className="block px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-surface-3 transition-colors">
                  Profile
                </Link>
                <Link to="/settings/notifications" onClick={() => setMenuOpen(false)}
                  className="block px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-surface-3 transition-colors">
                  Notifications
                </Link>
                <button
                  onClick={() => { logout(); setMenuOpen(false); }}
                  className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-surface-3 transition-colors">
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => openAuth('login')}  className="btn-ghost text-sm py-1.5 px-3">Log in</button>
            <button onClick={() => openAuth('signup')} className="btn-primary text-sm py-1.5 px-3">Sign up</button>
          </div>
        )}
      </div>
    </header>
  );
}
