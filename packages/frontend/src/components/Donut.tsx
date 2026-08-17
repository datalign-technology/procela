import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Donut — a ring chart for a small set of parts-of-a-whole. Renders each
// segment as a stroked arc with a 2px surface gap between segments, a total in
// the middle, and (optionally) a labelled legend so identity is never colour
// alone. Pure SVG, no chart dependency.
//
//   <Donut segments={[{label:'Gold', value:3, color:'#b8860b'}, …]} centerLabel="Assets" />
// ──────────────────────────────────────────────────────────────────────────

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  segments: DonutSegment[];
  /** Outer diameter in px. Default 120. */
  size?: number;
  /** Ring thickness in px. Default 16. */
  thickness?: number;
  /** Small caption under the center total (e.g. "Assets"). */
  centerLabel?: string;
  /** Show the legend beside the ring. Default true. */
  legend?: boolean;
  style?: CSSProperties;
}

const TAU = 2 * Math.PI;

export default function Donut({ segments, size = 120, thickness = 16, centerLabel, legend = true, style }: DonutProps) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = TAU * r;
  // 2px visual gap between segments, expressed in stroke-dash units.
  const gap = total > 0 ? 2 : 0;

  // Build cumulative offsets so each segment starts where the last ended.
  let acc = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = s.value / total;
      const len = Math.max(0, frac * circ - gap);
      const seg = { ...s, dash: len, offset: -acc * circ + gap / 2, frac };
      acc += frac;
      return seg;
    });

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 16, ...style }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Donut: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}
        style={{ flexShrink: 0, transform: 'rotate(-90deg)' }}
      >
        {/* Track (shows through when empty). */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth={thickness} />
        {arcs.map((s) => (
          <circle
            key={s.label}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={`${s.dash} ${circ - s.dash}`}
            strokeDashoffset={s.offset}
            strokeLinecap="butt"
          >
            <title>{`${s.label}: ${s.value} (${Math.round(s.frac * 100)}%)`}</title>
          </circle>
        ))}
        {/* Center total — counter-rotate so text sits upright. */}
        <g transform={`rotate(90 ${cx} ${cy})`}>
          <text x={cx} y={cy - (centerLabel ? 2 : -4)} textAnchor="middle" fontSize={size * 0.24} fontWeight={700} style={{ fill: 'var(--color-text)' }}>
            {total}
          </text>
          {centerLabel && (
            <text x={cx} y={cy + size * 0.14} textAnchor="middle" fontSize={size * 0.09} style={{ fill: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {centerLabel}
            </text>
          )}
        </g>
      </svg>

      {legend && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          {segments.map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--color-text-secondary)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
              <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{s.value}</span>
              <span style={{ color: 'var(--color-text-muted)', minWidth: 34, textAlign: 'right' }}>{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
