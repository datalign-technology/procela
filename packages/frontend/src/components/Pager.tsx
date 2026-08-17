import type { Pagination } from '../hooks/usePagination';

// ──────────────────────────────────────────────────────────────────────────
// Pager — the numbered pagination footer that pairs with usePagination.
// « First  ‹ Prev   1 … 4 [5] 6 … 20   Next ›  Last »   + a page-size select
// and an "N–M of T" count. Renders nothing when the whole result set fits on
// one page, so small lists are visually untouched.
// ──────────────────────────────────────────────────────────────────────────

const PAGE_SIZES = [15, 50, 100, 200];

// Windowed page list: always the first and last page, the current page and its
// neighbours, with '…' gaps between runs.
function pageWindow(current: number, totalPages: number): (number | 'gap')[] {
  const wanted = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

interface Props {
  pagination: Pagination<unknown>;
  /** Singular/plural noun for the count, e.g. ['person','people']. Defaults to rows. */
  noun?: [string, string];
}

const navBtn = (enabled: boolean): React.CSSProperties => ({
  padding: '4px 10px', fontSize: 12, fontWeight: 500,
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: enabled ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
  cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.5,
});

export default function Pager({ pagination, noun = ['row', 'rows'] }: Props) {
  const { page, totalPages, total, startIndex, endIndex, pageSize, setPage, setPageSize, first, prev, next, last, canPrev, canNext } = pagination;
  // Single page — nothing to paginate.
  if (totalPages <= 1) return null;

  const label = total === 1 ? noun[0] : noun[1];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 12px', borderTop: '1px solid var(--color-border)',
      fontSize: 12, color: 'var(--color-text-secondary)',
    }}>
      <span>
        <strong style={{ color: 'var(--color-text)' }}>{startIndex.toLocaleString()}–{endIndex.toLocaleString()}</strong> of {total.toLocaleString()} {label}
      </span>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
        <button type="button" onClick={first} disabled={!canPrev} style={navBtn(canPrev)} aria-label="First page">« First</button>
        <button type="button" onClick={prev} disabled={!canPrev} style={navBtn(canPrev)} aria-label="Previous page">‹ Prev</button>

        {pageWindow(page, totalPages).map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} style={{ padding: '0 4px', color: 'var(--color-text-muted)' }} aria-hidden>…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              aria-label={`Page ${p}`}
              aria-current={p === page ? 'page' : undefined}
              style={{
                minWidth: 30, padding: '4px 8px', fontSize: 12, fontWeight: p === page ? 700 : 500,
                border: `1px solid ${p === page ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
                background: p === page ? 'var(--color-primary)' : 'var(--color-surface)',
                color: p === page ? '#fff' : 'var(--color-text-secondary)',
              }}
            >
              {p}
            </button>
          ),
        )}

        <button type="button" onClick={next} disabled={!canNext} style={navBtn(canNext)} aria-label="Next page">Next ›</button>
        <button type="button" onClick={last} disabled={!canNext} style={navBtn(canNext)} aria-label="Last page">Last »</button>
      </div>

      <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        Rows per page
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          style={{ fontSize: 12, padding: '3px 6px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}
