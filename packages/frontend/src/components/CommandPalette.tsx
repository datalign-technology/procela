import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

// ──────────────────────────────────────────────────────────────────────────
// CommandPalette — Procela's global Cmd-K front door.
//
// Procela has many surface areas (Systems, Data Assets, Activities,
// Connections, People, Domains, Glossary, Mappings…). Without a single
// search overlay users hunt through the nav. This component is the one
// front door: a centered modal with an input, debounced backend search,
// type-grouped results, keyboard navigation, and recent items so users
// can re-open things they were just looking at.
//
// Mounted once in Layout, opened by Cmd/Ctrl+K or `/`.
// ──────────────────────────────────────────────────────────────────────────

type ResultType =
  | 'system'
  | 'data-asset'
  | 'activity'
  | 'connection'
  | 'person'
  | 'data-domain'
  | 'governance-group'
  | 'glossary-term'
  | 'mapping';

export interface PaletteResult {
  type: ResultType;
  id: string;
  label: string;
  subtitle?: string;
  path: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPE_LABEL: Record<ResultType, string> = {
  system: 'System',
  'data-asset': 'Data Asset',
  activity: 'Activity',
  connection: 'Connection',
  person: 'Person',
  'data-domain': 'Domain',
  'governance-group': 'Governance Group',
  'glossary-term': 'Glossary',
  mapping: 'Mapping',
};

const TYPE_COLOR: Record<ResultType, { bg: string; fg: string }> = {
  system: { bg: '#dbeafe', fg: '#1e40af' },
  'data-asset': { bg: '#dcfce7', fg: '#166534' },
  activity: { bg: '#fef3c7', fg: '#92400e' },
  connection: { bg: '#e0e7ff', fg: '#3730a3' },
  person: { bg: '#fce7f3', fg: '#9d174d' },
  'data-domain': { bg: '#cffafe', fg: '#155e75' },
  'governance-group': { bg: '#f3e8ff', fg: '#6b21a8' },
  'glossary-term': { bg: '#f1f5f9', fg: '#334155' },
  mapping: { bg: '#fee2e2', fg: '#991b1b' },
};

const RECENTS_KEY_PREFIX = 'procela.cmdk.recents.';
const MAX_RECENTS = 8;

function loadRecents(orgKey: string): PaletteResult[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY_PREFIX + orgKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecents(orgKey: string, items: PaletteResult[]) {
  try {
    localStorage.setItem(RECENTS_KEY_PREFIX + orgKey, JSON.stringify(items.slice(0, MAX_RECENTS)));
  } catch { /* quota / private mode — fail silent */ }
}

export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const orgKey = activeOrgId || '_';
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The palette has its own arrow-key navigation, so we use focus trap
  // just for Tab containment and focus restoration on close; the input
  // is focused explicitly when the palette opens (see the effect below).
  useFocusTrap(dialogRef, open);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PaletteResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<PaletteResult[]>(() => loadRecents(orgKey));
  const [activeIndex, setActiveIndex] = useState(0);

  // Reload recents when the active org switches so users see only the
  // recents they made in this org context.
  useEffect(() => { setRecents(loadRecents(orgKey)); }, [orgKey]);

  // Reset state and focus the input when the palette opens. Reset on
  // close too so the next open is a clean slate.
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced backend search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (activeOrgId) params.set('orgId', activeOrgId);
        const res = await apiClient.get<{ success: boolean; data: { results: PaletteResult[]; query: string } }>(
          `/search?${params.toString()}`
        );
        setResults(res.data?.results || []);
        setActiveIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open, activeOrgId]);

  // Items shown — recents when query is empty, search results when typing.
  const items: PaletteResult[] = useMemo(
    () => (query.trim() ? results : recents),
    [query, results, recents],
  );

  // Group items by type while preserving the rank order: groups appear
  // in the order their first result does.
  const grouped = useMemo(() => {
    const seen = new Map<ResultType, PaletteResult[]>();
    for (const r of items) {
      const arr = seen.get(r.type) || [];
      arr.push(r);
      seen.set(r.type, arr);
    }
    return Array.from(seen.entries());
  }, [items]);

  const pick = (r: PaletteResult) => {
    // Bump to front of recents (dedup by type+id).
    const next = [r, ...recents.filter((x) => !(x.type === r.type && x.id === r.id))];
    setRecents(next);
    saveRecents(orgKey, next);
    onClose();
    navigate(r.path);
  };

  // Keyboard nav — handled at the modal level so arrow keys / enter
  // work no matter what's focused inside the input.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        const picked = items[activeIndex];
        if (picked) {
          e.preventDefault();
          pick(picked);
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, items, activeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the active row into view as the user arrows down/up.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-row-index="${activeIndex}"]`);
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!open) return null;

  const flatIndexOf = (groupIdx: number, rowIdx: number): number => {
    let n = 0;
    for (let g = 0; g < groupIdx; g++) n += grouped[g][1].length;
    return n + rowIdx;
  };

  const emptyHint = query.trim()
    ? (loading ? 'Searching…' : 'No matches. Try a different word or check the spelling.')
    : 'Start typing to search across systems, data assets, activities, people, and more.';

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh', zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          width: 'min(640px, 92vw)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          maxHeight: '70vh',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px', borderBottom: '1px solid var(--color-border)',
        }}>
          <span style={{ fontSize: 16, color: 'var(--color-text-muted)' }}>{'🔍'}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anything…"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="cmd-palette-results"
            aria-autocomplete="list"
            aria-activedescendant={items[activeIndex] ? `cmd-palette-opt-${activeIndex}` : undefined}
            aria-label="Search across systems, data assets, activities, people, and more"
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: 15, background: 'transparent', color: 'var(--color-text)',
            }}
          />
          {loading && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>…</span>
          )}
          <kbd style={kbdStyle}>Esc</kbd>
        </div>

        <div
          ref={listRef}
          id="cmd-palette-results"
          role="listbox"
          aria-label="Search results"
          style={{ overflowY: 'auto', flex: 1 }}
        >
          {items.length === 0 ? (
            <div role="status" aria-live="polite" style={{ padding: 28, textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
              {emptyHint}
            </div>
          ) : (
            <>
              {!query.trim() && recents.length > 0 && (
                <div style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  padding: '12px 14px 4px',
                }}>Recent</div>
              )}
              {grouped.map(([type, rows], groupIdx) => (
                <div key={type}>
                  {query.trim() && (
                    <div style={{
                      fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      padding: '10px 14px 4px',
                    }}>{TYPE_LABEL[type]}</div>
                  )}
                  {rows.map((r, rowIdx) => {
                    const idx = flatIndexOf(groupIdx, rowIdx);
                    const isActive = idx === activeIndex;
                    return (
                      <div
                        key={`${r.type}-${r.id}`}
                        id={`cmd-palette-opt-${idx}`}
                        role="option"
                        aria-selected={isActive}
                        data-row-index={idx}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => pick(r)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 14px', cursor: 'pointer',
                          background: isActive ? 'var(--color-bg)' : 'transparent',
                        }}
                      >
                        <span style={{
                          display: 'inline-block', padding: '2px 7px', borderRadius: 4,
                          fontSize: 10, fontWeight: 600,
                          background: TYPE_COLOR[r.type].bg, color: TYPE_COLOR[r.type].fg,
                          flexShrink: 0,
                        }}>{TYPE_LABEL[r.type]}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.label}
                          </div>
                          {r.subtitle && (
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.subtitle}
                            </div>
                          )}
                        </div>
                        {isActive && (
                          <kbd style={kbdStyle}>↵</kbd>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '8px 14px', borderTop: '1px solid var(--color-border)',
          fontSize: 11, color: 'var(--color-text-muted)',
        }}>
          <span><kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> navigate</span>
          <span><kbd style={kbdStyle}>↵</kbd> open</span>
          <span><kbd style={kbdStyle}>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 5px',
  fontSize: 10,
  fontFamily: 'var(--font-mono, monospace)',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 3,
  color: 'var(--color-text-muted)',
};
