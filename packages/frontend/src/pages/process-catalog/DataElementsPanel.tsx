import { useState, useEffect } from 'react';
import SectionLabel from '../../components/SectionLabel';
import {
  DATA_DIRECTION_OPTIONS, DATA_KIND_OPTIONS,
  type DataElement,
} from '../ProcessCatalogPage';

// The four CRUD operations, in canonical order. An activity records which of
// these it performs on each data element it touches (the "data-usage table"
// from the record spec).
const CRUD: Array<{ key: string; label: string }> = [
  { key: 'C', label: 'Create' },
  { key: 'R', label: 'Read' },
  { key: 'U', label: 'Update' },
  { key: 'D', label: 'Delete' },
];

const cellInput: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontSize: 11,
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '2px 5px', background: 'var(--color-surface)', color: 'var(--color-text)',
};
const cellSelect: React.CSSProperties = { ...cellInput, cursor: 'pointer' };
const th: React.CSSProperties = {
  fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--color-text-muted)', textAlign: 'left', padding: '2px 4px', whiteSpace: 'nowrap',
};

/**
 * Editable data-element usage table for an activity — the business data the
 * activity touches, the CRUD it performs, the system of record, and whether the
 * element is in the governed registry. Sits alongside the systems picker; a
 * blank `element` row is dropped by the backend, so the local draft can carry
 * an empty new row while it's being filled in.
 *
 * State is a local draft seeded from `value`; text edits commit on blur and
 * checkbox / select edits commit immediately, each pushing the full cleaned
 * array up through `onSave` (matching how `systemLinks` is saved as a set).
 */
export default function DataElementsPanel({ value, onSave, disabled }: {
  value: DataElement[];
  onSave: (rows: DataElement[]) => void;
  disabled: boolean;
}) {
  const [rows, setRows] = useState<DataElement[]>(value);

  // Re-seed if the upstream value changes (e.g. after a save round-trips or the
  // selected node changes) — but only when it actually differs, so in-progress
  // typing isn't clobbered by an identical echo.
  useEffect(() => {
    setRows((prev) => (JSON.stringify(prev) === JSON.stringify(value) ? prev : value));
  }, [value]);

  // Commit the current draft, dropping blank rows (no element name). Returns the
  // cleaned set so callers can hand the same value to onSave.
  const commit = (next: DataElement[]) => {
    const cleaned = next.filter((r) => (r.element || '').trim());
    onSave(cleaned);
  };

  const update = (i: number, patch: Partial<DataElement>, commitNow: boolean) => {
    setRows((prev) => {
      const next = prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      if (commitNow) commit(next);
      return next;
    });
  };

  const toggleCrud = (i: number, key: string) => {
    setRows((prev) => {
      const next = prev.map((r, idx) => {
        if (idx !== i) return r;
        const has = (r.crud || []).includes(key);
        const set = new Set(r.crud || []);
        if (has) set.delete(key); else set.add(key);
        return { ...r, crud: CRUD.map((c) => c.key).filter((k) => set.has(k)) };
      });
      commit(next);
      return next;
    });
  };

  const addRow = () => setRows((prev) => [...prev, { element: '' }]);

  const removeRow = (i: number) => {
    setRows((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      commit(next);
      return next;
    });
  };

  return (
    <div>
      <SectionLabel>Data elements</SectionLabel>
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>Element</th>
                <th style={th}>Direction</th>
                <th style={{ ...th, textAlign: 'center' }} colSpan={4}>CRUD</th>
                <th style={th}>System of record</th>
                <th style={{ ...th, textAlign: 'center' }}>In registry</th>
                <th style={th}>Kind</th>
                <th style={th}>Format</th>
                <th style={th} aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: '2px 4px', minWidth: 120 }}>
                    <input
                      style={cellInput}
                      value={r.element || ''}
                      placeholder="e.g. Incident ID"
                      disabled={disabled}
                      aria-label="Data element name"
                      onChange={(e) => update(i, { element: e.target.value }, false)}
                      onBlur={() => commit(rows)}
                    />
                  </td>
                  <td style={{ padding: '2px 4px' }}>
                    <select
                      style={cellSelect}
                      value={r.direction || ''}
                      disabled={disabled}
                      aria-label="Direction"
                      onChange={(e) => update(i, { direction: e.target.value || undefined }, true)}
                    >
                      <option value="">—</option>
                      {DATA_DIRECTION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  {CRUD.map((c) => (
                    <td key={c.key} style={{ padding: '2px 4px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={(r.crud || []).includes(c.key)}
                        disabled={disabled}
                        aria-label={`${c.label} ${r.element || 'element'}`}
                        title={c.label}
                        onChange={() => toggleCrud(i, c.key)}
                      />
                    </td>
                  ))}
                  <td style={{ padding: '2px 4px', minWidth: 120 }}>
                    <input
                      style={cellInput}
                      value={r.systemOfRecord || ''}
                      placeholder="e.g. OMS"
                      disabled={disabled}
                      aria-label="System of record"
                      onChange={(e) => update(i, { systemOfRecord: e.target.value }, false)}
                      onBlur={() => commit(rows)}
                    />
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={r.inRegistry === true}
                      disabled={disabled}
                      aria-label={`In registry: ${r.element || 'element'}`}
                      onChange={(e) => update(i, { inRegistry: e.target.checked }, true)}
                    />
                  </td>
                  <td style={{ padding: '2px 4px' }}>
                    <select
                      style={cellSelect}
                      value={r.kind || ''}
                      disabled={disabled}
                      aria-label="Kind"
                      onChange={(e) => update(i, { kind: e.target.value || undefined }, true)}
                    >
                      <option value="">—</option>
                      {DATA_KIND_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '2px 4px', minWidth: 80 }}>
                    <input
                      style={cellInput}
                      value={r.format || ''}
                      placeholder="e.g. text"
                      disabled={disabled}
                      aria-label="Format"
                      onChange={(e) => update(i, { format: e.target.value }, false)}
                      onBlur={() => commit(rows)}
                    />
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'center' }}>
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        aria-label="Remove data element"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1, padding: 2 }}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={addRow}
          style={{
            marginTop: 4, background: 'none', border: '1px dashed var(--color-border)',
            borderRadius: 4, padding: '3px 8px', fontSize: 11,
            color: 'var(--color-primary)', cursor: 'pointer',
          }}
        >
          + Add data element
        </button>
      )}
    </div>
  );
}
