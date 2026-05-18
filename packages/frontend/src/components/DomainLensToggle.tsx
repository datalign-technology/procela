import { useEffect } from 'react';
import { useDomainLensStore, DomainLens } from '../stores/domainLensStore';

// Segmented "All · Operational · Governance" control. Pages that have a
// primary audience pass `defaultLens` so they open focused (e.g. the
// Process Catalog defaults to OPERATIONAL); the user's explicit change
// still persists globally via the store.

const OPTIONS: Array<{ value: DomainLens; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'OPERATIONAL', label: 'Operational' },
  { value: 'GOVERNANCE', label: 'Governance' },
];

export default function DomainLensToggle({ defaultLens }: { defaultLens?: DomainLens }) {
  const lens = useDomainLensStore((s) => s.lens);
  const setLens = useDomainLensStore((s) => s.setLens);

  // Apply the page's audience default once on mount, only if the user
  // hasn't already chosen something this session (store starts from
  // localStorage; we only nudge when it's still the global 'ALL').
  useEffect(() => {
    if (defaultLens && lens === 'ALL' && defaultLens !== 'ALL') {
      setLens(defaultLens);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="tablist"
      aria-label="Governance / operational lens"
      style={{
        display: 'inline-flex', border: '1px solid var(--color-border)',
        borderRadius: 999, overflow: 'hidden', background: 'var(--color-surface)',
      }}
    >
      {OPTIONS.map((o) => {
        const active = lens === o.value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => setLens(o.value)}
            style={{
              padding: '4px 12px', fontSize: 11,
              fontWeight: active ? 600 : 400, border: 'none', cursor: 'pointer',
              background: active ? 'var(--color-primary)' : 'transparent',
              color: active ? '#fff' : 'var(--color-text)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
