import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorToast, successToast } from '../lib/errorToast';
import { usePermissions } from '../hooks/usePermissions';
import ConfirmDialog from './ConfirmDialog';
import SectionLabel from './SectionLabel';

// ──────────────────────────────────────────────────────────────────────────
// SecurityCard — admin-only panel for credential lifecycle actions on
// a Person:
//   - Activate / deactivate the account (soft-delete).
//   - Reset two-step verification (clears TOTP enrollment).
//   - Clear registered security keys (WebAuthn).
//   - Clear an active lockout (manual unlock).
//   - GDPR right-to-be-forgotten cascade (typed-confirmation gate).
//
// Rendered as a self-contained card on the Person detail page. Each
// destructive action goes through a confirmation prompt — the forget
// flow uses ConfirmDialog's requireTypedConfirmation so a muscle-
// memory click can't trigger the cascade.
// ──────────────────────────────────────────────────────────────────────────

export interface SecurityCardPerson {
  id: string;
  name: string;
  email: string;
  active?: boolean;
  mfaEnrolled?: boolean;
  webauthnCredentials?: Array<{ id: string; label: string; createdAt: string }>;
  webauthnEnrolled?: boolean;
  locked?: boolean;
  lockedUntil?: string;
}

interface SecurityCardProps {
  person: SecurityCardPerson;
  onChanged: () => void;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 16,
  marginBottom: 16,
};

