import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// ActiveFiltersBar — visualises the currently-applied filters as chips
// above a list. Each chip has an × to remove just that filter, plus a
// "Clear all" link. Filter state usually lives in the URL (via useUrlState),
// so removing a chip calls the same setter that drives the URL.
//
// Usage:
//   <ActiveFiltersBar
//     filters={[
//       selectedOrgName && { label: 'Org', value: selectedOrgName, onClear: () => applyOrgFilter('') },
//       searchTerm && { label: 'Search', value: searchTerm, onClear: () => setSearchTerm('') },
//     ].filter(Boolean) as Filter[]}
//     onClearAll={() => { ... }}
//   />
// ──────────────────────────────────────────────────────────────────────────

export interface ActiveFilter {
  label: string;
  value: string;
  onClear: () => void;
}

interface ActiveFiltersBarProps {
  filters: ActiveFilter[];
  onClearAll?: () => void;
  style?: CSSProperties;
}

export default function ActiveFiltersBar({ filters, onClearAll, style }: ActiveFiltersBarProps) {
  if (filters.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="Active filters"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '8px 0',
        marginBottom: 8,
        ...style,
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>
        Filters
      </span>
      {filters.map((f, i) => (
        <span
          key={`${f.label}-${i}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 4px 3px 10px',
            background: 'var(--color-primary-light)',
            border: '1px solid var(--color-primary)',
            borderRadius: 999,
            fontSize: 12,
            color: 'var(--color-primary)',
          }}
        >
          <span style={{ fontWeight: 600 }}>{f.label}:</span>
          <span>{f.value}</span>
          <button
            onClick={f.onClear}
            aria-label={`Remove ${f.label} filter`}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--color-primary)', fontSize: 14, lineHeight: 1,
              padding: '0 6px', borderRadius: 999,
            }}
          >
            &times;
          </button>
        </span>
      ))}
      {onClearAll && filters.length > 1 && (
        <button
          onClick={onClearAll}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 12, color: 'var(--color-primary)',
            padding: '3px 8px', fontWeight: 500,
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
