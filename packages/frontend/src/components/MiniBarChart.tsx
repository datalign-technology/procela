import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// MiniBarChart — a compact horizontal bar chart for comparing the magnitude of
// one measure across a few labelled categories (e.g. the catalog's shape:
// Value Streams / Processes / Sub-processes / Activities). One hue — this is a
// magnitude comparison, not identity — with each bar's data-end rounded and a
// value label. Bars scale to the largest row.
// ──────────────────────────────────────────────────────────────────────────

export interface MiniBar {
  label: string;
  value: number;
  /** Optional per-row override; defaults to the shared `color`. */
  color?: string;
  /** Optional deep-link for the row. */
  to?: string;
}

interface MiniBarChartProps {
  rows: MiniBar[];
  /** Shared bar colour (magnitude → one hue). Default brand primary. */
  color?: string;
  /** Label column width in px. Default 96. */
  labelWidth?: number;
  /** Row click handler (receives the row's `to`, if any). */
  onRowClick?: (to: string | undefined, row: MiniBar) => void;
  style?: CSSProperties;
}

export default function MiniBarChart({ rows, color = 'var(--color-primary)', labelWidth = 96, onRowClick, style }: MiniBarChartProps) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        const clickable = !!(onRowClick && r.to);
        return (
          <div
            key={r.label}
            onClick={clickable ? () => onRowClick!(r.to, r) : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: clickable ? 'pointer' : 'default' }}
          >
            <span style={{ width: labelWidth, flexShrink: 0, fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.label}
            </span>
            <div style={{ flex: 1, height: 10, background: 'var(--color-bg)', borderRadius: 5, overflow: 'hidden', minWidth: 40 }}>
              <div style={{ height: '100%', width: `${pct}%`, minWidth: r.value > 0 ? 4 : 0, background: r.color ?? color, borderRadius: 5, transition: 'width 0.3s' }}>
                <title>{`${r.label}: ${r.value}`}</title>
              </div>
            </div>
            <span style={{ width: 40, textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>{r.value}</span>
          </div>
        );
      })}
    </div>
  );
}
