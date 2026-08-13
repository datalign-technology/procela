import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// ──────────────────────────────────────────────────────────────────────────
// StatTile — the one KPI / metric tile.
//
// Replaces the Dashboard's two tile systems (MyDashboard + Overview strips)
// and the Executive Report's static metric boxes. One number size (24/700),
// one label, one card. Counts wear plain ink — the label carries identity;
// spend colour only where the number is a *state* (coverage, health) by
// passing `valueColor={healthColorVar(x)}`.
//
//   <StatTile label="Processes" value={48} to="/processes" />
//   <StatTile label="Coverage" value="72%" to="/mappings" valueColor={healthColorVar(72)} />
//   <StatTile label="Certified" value={9} accent="var(--color-tier-gold)" valueColor="var(--color-tier-gold)" />
//
// With `to` it becomes a hover-lift deep link with a zero-aware tooltip;
// without, it's a static box (the print report).
// ──────────────────────────────────────────────────────────────────────────

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Deep-link target. When set the tile hover-lifts and carries a tooltip. */
  to?: string;
  /** Number colour. Default ink; pass a semantic token / healthColorVar() for state. */
  valueColor?: string;
  /** Optional left-border accent (e.g. a governance tier). */
  accent?: string;
  /** Small colored sub-line under the label ("3 overdue"). */
  sub?: { text: ReactNode; color?: string } | null;
  /** Muted number + zero-state tooltip. */
  zero?: boolean;
  /** Tooltip override (else derived from the label when it's a string). */
  title?: string;
  /** Tighter padding + number — for dense grids like the printable report. */
  dense?: boolean;
}

export default function StatTile({ label, value, to, valueColor, accent, sub, zero, title, dense }: StatTileProps) {
  const isZero = zero ?? (typeof value === 'number' && value === 0);
  const base: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    padding: dense ? '8px 12px' : '14px 16px',
    textAlign: 'center',
    ...(accent ? { borderLeft: `4px solid ${accent}` } : null),
  };

  const body = (
    <>
      <div style={{ fontSize: dense ? 20 : 24, fontWeight: 700, lineHeight: 1.1, color: isZero ? 'var(--color-text-muted)' : (valueColor || 'var(--color-text)'), fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: dense ? 10.5 : 11, color: 'var(--color-text-muted)', marginTop: dense ? 2 : 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: sub.color || 'var(--color-text-muted)', marginTop: 2 }}>{sub.text}</div>}
    </>
  );

  if (!to) return <div style={base}>{body}</div>;

  const labelText = typeof label === 'string' ? label : undefined;
  const tip = title ?? (labelText ? (isZero ? `No ${labelText.toLowerCase()} yet — open ${labelText}` : `Open ${labelText}`) : undefined);

  return (
    <Link
      to={to}
      title={tip}
      style={{ ...base, display: 'block', textDecoration: 'none', cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = ''; }}
    >
      {body}
    </Link>
  );
}
