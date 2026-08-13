import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// TierBar — the governance-tier distribution as one stacked bar + legend,
// instead of three lonely count tiles.
//
// Tiers are a reserved status-style palette (--color-tier-*), never in the
// categorical/accent rotation. Segments carry a 2px surface gap between
// fills, and identity is always in the legend labels — never colour alone.
//
//   <TierBar gold={9} silver={4} bronze={2} />
// ──────────────────────────────────────────────────────────────────────────

const TIERS = [
  { key: 'gold', label: 'Certified', color: 'var(--color-tier-gold)' },
  { key: 'silver', label: 'Managed', color: 'var(--color-tier-silver)' },
  { key: 'bronze', label: 'Uncertified', color: 'var(--color-tier-bronze)' },
] as const;

interface TierBarProps {
  gold: number;
  silver: number;
  bronze: number;
  height?: number;
  style?: CSSProperties;
}

export default function TierBar({ gold, silver, bronze, height = 14, style }: TierBarProps) {
  const counts = { gold, silver, bronze };
  const total = gold + silver + bronze;
  return (
    <div style={style}>
      <div style={{ display: 'flex', gap: 2, height, borderRadius: height / 2, overflow: 'hidden', background: 'var(--color-border)' }}>
        {total > 0 && TIERS.map((t) => {
          const n = counts[t.key];
          if (n === 0) return null;
          return <div key={t.key} title={`${t.label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: t.color }} />;
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
        {TIERS.map((t) => (
          <span key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color, flexShrink: 0 }} />
            {t.label}
            <strong style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{counts[t.key]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
