import { useState } from 'react';
import { clickable, activateOnKeyStop } from '../lib/a11y';

// ──────────────────────────────────────────────────────────────────────────
// OrgSidebarTree — the collapsible organization hierarchy used as a
// left-rail filter on entity-list pages (People, Agents). Selecting a node
// filters the list to that org; a per-node count badge shows how many items
// belong to it. Extracted from PeoplePage so every page that filters by org
// renders the identical tree instead of hand-rolling its own.
//
// The node shape is intentionally minimal (id / name / children) so a caller
// can pass a richer org object with extra fields — structural typing lets it
// through.
// ──────────────────────────────────────────────────────────────────────────

export interface OrgTreeNode {
  id: string;
  name: string;
  children: OrgTreeNode[];
}

export default function OrgSidebarTree({ nodes, selectedId, onSelect, counts }: {
  nodes: OrgTreeNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Per-org item count, keyed by org id. Zero/absent hides the badge. */
  counts: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand root nodes on mount.
    return new Set(nodes.map((n) => n.id));
  });

  const toggle = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderNode = (node: OrgTreeNode, depth: number) => {
    const isSelected = selectedId === node.id;
    const isExpanded = expanded.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const count = counts[node.id] || 0;
    return (
      <div key={node.id}>
        <div
          {...clickable(() => onSelect(node.id), { label: `Select organization ${node.name}` })}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 6px', paddingLeft: 6 + depth * 14,
            fontSize: 12, borderRadius: 4, cursor: 'pointer',
            fontWeight: isSelected ? 600 : 400,
            background: isSelected ? 'var(--color-primary-light)' : 'transparent',
            color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
          }}
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
        >
          {hasChildren ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
              aria-expanded={isExpanded}
              onClick={(e) => toggle(node.id, e)}
              onKeyDown={activateOnKeyStop(() => toggle(node.id))}
              style={{ width: 14, textAlign: 'center', fontSize: 8, color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0 }}
            >
              {isExpanded ? '▼' : '▶'}
            </span>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {node.name}
          </span>
          {count > 0 && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>{count}</span>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return <div>{nodes.map((n) => renderNode(n, 0))}</div>;
}
