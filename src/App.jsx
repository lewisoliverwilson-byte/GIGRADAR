import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <FollowProvider>
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">
              <Routes>
                <Route path="/"                index element={<Home />} />
                <Route path="/artists"               element={<Artists />} />
                <Route path="/artists/:id"           element={<ArtistDetail />} />
                <Route path="/gigs"                  element={<Gigs />} />
                <Route path="/discover"              element={<Discover />} />
                <Route path="/search"                element={<Search />} />
                <Route path="/venues/:slug"          element={<VenuePage />} />
                <Route path="/profile"               element={<Profile />} />
                <Route path="/admin"                 element={<Admin />} />
                <Route path="*"                      element={<NotFound />} />
              </Routes>
            </main>
          </div>
          <AuthModal />
        </FollowProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
