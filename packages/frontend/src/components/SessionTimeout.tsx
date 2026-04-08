import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { apiClient } from '@/api/client';

const WARNING_THRESHOLD_SECONDS = 120; // Show warning when < 2 minutes remain

interface RefreshResponse {
  success: boolean;
  data: {
    accessToken: string;
    expiresIn: number;
  };
}

export default function SessionTimeout() {
  const { isAuthenticated, refreshToken, getTimeUntilExpiry, refreshSession, logout } = useAuthStore();
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [extending, setExtending] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleLogout = useCallback(() => {
    setShowWarning(false);
    logout();
    navigate('/login');
  }, [logout, navigate]);

  const handleExtend = useCallback(async () => {
    if (!refreshToken || extending) return;
    setExtending(true);
    try {
      const res = await apiClient.post<RefreshResponse>('/auth/refresh', { refreshToken });
      const { accessToken, expiresIn } = res.data;
      refreshSession(accessToken, expiresIn);
      setShowWarning(false);
    } catch {
      // Refresh failed, force logout
      handleLogout();
    } finally {
      setExtending(false);
    }
  }, [refreshToken, refreshSession, handleLogout, extending]);

  useEffect(() => {
    if (!isAuthenticated) {
      setShowWarning(false);
      return;
    }

    intervalRef.current = setInterval(() => {
      const remaining = getTimeUntilExpiry();
      setSecondsRemaining(remaining);

      if (remaining <= 0) {
        handleLogout();
      } else if (remaining <= WARNING_THRESHOLD_SECONDS) {
        setShowWarning(true);
      } else {
        setShowWarning(false);
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isAuthenticated, getTimeUntilExpiry, handleLogout]);

  if (!isAuthenticated || !showWarning) {
    return null;
  }

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const timeDisplay = minutes > 0
    ? `${minutes}:${seconds.toString().padStart(2, '0')}`
    : `${seconds}s`;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Warning icon */}
        <div style={styles.iconCircle}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12,6 12,12 12,12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h2 style={styles.title}>Session Expiring</h2>
        <p style={styles.description}>
          Your session is about to expire. You will be automatically logged out.
        </p>

        {/* Countdown */}
        <div style={styles.countdown}>
          <span style={styles.countdownValue}>{timeDisplay}</span>
          <span style={styles.countdownLabel}>remaining</span>
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <button
            onClick={handleExtend}
            disabled={extending}
            style={{
              ...styles.extendButton,
              ...(extending ? styles.extendButtonDisabled : {}),
            }}
          >
            {extending ? 'Extending...' : 'Extend Session'}
          </button>
          <button
            onClick={handleLogout}
            style={styles.signOutButton}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(15, 23, 42, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1100,
    padding: '1rem',
  },
  modal: {
    background: '#ffffff',
    borderRadius: '16px',
    padding: '2rem',
    maxWidth: '400px',
    width: '100%',
    textAlign: 'center' as const,
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    border: '1px solid #e2e8f0',
  },
  iconCircle: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    marginBottom: '1rem',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: '0.5rem',
  },
  description: {
    fontSize: '0.875rem',
    color: '#64748b',
    marginBottom: '1.5rem',
    lineHeight: 1.5,
  },
  countdown: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.25rem',
    marginBottom: '1.5rem',
    padding: '1rem',
    background: '#fef2f2',
    borderRadius: '12px',
    border: '1px solid #fecaca',
  },
  countdownValue: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#dc2626',
    fontVariantNumeric: 'tabular-nums',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  countdownLabel: {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
  },
  extendButton: {
    flex: 1,
    padding: '0.75rem 1.25rem',
    background: '#1a7a6d',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.9375rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  extendButtonDisabled: {
    background: '#6b7280',
    cursor: 'not-allowed',
  },
  signOutButton: {
    flex: 1,
    padding: '0.75rem 1.25rem',
    background: '#ffffff',
    color: '#64748b',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '0.9375rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
};
