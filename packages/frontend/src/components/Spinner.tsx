import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Spinner — the shared busy / loading indicator.
//
// A `currentColor` ring, so it tints to its context automatically: white on
// a primary button, muted grey in a page loader, primary next to body text.
// Pair it with a label for a full-area wait ("Loading…"), or drop it bare
// into a button while an action is in flight.
//
// When to use which loader:
//   • Table / list still loading      → <SkeletonRows> (keeps the final
//     layout so nothing jumps when rows arrive)
//   • Everything else — a full-area fetch, a button action, an overlay,
//     a non-table panel — → <Spinner>
//
// Canonical loading copy is "Loading…" (real ellipsis). Prefer the default
// label; only pass a more specific one when the wait is genuinely ambiguous.
// ──────────────────────────────────────────────────────────────────────────

interface SpinnerProps {
  /** Diameter in px. Default 16. */
  size?: number;
  /** Ring thickness in px. Default 2. */
  thickness?: number;
  /** Optional label shown after the ring (e.g. "Loading…"). */
  label?: string;
  /** Centre the spinner in a padded block — the standard full-area loader. */
  center?: boolean;
  /** Colour override. Defaults to `currentColor` so it inherits its context. */
  color?: string;
  style?: CSSProperties;
}

export default function Spinner({
  size = 16,
  thickness = 2,
  label,
  center,
  color,
  style,
}: SpinnerProps) {
  const content = (
    <span
      role="status"
      aria-label={label || 'Loading'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: label ? 8 : 0,
        color: center ? 'var(--color-text-muted)' : undefined,
        fontSize: 13,
        lineHeight: 1,
        ...(center ? null : style),
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          border: `${thickness}px solid ${color ?? 'currentColor'}`,
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'procelaSpin 0.6s linear infinite',
          flexShrink: 0,
        }}
      />
      {label && <span>{label}</span>}
      <style>{`@keyframes procelaSpin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );

  if (center) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 48, ...style }}>
        {content}
      </div>
    );
  }
  return content;
}
