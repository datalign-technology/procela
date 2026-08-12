import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// ──────────────────────────────────────────────────────────────────────────
// OrgPicker — shared searchable multi-select tree for assigning an entity
// to one or more organizations. Used by:
//   - PersonDetailPage  (editing a single person's org assignments)
//   - PeoplePage bulk   (assigning N selected people to one or more orgs)
//
// Features:
//   - `/` shortcut inside the picker focuses the search field.
//   - As-you-type search filters the tree, keeping ancestors of any match
//     visible so matches remain reachable in context.
//   - Optional "Scope" toggle narrows the list to the active Working-In
//     org's subtree (the common case) vs. the full org hierarchy.
//   - Multi-select with checkboxes; leaves its own state management to
//     the parent, which owns `selectedIds` and gets `onChange` callbacks.
//
// Rendered as an inline panel. If you need a modal wrapper for the bulk
// flow, wrap this in a `<dialog>` / overlay at the call site.
// ──────────────────────────────────────────────────────────────────────────

export interface PickerOrgNode {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  children?: PickerOrgNode[];
}

interface OrgPickerProps {
  // Full tree (tree form) OR a flat list — either works. If flat, we'll
  // reconstruct the tree via parentId.
  orgs: PickerOrgNode[] | FlatOrg[];
  selectedIds: Set<string>;
  onToggle: (orgId: string) => void;
  // The org whose subtree is shown when scope="subtree". Typically the
  // Working-In org id. Null/undefined disables the scope toggle.
  scopeOrgId?: string | null;
  // "Scope" toggle initial state. Parent can override for persistent prefs.
  initialScope?: 'subtree' | 'all';
  // If true, the search field autofocuses on mount.
  autoFocusSearch?: boolean;
  // Max-height for the scrollable tree area.
  maxHeight?: number | string;
  // Optional placeholder for the search input.
  placeholder?: string;
  // When the user disables an org (e.g. the one "last" assignment), we
  // can't uncheck it. Parent supplies the predicate.
  isDisabled?: (orgId: string) => boolean;
}

interface FlatOrg {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
}

function isTree(list: (PickerOrgNode | FlatOrg)[]): list is PickerOrgNode[] {
  return list.length > 0 && 'children' in list[0];
}

function flatten(nodes: PickerOrgNode[], acc: FlatOrg[] = []): FlatOrg[] {
  for (const n of nodes) {
    acc.push({ id: n.id, parentId: n.parentId, name: n.name, type: n.type });
    if (n.children) flatten(n.children, acc);
  }
  return acc;
}

