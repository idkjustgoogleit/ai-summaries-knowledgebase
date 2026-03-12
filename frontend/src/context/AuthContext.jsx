// frontend/src/context/AuthContext.jsx
/**
 * Authentication Context - OIDC-Only Mode
 * Provides global authentication state and methods for OIDC SSO
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { checkAuthStatus } from '../utils/api';

/**
 * Authentication Context
 * Provides global authentication state and methods
 */
const AuthContext = createContext(null);

/**
 * Custom hook to use authentication context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * AuthProvider Component
 * Manages OIDC authentication state across the app
 */
export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Initialize authentication on mount
  useEffect(() => {
    initializeAuth();
  }, []);

  /**
   * Initialize authentication state
   */
  const initializeAuth = async () => {
    try {
      setLoading(true);

      // Check authentication status (OIDC session-based)
      const authStatus = await checkAuthStatus();
      setIsAuthenticated(authStatus.isAuthenticated);
      setUser(authStatus.user);
      setIsAdmin(authStatus.user?.isAdmin || false);

      console.log('[AuthContext] OIDC Auth initialized:', {
        authenticated: authStatus.isAuthenticated,
        user: authStatus.user,
        isAdmin: authStatus.user?.isAdmin
      });
    } catch (error) {
      console.error('[AuthContext] Error initializing auth:', error);
      setIsAuthenticated(false);
      setUser(null);
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Logout - clears session and redirects to OIDC logout
   */
  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      console.error('[AuthContext] Logout error:', error);
    } finally {
      // Clear local state
      setIsAuthenticated(false);
      setUser(null);
      setIsAdmin(false);

      // Redirect to OIDC logout endpoint
      window.location.href = '/api/auth/oidc/logout';
    }
  };

  /**
   * Refresh authentication status
   */
  const refreshAuth = async () => {
    await initializeAuth();
  };

  const value = {
    isAuthenticated,
    user,
    isAdmin,
    loading,
    logout,
    refreshAuth
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
