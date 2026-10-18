import React, { createContext, useContext, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, getToken, setToken, removeToken } from '../api/client';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const token = getToken();

  const {
    data: userData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await apiFetch<{ user: User }>('/api/me');
      return res.user || (res as unknown as User);
    },
    enabled: Boolean(token),
    retry: false,
    staleTime: 60000,
  });

  const login = (newToken: string) => {
    setToken(newToken);
    refetch();
  };

  const logout = () => {
    removeToken();
    queryClient.clear();
    window.location.href = '/login';
  };

  useEffect(() => {
    if (!token && window.location.pathname !== '/login') {
      // Unauthenticated, redirect to login
    }
  }, [token]);

  const value = {
    user: userData || null,
    isAuthenticated: Boolean(token && userData),
    isLoading: Boolean(token && isLoading),
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
