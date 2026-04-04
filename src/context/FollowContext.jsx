import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';

const FollowContext = createContext(null);

function storageKey(user) {
  return `gigradar_following_${user?.sub || user?.email || 'guest'}`;
}

export function FollowProvider({ children }) {
  const { user } = useAuth();
  const [following, setFollowing] = useState(new Set());

  // Load from localStorage when user changes
  useEffect(() => {
    if (user === undefined) return;
    try {
      const raw = localStorage.getItem(storageKey(user));
      setFollowing(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setFollowing(new Set());
    }
  }, [user]);

  const save = useCallback((set) => {
    localStorage.setItem(storageKey(user), JSON.stringify([...set]));
  }, [user]);

  const follow = useCallback((artistId) => {
    setFollowing(prev => {
      const next = new Set(prev);
      next.add(artistId);
      save(next);
      return next;
    });
  }, [save]);

  const unfollow = useCallback((artistId) => {
    setFollowing(prev => {
      const next = new Set(prev);
      next.delete(artistId);
      save(next);
      return next;
    });
  }, [save]);

  const isFollowing = useCallback((artistId) => following.has(artistId), [following]);

  return (
    <FollowContext.Provider value={{ following, follow, unfollow, isFollowing }}>
      {children}
    </FollowContext.Provider>
  );
}

export function useFollow() {
  return useContext(FollowContext);
}
