import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// HealthBar — a compact horizontal gauge for a 0–100 health score. The fill
// colour follows the app-wide thresholds (≥80 success / ≥50 warning / else
// error) using the semantic `--color-*` tokens, so it retunes with the theme
// rather than drifting to a bespoke hex. Renders an em-dash when unset.
//
//   <HealthBar score={asset.healthScore} />
// ──────────────────────────────────────────────────────────────────────────

/** Semantic token for a score, by the app-wide 80/50 thresholds. */
export function healthColorVar(score: number): string {
  return score >= 80
    ? 'var(--color-success)'
    : score >= 50
      ? 'var(--color-warning)'
      : 'var(--color-error)';
}

interface HealthBarProps {
  score: number | null | undefined;
  /** Track width in px. Default 64. */
  width?: number;
  style?: CSSProperties;
}

export default function HealthBar({ score, width = 64, style }: HealthBarProps) {
  if (score == null) {
    return <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>;
  }
  const clamped = Math.max(0, Math.min(100, score));
  const color = healthColorVar(clamped);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}>
      <span
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ position: 'relative', width, height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden', flexShrink: 0 }}
      >
        <span style={{ position: 'absolute', insetBlock: 0, left: 0, width: `${clamped}%`, background: color, borderRadius: 3 }} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 32 }}>{clamped}%</span>
    </span>
  );
}
