import { useMemo } from 'react';

// Lightweight, hand-rolled SVG visualization for Enterprise View.
// Lays nodes out as horizontal swimlanes — one row per entity type — and
// draws edges between them. Same data shape as the cards view; the parent
// passes already-filtered nodes/edges plus the active selection / impact set.

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
  icon: string;
  label: string;
  plural: string;
}

interface Props {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  selected: DiagramNode | null;
  impactSet: Set<string>;
  onSelect: (n: DiagramNode) => void;
  typeConfig: Record<string, TypeCfg>;
  columnOrder: string[];
}

const NODE_W = 150;
const NODE_H = 44;
const NODE_GAP_X = 14;
const LANE_GAP_Y = 70;
const LANE_LABEL_W = 110;
const PADDING = 20;
const MAX_LABEL_CHARS = 18;

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export default function EnterpriseDiagram({
  nodes, edges, selected, impactSet, onSelect, typeConfig, columnOrder,
}: Props) {
  const layout = useMemo(() => {
    const byType: Record<string, DiagramNode[]> = {};
    for (const t of columnOrder) byType[t] = [];
    for (const n of nodes) if (byType[n.type]) byType[n.type].push(n);

    const activeLanes = columnOrder.filter((t) => byType[t].length > 0);
    const maxInLane = Math.max(1, ...activeLanes.map((t) => byType[t].length));

    const innerW = maxInLane * NODE_W + (maxInLane - 1) * NODE_GAP_X;
    const totalW = LANE_LABEL_W + innerW + PADDING * 2;
    const totalH = Math.max(
      120,
      PADDING * 2 + activeLanes.length * NODE_H + Math.max(0, activeLanes.length - 1) * LANE_GAP_Y,
    );

    const positions = new Map<string, { x: number; y: number }>();
    activeLanes.forEach((laneType, laneIdx) => {
      const laneNodes = byType[laneType];
      const laneY = PADDING + laneIdx * (NODE_H + LANE_GAP_Y);
      const laneW = laneNodes.length * NODE_W + (laneNodes.length - 1) * NODE_GAP_X;
      const laneStartX = LANE_LABEL_W + PADDING + (innerW - laneW) / 2;
      laneNodes.forEach((n, i) => {
        positions.set(n.id, { x: laneStartX + i * (NODE_W + NODE_GAP_X), y: laneY });
      });
    });

    return { byType, activeLanes, totalW, totalH, positions };
  }, [nodes, columnOrder]);

  const { activeLanes, totalW, totalH, positions } = layout;

  if (nodes.length === 0) {
    return (
      <div style={{ padding: '3rem 2rem', textAlign: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No entities to diagram for this view.</p>
      </div>
    );
  }

  const hasSelection = !!selected;

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 12, overflow: 'auto' }}>
      <svg width={totalW} height={totalH} style={{ display: 'block' }}>
        <defs>
          <marker id="ev-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
          </marker>
          <marker id="ev-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#cbd5e1" />
          </marker>
          <marker id="ev-arrow-active" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#1e293b" />
          </marker>
        </defs>

        {/* Lane bands and labels */}
        {activeLanes.map((laneType, idx) => {
          const cfg = typeConfig[laneType];
          const laneY = PADDING + idx * (NODE_H + LANE_GAP_Y);
          return (
            <g key={`lane-${laneType}`}>
              <rect
                x={PADDING}
                y={laneY - 10}
                width={totalW - PADDING * 2}
                height={NODE_H + 20}
                rx={6}
                fill={cfg.bg}
                opacity={0.22}
              />
              <text
                x={PADDING + 10}
                y={laneY + NODE_H / 2 + 4}
                fontSize={11}
                fontWeight={700}
                style={{ fill: cfg.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                {cfg.icon} {cfg.plural}
              </text>
            </g>
          );
        })}

        {/* Edges (behind nodes) */}
        {edges.map((e) => {
          const a = positions.get(e.source);
          const b = positions.get(e.target);
          if (!a || !b) return null;
          const isActive = hasSelection && impactSet.has(e.source) && impactSet.has(e.target);
          const isDimmed = hasSelection && !isActive;

          const targetBelow = b.y > a.y;
          const targetAbove = b.y < a.y;
          const x1 = a.x + NODE_W / 2;
          const x2 = b.x + NODE_W / 2;
          let y1: number, y2: number;
          if (targetBelow) {
            y1 = a.y + NODE_H;
            y2 = b.y;
          } else if (targetAbove) {
            y1 = a.y;
            y2 = b.y + NODE_H;
          } else {
            y1 = a.y + NODE_H / 2;
            y2 = b.y + NODE_H / 2;
          }

          const stroke = isActive ? '#1e293b' : isDimmed ? '#e2e8f0' : '#94a3b8';
          const marker = isActive ? 'url(#ev-arrow-active)' : isDimmed ? 'url(#ev-arrow-dim)' : 'url(#ev-arrow)';
          const opacity = isDimmed ? 0.5 : 1;
          const strokeWidth = isActive ? 1.8 : 1;

          return (
            <line
              key={e.id}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              markerEnd={marker}
            >
              <title>{e.label}</title>
            </line>
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
              <text
                x={10}
                y={NODE_H / 2 + 5}
                fontSize={15}
                style={{ fill: cfg.color }}
                opacity={opacity}
              >
                {cfg.icon}
              </text>
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
            </g>
          );
        })}
      </svg>
    </div>
  );
}
