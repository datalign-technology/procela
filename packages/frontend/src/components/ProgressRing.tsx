// ProgressRing — small circular progress indicator used by the Setup Hub
// header and its sidebar nav entry. Pure SVG so it inherits theme colors
// and needs no chart dependency.
interface ProgressRingProps {
  /** 0–100 */
  percent: number;
  size?: number;
  stroke?: number;
  /** Show the "NN%" label centered inside the ring. */
  showLabel?: boolean;
}

export default function ProgressRing({ percent, size = 18, stroke = 2.5, showLabel = false }: ProgressRingProps) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden={!showLabel} role={showLabel ? 'img' : undefined}>
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="var(--color-border)" strokeWidth={stroke}
      />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="var(--color-primary)" strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
      {showLabel && (
        <text
          x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
          fontSize={size * 0.32} fontWeight={700} fill="var(--color-text)"
        >{pct}%</text>
      )}
    </svg>
  );
}
