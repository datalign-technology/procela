import { useEffect, useState, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { getStatusColor } from '../lib/statusBadge';

// ── Types ──

interface GraphNode {
  id: string;
  type: 'process' | 'system' | 'data-asset' | 'person' | 'domain';
  label: string;
  status?: string;
  meta: Record<string, any>;
  // Layout
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
}

interface Summary {
  processes: number;
  systems: number;
  dataAssets: number;
  domains: number;
  people: number;
  edges: number;
}

// ── Constants ──

const TYPE_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  process:      { color: '#2563eb', bg: '#dbeafe', icon: '\u2630', label: 'Process' },
  system:       { color: '#7c3aed', bg: '#ede9fe', icon: '\u2699', label: 'System' },
  'data-asset': { color: '#059669', bg: '#d1fae5', icon: '\u26C1', label: 'Data Asset' },
  person:       { color: '#d97706', bg: '#fef3c7', icon: '\u263B', label: 'Person' },
  domain:       { color: '#dc2626', bg: '#fee2e2', icon: '\u2637', label: 'Domain' },
};

const EDGE_COLORS: Record<string, string> = {
  hierarchy: '#94a3b8',
  'hosted-by': '#7c3aed',
  'owned-by': '#d97706',
  mapping: '#2563eb',
  governs: '#dc2626',
  lineage: '#059669',
};

const NODE_RADIUS = 28;

// ── Force layout helpers ──

function initLayout(nodes: GraphNode[], width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  for (const n of nodes) {
    n.x = cx + (Math.random() - 0.5) * width * 0.6;
    n.y = cy + (Math.random() - 0.5) * height * 0.6;
    n.vx = 0;
    n.vy = 0;
  }
}

function runForceIteration(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1));
  const repulsion = k * 50;
  const attraction = 0.005;
  const damping = 0.85;

  // Repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = repulsion / (dist * dist);
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx -= fx; a.vy -= fy;
      b.vx += fx; b.vy += fy;
    }
  }

  // Attraction (edges)
  for (const e of edges) {
    const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const force = dist * attraction;
    const fx = dx * force, fy = dy * force;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  // Center gravity
  const cx = width / 2, cy = height / 2;
  for (const n of nodes) {
    n.vx += (cx - n.x) * 0.001;
    n.vy += (cy - n.y) * 0.001;
    n.vx *= damping;
    n.vy *= damping;
    n.x += n.vx;
    n.y += n.vy;
    n.x = Math.max(NODE_RADIUS, Math.min(width - NODE_RADIUS, n.x));
    n.y = Math.max(NODE_RADIUS, Math.min(height - NODE_RADIUS, n.y));
  }
}

// ── Component ──

