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
// Expandable detail rows are supported via the `expansion` prop (caret or
// row-click trigger): the page owns what the expanded region renders —
// including any lazy fetch, nested sub-table, or quick-add controls —
// inside `renderExpandedRow`. Conditional columns are supported too — the
// `columns` array is built with `.filter(Boolean)`, so gate an entry on a
// boolean to add/drop it. The one shape still out of scope is a persistent
// input row pinned inside `<tbody>` (People's quick-add row); there is no
// slot for a non-data `<tr>` in the body, and adding one for a single
// consumer isn't worth it.
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

export interface DataTableExpansion<T> {
  /** Ids of the currently-open rows. Pages that allow only one open at a
   *  time pass a 0/1-element Set derived from their single `expandedId`. */
  expandedIds: Set<string>;
  /** Called from the caret button. The page decides single- vs multi-open. */
  onToggleExpanded: (id: string) => void;
  /** Body of the expanded region. DataTable wraps it in a full-width
   *  `<tr><td colSpan=…>`. Lazy fetch / spinners / nested tables / quick-add
   *  all live here — DataTable never fetches. */
  renderExpandedRow: (row: T) => ReactNode;
  /** Gate which rows can expand (rows returning false show no caret and
   *  never render a detail row). Default: every row is expandable. */
  getRowExpandable?: (row: T) => boolean;
  /** How a row is expanded. `'caret'` (default): only the leading caret
   *  button toggles. `'row-click'`: clicking anywhere on the row toggles,
   *  and the caret becomes a keyboard-focusable affordance. DataTable
   *  `stopPropagation`s the cells it owns (caret + selection checkbox); any
   *  interactive control inside a `column.render` must `stopPropagation`
   *  itself so a click on it doesn't also toggle the row. */
  trigger?: 'caret' | 'row-click';
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
  /** Enable expandable detail rows with a leading caret column. */
  expansion?: DataTableExpansion<T>;
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
  expansion,
}: DataTableProps<T>) {
  const colCount = columns.length + (selection ? 1 : 0) + (expansion ? 1 : 0);

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--color-bg)' }}>
          {expansion && <th scope="col" aria-hidden="true" style={{ ...thStyle, width: 32 }} />}
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
            const canExpand = expansion ? (expansion.getRowExpandable?.(row) ?? true) : false;
            const isExpanded = canExpand && (expansion?.expandedIds.has(id) ?? false);
            const rowClick = expansion?.trigger === 'row-click' && canExpand;
            return (
              <React.Fragment key={id}>
                <tr
                  id={rowId?.(row)}
                  onClick={rowClick ? () => expansion!.onToggleExpanded(id) : undefined}
                  style={{ transition: 'background 0.1s', background: isSelected ? 'var(--color-primary-light)' : '', cursor: rowClick ? 'pointer' : undefined }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
                >
                  {expansion && (
                    <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                      {canExpand && (
                        <button
                          type="button"
                          aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                          aria-expanded={isExpanded}
                          onClick={(e) => { if (rowClick) e.stopPropagation(); expansion.onToggleExpanded(id); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 10, lineHeight: 1, padding: 4 }}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      )}
                    </td>
                  )}
                  {selection && (
                    <td
                      style={{ ...tdStyle, textAlign: 'center', width: 32 }}
                      onClick={rowClick ? (e) => e.stopPropagation() : undefined}
                    >
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
                {isExpanded && expansion && (
                  <tr>
                    <td colSpan={colCount} style={{ padding: 0, borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
                      {expansion.renderExpandedRow(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })
        )}
      </tbody>
    </table>
  );
}
