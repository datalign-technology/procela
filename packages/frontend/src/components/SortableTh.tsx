import type { CSSProperties } from 'react';
import type { SortDir } from '@/hooks/useSortedList';

// ──────────────────────────────────────────────────────────────────────────
// SortableTh — clickable column header. Pairs with useSortedList so a
// table just becomes:
//   <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>
//     Name
//   </SortableTh>
// ──────────────────────────────────────────────────────────────────────────

interface SortableThProps {
  sortKey: string;
  active: string;
  dir: SortDir;
  onClick: (key: string) => void;
  children: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  style?: CSSProperties;
  /** Optional native tooltip on the header cell. */
  title?: string;
}

const baseStyle: CSSProperties = {
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

export default function SortableTh({ sortKey, active, dir, onClick, children, align = 'left', width, style, title }: SortableThProps) {
  const isActive = active === sortKey;
  const arrow = !isActive ? '\u2195' : dir === 'asc' ? '\u25B2' : '\u25BC';

  return (
    <th
      onClick={() => onClick(sortKey)}
      title={title}
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{
        ...baseStyle,
        textAlign: align,
        width,
        color: isActive ? 'var(--color-text)' : baseStyle.color,
        ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {children}
        <span aria-hidden style={{ fontSize: 9, opacity: isActive ? 1 : 0.45 }}>{arrow}</span>
      </span>
    </th>
  );
}
