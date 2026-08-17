import { useMemo, useRef, useState, useLayoutEffect } from 'react';

// Lightweight, hand-rolled SVG visualization for Enterprise View.
// Lays nodes out as horizontal swimlanes — one row per entity type — and
// draws curved, colour-coded edges between them, in the same visual language
// as the Process ↔ Data Map. The process lane sub-groups its nodes under their
// value stream, and the data-asset lane sub-groups under the system (or domain)
// that holds each asset, so related nodes cluster together. Selection dims
// everything outside the impact set so a click reads as a focus.
// Same data shape as the cards view; the parent passes already-filtered
// nodes/edges plus the active selection / impact set.

export interface DiagramNode {
  id: string;
  type: string;
  label: string;
  status?: string;
  meta: Record<string, any>;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
}

interface TypeCfg {
  color: string;
  bg: string;
  // Icon is a function of size so this component can request the
  // same sidebar SVG the Enterprise View page uses, sized to fit
  // the lane header vs the node bubble independently.
  icon: (size: number) => React.ReactNode;
  label: string;
  plural: string;
}

/** Drill affordance for a process node (see collapseHierarchy). */
interface ExpandCtl { state: 'expand' | 'collapse'; count: number; childLevel: string }

interface Props {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  selected: DiagramNode | null;
  impactSet: Set<string>;
  onSelect: (n: DiagramNode) => void;
  typeConfig: Record<string, TypeCfg>;
  columnOrder: string[];
  /** Visible process id → expand/collapse control. When present, a node draws a
   *  small caret badge that drills into (or out of) that branch. */
  expandControls?: Map<string, ExpandCtl>;
  onToggleExpand?: (id: string) => void;
}

const NODE_W = 150;
const NODE_H = 44;
const NODE_GAP_X = 14;
const ROW_GAP_Y = 12;   // gap between wrapped rows within a group
const GROUP_HEADER_H = 22; // sub-group label band inside a lane
const GROUP_GAP_Y = 14;  // gap between sub-groups within a lane
const LANE_GAP_Y = 70;
const LANE_LABEL_W = 110;
const PADDING = 20;
const MAX_LABEL_CHARS = 18;

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Edge palette. Mapping edges carry the mapping's linkType in `label`
// (produces / consumes / transforms / references / uses) and are coloured the
// same as the Process ↔ Data Map so the two surfaces read alike; the other
// relationship types (structural, ownership, lineage, …) each get a distinct
// colour. Returns the stroke colour plus a legend label so the diagram can
// build a legend of only the relationships actually present.
function edgeStyle(e: DiagramEdge): { color: string; legend: string } {
  if (e.type === 'mapping') {
    const k = (e.label || '').toLowerCase();
    if (k.includes('produce')) return { color: '#059669', legend: 'produces' };
    if (k.includes('consume')) return { color: '#2563eb', legend: 'consumes' };
    if (k.includes('transform')) return { color: '#7c3aed', legend: 'transforms' };
    return { color: '#64748b', legend: 'references / uses' };
  }
  switch (e.type) {
    case 'hosted-by': return { color: '#0ea5e9', legend: 'hosted by' };
    case 'governs':   return { color: '#dc2626', legend: 'governs' };
    case 'owned-by':  return { color: '#d97706', legend: 'owned by' };
    case 'lineage':   return { color: '#14b8a6', legend: 'lineage' };
    case 'hierarchy': return { color: '#cbd5e1', legend: 'contains' };
    default:          return { color: '#94a3b8', legend: e.type };
  }
}

