import { useDomainLensStore, useDomainLens, DomainLens } from '../stores/domainLensStore';

// Visible reminder that a per-page domain lens is filtering what the
// user sees. The DomainLensToggle is small and easy to scroll past; on
// pages that persist the lens across visits, a user can come back later,
// see fewer items than expected, and not realise the lens is non-default.
// Render this just above the list / tree so the filter is impossible
// to miss.

const LABELS: Record<Exclude<DomainLens, 'ALL'>, string> = {
  OPERATIONAL: 'operational',
  GOVERNANCE:  'governance',
};

export default function DomainLensActiveBanner({
  pageKey,
  defaultLens = 'ALL',
  entityLabel = 'items',
}: {
  pageKey: string;
  defaultLens?: DomainLens;
  /** Plural label for what the page lists, e.g. "data assets",
   *  "value streams". Used in "Showing X only" copy. */
  entityLabel?: string;
}) {
  const lens = useDomainLens(pageKey, defaultLens);
  const setLens = useDomainLensStore((s) => s.setLens);

  if (lens === defaultLens || lens === 'ALL') return null;
  const which = LABELS[lens as Exclude<DomainLens, 'ALL'>];

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', marginBottom: 14,
        background: '#fef3c7', border: '1px solid #f59e0b',
        borderLeft: '4px solid #f59e0b',
        borderRadius: 'var(--radius-md)', fontSize: 13, color: '#92400e',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>⚠</span>
      <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>Filter active</span>
      <span>Showing <strong>{which} {entityLabel}</strong> only — some {entityLabel} are hidden.</span>
      <button
        type="button"
        onClick={() => setLens(pageKey, 'ALL')}
        style={{
          marginLeft: 'auto',
          background: '#b45309', border: '1px solid #b45309',
          color: '#fff', borderRadius: 4,
          padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}
      >
        Show all
      </button>
    </div>
  );
}
