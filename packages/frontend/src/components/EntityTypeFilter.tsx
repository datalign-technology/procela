import { useEffect, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// EntityTypeFilter — one dropdown per entity type on the Enterprise View. The
// button shows the type + how many of it are shown ("Systems · 3 of 8", or
// "Hidden"); the popover lets you search and check exactly which entities to
// show. All checked = the whole type shows; some checked = only those; none
// checked = the type is hidden. `selected === null` is the "all" shortcut so a
// fresh view doesn't have to enumerate every id.
// ──────────────────────────────────────────────────────────────────────────

export interface FilterOption { id: string; label: string; }

interface TypeCfg {
  color: string;
  bg: string;
  icon: (size: number) => React.ReactNode;
  plural: string;
}

interface Props {
  cfg: TypeCfg;
  options: FilterOption[];
  /** null = all shown; a Set = only those ids; empty Set = type hidden. */
  selected: Set<string> | null;
  onChange: (sel: Set<string> | null) => void;
}

export default function EntityTypeFilter({ cfg, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const total = options.length;
  const selCount = selected === null ? total : selected.size;
  const hidden = selCount === 0;
  const isChecked = (id: string) => selected === null || selected.has(id);

  const toggle = (id: string) => {
    const base = selected === null ? new Set(options.map((o) => o.id)) : new Set(selected);
    if (base.has(id)) base.delete(id); else base.add(id);
    // Normalise "everything checked" back to the null "all" shortcut.
    onChange(base.size === total ? null : base);
  };
  const selectAll = () => onChange(null);
  const clear = () => onChange(new Set());

  const ql = q.trim().toLowerCase();
  const shown = ql ? options.filter((o) => o.label.toLowerCase().includes(ql)) : options;

  const countLabel = hidden ? 'Hidden' : selCount === total ? `${total}` : `${selCount} of ${total}`;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Filter ${cfg.plural}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer',
          border: `1px solid ${hidden ? 'var(--color-border)' : cfg.color}`,
          background: hidden ? 'var(--color-surface)' : cfg.bg,
          color: hidden ? 'var(--color-text-muted)' : cfg.color,
        }}
      >
        <span style={{ display: 'inline-flex', opacity: hidden ? 0.5 : 1 }}>{cfg.icon(14)}</span>
        <span style={{ textDecoration: hidden ? 'line-through' : 'none' }}>{cfg.plural}</span>
        <span style={{ fontWeight: 700 }}>· {countLabel}</span>
        <span aria-hidden style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
            width: 260, maxWidth: '80vw',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: 8,
          }}
        >
          <input
            type="text"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${cfg.plural.toLowerCase()}…`}
            aria-label={`Search ${cfg.plural}`}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--color-border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, marginBottom: 6 }}
          />
          <div style={{ display: 'flex', gap: 12, padding: '0 2px 6px', borderBottom: '1px solid var(--color-border)', marginBottom: 6 }}>
            <button type="button" onClick={selectAll} style={linkBtn}>Select all</button>
            <button type="button" onClick={clear} style={linkBtn}>Clear (hide)</button>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {shown.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 4px', textAlign: 'center' }}>No matches</div>
            ) : shown.map((o) => (
              <label
                key={o.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 12.5 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
              >
                <input type="checkbox" checked={isChecked(o.id)} onChange={() => toggle(o.id)} style={{ margin: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 11, fontWeight: 600, color: 'var(--color-primary)',
};