export default function EnterpriseDiagram({
  nodes, edges, selected, impactSet, onSelect, typeConfig, columnOrder,
  expandControls, onToggleExpand,
}: Props) {
  // Measure the available width so each lane wraps its nodes to fit instead
  // of running off the right edge.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const byType: Record<string, DiagramNode[]> = {};
    for (const t of columnOrder) byType[t] = [];
    for (const n of nodes) if (byType[n.type]) byType[n.type].push(n);

    const activeLanes = columnOrder.filter((t) => byType[t].length > 0);

    // ── Sub-group derivation ──────────────────────────────────────────────
    // Use the structural edges that are in view to cluster each lane:
    //   • process nodes group under their top value-stream ancestor (hierarchy)
    //   • data-asset nodes group under the system that hosts them (hosted-by),
    //     falling back to their governing domain (governs).
    // Grouping only kicks in when those edges are present in the current view,
    // so a preset that hides the relationship simply renders a flat lane.
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const parentOf = new Map<string, string>();   // child → parent (hierarchy)
    const systemOf = new Map<string, string>();    // asset → system (hosted-by)
    const domainOf = new Map<string, string>();    // asset → domain (governs)
    for (const e of edges) {
      if (e.type === 'hierarchy') parentOf.set(e.target, e.source);
      else if (e.type === 'hosted-by') systemOf.set(e.source, e.target);
      else if (e.type === 'governs') domainOf.set(e.target, e.source);
    }
    const rootOf = (id: string): string => {
      let cur = id;
      const seen = new Set<string>([cur]);
      while (parentOf.has(cur)) {
        const p = parentOf.get(cur)!;
        if (seen.has(p)) break; // cycle guard
        cur = p; seen.add(cur);
      }
      return cur;
    };
    const groupOf = (n: DiagramNode): { key: string; label: string } => {
      if (n.type === 'process') {
        const root = rootOf(n.id);
        return { key: root, label: nodeById.get(root)?.label || 'Ungrouped' };
      }
      if (n.type === 'data-asset') {
        const sys = systemOf.get(n.id);
        if (sys) return { key: `sys:${sys}`, label: nodeById.get(sys)?.label || 'System' };
        const dom = domainOf.get(n.id);
        if (dom) return { key: `dom:${dom}`, label: nodeById.get(dom)?.label || 'Domain' };
        return { key: '__ungrouped__', label: 'Unassigned' };
      }
      return { key: '__all__', label: '' };
    };

    const availW = Math.max(360, containerW || 900);
    const usableW = Math.max(NODE_W, availW - LANE_LABEL_W - PADDING * 2);
    const cols = Math.max(1, Math.floor((usableW + NODE_GAP_X) / (NODE_W + NODE_GAP_X)));
    const laneLeft = LANE_LABEL_W + PADDING;

    const positions = new Map<string, { x: number; y: number }>();
    const laneBands: Array<{ type: string; y: number; height: number }> = [];
    const groupHeaders: Array<{ laneType: string; label: string; x: number; y: number; color: string }> = [];

    // Place a set of nodes as wrapped, left-aligned rows starting at `startY`.
    // Returns the height consumed.
    const placeRows = (laneNodes: DiagramNode[], startY: number): number => {
      laneNodes.forEach((n, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        positions.set(n.id, {
          x: laneLeft + col * (NODE_W + NODE_GAP_X),
          y: startY + row * (NODE_H + ROW_GAP_Y),
        });
      });
      const rows = Math.max(1, Math.ceil(laneNodes.length / cols));
      return rows * NODE_H + (rows - 1) * ROW_GAP_Y;
    };

    let y = PADDING;
    for (const laneType of activeLanes) {
      const laneNodes = byType[laneType];
      const laneStartY = y;
      const groupable = laneType === 'process' || laneType === 'data-asset';

      // Build ordered groups (preserve first-appearance order; push the
      // "Unassigned" bucket to the end so real clusters lead).
      let groups: Array<{ key: string; label: string; nodes: DiagramNode[] }> = [];
      if (groupable) {
        const map = new Map<string, { key: string; label: string; nodes: DiagramNode[] }>();
        for (const n of laneNodes) {
          const g = groupOf(n);
          if (!map.has(g.key)) map.set(g.key, { key: g.key, label: g.label, nodes: [] });
          map.get(g.key)!.nodes.push(n);
        }
        groups = Array.from(map.values());
        groups.sort((a, b) => {
          const au = a.key === '__ungrouped__' ? 1 : 0;
          const bu = b.key === '__ungrouped__' ? 1 : 0;
          if (au !== bu) return au - bu;
          return a.label.localeCompare(b.label);
        });
      }

      const cfg = typeConfig[laneType];
      if (groupable && groups.length > 1) {
        groups.forEach((g, gi) => {
          if (gi > 0) y += GROUP_GAP_Y;
          groupHeaders.push({ laneType, label: g.label, x: laneLeft, y: y + 10, color: cfg?.color || '#64748b' });
          y += GROUP_HEADER_H;
          y += placeRows(g.nodes, y);
        });
      } else {
        y += placeRows(laneNodes, y);
      }

      laneBands.push({ type: laneType, y: laneStartY, height: y - laneStartY });
      y += LANE_GAP_Y;
    }

    const totalW = availW;
    const totalH = Math.max(120, y - LANE_GAP_Y + PADDING);
    return { totalW, totalH, positions, laneBands, groupHeaders };
  }, [nodes, edges, columnOrder, containerW, typeConfig]);

  const { totalW, totalH, positions, laneBands, groupHeaders } = layout;

  // Legend — the distinct relationship colours actually present in this view.
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of edges) {
      const s = edgeStyle(e);
      if (!seen.has(s.legend)) seen.set(s.legend, s.color);
    }
    return Array.from(seen.entries()).map(([label, color]) => ({ label, color }));
  }, [edges]);

  if (nodes.length === 0) {
    return (
      <div style={{ padding: '3rem 2rem', textAlign: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No entities to diagram for this view.</p>
      </div>
    );
  }

  const hasSelection = !!selected;

  // Build a curved path between two node boxes. Vertical cubic bezier for the
  // common cross-lane case (source lane above/below the target); a downward
  // bow for the rarer same-row case so the two ends stay distinguishable.
  const edgePath = (a: { x: number; y: number }, b: { x: number; y: number }): string => {
    const x1 = a.x + NODE_W / 2;
    const x2 = b.x + NODE_W / 2;
    if (b.y > a.y + NODE_H / 2) {
      const y1 = a.y + NODE_H, y2 = b.y;
      const dy = Math.min(70, Math.max(24, (y2 - y1) * 0.5));
      return `M ${x1} ${y1} C ${x1} ${y1 + dy} ${x2} ${y2 - dy} ${x2} ${y2}`;
    }
    if (b.y < a.y - NODE_H / 2) {
      const y1 = a.y, y2 = b.y + NODE_H;
      const dy = Math.min(70, Math.max(24, (y1 - y2) * 0.5));
      return `M ${x1} ${y1} C ${x1} ${y1 - dy} ${x2} ${y2 + dy} ${x2} ${y2}`;
    }
    // Same lane / same row band — bow downward under both nodes.
    const y1 = a.y + NODE_H / 2, y2 = b.y + NODE_H / 2;
    return `M ${x1} ${y1} C ${x1} ${y1 + 36} ${x2} ${y2 + 36} ${x2} ${y2}`;
  };

  return (
    <div ref={containerRef} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 12, overflow: 'hidden' }}>
      <svg
        viewBox={`0 0 ${totalW} ${totalH}`}
        width={totalW}
        height={totalH}
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      >
        <defs>
          <marker id="ev-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#cbd5e1" />
          </marker>
        </defs>

        {/* Lane bands and labels */}
        {laneBands.map((band) => {
          const cfg = typeConfig[band.type];
          return (
            <g key={`lane-${band.type}`}>
              <rect
                x={PADDING}
                y={band.y - 10}
                width={totalW - PADDING * 2}
                height={band.height + 20}
                rx={6}
                fill={cfg.bg}
                opacity={0.22}
              />
              <text
                x={PADDING + 10}
                y={band.y + band.height / 2 + 4}
                fontSize={11}
                fontWeight={700}
                style={{ fill: cfg.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                {cfg.plural}
              </text>
            </g>
          );
        })}

        {/* Sub-group labels within a lane (process → value stream, data →
            system/domain). Rendered only when a lane actually sub-groups. */}
        {groupHeaders.map((g, i) => (
          <text
            key={`gh-${i}`}
            x={g.x}
            y={g.y}
            fontSize={9.5}
            fontWeight={700}
            style={{ fill: g.color, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.75 }}
          >
            {truncate(g.label, 40)}
          </text>
        ))}

        {/* Edges (behind nodes) — curved and colour-coded by relationship. */}
        {edges.map((e) => {
          const a = positions.get(e.source);
          const b = positions.get(e.target);
          if (!a || !b) return null;
          const isActive = hasSelection && impactSet.has(e.source) && impactSet.has(e.target);
          const isDimmed = hasSelection && !isActive;
          const style = edgeStyle(e);

          const stroke = isDimmed ? '#e2e8f0' : style.color;
          const strokeWidth = isActive ? 2.4 : isDimmed ? 1 : 1.5;
          const opacity = isDimmed ? 0.5 : isActive ? 1 : 0.8;

          return (
            <path
              key={e.id}
              d={edgePath(a, b)}
              fill="none"
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              strokeLinecap="round"
              markerEnd={isDimmed ? 'url(#ev-arrow-dim)' : undefined}
            >
              <title>{e.label}</title>
            </path>
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          const cfg = typeConfig[n.type];
          const isSelected = selected?.id === n.id;
          const isImpacted = hasSelection && impactSet.has(n.id) && !isSelected;
          const isDimmed = hasSelection && !impactSet.has(n.id);

          const strokeColor = isSelected ? cfg.color : isImpacted ? cfg.color : '#cbd5e1';
          const strokeWidth = isSelected ? 2.5 : isImpacted ? 1.6 : 1;
          const fillBg = isSelected ? cfg.bg : '#ffffff';
          const opacity = isDimmed ? 0.32 : 1;

          return (
            <g
              key={n.id}
              transform={`translate(${pos.x},${pos.y})`}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(n)}
            >
              <title>{n.label}</title>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={fillBg}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                opacity={opacity}
              />
              {/* Small filled circle in the type colour signals the node's
                  type at a glance; the lane it docks to labels it explicitly. */}
              <circle
                cx={16}
                cy={NODE_H / 2}
                r={4.5}
                fill={cfg.color}
                opacity={opacity}
              />
              <text
                x={32}
                y={n.meta?.governanceTier || n.meta?.systemType || n.meta?.level || n.meta?.role ? NODE_H / 2 - 2 : NODE_H / 2 + 4}
                fontSize={11.5}
                fontWeight={600}
                style={{ fill: '#0f172a' }}
                opacity={opacity}
              >
                {truncate(n.label, MAX_LABEL_CHARS)}
              </text>
              {(n.meta?.governanceTier || n.meta?.systemType || n.meta?.level || n.meta?.role) && (
                <text
                  x={32}
                  y={NODE_H / 2 + 12}
                  fontSize={9.5}
                  style={{ fill: '#64748b' }}
                  opacity={opacity}
                >
                  {truncate(
                    String(n.meta?.governanceTier || n.meta?.systemType || n.meta?.level || n.meta?.role || ''),
                    24,
                  )}
                </text>
              )}
              {/* Drill caret — expand reveals this branch's hidden children,
                  collapse hides them. Its own click must not also select. */}
              {(() => {
                const ec = expandControls?.get(n.id);
                if (!ec || !onToggleExpand) return null;
                const w = ec.state === 'expand' ? 26 : 18;
                return (
                  <g
                    transform={`translate(${NODE_W - w - 6},${NODE_H - 18})`}
                    style={{ cursor: 'pointer' }}
                    onClick={(ev) => { ev.stopPropagation(); onToggleExpand(n.id); }}
                    opacity={opacity}
                  >
                    <title>{ec.state === 'expand' ? `Show ${ec.count} ${ec.childLevel === 'ACTIVITY' ? 'activities' : 'children'}` : 'Hide children'}</title>
                    <rect width={w} height={13} rx={6.5} fill={cfg.bg} stroke={cfg.color} strokeWidth={0.75} />
                    <text
                      x={w / 2}
                      y={9.5}
                      fontSize={9}
                      fontWeight={700}
                      textAnchor="middle"
                      style={{ fill: cfg.color }}
                    >
                      {ec.state === 'expand' ? `+${ec.count}` : '−'}
                    </text>
                  </g>
                );
              })()}
            </g>
          );
        })}
      </svg>

      {/* Relationship legend — the edge colours present in this view. */}
      {legend.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', padding: '10px 6px 2px', borderTop: '1px solid var(--color-border)', marginTop: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Relationships</span>
          {legend.map((l) => (
            <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-secondary)' }}>
              <svg width={20} height={8} style={{ flexShrink: 0 }}><line x1={0} y1={4} x2={20} y2={4} stroke={l.color} strokeWidth={2.4} strokeLinecap="round" /></svg>
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
