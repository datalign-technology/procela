import { useState } from 'react';
import { GripVertical } from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────
// Sortable — shared drag-to-reorder / re-parent mechanics.
//
// A design-system primitive for list & tree drag interactions. It owns the
// *mechanics* — the in-flight drag tracker, the three-zone hit-testing, the
// drop indicator, the dragging state, and the native HTML5 event plumbing —
// and takes the *policy* (what counts as a valid drop, and how to persist a
// move) from the call site. Compose it instead of hand-rolling drag handlers
// per list.
//
//   const { dragging, dropMode, handleProps, rowProps } = useSortable({
//     id: item.id,
//     group: item.parentId,                 // what "the same list" means
//     data: { level: item.level },          // payload read back on a hovered row
//     draggable: canDrag,
//     canDropInside: (drag) => accepts(item.level, drag.data.level),  // enable the middle zone
//     onMove: (draggedId, targetId, mode) => persist(draggedId, targetId, mode),
//   });
//   // <div {...rowProps} style={{ ...rowStyle, ...sortableIndicatorStyle(dropMode, dragging) }}>
//   //   {canDrag && <DragHandle {...handleProps} />}
//   //   …row…
//   // </div>
//
// Three drop zones per row: the top / bottom edges reorder within the target's
// group (same group only), and the middle re-parents the dragged item in under
// the target — offered only when `canDropInside` says so. The edges are the
// mouse affordance for reordering; keep a keyboard path (e.g. up/down buttons)
// alongside, since native DnD isn't keyboard-operable. Swapping the native
// engine for dnd-kit (keyboard drag + touch) is a change inside this file, not
// at the call sites.
//
// dataTransfer is unreadable during `dragover` (only on `drop`), so a hovered
// row can't consult it to decide whether it's a valid target. A module-level
// tracker holds the in-flight drag instead; a drag is a single global pointer
// gesture, so one shared value is safe.
// ──────────────────────────────────────────────────────────────────────────

export type DropMode = 'before' | 'after' | 'inside';

/** The in-flight drag: the moved item's id, its group ("same list" key), and
 *  an opaque payload the target rows read back to judge an inside drop. */
export interface SortableDrag<T = unknown> {
  id: string;
  group: string | null;
  data: T;
}

// One global tracker: only one drag is in flight at a time.
let activeDrag: SortableDrag | null = null;

export interface UseSortableOptions<T> {
  /** This row's id. */
  id: string;
  /** The "same list" key — rows sharing it can reorder against each other
   *  (e.g. a shared parent id, or a list name). null groups the roots. */
  group: string | null;
  /** Payload carried while this row is dragged, read back by hovered rows in
   *  `canDropInside`. Cheap to compute — built on every render. */
  data: T;
  /** Whether this row can be picked up. Default true. */
  draggable?: boolean;
  /** Whether same-group edge drops (before/after) are offered. Default true. */
  canReorder?: boolean;
  /** Enables the middle (inside / re-parent) zone when it returns true for the
   *  in-flight drag. Omit to disable inside drops entirely (flat lists). */
  canDropInside?: (drag: SortableDrag<T>) => boolean;
  /** Persist a move. `mode` is relative to `targetId` (this row). */
  onMove: (draggedId: string, targetId: string, mode: DropMode) => void;
}

export interface UseSortableResult {
  dragging: boolean;
  dropMode: DropMode | null;
  handleProps: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
  };
  rowProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

export function useSortable<T>(opts: UseSortableOptions<T>): UseSortableResult {
  const [dropMode, setDropMode] = useState<DropMode | null>(null);
  const [dragging, setDragging] = useState(false);

  // Which drop this row would accept for the in-flight drag, from the cursor's
  // vertical position: reorder on the edges (same group only), inside re-parent
  // in the middle (when canDropInside allows). Returns null when not a target.
  const modeFor = (clientY: number, r: DOMRect): DropMode | null => {
    if (!activeDrag || activeDrag.id === opts.id) return null;
    const canReorder = (opts.canReorder ?? true) && activeDrag.group === opts.group;
    const canInside = !!opts.canDropInside && opts.canDropInside(activeDrag as SortableDrag<T>);
    if (!canReorder && !canInside) return null;
    const y = clientY - r.top;
    const h = r.height || 1;
    if (canInside && y > h * 0.3 && y < h * 0.7) return 'inside';
    if (canReorder) return y < h / 2 ? 'before' : 'after';
    return canInside ? 'inside' : null;
  };

  return {
    dragging,
    dropMode,
    handleProps: {
      draggable: opts.draggable ?? true,
      onDragStart: (e) => {
        activeDrag = { id: opts.id, group: opts.group, data: opts.data };
        setDragging(true);
        e.dataTransfer.effectAllowed = 'move';
        // A payload for completeness; the module tracker is what we read.
        e.dataTransfer.setData('text/plain', opts.id);
      },
      onDragEnd: () => { activeDrag = null; setDragging(false); setDropMode(null); },
    },
    rowProps: {
      onDragOver: (e) => {
        const mode = modeFor(e.clientY, e.currentTarget.getBoundingClientRect());
        if (!mode) { if (dropMode) setDropMode(null); return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropMode(mode);
      },
      onDragLeave: (e) => {
        // Ignore leave events fired when crossing into a child element.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropMode(null);
      },
      onDrop: (e) => {
        const mode = modeFor(e.clientY, e.currentTarget.getBoundingClientRect());
        setDropMode(null);
        if (!mode || !activeDrag) return;
        e.preventDefault();
        opts.onMove(activeDrag.id, opts.id, mode);
      },
    },
  };
}

/** The drop indicator + dragging fade for a sortable row: an inset accent line
 *  on the hovered edge for a reorder, a full ring for an inside re-parent, and
 *  a fade on the row being dragged. Spread into the row's style. */
export function sortableIndicatorStyle(
  dropMode: DropMode | null,
  dragging: boolean,
  color = 'var(--color-primary)',
): React.CSSProperties {
  return {
    opacity: dragging ? 0.4 : 1,
    boxShadow: dropMode === 'before' ? `inset 0 2px 0 0 ${color}`
      : dropMode === 'after' ? `inset 0 -2px 0 0 ${color}`
      : dropMode === 'inside' ? `inset 0 0 0 2px ${color}` : undefined,
  };
}

/** The standard grip affordance for a sortable row. Spread `handleProps` from
 *  useSortable onto it. Purely a mouse affordance (aria-hidden) — pair it with
 *  a keyboard path such as up/down buttons. */
export function DragHandle(
  { title = 'Drag to reorder', style, size = 14, ...rest }:
    React.HTMLAttributes<HTMLSpanElement> & { draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragEnd?: (e: React.DragEvent) => void; size?: number },
) {
  return (
    <span
      aria-hidden="true"
      title={title}
      {...rest}
      style={{ flexShrink: 0, cursor: 'grab', color: 'var(--color-text-muted)', display: 'inline-flex', lineHeight: 1, ...style }}
    >
      <GripVertical size={size} />
    </span>
  );
}