function buildTree(flat: FlatOrg[]): PickerOrgNode[] {
  const byId = new Map<string, PickerOrgNode>();
  for (const o of flat) byId.set(o.id, { ...o, children: [] });
  const roots: PickerOrgNode[] = [];
  for (const o of flat) {
    const node = byId.get(o.id)!;
    if (o.parentId && byId.has(o.parentId)) {
      byId.get(o.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// Build a set of ids that should survive a search filter: matching nodes
// plus every ancestor up to the root. Keeping ancestors visible gives
// matches context ("Engineering" vs. "Electric Engineering" vs. "Water
// Engineering").
function filterTreeBySearch(flat: FlatOrg[], query: string): Set<string> {
  if (!query.trim()) return new Set(flat.map((o) => o.id));
  const q = query.trim().toLowerCase();
  const visible = new Set<string>();
  const byId = new Map(flat.map((o) => [o.id, o]));
  for (const o of flat) {
    if (o.name.toLowerCase().includes(q) || o.type.toLowerCase().includes(q)) {
      visible.add(o.id);
      let p = o.parentId;
      while (p) {
        visible.add(p);
        p = byId.get(p)?.parentId ?? null;
      }
    }
  }
  return visible;
}

// Subtree: descendants of `root` (inclusive).
function subtreeIds(flat: FlatOrg[], rootId: string): Set<string> {
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

export default function OrgPicker({
  orgs, selectedIds, onToggle,
  scopeOrgId,
  initialScope = 'subtree',
  autoFocusSearch = false,
  maxHeight = 320,
  placeholder = 'Search organizations...',
  isDisabled,
}: OrgPickerProps) {
  const flat: FlatOrg[] = useMemo(() => (
    isTree(orgs) ? flatten(orgs) : (orgs as FlatOrg[])
  ), [orgs]);

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'subtree' | 'all'>(scopeOrgId ? initialScope : 'all');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocusSearch) inputRef.current?.focus();
  }, [autoFocusSearch]);

  // Local `/` shortcut — focus the search. Uses a plain effect (not
  // useKeyboardShortcut) because we want it scoped to the picker, not
  // global.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Compute the filter: scope ∩ search.
  const scopeIds = useMemo(() => {
    if (scope === 'all' || !scopeOrgId) return null;     // null = no scope filter
    return subtreeIds(flat, scopeOrgId);
  }, [flat, scope, scopeOrgId]);
  const searchIds = useMemo(() => filterTreeBySearch(flat, query), [flat, query]);
  const visibleIds = useMemo(() => {
    if (!scopeIds) return searchIds;
    const out = new Set<string>();
    for (const id of searchIds) if (scopeIds.has(id)) out.add(id);
    return out;
  }, [scopeIds, searchIds]);

  const tree = useMemo(() => buildTree(flat), [flat]);

  const renderNode = (node: PickerOrgNode, depth: number): JSX.Element | null => {
    if (!visibleIds.has(node.id)) return null;
    const checked = selectedIds.has(node.id);
    const disabled = isDisabled?.(node.id) ?? false;
    return (
      <div key={node.id}>
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 10px',
            paddingLeft: 10 + depth * 18,
            fontSize: 13,
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: checked ? 'var(--color-primary-light)' : 'transparent',
            color: disabled ? 'var(--color-text-muted)' : 'inherit',
            borderBottom: '1px solid var(--color-border)',
          }}
          title={disabled ? 'Cannot unassign' : undefined}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => onToggle(node.id)}
            style={{ flexShrink: 0 }}
          />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </span>
          <span style={{
            fontSize: 9, color: 'var(--color-text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
            flexShrink: 0,
          }}>
            {node.type}
          </span>
        </label>
        {(node.children || []).map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const selectedCount = Array.from(selectedIds).filter((id) => flat.some((o) => o.id === id)).length;
  const visibleCount = visibleIds.size;

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      background: 'var(--color-surface)',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Search */}
      <div style={{ padding: 8, borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder={placeholder}
            style={{
              width: '100%',
              padding: '6px 28px 6px 10px',
              fontSize: 13,
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              background: 'var(--color-surface)',
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              aria-label="Clear search"
              style={{
                position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-muted)', fontSize: 14, padding: '0 6px',
              }}
            >&times;</button>
          )}
        </div>
      </div>

      {/* Tree */}
      <div style={{ maxHeight, overflowY: 'auto' }}>
        {tree.map((node) => renderNode(node, 0))}
        {visibleCount === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>
            {query ? `No organizations match "${query}".` : 'No organizations in scope.'}
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
        )}
      </div>

      {/* Footer — scope toggle + selected-count */}
      <div style={{
        padding: '6px 10px',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 11, color: 'var(--color-text-muted)',
      }}>
        <div>
          {selectedCount > 0 ? `${selectedCount} selected` : 'None selected'}
        </div>
        {scopeOrgId && (
          <button
            onClick={() => setScope((s) => (s === 'subtree' ? 'all' : 'subtree'))}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 11, padding: 0 }}
          >
            {scope === 'subtree' ? 'Show all organizations' : 'Show only current scope'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Modal wrapper for bulk flows ──

interface OrgPickerModalProps extends OrgPickerProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function OrgPickerModal({
  open, title, description, confirmLabel = 'Assign',
  onConfirm, onCancel, ...pickerProps
}: OrgPickerModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="org-picker-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 1050,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-xl)',
          padding: 20,
          maxWidth: 520, width: '92vw',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <h3 id="org-picker-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: description ? 4 : 14 }}>{title}</h3>
        {description && (
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>{description}</p>
        )}
        <OrgPicker {...pickerProps} autoFocusSearch maxHeight={320} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button
            onClick={onCancel}
            style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 500, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
