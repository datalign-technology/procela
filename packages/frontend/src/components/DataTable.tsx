import React from 'react';
import type { ReactNode } from 'react';
import SortableTh from './SortableTh';
import { thStyle, tdStyle } from '../lib/tableStyles';
import type { RowSelection } from '../hooks/useRowSelection';
import type { SortDir } from '../hooks/useSortedList';

// ──────────────────────────────────────────────────────────────────────────
// DataTable — the shared list table.
//
// ~18 pages hand-rolled the same `<table style={{width:'100%',
// borderCollapse:'collapse'}}>` shell: a header row on `--color-bg`, a
// leading checkbox column, per-row imperative hover + selected-row tint, and
// a colSpan "no matches" row. `lib/tableStyles.ts` extracted the two cell
// style constants; this component extracts the markup around them.
//
// What it owns: the table + header + body, the optional leading selection
// column (wired to a useRowSelection result, incl. the header indeterminate
// state), row hover + selected tint, and the empty ("no matches") row.
//
// What it deliberately does NOT own — these stay on the page so behaviour is
// byte-identical and the surface stays small:
//   - Sorting lives in useSortedList (URL-persisted); the page passes the
//     current sort state + handler in via `sort`, and marks columns
//     `sortable`. The table just renders SortableTh vs a plain th.
//   - Column visibility lives in useColumnPicker with <ColumnPicker> in the
//     PageHeader; the page passes the already-filtered `columns` list.
//   - Loading skeletons and the "no data at all" empty hero stay in the
//     page's outer branch (they depend on page-specific state).
//
// Rows with expandable sub-rows, quick-add rows inside the body, or
// conditional columns (Data Assets, SOPs, People) are intentionally out of
// scope for this version — keep those hand-rolled until an expandable-row
// slot is added.
// ──────────────────────────────────────────────────────────────────────────

export interface DataTableColumn<T> {
  /** Stable id. Doubles as the sort key (must match a useSortedList comparator) when `sortable`. */
  key: string;
  header: ReactNode;
  /** Cell contents. Defaults to the row's value at `key`. */
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: number;
  align?: 'left' | 'center';
  /** Extra style merged into every `<td>` in this column (e.g. `fontWeight`). */
  cellStyle?: React.CSSProperties;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  /** Optional DOM `id` for each `<tr>` (e.g. `row-<id>` for scroll-to-highlight). */
  rowId?: (row: T) => string;
  /** Wire a useRowSelection result to prepend the leading checkbox column. */
  selection?: RowSelection;
  /** Disables a row's selection checkbox (e.g. inherited / read-only rows). */
  isRowDisabled?: (row: T) => boolean;
  /** Current sort state + handler from useSortedList. Required if any column is `sortable`. */
  sort?: { sortKey: string; sortDir: SortDir; onSort: (key: string) => void };
  /** Full-width row shown when `rows` is empty (e.g. "No issues match the current filters."). */
  emptyMessage?: ReactNode;
  /** aria-label for the select-all checkbox. */
  selectAllLabel?: string;
}

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowId,
  selection,
  isRowDisabled,
  sort,
  emptyMessage,
  selectAllLabel = 'Select all rows',
}: DataTableProps<T>) {
  const colCount = columns.length + (selection ? 1 : 0);

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--color-bg)' }}>
          {selection && (
            <th scope="col" style={{ ...thStyle, width: 32, textAlign: 'center' }}>
              <input
                type="checkbox"
                ref={(el) => { if (el) el.indeterminate = selection.someSelected; }}
                checked={selection.allSelected}
                onChange={selection.toggleAll}
                aria-label={selectAllLabel}
              />
            </th>
          )}
          {columns.map((col) =>
            col.sortable && sort ? (
              <SortableTh
                key={col.key}
                sortKey={col.key}
                active={sort.sortKey}
                dir={sort.sortDir}
                onClick={sort.onSort}
                align={col.align}
                width={col.width}
              >
                {col.header}
              </SortableTh>
            ) : (
              <th
                key={col.key}
                scope="col"
                style={{ ...thStyle, width: col.width, textAlign: col.align ?? 'left' }}
              >
                {col.header}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>
              {emptyMessage ?? 'No matching rows.'}
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const id = rowKey(row);
            const isSelected = selection?.isSelected(id) ?? false;
            return (
              <tr
                key={id}
                id={rowId?.(row)}
                style={{ transition: 'background 0.1s', background: isSelected ? 'var(--color-primary-light)' : '' }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
              >
                {selection && (
                  <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isRowDisabled?.(row) ?? false}
                      onChange={() => selection.toggle(id)}
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{ ...tdStyle, textAlign: col.align ?? 'left', width: col.width, ...col.cellStyle }}
                  >
                    {col.render ? col.render(row) : ((row as Record<string, ReactNode>)[col.key] ?? null)}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
