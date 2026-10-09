import type { ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// SegmentedControl — the shared in-page "pick one of a few" pill toggle:
// a bordered, pill-shaped track whose active segment fills solid primary.
// Used for view/scope switches that sit in a page header or toolbar — the
// governance/operational lens, All vs Governed/In-scope, Basic vs Detailed,
// List vs Calendar, and so on.
//
// Several pages hand-rolled this same control inline and drifted apart on
// the details (radius 999 on some, `--radius-md` on others; 4px vs 5px vs
// 6px padding; 11px vs 12px text; inactive text vs text-secondary). This
// fixes the look in one place. It is the in-page control; the global-chrome
// toggles in the Layout header (density, terminology) are a deliberately
// different "raised chip on a subtle track" style and are not this.
//
// Generic over the option value so a page keeps its own string-union type
// (`'all' | 'governed'`, `'simple' | 'advanced'`, …) with no casting.
// ──────────────────────────────────────────────────────────────────────────

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional native tooltip on the segment. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group (required — it's a `tablist`). */
  ariaLabel: string;
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        border: '1px solid var(--color-border)',
        borderRadius: 999,
        overflow: 'hidden',
        background: 'var(--color-surface)',
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: active ? 600 : 400,
              border: 'none',
              cursor: 'pointer',
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
