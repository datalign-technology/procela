import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Gauge — a semicircular (180°) gauge for a single 0–100 measure, with the
// value arc coloured by the app-wide health thresholds (≥80 success / ≥50
// warning / else error) so it retunes with the theme rather than a bespoke
// hex. Pure SVG, no chart dependency, matching ProgressRing / Meter.
//
//   <Gauge value={coverage} label="Coverage" />
// ──────────────────────────────────────────────────────────────────────────

import { healthColorVar } from './HealthBar';

interface GaugeProps {
  /** 0–100. Clamped. */
  value: number | null | undefined;
  /** Diameter in px. Default 120 (the arc is half this tall). */
  size?: number;
  /** Arc thickness in px. Default 10. */
  thickness?: number;
  /** Caption under the number. */
  label?: string;
  /** Override the value-arc colour (defaults to the health thresholds). */
  color?: string;
  /** Suffix after the number. Default "%". */
  unit?: string;
  style?: CSSProperties;
}

// angle: 180 = left, 90 = top, 0 = right. y is flipped for screen coords.
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

// Arc path from `fromDeg` to `toDeg` (both in the 0–180 top semicircle),
// swept clockwise over the top.
function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  const s = polar(cx, cy, r, fromDeg);
  const e = polar(cx, cy, r, toDeg);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
}

export default function Gauge({
  value, size = 120, thickness = 10, label, color, unit = '%', style,
}: GaugeProps) {
  const has = value != null;
  const pct = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  const stroke = color ?? healthColorVar(pct);
  const pad = thickness / 2 + 1;
  const cx = size / 2;
  const cy = size / 2; // baseline of the semicircle
  const r = size / 2 - pad;
  // value 0 → 180° (left), value 100 → 0° (right).
  const valAngle = 180 * (1 - pct / 100);
  const h = cy + pad; // svg height: top of arc + a little for the number below

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, ...style }}>
      <svg
        width={size}
        height={h}
        viewBox={`0 0 ${size} ${h}`}
        role="img"
        aria-label={`${label ? label + ': ' : ''}${has ? pct + unit : 'no data'}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Track */}
        <path d={arc(cx, cy, r, 180, 0)} fill="none" stroke="var(--color-border)" strokeWidth={thickness} strokeLinecap="round" />
        {/* Value arc */}
        {has && pct > 0 && (
          <path
            d={arc(cx, cy, r, 180, valAngle)}
            fill="none"
            stroke={stroke}
            strokeWidth={thickness}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.4s ease' }}
          />
        )}
        {/* Centered number, sitting inside the arc. */}
        <text
          x={cx}
          y={cy - r * 0.28}
          textAnchor="middle"
          fontSize={size * 0.2}
          fontWeight={700}
          style={{ fill: has ? stroke : 'var(--color-text-muted)' }}
        >
          {has ? `${pct}${unit}` : '—'}
        </text>
      </svg>
      {label && (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
      )}
    </div>
  );
}
