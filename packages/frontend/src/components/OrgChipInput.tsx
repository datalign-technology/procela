import { useEffect, useMemo, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// OrgChipInput — typeahead chip input for the Add Person form. Much
// nicer than the old flat-checkbox picker once you have 50+ orgs:
//
//   - Type to narrow the dropdown. Matches show their ancestor breadcrumb
//     ("Tidewater Utilities › Tidewater Electric › Electric Engineering")
//     so two same-named orgs (Electric Engineering, Water Engineering)
//     are trivially distinguishable.
//   - Enter / click adds the chip. Backspace in an empty field pops the
//     last chip. ↑/↓ move the highlight; Escape closes the dropdown.
//
// State is owned by the parent; this component takes/reports an array
// of selected org ids.
// ──────────────────────────────────────────────────────────────────────────

export interface ChipOrgNode {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
}

interface OrgChipInputProps {
  orgs: ChipOrgNode[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  scopeOrgId?: string | null;       // narrow the dropdown to this subtree
  placeholder?: string;
  autoFocus?: boolean;
}

function buildBreadcrumbs(flat: ChipOrgNode[]): Map<string, string[]> {
  const byId = new Map(flat.map((o) => [o.id, o]));
  const out = new Map<string, string[]>();
  for (const o of flat) {
    const path: string[] = [];
    let cur: ChipOrgNode | undefined = o;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(o.id, path);
  }
  return out;
}

function subtreeIds(flat: ChipOrgNode[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of flat) {
      if (o.parentId && ids.has(o.parentId) && !ids.has(o.id)) {
        ids.add(o.id);
        changed = true;
      }
    }
  }
  return ids;
}

export default function OrgChipInput({
  orgs, selectedIds, onChange, scopeOrgId, placeholder = 'Type to find an organization...', autoFocus = false,
}: OrgChipInputProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [scope, setScope] = useState<'subtree' | 'all'>(scopeOrgId ? 'subtree' : 'all');
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const breadcrumbs = useMemo(() => buildBreadcrumbs(orgs), [orgs]);
  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);
  const scopeIds = useMemo(
    () => (scope === 'all' || !scopeOrgId ? null : subtreeIds(orgs, scopeOrgId)),
    [orgs, scope, scopeOrgId],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const selected = new Set(selectedIds);
    // Candidates: in scope, not already selected.
    const pool = orgs.filter((o) => !selected.has(o.id) && (!scopeIds || scopeIds.has(o.id)));
    if (!q) return pool.slice(0, 12);
    const scored = pool
      .map((o) => {
        const name = o.name.toLowerCase();
        const idx = name.indexOf(q);
        if (idx === -1) return null;
        // Prefer prefix matches.
        const score = idx === 0 ? 0 : 1;
        return { o, score };
      })
      .filter(Boolean) as Array<{ o: ChipOrgNode; score: number }>;
    scored.sort((a, b) => a.score - b.score || a.o.name.localeCompare(b.o.name));
    return scored.slice(0, 12).map((s) => s.o);
  }, [orgs, query, selectedIds, scopeIds]);

  useEffect(() => { setHighlight(0); }, [query, matches.length]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Close on click outside.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const addOrg = (id: string) => {
    if (selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
    setQuery('');
    setOpen(true);   // keep open so users can add another quickly
    inputRef.current?.focus();
  };

  const removeOrg = (id: string) => {
    onChange(selectedIds.filter((x) => x !== id));
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && matches[highlight]) {
        e.preventDefault();
        addOrg(matches[highlight].id);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && query === '' && selectedIds.length > 0) {
      e.preventDefault();
      removeOrg(selectedIds[selectedIds.length - 1]);
    }
  };

  const breadcrumbOf = (id: string): string => {
    const path = breadcrumbs.get(id) || [];
    return path.slice(0, -1).join(' \u203A ');
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div
        onClick={() => { inputRef.current?.focus(); setOpen(true); }}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center',
          minHeight: 34,
          padding: 4,
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          background: 'var(--color-surface)',
          cursor: 'text',
        }}
      >
        {selectedIds.map((id) => {
          const o = orgsById.get(id);
          if (!o) return null;
          const bc = breadcrumbOf(id);
          return (
            <span
              key={id}
              title={bc ? `${bc} \u203A ${o.name}` : o.name}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 4px 3px 10px',
                background: 'var(--color-primary-light)',
                color: 'var(--color-primary)',
                borderRadius: 999,
                fontSize: 12, fontWeight: 500,
              }}
            >
              {o.name}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeOrg(id); }}
                aria-label={`Remove ${o.name}`}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--color-primary)', fontSize: 14, lineHeight: 1,
                  padding: '0 6px', borderRadius: 999,
                }}
              >&times;</button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selectedIds.length === 0 ? placeholder : ''}
          style={{
            flex: 1, minWidth: 160,
            padding: '4px 6px',
            fontSize: 13, border: 'none', outline: 'none',
            background: 'transparent',
          }}
        />
      </div>

      {open && (
        <div
          style={{
            position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 80,
            maxHeight: 280, overflowY: 'auto',
          }}
        >
          {matches.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
              {query
                ? `No organizations match "${query}"${scope === 'subtree' && scopeOrgId ? ' in the current scope.' : '.'}`
                : 'Start typing to search.'}
              {scope === 'subtree' && scopeOrgId && query && (
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => setScope('all')}
                    style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0 }}
                  >
                    Search in all organizations
                  </button>
                </div>
              )}
            </div>
          ) : (
            matches.map((o, i) => {
              const bc = breadcrumbOf(o.id);
              return (
                <div
                  key={o.id}
                  onMouseDown={(e) => { e.preventDefault(); addOrg(o.id); }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    padding: '8px 12px',
                    background: i === highlight ? 'var(--color-bg)' : 'transparent',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {bc && (
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bc}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{o.name}</span>
                    <span style={{
                      fontSize: 9, color: 'var(--color-text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>{o.type}</span>
                  </div>
                </div>
              );
            })
          )}
          {scopeOrgId && (
            <div style={{
              padding: '6px 10px',
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              fontSize: 11, color: 'var(--color-text-muted)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>{scope === 'subtree' ? 'Searching within current scope' : 'Searching all organizations'}</span>
              <button
                onClick={() => setScope((s) => (s === 'subtree' ? 'all' : 'subtree'))}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 11, padding: 0 }}
              >
                {scope === 'subtree' ? 'Show all' : 'Show current scope'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
