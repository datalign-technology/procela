import { useState } from 'react';
import { apiClient } from '../api/client';
import { usePermissions } from '@/hooks/usePermissions';
import { signOutLocal } from '@/lib/signOut';
import { successToast, errorToast } from '../lib/errorToast';

// ──────────────────────────────────────────────────────────────────────────
// ResetAllDataPanel — admin-only "factory reset" for the data layer.
// Hits POST /backup/reset-all, which truncates every JSON store on
// disk AND clears every registered in-memory array. The user is
// signed out and bounced to /login afterwards so the onboarding
// wizard fires on the next sign-in.
//
// Two gates:
//   - Super-admin only. The button doesn't render for other roles.
//   - Typed RESET confirmation phrase. Matches the GDPR forget flow's
//     defence against muscle-memory triggers.
//
// Sits next to Backup & Restore because that's where someone would
// look for "wipe everything and start over." Recommended sequence
// (surfaced in the description) is Export → Reset → Onboarding, so
// the operator has a recovery file before nuking anything.
// ──────────────────────────────────────────────────────────────────────────

interface ResetAllDataPanelProps {
  /** Render a quick "Export Backup first" affordance — wired to the
   *  same handler the surrounding card uses so the operator doesn't
   *  have to scroll. Optional; omit if exporting isn't reachable. */
  onExportFirst?: () => void;
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  marginBottom: '1rem',
};

const sectionStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid #fecaca',
  padding: '1.5rem',
  maxWidth: 600,
};

export default function ResetAllDataPanel({ onExportFirst }: ResetAllDataPanelProps) {
  const { isSuperAdmin } = usePermissions();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  // signOutLocal clears both the auth store and the org-context
  // store. Without the org-context part, the header still shows the
  // pre-reset activeOrgName after the redirect to /login — the
  // backend org store is empty but localStorage disagrees.

  if (!isSuperAdmin) return null;

  const reset = async () => {
    if (phrase !== 'RESET') {
      errorToast(null, 'Type RESET exactly to confirm');
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.post<{ data: { filesCleared: number; storesReloaded: number; message: string } }>(
        '/backup/reset-all',
        { confirm: 'RESET' },
      );
      const { filesCleared, storesReloaded } = res.data;
      successToast(`Reset complete — ${filesCleared} files cleared, ${storesReloaded} in-memory stores. Signing you out…`);
      // The session is technically still valid server-side, but the
      // user record is gone. Drop the local session and route to
      // /login so the next sign-in lands them in onboarding.
      setTimeout(() => {
        signOutLocal();
        window.location.href = '/login';
      }, 1500);
    } catch (err: any) {
      errorToast(err?.message || 'Could not reset data');
      setBusy(false);
    }
  };

  return (
    <div style={sectionStyle} data-testid="reset-all-data-panel">
      <h2 style={{ ...sectionTitleStyle, color: '#991b1b' }}>Reset everything</h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
        Permanently delete every organization, person, process, data asset,
        system, mapping, governance record, comment, and audit-log entry. The
        closest thing Procela has to a factory reset. After this completes,
        you'll be signed out and the next sign-in will start the onboarding
        wizard for a brand-new organization.
      </p>
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '0.625rem 0.875rem', marginBottom: '1rem', fontSize: 12, color: '#92400e' }}>
        <strong>Strongly recommended:</strong> export a backup first so you can recover later if you need to.
        {onExportFirst && (
          <>
            {' '}
            <button
              type="button"
              onClick={onExportFirst}
              disabled={busy}
              style={{ background: 'none', border: 'none', color: '#92400e', textDecoration: 'underline', fontSize: 12, cursor: 'pointer', padding: 0, fontWeight: 600 }}
            >
              Export now →
            </button>
          </>
        )}
      </div>

      {!confirmOpen ? (
        <button
          type="button"
          onClick={() => { setConfirmOpen(true); setPhrase(''); }}
          disabled={busy}
          aria-label="Reset all data"
          style={{
            padding: '0.5rem 1.25rem', fontSize: 13, fontWeight: 500,
            background: 'var(--color-surface)', color: '#dc2626',
            border: '1px solid #dc2626', borderRadius: 'var(--radius-md)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Reset all data…
        </button>
      ) : (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-confirm-title"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '1rem' }}
        >
          <div id="reset-confirm-title" style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#991b1b' }}>
            Type <code style={{ background: '#fef2f2', color: '#991b1b', padding: '1px 6px', borderRadius: 3, fontFamily: 'var(--font-mono, monospace)', fontWeight: 700 }}>RESET</code> to confirm
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            This cannot be undone. The audit log will be wiped along with
            everything else; a single <code>ALL_DATA_RESET</code> entry will be
            recorded so the reset itself is traceable.
          </p>
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="RESET"
            autoComplete="off"
            spellCheck={false}
            aria-label="Confirmation phrase"
            style={{
              width: '100%', padding: '0.5rem 0.75rem',
              border: `1px solid ${phrase === 'RESET' ? '#16a34a' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 12,
              fontFamily: 'var(--font-mono, monospace)', fontWeight: 600,
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); setPhrase(''); }}
              disabled={busy}
              style={{
                padding: '0.5rem 1rem', fontSize: 13,
                background: 'transparent', color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy || phrase !== 'RESET'}
              style={{
                padding: '0.5rem 1rem', fontSize: 13, fontWeight: 500,
                background: '#dc2626', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-md)',
                cursor: (busy || phrase !== 'RESET') ? 'not-allowed' : 'pointer',
                opacity: (busy || phrase !== 'RESET') ? 0.5 : 1,
              }}
            >
              {busy ? 'Resetting…' : 'Reset everything'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
