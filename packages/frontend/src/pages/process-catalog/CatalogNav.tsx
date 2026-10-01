import { Check, AlertTriangle } from 'lucide-react';
import { clickable, activateOnKeyStop } from '../../lib/a11y';
import { useSortable, sortableIndicatorStyle, DragHandle } from '../../components/Sortable';
import { LEVEL_CONFIG, statusColors, type ProcessNode, type NodeLevel } from '../ProcessCatalogPage';
import { requiredFields } from './ReadinessPanel';

// Drag payload — the dragged node's level (does the hovered row accept it as a
// child?) and its subtree ids (refuse a drop into its own descendant).
interface NavDrag { level: NodeLevel; descendantIds: Set<string> }
function collectDescendantIds(node: ProcessNode, out: Set<string> = new Set()): Set<string> {
  for (const c of node.children || []) { out.add(c.id); collectDescendantIds(c, out); }
  return out;
}

// ── Catalog navigation tree (left pane of the two-pane catalog) ──────────────
// A compact, read-only hierarchy: expand/collapse carets, a short level badge,
// the name + its code, and a right-hand cluster showing the record's status
// (a coloured dot) and its required-field completeness (✓ complete / ⚠ active
// but incomplete / N·M draft in progress). Clicking a row selects it; the
// record detail + actions open in the right pane (TreeNode in detailMode).
//
// Editing, drag-reorder and actions deliberately do NOT live here — the detail
// pane owns them, so the nav stays scannable.

// Short badge code per level (the full labels live in LEVEL_CONFIG). Activities
// show their activity-type where set (Event → EVT, …) so the board reads like
// the mock-up.
const LEVEL_CODE: Record<NodeLevel, string> = {
  VALUE_STREAM: 'VS', DOMAIN: 'DOM', CAPABILITY: 'CAP', PROCESS: 'PRO',
  SUBPROCESS: 'SP', ACTIVITY: 'ACT', TASK: 'TASK', EXECUTION: 'EXE',
};
const ACTIVITY_TYPE_CODE: Record<string, string> = {
  Event: 'EVT', Approval: 'APR', Decision: 'DEC', Automated: 'AUTO',
  Manual: 'MAN', 'Quality check': 'QC',
};
function badgeCode(node: ProcessNode): string {
  if (node.level === 'ACTIVITY' && node.activityType && ACTIVITY_TYPE_CODE[node.activityType]) {
    return ACTIVITY_TYPE_CODE[node.activityType];
  }
  return LEVEL_CODE[node.level] || node.level.slice(0, 3);
}

/** The completeness state of a node's required fields — drives the right-hand
 *  indicator and the "Needs attention" counts. */
export function completeness(node: ProcessNode): { total: number; complete: number; allDone: boolean; activeIncomplete: boolean } {
  const reqs = requiredFields(node);
  const total = reqs.length;
  const complete = reqs.filter((r) => r.filled).length;
  const allDone = total > 0 && complete === total;
  return { total, complete, allDone, activeIncomplete: node.status === 'ACTIVE' && !allDone && total > 0 };
}

function CompletenessMark({ node }: { node: ProcessNode }) {
  const { total, complete, allDone, activeIncomplete } = completeness(node);
  if (total === 0) return null;
  if (allDone) return <Check size={14} aria-label="All required fields complete" style={{ color: 'var(--color-success)', flexShrink: 0 }} />;
  if (activeIncomplete) {
    return (
      <span title={`Active, but ${total - complete} required field${total - complete === 1 ? '' : 's'} missing`} style={{ display: 'inline-flex', flexShrink: 0 }}>
        <AlertTriangle size={14} aria-label="Active but incomplete" style={{ color: 'var(--color-attention)' }} />
      </span>
    );
  }
  return (
    <span title={`${complete} of ${total} required fields complete`}
      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>
      {complete}/{total}
    </span>
  );
}

function NavRow({ node, depth, parentId, selectedId, expanded, onToggle, onSelect, onMove, validChildrenMap }: {
  node: ProcessNode;
  depth: number;
  parentId: string | null;
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onMove?: (draggedId: string, targetId: string, mode: 'before' | 'after' | 'inside') => void;
  validChildrenMap?: Record<string, string[]>;
}) {
  const cfg = LEVEL_CONFIG[node.level];
  const kids = node.children || [];
  const hasKids = kids.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const dot = statusColors[node.status]?.color || 'var(--color-text-muted)';
  const canDrag = !!onMove;
  const { dragging, dropMode, handleProps, rowProps } = useSortable<NavDrag>({
    id: node.id,
    group: parentId,
    data: { level: node.level, descendantIds: collectDescendantIds(node) },
    draggable: canDrag,
    canDropInside: (drag) =>
      (validChildrenMap?.[node.level] || []).includes(drag.data.level)
      && !drag.data.descendantIds.has(node.id),
    onMove: onMove || (() => {}),
  });
  return (
    <>
      <div
        {...clickable(() => onSelect(node.id), { label: `Open ${node.name}` })}
        {...(canDrag ? rowProps : {})}
        aria-current={isSelected ? 'true' : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', paddingLeft: 10 + depth * 18,
          cursor: 'pointer', borderRadius: 6,
          background: isSelected ? 'var(--color-primary-light)' : 'transparent',
          ...(canDrag ? sortableIndicatorStyle(dropMode, dragging) : {}),
          ...(isSelected && !dropMode ? { boxShadow: 'inset 2px 0 0 var(--color-primary)' } : {}),
        }}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
      >
        {canDrag && (
          <DragHandle
            {...handleProps}
            size={12}
            style={{ marginLeft: -2 }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {/* Caret — toggles expand without selecting. Spacer keeps leaf rows aligned. */}
        {hasKids ? (
          <span
            role="button" tabIndex={0}
            aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={isOpen}
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            onKeyDown={activateOnKeyStop(() => onToggle(node.id))}
            style={{ width: 12, flexShrink: 0, fontSize: 10, color: 'var(--color-text-muted)', lineHeight: 1, textAlign: 'center', cursor: 'pointer' }}
          >{isOpen ? '▼' : '▶'}</span>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}
        {/* Level badge */}
        <span style={{
          flexShrink: 0, minWidth: 34, textAlign: 'center',
          background: cfg.bg, color: cfg.color,
          fontSize: 9, fontWeight: 700, letterSpacing: '0.03em',
          padding: '2px 6px', borderRadius: 4,
        }}>{badgeCode(node)}</span>
        {/* Name + code */}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
          {node.activityId && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.activityId}</span>
          )}
        </span>
        {/* Status dot + completeness */}
        <span title={node.status.replace('_', ' ').toLowerCase()} style={{ width: 8, height: 8, borderRadius: 999, background: dot, flexShrink: 0 }} />
        <CompletenessMark node={node} />
      </div>
      {isOpen && kids.map((child) => (
        <NavRow key={child.id} node={child} depth={depth + 1} parentId={node.id} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onMove={onMove} validChildrenMap={validChildrenMap} />
      ))}
    </>
  );
}

export default function CatalogNav({ nodes, selectedId, expanded, onToggle, onSelect, onMove, validChildrenMap }: {
  nodes: ProcessNode[];
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onMove?: (draggedId: string, targetId: string, mode: 'before' | 'after' | 'inside') => void;
  validChildrenMap?: Record<string, string[]>;
}) {
  return (
    <div role="tree" aria-label="Process hierarchy" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {nodes.map((node) => (
        <NavRow key={node.id} node={node} depth={0} parentId={null} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onMove={onMove} validChildrenMap={validChildrenMap} />
      ))}
    </div>
  );
}
