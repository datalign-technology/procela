import { useOrgContext } from '@/stores/orgContext';

export default function ScopeBanner() {
  const { activeOrgId, activeOrgName, activeOrgType, orgs } = useOrgContext();
  // Hide when no org selected, or when there's only one org (no ambiguity)
  if (!activeOrgId || orgs.length <= 1) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 12px',
        background: '#f8fafc',
        borderBottom: '1px solid var(--color-border)',
        fontSize: 11, color: 'var(--color-text-muted)',
      }}
    >
      <span>
        Viewing: <strong style={{ color: 'var(--color-text)' }}>{activeOrgName}</strong>
        {activeOrgType && (
          <span style={{ fontSize: 10, marginLeft: 4, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>
            {activeOrgType}
          </span>
        )}
      </span>
      <span style={{ marginLeft: 'auto', fontSize: 10 }}>
        Includes items from parent and child organizations
      </span>
    </div>
  );
}