export default function EnterpriseViewPage() {
  const { activeOrgId } = useOrgContext();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set(['process', 'system', 'data-asset', 'person', 'domain']));
  const [filterEdgeTypes, setFilterEdgeTypes] = useState<Set<string>>(new Set(Object.keys(EDGE_COLORS)));
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>([]);
  const dragging = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);

  const WIDTH = 1200;
  const HEIGHT = 700;

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: { nodes: GraphNode[]; edges: GraphEdge[] }; summary: Summary }>(`/enterprise-view${query}`);
      const data = res.data;
      if (data) {
        const gNodes = data.nodes.map((n) => ({ ...n, x: 0, y: 0, vx: 0, vy: 0 }));
        initLayout(gNodes, WIDTH, HEIGHT);
        nodesRef.current = gNodes;
        setNodes(gNodes);
        setEdges(data.edges || []);
      }
      setSummary(res.summary || null);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Force simulation
  useEffect(() => {
    if (nodes.length === 0) return;
    let iterations = 0;
    const maxIterations = 300;
    function tick() {
      if (iterations >= maxIterations) return;
      runForceIteration(nodesRef.current, edges, WIDTH, HEIGHT);
      setNodes([...nodesRef.current]);
      iterations++;
      animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [edges, nodes.length]);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent, node: GraphNode) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    dragging.current = { nodeId: node.id, offsetX: svgP.x - node.x, offsetY: svgP.y - node.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    const n = nodesRef.current.find((n) => n.id === dragging.current!.nodeId);
    if (n) {
      n.x = svgP.x - dragging.current.offsetX;
      n.y = svgP.y - dragging.current.offsetY;
      n.vx = 0; n.vy = 0;
      setNodes([...nodesRef.current]);
    }
  };

  const handleMouseUp = () => { dragging.current = null; };

  // Filter
  const visibleNodes = nodes.filter((n) => filterTypes.has(n.type));
  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges.filter((e) =>
    visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target) && filterEdgeTypes.has(e.type)
  );

  // Impact analysis: find all connected nodes from selected
  const impactSet = new Set<string>();
  const impactEdges = new Set<string>();
  if (selected) {
    const queue = [selected.id];
    impactSet.add(selected.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of edges) {
        if (e.source === current && !impactSet.has(e.target)) {
          impactSet.add(e.target); impactEdges.add(e.id); queue.push(e.target);
        }
        if (e.target === current && !impactSet.has(e.source)) {
          impactSet.add(e.source); impactEdges.add(e.id); queue.push(e.source);
        }
      }
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const toggleFilter = (type: string) => {
    setFilterTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const toggleEdgeFilter = (type: string) => {
    setFilterEdgeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading enterprise view...</div>;
  }

  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 140px)' }}>
      {/* Main graph area */}
      <div style={{ flex: 1, position: 'relative', background: '#fafbfc', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {/* Legend / Filters */}
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
            <button key={type}
              onClick={() => toggleFilter(type)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: filterTypes.has(type) ? cfg.bg : '#f1f5f9',
                color: filterTypes.has(type) ? cfg.color : '#94a3b8',
                border: `1px solid ${filterTypes.has(type) ? cfg.color + '44' : '#e2e8f0'}`,
                opacity: filterTypes.has(type) ? 1 : 0.5,
              }}
            >
              <span>{cfg.icon}</span> {cfg.label}
            </button>
          ))}
        </div>

        {/* Edge type filters */}
        <div style={{ position: 'absolute', top: 48, left: 12, zIndex: 10, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(EDGE_COLORS).map(([type, color]) => (
            <button key={type}
              onClick={() => toggleEdgeFilter(type)}
              style={{
                padding: '2px 8px', borderRadius: 10, fontSize: 9, fontWeight: 500,
                cursor: 'pointer', border: '1px solid #e2e8f0',
                background: filterEdgeTypes.has(type) ? color + '18' : '#f8fafc',
                color: filterEdgeTypes.has(type) ? color : '#94a3b8',
                opacity: filterEdgeTypes.has(type) ? 1 : 0.4,
              }}
            >
              {type.replace('-', ' ')}
            </button>
          ))}
        </div>

        {/* Summary stats */}
        {summary && (
          <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 10, display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-text-muted)' }}>
            <span>{summary.processes} processes</span>
            <span>{summary.systems} systems</span>
            <span>{summary.dataAssets} assets</span>
            <span>{summary.domains} domains</span>
            <span>{summary.people} people</span>
            <span>{summary.edges} relationships</span>
          </div>
        )}

        <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          style={{ cursor: dragging.current ? 'grabbing' : 'default' }}>
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
            </marker>
          </defs>

          {/* Edges */}
          {visibleEdges.map((e) => {
            const s = nodeMap.get(e.source);
            const t = nodeMap.get(e.target);
            if (!s || !t) return null;
            const isHighlighted = selected && impactEdges.has(e.id);
            const isDimmed = selected && !impactEdges.has(e.id);
            return (
              <line key={e.id}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={EDGE_COLORS[e.type] || '#cbd5e1'}
                strokeWidth={isHighlighted ? 2.5 : 1}
                strokeOpacity={isDimmed ? 0.1 : isHighlighted ? 1 : 0.35}
                markerEnd={e.type === 'lineage' ? 'url(#arrowhead)' : undefined}
              />
            );
          })}

          {/* Nodes */}
          {visibleNodes.map((n) => {
            const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.process;
            const isSelected = selected?.id === n.id;
            const isImpacted = selected && impactSet.has(n.id);
            const isDimmed = selected && !impactSet.has(n.id);
            const statusColor = n.status ? getStatusColor(n.status) : null;
            return (
              <g key={n.id}
                style={{ cursor: 'grab' }}
                onMouseDown={(e) => handleMouseDown(e as any, n)}
                onClick={() => setSelected(isSelected ? null : n)}
              >
                {/* Glow for selected */}
                {isSelected && (
                  <circle cx={n.x} cy={n.y} r={NODE_RADIUS + 6} fill="none" stroke={cfg.color} strokeWidth={2} strokeOpacity={0.4} />
                )}
                {/* Node circle */}
                <circle cx={n.x} cy={n.y} r={NODE_RADIUS}
                  fill={cfg.bg} stroke={cfg.color}
                  strokeWidth={isImpacted ? 2.5 : 1.5}
                  opacity={isDimmed ? 0.2 : 1}
                />
                {/* Status dot */}
                {statusColor && (
                  <circle cx={n.x + NODE_RADIUS * 0.65} cy={n.y - NODE_RADIUS * 0.65} r={5}
                    fill={statusColor.bg} stroke={statusColor.color} strokeWidth={1.5}
                    opacity={isDimmed ? 0.2 : 1}
                  />
                )}
                {/* Icon */}
                <text x={n.x} y={n.y - 4} textAnchor="middle" fontSize={14}
                  opacity={isDimmed ? 0.2 : 1}>
                  {cfg.icon}
                </text>
                {/* Label */}
                <text x={n.x} y={n.y + 12} textAnchor="middle" fontSize={8} fontWeight={500}
                  fill={cfg.color} opacity={isDimmed ? 0.2 : 1}>
                  {n.label.length > 14 ? n.label.substring(0, 13) + '\u2026' : n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Sidebar — impact analysis panel */}
      <div style={{
        width: 320, flexShrink: 0, background: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)', padding: 16, overflowY: 'auto',
      }}>
        {!selected ? (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Enterprise View</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              Click any node in the graph to see its dependencies, impact, and details.
              Drag nodes to rearrange. Use the legend to filter entity types.
            </p>
            <div style={{ marginTop: 20 }}>
              <h4 style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Relationship Types</h4>
              {Object.entries(EDGE_COLORS).map(([type, color]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                  <div style={{ width: 20, height: 2, background: color, borderRadius: 1 }} />
                  <span style={{ color: 'var(--color-text-secondary)' }}>{type.replace('-', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: '50%',
                    background: TYPE_CONFIG[selected.type]?.bg,
                    color: TYPE_CONFIG[selected.type]?.color,
                    fontSize: 14,
                  }}>
                    {TYPE_CONFIG[selected.type]?.icon}
                  </span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{selected.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                      {TYPE_CONFIG[selected.type]?.label}
                    </div>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelected(null)}
                style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                Close
              </button>
            </div>

            {/* Status */}
            {selected.status && (
              <div style={{ marginBottom: 12 }}>
                <span style={{
                  display: 'inline-block', padding: '2px 10px', borderRadius: 4,
                  fontSize: 11, fontWeight: 600,
                  background: getStatusColor(selected.status).bg,
                  color: getStatusColor(selected.status).color,
                }}>
                  {selected.status.replace('_', ' ')}
                </span>
              </div>
            )}

            {/* Meta details */}
            {selected.meta.description && (
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
                {selected.meta.description}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
              {Object.entries(selected.meta).filter(([k]) => k !== 'description').map(([k, v]) => (
                v != null && v !== '' ? (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <span style={{ color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}</span>
                    <span style={{ fontWeight: 500, maxWidth: 160, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(v)}</span>
                  </div>
                ) : null
              ))}
            </div>

            {/* Impact analysis */}
            <h4 style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Impact Analysis ({impactSet.size - 1} connected)
            </h4>
            {impactSet.size <= 1 ? (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No dependencies found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[...impactSet].filter((id) => id !== selected.id).map((id) => {
                  const n = nodeMap.get(id);
                  if (!n) return null;
                  const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.process;
                  // Find the edge connecting to this node
                  const connectingEdge = edges.find((e) =>
                    (e.source === selected.id && e.target === id) ||
                    (e.target === selected.id && e.source === id) ||
                    impactEdges.has(e.id) && (e.source === id || e.target === id)
                  );
                  return (
                    <div key={id}
                      onClick={() => setSelected(n)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                        borderRadius: 4, cursor: 'pointer', fontSize: 12,
                        background: 'var(--color-bg)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = cfg.bg; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                    >
                      <span style={{ fontSize: 12 }}>{cfg.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</div>
                        <div style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>
                          {cfg.label}
                          {connectingEdge && <span> &middot; {connectingEdge.label}</span>}
                        </div>
                      </div>
                      {n.status && (
                        <span style={{
                          fontSize: 8, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                          background: getStatusColor(n.status).bg,
                          color: getStatusColor(n.status).color,
                        }}>
                          {n.status.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
