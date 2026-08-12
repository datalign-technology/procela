import { useState } from 'react';
import IconButton from './IconButton';
import SectionLabel from './SectionLabel';
import { ColumnPickerState } from '../hooks/useColumnPicker';

// ──────────────────────────────────────────────────────────────────────────
// ColumnPicker — toolbar button + popover that lets the user toggle
// which columns are visible on a table page. Pairs with the
// `useColumnPicker` hook, which owns the state and storage key.
//
// Drop-in usage from a page:
//   const cols = useColumnPicker('mystore.cols.v1', COLUMN_DEFS);
//   ...
//   <ColumnPicker state={cols} />
// ──────────────────────────────────────────────────────────────────────────

interface ColumnPickerProps<T extends string> {
  state: ColumnPickerState<T>;
}

export default function ColumnPicker<T extends string>({ state }: ColumnPickerProps<T>) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <IconButton icon="columns" label="Columns" onClick={() => setOpen((v) => !v)} />
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 10,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)',
            padding: 10, minWidth: 200,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <SectionLabel marginBottom={0}>
              Columns
            </SectionLabel>
            <button
              onClick={() => state.reset()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-primary)', padding: 0 }}
              title="Reset to default columns"
            >
              Reset
            </button>
          </div>
          {state.columns.map((c) => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px', cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" checked={state.isVisible(c.id)} onChange={() => state.toggle(c.id)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
