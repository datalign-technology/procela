import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { apiClient } from '@/api/client';

// ──────────────────────────────────────────────────────────────────────────
// IdleTimeout — log out the user after a period of UI inactivity, even
// when their access token is still valid.
//
// Separate from SessionTimeout (which fires when the access token
// itself is about to expire). Idle timeout is the compliance ask —
// SOC 2 / ISO 27001 / HIPAA all expect "inactive session auto-logout
// after N minutes" as a baseline control. Most enterprises set it to
// 15-30 minutes; we default to 30 and let env override.
//
// Watches a small set of user-input events on the window. Each
// recognised event bumps a lastActivity timestamp; a 30-second poll
// compares now vs lastActivity and logs out past the threshold.
// Polling rather than fancier reactivity because the work per tick
// is trivial and the alternative would be coupling this to a heavy
// state subscription.
//
// On logout, calls /auth/logout (so the refresh token is revoked
// server-side) before clearing local state and routing to /login.
// ──────────────────────────────────────────────────────────────────────────

// Default 30 minutes. Override via env: VITE_IDLE_TIMEOUT_MINUTES=15.
const DEFAULT_IDLE_MINUTES = 30;
const WARNING_SECONDS = 60; // surface a banner this many seconds before logout

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const;

function getIdleMinutes(): number {
  // Read from import.meta.env first (production / vite-built bundle),
  // fall back to process.env so tests using vi.stubEnv (which writes
  // to process.env) can override the value at runtime. Vite injects
  // import.meta.env per-module at build time, so cross-module mutation
  // doesn't propagate — process.env is the universal escape hatch.
  const raw =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import.meta as any).env?.VITE_IDLE_TIMEOUT_MINUTES
    ?? (typeof process !== 'undefined' ? process.env?.VITE_IDLE_TIMEOUT_MINUTES : undefined);
  const parsed = parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IDLE_MINUTES;
  return parsed;
}

export default function IdleTimeout() {
  const { isAuthenticated, refreshToken, logout } = useAuthStore();
  const navigate = useNavigate();
  const lastActivityRef = useRef<number>(Date.now());
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const idleMs = getIdleMinutes() * 60 * 1000;

  const handleLogout = useCallback(async () => {
    try {
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken });
      }
    } catch { /* clear local state regardless */ }
    logout();
    navigate('/login?error=' + encodeURIComponent('You were signed out due to inactivity.'));
  }, [refreshToken, logout, navigate]);

  // Activity tracking — passive listeners on the window. Resetting
  // lastActivityRef is cheap; we don't trigger a re-render until the
  // warning window is open.
  useEffect(() => {
    if (!isAuthenticated) return;
    const bump = () => {
      lastActivityRef.current = Date.now();
      // If we'd already started showing the warning, cancel it on any
      // fresh interaction. Avoids the banner sticking around after
      // the user wakes the tab.
      if (showWarning) setShowWarning(false);
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, bump, { passive: true });
    }
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump);
    };
  }, [isAuthenticated, showWarning]);

  // Poll every 5 seconds when idle, every second once the warning is
  // visible (so the countdown ticks visibly). The lighter cadence when
  // not warning keeps the cost negligible.
  useEffect(() => {
    if (!isAuthenticated) return;
    const tick = () => {
      const now = Date.now();
      const elapsed = now - lastActivityRef.current;
      if (elapsed >= idleMs) {
        handleLogout();
        return;
      }
      const warningWindow = idleMs - WARNING_SECONDS * 1000;
      if (elapsed >= warningWindow) {
        setShowWarning(true);
        setSecondsRemaining(Math.max(0, Math.ceil((idleMs - elapsed) / 1000)));
      }
    };
    const interval = setInterval(tick, showWarning ? 1000 : 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated, idleMs, handleLogout, showWarning]);

  if (!isAuthenticated || !showWarning) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 1100,
        background: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(15, 23, 42, 0.18)',
        padding: '12px 16px',
        maxWidth: 360,
        fontSize: 13,
        color: '#92400e',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>You're about to be signed out</div>
      <div style={{ marginBottom: 8 }}>
        For your security, Procela signs you out after {getIdleMinutes()} minutes of inactivity.
        Signing out in <strong>{secondsRemaining}s</strong>.
      </div>
      <button
        type="button"
        onClick={() => { lastActivityRef.current = Date.now(); setShowWarning(false); }}
        style={{
          padding: '4px 12px', fontSize: 12, fontWeight: 500,
          background: '#92400e', color: '#fff',
          border: 'none', borderRadius: 4, cursor: 'pointer',
        }}
      >
        Keep me signed in
      </button>
    </div>
  );
}
