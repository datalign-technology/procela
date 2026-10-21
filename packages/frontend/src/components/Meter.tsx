import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Meter — the one horizontal progress / proportion bar.
//
// Replaces the five hand-rolled bars across the dashboards (heights 4/6/8,
// tracks split between raw #e5e7eb and tokens). One tokenised track, one
// height, one fill convention. Brand teal for "progress toward a goal";
// pass a semantic token / healthColorVar(x) when the bar encodes health.
//
//   <Meter value={pct} />
//   <Meter value={healthPct} color={healthColorVar(healthPct)} />
//
// For the labelled inline health gauge with a trailing "NN%", use <HealthBar>.
// ──────────────────────────────────────────────────────────────────────────

interface MeterProps {
  /** 0–100. Clamped. */
  value: number;
  /** Fill colour. Default brand primary. */
  color?: string;
  /** Track colour. Default `--color-border`. */
  trackColor?: string;
  /** Bar height in px. Default 6. */
  height?: number;
  radius?: number;
  /** Optional 0–100 goal marker — draws a vertical tick at this position so
   *  the bar reads against a target (e.g. a classification goal). Clamped. */
  target?: number;
  ariaLabel?: string;
  style?: CSSProperties;
}

export default function Meter({
  value,
  color = 'var(--color-primary)',
  trackColor = 'var(--color-border)',
  height = 6,
  radius,
  target,
  ariaLabel,
  style,
}: MeterProps) {
  const pct = Math.max(0, Math.min(100, value));
  const r = radius ?? height / 2;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      style={{ height, background: trackColor, borderRadius: r, overflow: 'hidden', position: 'relative', ...style }}
    >
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: r, transition: 'width 0.3s' }} />
      {typeof target === 'number' && (
        <span
          aria-hidden="true"
          style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.max(0, Math.min(100, target))}%`, width: 2, marginLeft: -1, background: 'var(--color-text)' }}
        />
      )}
    </div>
  );
}
