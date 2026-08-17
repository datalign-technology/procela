import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Sparkline — a tiny inline trend line for a single series, meant to sit under
// a KPI number. No axes or grid (it's a micro-viz, not a full chart); the last
// point gets a dot and the whole series a native tooltip. Colour is a single
// hue; the value + delta beside it (rendered by the caller) carry the reading.
//
//   <Sparkline points={[40,44,51,58,62,71]} />
// ──────────────────────────────────────────────────────────────────────────

interface SparklineProps {
  /** Series values, oldest → newest. Needs ≥ 2 points to draw a line. */
  points: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Fill the area under the line at low opacity. Default true. */
  area?: boolean;
  /** Native tooltip / aria description, e.g. "Coverage, last 10 weeks". */
  title?: string;
  style?: CSSProperties;
}

export default function Sparkline({ points, width = 96, height = 26, color = 'var(--color-primary)', area = true, title, style }: SparklineProps) {
  if (!points || points.length < 2) {
    return <span style={{ display: 'inline-block', width, height, ...style }} aria-hidden />;
  }
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  const xy = points.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const areaPath = `${line} L ${xy[xy.length - 1][0].toFixed(1)} ${height - pad} L ${xy[0][0].toFixed(1)} ${height - pad} Z`;
  const [lx, ly] = xy[xy.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title || 'trend'}
      style={{ display: 'block', overflow: 'visible', ...style }}
    >
      {title && <title>{title}</title>}
      {area && <path d={areaPath} fill={color} opacity={0.12} stroke="none" />}
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={2.6} fill={color} />
    </svg>
  );
}
