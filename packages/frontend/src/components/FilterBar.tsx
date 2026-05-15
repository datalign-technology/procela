import React from 'react';

// ──────────────────────────────────────────────────────────────────────────
// FilterBar — standardised top-of-list-page strip. Each list page used
// to roll its own arrangement of search input + dropdown filters +
// density toggle + saved views menu + column picker, with the order
// and spacing drifting between pages. FilterBar locks the visual order:
//
//   [ Search ] [ Filter ▾ ] [ Filter ▾ ] ...        [ leftActions ]   [ rightActions ]
//
// `leftActions` is for content that should sit next to the filters
// (e.g. the "Active filters" chip bar). `rightActions` is for the
// trailing density toggle / saved views / column picker / page-level
// CTAs.
//
// Filter dropdowns are wired here so options stay vertically aligned
// and the placeholder uppercase label reads the same on every page.
// ──────────────────────────────────────────────────────────────────────────

export interface FilterDropdown {
  // Stable id for React keys. Defaults to label if omitted.
  id?: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  // Width override — some filters need more room (e.g. long system names).
  width?: number;
}

interface FilterBarProps {
  search?: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    width?: number;
  };
  filters?: FilterDropdown[];
  leftActions?: React.ReactNode;
  rightActions?: React.ReactNode;
  style?: React.CSSProperties;
}

const SELECT_STYLE: React.CSSProperties = {
  height: 32,
  padding: '0 28px 0 10px',
  fontSize: 12,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  cursor: 'pointer',
};

const INPUT_STYLE: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  fontSize: 12,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
};

export default function FilterBar({ search, filters = [], leftActions, rightActions, style }: FilterBarProps) {
  return (
    <div
      role="search"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
        ...style,
      }}
    >
      {search && (
        <input
          type="search"
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder || 'Search…'}
          aria-label={search.placeholder || 'Search'}
          style={{ ...INPUT_STYLE, width: search.width || 220 }}
        />
      )}
      {filters.map((f) => (
        <select
          key={f.id || f.label}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
          aria-label={f.label}
          style={{ ...SELECT_STYLE, width: f.width }}
        >
          <option value="">{f.label}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
      {leftActions}
      {rightActions && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {rightActions}
        </div>
      )}
    </div>
  );
}
