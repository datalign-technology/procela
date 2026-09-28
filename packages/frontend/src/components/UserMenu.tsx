import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import TerminologyToggle from './TerminologyToggle';
import DensityToggle from './DensityToggle';
import styles from './Layout.module.css';

interface UserMenuProps {
  onSignOut: () => void;
}

// ──────────────────────────────────────────────────────────────────────────
// UserMenu — top-right user pill that opens a popover dropdown.
//
// The dropdown is where per-user concerns live: display preferences
// (terminology + density toggles) and Sign out today, with room for
// Profile / Account / Notification preferences as those land. This is
// the canonical "click the avatar" pattern users reach for when they
// ask "where are my settings?".
//
// Distinct from the Settings page, which is admin-only and holds
// org-wide configuration. The two surfaces split along the user vs.
// org axis rather than by feature category.
// ──────────────────────────────────────────────────────────────────────────

export default function UserMenu({ onSignOut }: UserMenuProps) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on click outside / Escape so the popover behaves like the
  // notifications dropdown a few elements over — same dismissal model
  // means the chrome reads consistent.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';
  const role = (user?.role || '').replace('_', ' ');

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Open user menu"
        className={styles.userMenu}
        style={{
          background: 'transparent', border: 'none',
          padding: '6px 12px',
          cursor: 'pointer',
        }}
      >
        <div className={styles.userAvatar}>{userInitial}</div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3, textAlign: 'left' }}>
          <span style={{ fontSize: 14 }}>{user?.name || 'User'}</span>
          <span style={{
            fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 500,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {role}
          </span>
        </div>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            minWidth: 320,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))',
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          {/* User block */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
              {user?.name || 'User'}
            </div>
            {user?.email && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {user.email}
              </div>
            )}
            {role && (
              <div style={{
                fontSize: 10, color: 'var(--color-text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
                fontWeight: 600, marginTop: 4,
              }}>
                {role}
              </div>
            )}
          </div>

          {/* Display preferences */}
          <div style={{ padding: '12px 14px' }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'var(--color-text-muted)',
              marginBottom: 8,
            }}>
              Display preferences
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Terminology</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Plain English vs. DAMA-DMBOK labels</div>
                </div>
                <TerminologyToggle />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Density</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Cozy or compact row spacing</div>
                </div>
                <DensityToggle />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ borderTop: '1px solid var(--color-border)', padding: '8px' }}>
            <button
              type="button"
              onClick={() => { setOpen(false); onSignOut(); }}
              role="menuitem"
              style={{
                width: '100%', textAlign: 'left',
                padding: '8px 10px', fontSize: 13,
                background: 'transparent', border: 'none', borderRadius: 4,
                cursor: 'pointer', color: 'var(--color-text)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ flexShrink: 0, opacity: 0.5, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none', marginLeft: 4 }}
    >
      <path d="M6 9 L12 15 L18 9" />
    </svg>
  );
}
