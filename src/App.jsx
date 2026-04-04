import React from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { FollowProvider } from './context/FollowContext.jsx';
import Navbar from './components/Navbar.jsx';
import AuthModal from './components/AuthModal.jsx';
import Home from './pages/Home.jsx';
import Artists from './pages/Artists.jsx';
import ArtistDetail from './pages/ArtistDetail.jsx';
import Gigs from './pages/Gigs.jsx';
import Discover from './pages/Discover.jsx';
import Search from './pages/Search.jsx';
import VenuePage from './pages/VenuePage.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';
import NotFound from './pages/NotFound.jsx';
import OnboardingConnect from './pages/OnboardingConnect.jsx';
import OnboardingArtists from './pages/OnboardingArtists.jsx';
import SpotifyCallback from './pages/SpotifyCallback.jsx';

const FULLSCREEN_ROUTES = ['/onboarding/connect', '/onboarding/artists', '/auth/spotify/callback'];

function Layout() {
  const { pathname } = useLocation();
  const isFullscreen = FULLSCREEN_ROUTES.some(r => pathname.startsWith(r));

  return (
    <div className="min-h-screen flex flex-col">
      {!isFullscreen && <Navbar />}
      <main className="flex-1">
        <Routes>
          <Route path="/"                      index element={<Home />} />
          <Route path="/artists"               element={<Artists />} />
          <Route path="/artists/:id"           element={<ArtistDetail />} />
          <Route path="/gigs"                  element={<Gigs />} />
          <Route path="/discover"              element={<Discover />} />
          <Route path="/search"               element={<Search />} />
          <Route path="/venues/:slug"          element={<VenuePage />} />
          <Route path="/profile"               element={<Profile />} />
          <Route path="/admin"                 element={<Admin />} />
          <Route path="/onboarding/connect"    element={<OnboardingConnect />} />
          <Route path="/onboarding/artists"    element={<OnboardingArtists />} />
          <Route path="/auth/spotify/callback" element={<SpotifyCallback />} />
          <Route path="*"                      element={<NotFound />} />
        </Routes>
      </main>
      {!isFullscreen && <AuthModal />}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <FollowProvider>
          <Layout />
        </FollowProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
