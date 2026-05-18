import { useDomainLensStore, useDomainLens, DomainLens } from '../stores/domainLensStore';

// Segmented "All · Operational · Governance" control. Each page passes a
// stable `pageKey` so its lens is independent — setting Governance on
// Data Assets no longer affects the Process Catalog and vice versa.
// `defaultLens` is the value used until the user picks something on
// that page.

const OPTIONS: Array<{ value: DomainLens; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'OPERATIONAL', label: 'Operational' },
  { value: 'GOVERNANCE', label: 'Governance' },
];

export default function DomainLensToggle({
  pageKey,
  defaultLens = 'ALL',
}: {
  pageKey: string;
  defaultLens?: DomainLens;
}) {
  const lens = useDomainLens(pageKey, defaultLens);
  const setLens = useDomainLensStore((s) => s.setLens);

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
            onClick={() => setLens(pageKey, o.value)}
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
