import type { Pagination } from '../hooks/usePagination';

// ──────────────────────────────────────────────────────────────────────────
// LoadMoreBar — the footer that pairs with usePagination. Shows "Showing X of
// Y", a Load more button while more rows remain, a one-click "Show all", and a
// page-size selector. Renders nothing when the whole result set already fits
// in one page, so small lists are visually untouched.
// ──────────────────────────────────────────────────────────────────────────

const PAGE_SIZES = [25, 50, 100, 200];

interface Props {
  pagination: Pick<Pagination<unknown>, 'shown' | 'total' | 'hasMore' | 'loadMore' | 'showAll' | 'pageSize' | 'setPageSize'>;
  /** Singular/plural noun for the count, e.g. ['person','people'] or ['asset','assets']. Defaults to rows. */
  noun?: [string, string];
}

export default function LoadMoreBar({ pagination, noun = ['row', 'rows'] }: Props) {
  const { shown, total, hasMore, loadMore, showAll, pageSize, setPageSize } = pagination;
  // Nothing to page through — the list fits in a single page.
  if (total <= pageSize && !hasMore) return null;

  const label = total === 1 ? noun[0] : noun[1];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '10px 12px', borderTop: '1px solid var(--color-border)',
      fontSize: 12, color: 'var(--color-text-secondary)',
    }}>
      <span>Showing <strong style={{ color: 'var(--color-text)' }}>{shown.toLocaleString()}</strong> of {total.toLocaleString()} {label}</span>

      {hasMore && (
        <>
          <button
            type="button"
            onClick={loadMore}
            style={{
              padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-primary)', color: '#fff',
            }}
          >
            Load {Math.min(pageSize, total - shown).toLocaleString()} more
          </button>
          <button
            type="button"
            onClick={showAll}
            style={{
              padding: '4px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
            }}
          >
            Show all
          </button>
        </>
      )}

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