export default function SecurityCard({ person, onChanged }: SecurityCardProps) {
  const { isAdmin } = usePermissions();
  const [confirm, setConfirm] = useState<null | 'deactivate' | 'reactivate' | 'mfa-reset' | 'webauthn-reset' | 'unlock' | 'forget'>(null);
  const [busy, setBusy] = useState(false);
  const [forgetPhrase, setForgetPhrase] = useState('');
  const navigate = useNavigate();

  if (!isAdmin) return null;

  const active = person.active !== false;
  const webauthnCount = person.webauthnCredentials?.length ?? (person.webauthnEnrolled ? 1 : 0);

  const deactivate = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/people/${person.id}/deactivate`, {});
      successToast('Account deactivated');
      onChanged();
    } catch (err) { errorToast(err, 'Could not deactivate'); }
    finally { setBusy(false); setConfirm(null); }
  };
  const reactivate = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/people/${person.id}/reactivate`, {});
      successToast('Account reactivated');
      onChanged();
    } catch (err) { errorToast(err, 'Could not reactivate'); }
    finally { setBusy(false); setConfirm(null); }
  };
  const resetMfa = async () => {
    setBusy(true);
    try {
      await apiClient.post('/auth/mfa/admin-reset', { personId: person.id });
      successToast('Two-step verification reset');
      onChanged();
    } catch (err) { errorToast(err, 'Could not reset MFA'); }
    finally { setBusy(false); setConfirm(null); }
  };
  const resetWebauthn = async () => {
    setBusy(true);
    try {
      await apiClient.post('/auth/mfa/webauthn/admin-reset', { personId: person.id });
      successToast('Security keys cleared');
      onChanged();
    } catch (err) { errorToast(err, 'Could not clear security keys'); }
    finally { setBusy(false); setConfirm(null); }
  };
  const clearLockout = async () => {
    setBusy(true);
    try {
      await apiClient.post('/auth/lockout/admin-clear', { personId: person.id });
      successToast('Account unlocked');
      onChanged();
    } catch (err) { errorToast(err, 'Could not clear lockout'); }
    finally { setBusy(false); setConfirm(null); }
  };
  const forgetPerson = async () => {
    const expected = `FORGET ${person.email}`;
    if (forgetPhrase !== expected) {
      errorToast(null, `Type "${expected}" exactly to confirm`);
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.post<{ data: { cascadeReport: { storesModified: number; rowsRemoved: number; rowsModified: number; auditEntriesRedacted: number } } }>(
        `/people/${person.id}/forget`, { confirm: expected });
      const r = res.data.cascadeReport;
      successToast(`Erased. ${r.storesModified} stores changed, ${r.rowsRemoved + r.rowsModified} rows touched, ${r.auditEntriesRedacted} audit entries redacted.`);
      navigate('/people');
    } catch (err) { errorToast(err, 'Could not erase person'); }
    finally { setBusy(false); setConfirm(null); setForgetPhrase(''); }
  };

  return (
    <div style={cardStyle} data-testid="security-card">
      <SectionLabel marginBottom={10}>Security</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Account status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: active ? '#d1fae5' : '#fee2e2',
            color: active ? '#065f46' : '#991b1b',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{active ? 'Active' : 'Deactivated'}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>
            {active
              ? 'Can sign in and appears in default People lists.'
              : 'Cannot sign in; hidden from default lists.'}
          </span>
          <button
            type="button"
            onClick={() => setConfirm(active ? 'deactivate' : 'reactivate')}
            disabled={busy}
            style={{
              padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
              background: 'var(--color-surface)',
              color: active ? 'var(--color-error, #dc2626)' : 'var(--color-primary)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>

        {/* Authenticator app (TOTP) row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: person.mfaEnrolled ? '#d1fae5' : '#f1f5f9',
            color: person.mfaEnrolled ? '#065f46' : '#64748b',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{person.mfaEnrolled ? 'TOTP Enrolled' : 'No TOTP'}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>
            {person.mfaEnrolled
              ? 'Authenticator app is configured for two-step verification.'
              : 'Authenticator app is not configured.'}
          </span>
          {person.mfaEnrolled && (
            <button
              type="button"
              onClick={() => setConfirm('mfa-reset')}
              disabled={busy}
              style={{
                padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
                background: 'var(--color-surface)',
                color: 'var(--color-error, #dc2626)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Security keys (WebAuthn) row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: webauthnCount > 0 ? '#d1fae5' : '#f1f5f9',
            color: webauthnCount > 0 ? '#065f46' : '#64748b',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{webauthnCount > 0 ? `${webauthnCount} Key${webauthnCount === 1 ? '' : 's'}` : 'No Keys'}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>
            {webauthnCount > 0
              ? 'Hardware / platform security keys are registered for this account.'
              : 'No security keys are registered.'}
          </span>
          {webauthnCount > 0 && (
            <button
              type="button"
              onClick={() => setConfirm('webauthn-reset')}
              disabled={busy}
              style={{
                padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
                background: 'var(--color-surface)',
                color: 'var(--color-error, #dc2626)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              Clear keys
            </button>
          )}
        </div>

        {/* Lockout row — only rendered when the account is currently
            locked by repeated failed sign-ins. */}
        {person.locked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
              background: '#fee2e2', color: '#991b1b',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>Locked</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>
              Locked by repeated failed sign-ins{person.lockedUntil ? ` until ${new Date(person.lockedUntil).toLocaleString()}` : ''}. Cannot sign in until cleared or auto-unlock.
            </span>
            <button
              type="button"
              onClick={() => setConfirm('unlock')}
              disabled={busy}
              style={{
                padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
                background: 'var(--color-surface)', color: 'var(--color-primary)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              Unlock
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'deactivate'}
        title="Deactivate account?"
        message={`${person.name} (${person.email}) will be unable to sign in and won't appear in default People lists. Their record, comments, and role assignments are preserved. You can reactivate later.`}
        confirmLabel="Deactivate"
        variant="danger"
        onConfirm={deactivate}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'reactivate'}
        title="Reactivate account?"
        message={`${person.name} (${person.email}) will be able to sign in again and reappear in default People lists.`}
        confirmLabel="Reactivate"
        variant="primary"
        onConfirm={reactivate}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'mfa-reset'}
        title="Reset two-step verification?"
        message={`${person.name} (${person.email}) will lose their current authenticator setup and backup codes. They'll be prompted to set up two-step verification again on next sign-in. Use this when they've lost their authenticator app or backup codes.`}
        confirmLabel="Reset"
        variant="danger"
        onConfirm={resetMfa}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'webauthn-reset'}
        title="Clear security keys?"
        message={`${person.name} (${person.email}) will lose every registered hardware key (YubiKey, Touch ID, etc.). They can register new keys after signing in. Use this when they've lost a key or are decommissioning a device.`}
        confirmLabel="Clear keys"
        variant="danger"
        onConfirm={resetWebauthn}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'unlock'}
        title="Clear account lockout?"
        message={`${person.name} (${person.email}) is currently locked out by the brute-force protection. Only clear this after positively identifying them via another channel (phone, in person). The failure counter and lock will be reset.`}
        confirmLabel="Unlock"
        variant="primary"
        onConfirm={clearLockout}
        onCancel={() => setConfirm(null)}
      />

      {/* GDPR / right-to-be-forgotten — separate row outside the
          standard security grid because it's destructive in a way
          deactivation isn't. Requires typing the literal confirmation
          phrase to defend against muscle-memory errors. */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          <strong>Right to be forgotten</strong> — permanently erase this
          person's record and scrub every reference across the catalog.
          Audit history is tombstoned, not deleted. Irreversible.
        </div>
        <button
          type="button"
          onClick={() => { setConfirm('forget'); setForgetPhrase(''); }}
          disabled={busy}
          style={{
            padding: '0.4rem 1rem', fontSize: 13, fontWeight: 500,
            background: 'var(--color-surface)', color: 'var(--color-error, #dc2626)',
            border: '1px solid var(--color-error, #dc2626)', borderRadius: 'var(--radius-md)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Forget person…
        </button>
      </div>

      {confirm === 'forget' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="forget-person-title"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
            padding: 24, maxWidth: 480, width: '90%',
            boxShadow: 'var(--shadow-xl)',
          }}>
            <div id="forget-person-title" style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              Erase {person.name}?
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
              This is the GDPR right-to-be-forgotten cascade. The Person
              record is deleted and every reference across the catalog
              (ownership, stewardship, group membership, authored
              comments) is scrubbed. Audit log entries are tombstoned
              with the user replaced by <code>[deleted]</code> so the
              action history survives. <strong>This cannot be undone.</strong>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
              Type <code style={{ background: 'var(--color-bg)', padding: '1px 4px', borderRadius: 3 }}>FORGET {person.email}</code> to confirm:
            </div>
            <input
              autoFocus
              aria-label="Confirmation phrase"
              value={forgetPhrase}
              onChange={(e) => setForgetPhrase(e.target.value)}
              style={{
                width: '100%', padding: '0.5rem 0.75rem',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 12,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setConfirm(null); setForgetPhrase(''); }}
                style={{
                  padding: '0.5rem 1rem', fontSize: 13,
                  background: 'transparent', color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={forgetPerson}
                disabled={busy || forgetPhrase !== `FORGET ${person.email}`}
                style={{
                  padding: '0.5rem 1rem', fontSize: 13, fontWeight: 500,
                  background: 'var(--color-error, #dc2626)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)',
                  cursor: (busy || forgetPhrase !== `FORGET ${person.email}`) ? 'not-allowed' : 'pointer',
                  opacity: (busy || forgetPhrase !== `FORGET ${person.email}`) ? 0.5 : 1,
                }}
              >
                {busy ? 'Erasing…' : 'Erase permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
