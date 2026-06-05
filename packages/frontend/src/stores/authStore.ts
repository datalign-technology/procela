import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  sessionExpiresAt: number | null; // timestamp in ms
  login: (user: User, accessToken: string, refreshToken: string, expiresIn: number) => void;
  logout: () => void;
  refreshSession: (accessToken: string, expiresIn: number, refreshToken?: string) => void;
  getTimeUntilExpiry: () => number; // seconds remaining
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      sessionExpiresAt: null,

      login: (user: User, accessToken: string, refreshToken: string, expiresIn: number) =>
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          sessionExpiresAt: Date.now() + expiresIn * 1000,
        }),

      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          sessionExpiresAt: null,
        }),

      refreshSession: (accessToken: string, expiresIn: number, refreshToken?: string) =>
        // Refresh-token rotation: when the backend returns a new
        // refresh token alongside the access token, store it so the
        // next /auth/refresh uses the latest jti. The old jti has
        // already been revoked server-side.
        set({
          accessToken,
          sessionExpiresAt: Date.now() + expiresIn * 1000,
          ...(refreshToken ? { refreshToken } : {}),
        }),

      getTimeUntilExpiry: () => {
        const { sessionExpiresAt } = get();
        if (!sessionExpiresAt) return 0;
        const remaining = Math.max(0, Math.floor((sessionExpiresAt - Date.now()) / 1000));
        return remaining;
      },
    }),
    {
      name: 'auth-storage',
    },
  ),
);
