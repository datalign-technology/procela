import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { clickable } from '../../lib/a11y';
import type { ProcessNode } from '../ProcessCatalogPage';
import CatalogNav, { completeness } from './CatalogNav';

// ── Catalog nav panel (left pane) ────────────────────────────────────────────
// Wraps the navigation tree with the quick-filter pills, a "Needs attention"
// summary and a legend — the chrome from the requested mock-up. The pills prune
// the tree (keeping ancestors so the structure stays navigable); the summary
// counts are always computed over the unfiltered tree and double as shortcuts
// into the matching filter.

type NavFilter = 'all' | 'active' | 'draft' | 'incomplete' | 'mine';

const FILTERS: { key: NavFilter; label: string }[] = [
  { key: 'all', label: 'All levels' },
  { key: 'active', label: 'Active' },
  { key: 'draft', label: 'Draft' },
  { key: 'incomplete', label: 'Incomplete' },
  { key: 'mine', label: 'Mine' },
];

function matches(node: ProcessNode, filter: NavFilter, currentUserId?: string): boolean {
  switch (filter) {
    case 'active': return node.status === 'ACTIVE';
    case 'draft': return node.status === 'DRAFT';
    case 'incomplete': { const c = completeness(node); return c.total > 0 && !c.allDone; }
    case 'mine': return !!currentUserId && (node.ownerId === currentUserId || node.responsiblePersonId === currentUserId);
    default: return true;
  }
}

/** Keep a node when it matches the filter, or any descendant does — so the
 *  matching rows stay reachable through their ancestor chain. */
function filterKeepAncestors(nodes: ProcessNode[], filter: NavFilter, currentUserId?: string): ProcessNode[] {
  const out: ProcessNode[] = [];
  for (const n of nodes) {
    const kids = filterKeepAncestors(n.children || [], filter, currentUserId);
    if (matches(n, filter, currentUserId) || kids.length > 0) out.push({ ...n, children: kids });
  }
  return out;
}

function walk(nodes: ProcessNode[], fn: (n: ProcessNode) => void) {
  for (const n of nodes) { fn(n); if (n.children?.length) walk(n.children, fn); }
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <span
      {...clickable(onClick, { label, pressed: active })}
      style={{
        padding: '3px 11px', borderRadius: 999, fontSize: 12, fontWeight: active ? 600 : 500,
        cursor: 'pointer', whiteSpace: 'nowrap',
        background: active ? 'var(--color-primary)' : 'var(--color-surface)',
        color: active ? '#fff' : 'var(--color-text-secondary)',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
      }}
    >{label}</span>
  );
}

export default function CatalogNavPanel({ nodes, selectedId, expanded, onToggle, onSelect, currentUserId, onMove, validChildrenMap }: {
  nodes: ProcessNode[];
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  currentUserId?: string;
  onMove?: (draggedId: string, targetId: string, mode: 'before' | 'after' | 'inside') => void;
  validChildrenMap?: Record<string, string[]>;
}) {
  const [filter, setFilter] = useState<NavFilter>('all');

  const navTree = useMemo(
    () => (filter === 'all' ? nodes : filterKeepAncestors(nodes, filter, currentUserId)),
    [nodes, filter, currentUserId],
  );

  // "Needs attention" counts over the full (unfiltered) tree.
  const counts = useMemo(() => {
    const now = Date.now();
    const in30 = now + 30 * 86400000;
    let activeIncomplete = 0, drafts = 0, reviewsDue = 0;
    walk(nodes, (n) => {
      if (completeness(n).activeIncomplete) activeIncomplete += 1;
      if (n.status === 'DRAFT') drafts += 1;
      if (n.nextReviewDate) { const t = Date.parse(n.nextReviewDate); if (!Number.isNaN(t) && t <= in30) reviewsDue += 1; }
    });
    return { activeIncomplete, drafts, reviewsDue };
  }, [nodes]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Quick-filter pills */}
      <div role="group" aria-label="Filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {FILTERS.map((f) => (
          <Pill key={f.key} label={f.label} active={filter === f.key} onClick={() => setFilter(f.key)} />
        ))}
      </div>

      {/* Navigation tree */}
      {navTree.length > 0 ? (
        <CatalogNav
          nodes={navTree}
          selectedId={selectedId}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          onMove={filter === 'all' ? onMove : undefined}
          validChildrenMap={validChildrenMap}
        />
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '12px 10px' }}>
          Nothing matches &ldquo;{FILTERS.find((f) => f.key === filter)?.label}&rdquo;.
        </div>
      )}

      {/* Needs attention */}
      <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          Needs attention
        </div>
        <AttentionRow label="Active but incomplete" count={counts.activeIncomplete} color="var(--color-attention)" onClick={() => setFilter('incomplete')} />
        <AttentionRow label="Drafts in progress" count={counts.drafts} onClick={() => setFilter('draft')} />
        <AttentionRow label="Reviews due in 30 days" count={counts.reviewsDue} />
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--color-text-secondary)' }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Legend</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--color-attention)', fontSize: 8 }}>{'●'}</span> Required before activation
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={11} style={{ color: 'var(--color-text-muted)' }} /> Calculated — rolled up or derived, not typed
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>Pick list</span> Field type, shown beside each label
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>10/13</span> Required fields complete
        </div>
      </div>
    </div>
  );
}

function AttentionRow({ label, count, color, onClick }: { label: string; count: number; color?: string; onClick?: () => void }) {
  const interactive = !!onClick;
  return (
    <div
      {...(interactive ? clickable(onClick!, { label: `Filter to ${label}` }) : {})}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 0', fontSize: 12.5, color: count > 0 && color ? color : 'var(--color-text)',
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: count > 0 && color ? color : 'var(--color-text)' }}>{count}</span>
    </div>
  );
}
