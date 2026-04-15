import { useOrgContext } from '@/stores/orgContext';

// ──────────────────────────────────────────────────────────────────────────
// ScopeBanner — a persistent strip under the header that shows which org
// the app is currently scoped to. The "Working in" dropdown in the header
// is easy to miss; this makes the scope tangible on every page and teaches
// users that changing it re-scopes the data they see.
//
// Rendered only when an org is selected. Purely informational — the
// dropdown in the header is still the control.
// ──────────────────────────────────────────────────────────────────────────

export default function ScopeBanner() {
  const { activeOrgId, activeOrgName, activeOrgType } = useOrgContext();
  if (!activeOrgId) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        background: 'var(--color-primary-light)',
        borderBottom: '1px solid var(--color-border)',
        fontSize: 12, color: 'var(--color-primary)',
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>{'\u2616'}</span>
      <span>
        Scoped to <strong>{activeOrgName}</strong>
        {activeOrgType && (
          <span style={{ fontSize: 10, marginLeft: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-primary)', opacity: 0.75 }}>
            {activeOrgType}
          </span>
        )}
      </span>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
        Lists and metrics below are filtered to this org. Switch via the header dropdown.
      </span>
    </div>
  );
}
