import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';

const FollowContext = createContext(null);

function storageKey(user, suffix = '') {
  return `gigradar_following${suffix}_${user?.sub || user?.email || 'guest'}`;
}

export function FollowProvider({ children }) {
  const { user } = useAuth();
  const [following,       setFollowing]       = useState(new Set());
  const [followingVenues, setFollowingVenues] = useState(new Set());

  useEffect(() => {
    if (user === undefined) return;
    try {
      const raw  = localStorage.getItem(storageKey(user));
      const rawV = localStorage.getItem(storageKey(user, '_venues'));
      setFollowing(new Set(raw  ? JSON.parse(raw)  : []));
      setFollowingVenues(new Set(rawV ? JSON.parse(rawV) : []));
    } catch {
      setFollowing(new Set());
      setFollowingVenues(new Set());
    }
  }, [user]);

  const saveArtists = useCallback((set) => {
    localStorage.setItem(storageKey(user), JSON.stringify([...set]));
  }, [user]);

  const saveVenues = useCallback((set) => {
    localStorage.setItem(storageKey(user, '_venues'), JSON.stringify([...set]));
  }, [user]);

  const follow = useCallback((artistId) => {
    setFollowing(prev => { const next = new Set(prev); next.add(artistId); saveArtists(next); return next; });
  }, [saveArtists]);

  const unfollow = useCallback((artistId) => {
    setFollowing(prev => { const next = new Set(prev); next.delete(artistId); saveArtists(next); return next; });
  }, [saveArtists]);

  const followVenue = useCallback((venueId) => {
    setFollowingVenues(prev => { const next = new Set(prev); next.add(venueId); saveVenues(next); return next; });
  }, [saveVenues]);

  const unfollowVenue = useCallback((venueId) => {
    setFollowingVenues(prev => { const next = new Set(prev); next.delete(venueId); saveVenues(next); return next; });
  }, [saveVenues]);

  const isFollowing      = useCallback((id) => following.has(id),       [following]);
  const isFollowingVenue = useCallback((id) => followingVenues.has(id), [followingVenues]);

  return (
    <FollowContext.Provider value={{
      following, follow, unfollow, isFollowing,
      followingVenues, followVenue, unfollowVenue, isFollowingVenue,
    }}>
      {children}
    </FollowContext.Provider>
  );
}

export function useFollow() {
  return useContext(FollowContext);
}
