import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DataTable, { type DataTableColumn } from './DataTable';
import type { RowSelection } from '../hooks/useRowSelection';

interface Row { id: string; name: string; kind: string; }
const rows: Row[] = [
  { id: 'a', name: 'Alpha', kind: 'X' },
  { id: 'b', name: 'Beta', kind: 'Y' },
];

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'kind', header: 'Kind', render: (r) => <span data-testid={`kind-${r.id}`}>{r.kind}</span> },
];

function mockSelection(overrides: Partial<RowSelection> = {}): RowSelection {
  return {
    selectedIds: new Set(),
    count: 0,
    isSelected: () => false,
    toggle: vi.fn(),
    remove: vi.fn(),
    toggleAll: vi.fn(),
    clear: vi.fn(),
    allSelected: false,
    someSelected: false,
    ...overrides,
  };
}

describe('DataTable', () => {
  it('renders headers and cell content (render fn + default key)', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Kind')).toBeInTheDocument();
    // default (no render): the row's value at `key`
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    // custom render
    expect(screen.getByTestId('kind-b')).toHaveTextContent('Y');
  });

  it('a sortable header calls onSort with the column key; a plain header does not', () => {
    const onSort = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        sort={{ sortKey: 'name', sortDir: 'asc', onSort }}
      />,
    );
    fireEvent.click(screen.getByText('Name'));
    expect(onSort).toHaveBeenCalledWith('name');

    onSort.mockClear();
    fireEvent.click(screen.getByText('Kind')); // not sortable
    expect(onSort).not.toHaveBeenCalled();
  });

  it('renders the empty message across all columns when there are no rows', () => {
    render(
      <DataTable
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        selection={mockSelection()}
        emptyMessage="Nothing here."
      />,
    );
    const cell = screen.getByText('Nothing here.');
    expect(cell).toBeInTheDocument();
    // selection column (1) + 2 data columns = colSpan 3
    expect(cell.closest('td')).toHaveAttribute('colspan', '3');
  });

  it('prepends a selection column: header reflects allSelected, toggles fire', () => {
    const toggleAll = vi.fn();
    const toggle = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        selection={mockSelection({ allSelected: true, toggleAll, toggle, isSelected: (id) => id === 'a' })}
        selectAllLabel="Select all things"
      />,
    );
    const headerCb = screen.getByLabelText('Select all things') as HTMLInputElement;
    expect(headerCb.checked).toBe(true);
    fireEvent.click(headerCb);
    expect(toggleAll).toHaveBeenCalledOnce();

    // Row checkboxes: 'a' is selected, 'b' is not.
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // [0] = header, [1] = row a, [2] = row b
    expect(checkboxes[1].checked).toBe(true);
    expect(checkboxes[2].checked).toBe(false);
    fireEvent.click(checkboxes[2]);
    expect(toggle).toHaveBeenCalledWith('b');
  });

  it('sets the header checkbox indeterminate from someSelected', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        selection={mockSelection({ someSelected: true })}
      />,
    );
    const headerCb = screen.getByLabelText('Select all rows') as HTMLInputElement;
    expect(headerCb.indeterminate).toBe(true);
  });

  it('isRowDisabled disables that row’s checkbox only', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        selection={mockSelection()}
        isRowDisabled={(r) => r.id === 'b'}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[1].disabled).toBe(false); // row a
    expect(checkboxes[2].disabled).toBe(true);  // row b
  });

  it('applies rowId to each <tr>', () => {
    const { container } = render(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowId={(r) => `row-${r.id}`} />,
    );
    expect(container.querySelector('#row-a')).not.toBeNull();
    expect(container.querySelector('#row-b')).not.toBeNull();
  });

  describe('expansion', () => {
    const baseExpansion = (over = {}) => ({
      expandedIds: new Set<string>(),
      onToggleExpanded: vi.fn(),
      renderExpandedRow: (r: Row) => <div data-testid={`detail-${r.id}`}>detail of {r.name}</div>,
      ...over,
    });

    it('renders a caret per expandable row and toggles on click', () => {
      const onToggleExpanded = vi.fn();
      render(
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} expansion={baseExpansion({ onToggleExpanded })} />,
      );
      const carets = screen.getAllByRole('button', { name: /expand row/i });
      expect(carets).toHaveLength(2);
      fireEvent.click(carets[0]);
      expect(onToggleExpanded).toHaveBeenCalledWith('a');
    });

    it('renders the detail row only for expanded ids, spanning all columns', () => {
      render(
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          selection={mockSelection()}
          expansion={baseExpansion({ expandedIds: new Set(['b']) })}
        />,
      );
      expect(screen.queryByTestId('detail-a')).toBeNull();
      const detail = screen.getByTestId('detail-b');
      expect(detail).toBeInTheDocument();
      // caret(1) + selection(1) + 2 data columns = colSpan 4
      expect(detail.closest('td')).toHaveAttribute('colspan', '4');
      // expanded row shows a collapse control
      expect(screen.getByRole('button', { name: /collapse row/i })).toBeInTheDocument();
    });

    it('getRowExpandable=false hides the caret and never renders a detail row', () => {
      render(
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          expansion={baseExpansion({ expandedIds: new Set(['b']), getRowExpandable: (r: Row) => r.id !== 'b' })}
        />,
      );
      // only row 'a' gets a caret
      expect(screen.getAllByRole('button', { name: /expand row/i })).toHaveLength(1);
      // 'b' is in expandedIds but not expandable → no detail
      expect(screen.queryByTestId('detail-b')).toBeNull();
    });

    it("trigger='row-click' toggles when the row body is clicked", () => {
      const onToggleExpanded = vi.fn();
      const { container } = render(
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          expansion={baseExpansion({ onToggleExpanded, trigger: 'row-click' })}
        />,
      );
      // click a data cell in the first row
      const firstRow = container.querySelector('tbody tr') as HTMLTableRowElement;
      fireEvent.click(firstRow.querySelectorAll('td')[1]);
      expect(onToggleExpanded).toHaveBeenCalledWith('a');
    });

    it("trigger='row-click' does not toggle when the selection checkbox is clicked", () => {
      const onToggleExpanded = vi.fn();
      const selection = mockSelection();
      render(
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          selection={selection}
          expansion={baseExpansion({ onToggleExpanded, trigger: 'row-click' })}
        />,
      );
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      fireEvent.click(checkboxes[1]); // first row's selection checkbox
      expect(selection.toggle).toHaveBeenCalledWith('a');
      expect(onToggleExpanded).not.toHaveBeenCalled(); // stopPropagation kept it from toggling
    });

    it("trigger='row-click' caret click toggles exactly once (no double-fire)", () => {
      const onToggleExpanded = vi.fn();
      render(
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          expansion={baseExpansion({ onToggleExpanded, trigger: 'row-click' })}
        />,
      );
      fireEvent.click(screen.getAllByRole('button', { name: /expand row/i })[0]);
      expect(onToggleExpanded).toHaveBeenCalledTimes(1);
      expect(onToggleExpanded).toHaveBeenCalledWith('a');
    });
  });
});
