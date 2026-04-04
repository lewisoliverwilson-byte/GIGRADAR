import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getCurrentUser, signOut as cognitoSignOut } from '../utils/cognito.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(undefined); // undefined = loading
  const [showAuth, setShowAuth] = useState(false);
  const [authTab, setAuthTab]   = useState('login');

  const refresh = useCallback(async () => {
    const u = await getCurrentUser();
    setUser(u);
    return u;
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const logout = useCallback(() => {
    cognitoSignOut();
    setUser(null);
  }, []);

  const openAuth = useCallback((tab = 'login') => {
    setAuthTab(tab);
    setShowAuth(true);
  }, []);

  return (
    <AuthContext.Provider value={{ user, refresh, logout, showAuth, setShowAuth, authTab, setAuthTab, openAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
