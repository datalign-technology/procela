import type { CSSProperties } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Skeleton — placeholder for content that's still loading. Preferred over
// a "Loading..." string because the page keeps its final dimensions so
// nothing jumps when data arrives.
//
// SkeletonRow renders N table-row-shaped placeholders with random widths
// so the illusion of real content is a bit more convincing.
// ──────────────────────────────────────────────────────────────────────────

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  rounded?: number;
  style?: CSSProperties;
}

export function Skeleton({ width = '100%', height = 14, rounded = 4, style }: SkeletonProps) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width, height,
        background: 'linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%)',
        backgroundSize: '200% 100%',
        animation: 'procelaSkeleton 1.2s ease-in-out infinite',
        borderRadius: rounded,
        ...style,
      }}
    />
  );
}

interface SkeletonRowsProps {
  rows?: number;
  columns?: number;
  // Optional: pass the column flex basis for each column so the
  // skeleton matches the real table layout and the page doesn't jump
  // when data arrives. Values:
  //   - number: fixed px width (e.g. 40 for a checkbox column)
  //   - string: any CSS flex-basis (e.g. '20%', '180px')
  //   - 'flex' | null: column stretches to fill remaining space
  // If supplied, `columns` is ignored and the array length wins.
  columnWidths?: Array<number | string | null>;
}

export function SkeletonRows({ rows = 6, columns = 4, columnWidths }: SkeletonRowsProps) {
  // Deterministic widths per column so repeated renders don't jitter.
  const widths = ['70%', '40%', '55%', '30%', '65%', '45%'];
  const cols = columnWidths ? columnWidths.length : columns;
  const flexFor = (ci: number): CSSProperties['flex'] => {
    if (!columnWidths) return ci === 0 ? '0 0 220px' : 1;
    const w = columnWidths[ci];
    if (w == null || w === 'flex') return 1;
    if (typeof w === 'number') return `0 0 ${w}px`;
    return `0 0 ${w}`;
  };
  return (
    <div role="status" aria-label="Loading" style={{ padding: '4px 0' }}>
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} style={{
          display: 'flex', gap: 14,
          padding: '10px 14px',
          borderTop: ri === 0 ? 'none' : '1px solid var(--color-border)',
          alignItems: 'center',
        }}>
          {Array.from({ length: cols }).map((_, ci) => (
            <div key={ci} style={{ flex: flexFor(ci), minWidth: 0 }}>
              <Skeleton width={widths[(ri + ci) % widths.length]} />
            </div>
          ))}
        </div>
      ))}
      <style>{`
        @keyframes procelaSkeleton {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
}

export default Skeleton;
