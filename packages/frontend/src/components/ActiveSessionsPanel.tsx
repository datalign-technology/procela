import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import ConfirmDialog from './ConfirmDialog';

// ──────────────────────────────────────────────────────────────────────────
// ActiveSessionsPanel — one row per outstanding refresh token bound to the
// current user. Backed by /auth/sessions, which reads from the same
// refreshTokenStore as /auth/refresh. The list shows the device hint
// derived from the original User-Agent string, the IP at issue time,
// the provider that minted the session, and a relative "last used" stamp
// so a user can spot a session they don't recognise at a glance.
//
// Two revoke verbs:
//   - Revoke this one — delete a single jti. Other devices stay signed in.
//   - Sign out everywhere — delete every session for this user, including
//     the one rendering the panel. The next /auth/refresh will 401 and the
//     UI tips back to the login page via the token interceptor.
// ──────────────────────────────────────────────────────────────────────────

export interface SessionRow {
  jti: string;
  createdAt?: string;
  lastUsedAt?: string;
  ip?: string;
  userAgent?: string;
  provider?: string;
  current?: boolean;
}

export function deviceLabel(ua?: string): string {
  if (!ua) return 'Unknown device';
  const s = ua.toLowerCase();
  let os = 'Device';
  if (s.includes('windows')) os = 'Windows';
  else if (s.includes('mac os') || s.includes('macintosh')) os = 'Mac';
  else if (s.includes('iphone')) os = 'iPhone';
  else if (s.includes('ipad')) os = 'iPad';
  else if (s.includes('android')) os = 'Android';
  else if (s.includes('linux')) os = 'Linux';
  let browser = '';
  if (s.includes('edg/')) browser = 'Edge';
  else if (s.includes('chrome/') && !s.includes('chromium')) browser = 'Chrome';
  else if (s.includes('firefox/')) browser = 'Firefox';
  else if (s.includes('safari/') && !s.includes('chrome')) browser = 'Safari';
  return browser ? `${browser} on ${os}` : os;
}

export function relativeTime(iso?: string, now: number = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`;
  return `${Math.floor(diffSec / 86400)} day${diffSec < 172800 ? '' : 's'} ago`;
}

export default function ActiveSessionsPanel() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: SessionRow[] }>('/auth/sessions');
      setSessions(res.data || []);
    } catch (e: any) {
      setErr(e?.message || 'Could not load sessions');
      setSessions([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revokeOne = async (jti: string) => {
    setBusy(true);
    setErr('');
    try {
      await apiClient.delete(`/auth/sessions/${jti}`);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Could not revoke session');
    } finally { setBusy(false); }
  };

  const revokeAll = async () => {
    setBusy(true);
    setErr('');
    try {
      await apiClient.delete('/auth/sessions');
      // The current session is now gone — the next API call will 401 and
      // the interceptor will bounce the user to /login. Reload anyway so
      // the panel reflects reality if for any reason the user lingers.
      window.location.href = '/login';
    } catch (e: any) {
      setErr(e?.message || 'Could not sign out everywhere');
      setBusy(false);
    }
  };

  if (sessions === null) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>;
  }

  return (
    <div>
      {err && <div role="alert" style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>{err}</div>}

      {sessions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          No active sessions on record.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {sessions.map((s) => (
            <div key={s.jti} data-testid={`session-row-${s.jti}`} style={{
              padding: '10px 12px',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                  {deviceLabel(s.userAgent)}
                  {s.current && (
                    <span style={{
                      marginLeft: 8, fontSize: 10, fontWeight: 600,
                      padding: '2px 6px', borderRadius: 4,
                      background: '#d1fae5', color: '#065f46',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>This device</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {s.ip || 'unknown IP'} · {s.provider || 'unknown provider'} · last used {relativeTime(s.lastUsedAt || s.createdAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revokeOne(s.jti)}
                disabled={busy}
                aria-label={`Revoke session on ${deviceLabel(s.userAgent)}`}
                style={{
                  padding: '4px 10px', fontSize: 12, fontWeight: 500,
                  background: 'var(--color-surface)', color: 'var(--color-error, #dc2626)',
                  border: '1px solid var(--color-border)', borderRadius: 4,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => setConfirmAll(true)}
          disabled={busy || sessions.length === 0}
          style={{
            padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
            background: 'var(--color-surface)', color: 'var(--color-error, #dc2626)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
            cursor: (busy || sessions.length === 0) ? 'default' : 'pointer',
            opacity: (busy || sessions.length === 0) ? 0.5 : 1,
          }}
        >
          Sign out everywhere
        </button>
      </div>

      <ConfirmDialog
        open={confirmAll}
        title="Sign out of every device?"
        message="Every active session, including this one, will be revoked. You'll need to sign in again on every device."
        confirmLabel="Sign out everywhere"
        variant="danger"
        onConfirm={revokeAll}
        onCancel={() => setConfirmAll(false)}
      />
    </div>
  );
}
