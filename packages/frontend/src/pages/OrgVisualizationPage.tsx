import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

// ──────────────────────────────────────────────────────────────────────────
// OrgVisualizationPage — full-page SVG view of the organization hierarchy.
// Mirrors the Process Catalog visualization page: zoom controls, a level
// (org type) filter, print-to-PDF support with shell chrome hidden, and
// a back link to the Organizations management screen.
//
// Layout uses a simple post-order width allocation per subtree, same as
// the inline visualization the Organizations page used previously.
// ──────────────────────────────────────────────────────────────────────────

interface OrgNode {
  id: string; parentId: string | null; name: string; type: string;
  industry: string; description: string; headCount: number; children: OrgNode[];
}

interface LayoutNode {
  id: string; name: string; type: string;
  x: number; y: number; width: number;
  children: LayoutNode[];
}

const ORG_TYPE_VISUAL: Record<string, { color: string; bg: string; label: string }> = {
  company:    { color: '#1e40af', bg: '#dbeafe', label: 'Company' },
  division:   { color: '#5b21b6', bg: '#ede9fe', label: 'Division' },
  department: { color: '#0f4f46', bg: '#d1f0eb', label: 'Department' },
  team:       { color: '#92400e', bg: '#fef3c7', label: 'Team' },
  unit:       { color: '#64748b', bg: '#f1f5f9', label: 'Unit' },
};

function layoutTree(node: OrgNode, depth: number, xOffset: number, slotW: number, levelH: number): LayoutNode {
  if (node.children.length === 0) {
    return {
      id: node.id, name: node.name, type: node.type,
      x: xOffset + slotW / 2, y: depth * levelH + 50, width: slotW,
      children: [],
    };
  }
  let runningX = xOffset;
  const laidOutChildren: LayoutNode[] = [];
  for (const child of node.children) {
    const childLayout = layoutTree(child, depth + 1, runningX, slotW, levelH);
    runningX += childLayout.width;
    laidOutChildren.push(childLayout);
  }
  const subtreeWidth = runningX - xOffset;
  return {
    id: node.id, name: node.name, type: node.type,
    x: xOffset + subtreeWidth / 2, y: depth * levelH + 50, width: subtreeWidth,
    children: laidOutChildren,
  };
}

function flattenLayout(node: LayoutNode, acc: LayoutNode[] = []): LayoutNode[] {
  acc.push(node);
  for (const c of node.children) flattenLayout(c, acc);
  return acc;
}

// Filter the tree by hidden org types — collapses hidden nodes by promoting
// their children to the hidden node's parent. Keeps the tree connected.
function filterTree(nodes: OrgNode[], hidden: Set<string>): OrgNode[] {
  function walk(node: OrgNode): OrgNode[] {
    const expandedChildren = node.children.flatMap(walk);
    if (hidden.has(node.type)) return expandedChildren;
    return [{ ...node, children: expandedChildren }];
  }
  return nodes.flatMap(walk);
}

// ── Print Styles ──

const PRINT_STYLE_ID = 'procela-orgviz-print-styles';

function ensurePrintStyles() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      nav, header, aside,
      .sidebar, [class*="sidebar"], [class*="Sidebar"],
      [class*="header"], [class*="Header"],
      [class*="chatPanel"], [class*="ChatPanel"],
      [class*="sessionTimeout"], [class*="toast"],
      [class*="shell"] > aside {
        display: none !important;
      }
      [class*="shell"] { display: block !important; }
      [class*="main"] { display: block !important; }
      [class*="content"] {
        padding: 0 !important;
        overflow: visible !important;
      }
      .viz-controls { display: none !important; }
      .print-header { display: block !important; }
      .print-footer { display: block !important; }
      .viz-container {
        transform: none !important;
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
      }
      .viz-scroll-area {
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
      }
      body, .viz-container, .viz-scroll-area { background: white !important; }
      @page {
        margin: 0.5in;
        size: landscape;
      }
    }
  `;
  document.head.appendChild(style);
}

export default function OrgVisualizationPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName } = useOrgContext();
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [peopleCounts, setPeopleCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { ensurePrintStyles(); }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgQuery = activeOrgId ? `?scopeOrgId=${encodeURIComponent(activeOrgId)}` : '';
      const [orgRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; tree: OrgNode[] }>(`/organizations${orgQuery}`),
        apiClient.get<{ success: boolean; data: Array<{ id: string; orgIds: string[] }> }>('/people'),
      ]);
      setTree(orgRes.tree || []);
      const counts: Record<string, number> = {};
      for (const p of peopleRes.data || []) {
        for (const oid of p.orgIds || []) counts[oid] = (counts[oid] || 0) + 1;
      }
      setPeopleCounts(counts);
    } catch (err: any) {
      setError(err?.message || 'Failed to load organization hierarchy');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredTree = useMemo(() => {
    if (hiddenTypes.size === 0) return tree;
    return filterTree(tree, hiddenTypes);
  }, [tree, hiddenTypes]);

  // Lay out + measure
  const { allNodes, edges, svgW, svgH } = useMemo(() => {
    const SLOT_W = 180;
    const LEVEL_H = 110;
    const BOX_H = 56;
    let xCursor = 20;
    const laidOut: LayoutNode[] = [];
    for (const root of filteredTree) {
      const laid = layoutTree(root, 0, xCursor, SLOT_W, LEVEL_H);
      laidOut.push(laid);
      xCursor += laid.width;
    }
    const allNodes = laidOut.flatMap((l) => flattenLayout(l));
    const svgW = Math.max(xCursor + 40, 600);
    const maxDepth = allNodes.reduce((m, n) => Math.max(m, n.y), 0);
    const svgH = maxDepth + BOX_H + 60;
    const edges: { from: LayoutNode; to: LayoutNode }[] = [];
    function collectEdges(node: LayoutNode) {
      for (const c of node.children) {
        edges.push({ from: node, to: c });
        collectEdges(c);
      }
    }
    for (const l of laidOut) collectEdges(l);
    return { allNodes, edges, svgW, svgH };
  }, [filteredTree]);

  const toggleType = (type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.15, 2));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.15, 0.3));
  const handleZoomReset = () => setZoom(1);
  const handlePrint = () => window.print();

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Type counts for the legend (computed from the unfiltered tree so
  // toggling a level doesn't make its own count disappear).
  const typeCounts: Record<string, number> = {};
  function countAll(nodes: OrgNode[]) {
    for (const n of nodes) {
      typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
      if (n.children) countAll(n.children);
    }
  }
  countAll(tree);

  const BOX_W = 160;
  const BOX_H = 56;

  return (
    <div>
      {/* Print header — hidden on screen */}
      <div className="print-header" style={{
        display: 'none', padding: '16px 0',
        borderBottom: '2px solid #1e40af', marginBottom: 24,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#1e40af' }}>
          Procela — Organization Hierarchy
        </div>
        {activeOrgName && (
          <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
            Organization: {activeOrgName}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
          Exported: {today}
        </div>
      </div>

      {/* Controls toolbar */}
      <div className="viz-controls" style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 16, flexWrap: 'wrap',
      }}>
        <button
          onClick={() => navigate('/organizations')}
          style={{
            padding: '8px 16px', background: 'var(--color-surface)',
            color: 'var(--color-text)', border: '1px solid var(--color-border)',
            borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {'\u2190'} Back to Organizations
        </button>

        <button
          onClick={handlePrint}
          style={{
            padding: '8px 16px', background: 'var(--color-primary)',
            color: '#fff', border: 'none',
            borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Export PDF
        </button>

        {/* Zoom controls */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8,
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 6, padding: '2px 4px',
        }}>
          <button onClick={handleZoomOut}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 700, color: 'var(--color-text)', padding: '4px 8px', borderRadius: 4 }}
            title="Zoom out">-</button>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', minWidth: 42, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={handleZoomIn}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 700, color: 'var(--color-text)', padding: '4px 8px', borderRadius: 4 }}
            title="Zoom in">+</button>
          <button onClick={handleZoomReset}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', padding: '3px 6px', fontSize: 11, color: 'var(--color-text-secondary)' }}
            title="Reset zoom">Reset</button>
        </div>

        {/* Type filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Show:</span>
          {Object.entries(ORG_TYPE_VISUAL).map(([type, config]) => {
            if ((typeCounts[type] || 0) === 0) return null;
            const isHidden = hiddenTypes.has(type);
            return (
              <label key={type} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, cursor: 'pointer',
                padding: '2px 6px', borderRadius: 4,
                background: isHidden ? '#f1f5f9' : config.bg,
                color: isHidden ? '#94a3b8' : config.color,
                border: `1px solid ${isHidden ? '#e2e8f0' : config.color + '44'}`,
                opacity: isHidden ? 0.6 : 1,
              }}>
                <input type="checkbox" checked={!isHidden} onChange={() => toggleType(type)}
                  style={{ width: 12, height: 12, margin: 0 }} />
                {config.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Color legend */}
      <div className="viz-controls" style={{
        display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Legend:</span>
        {Object.entries(ORG_TYPE_VISUAL).map(([type, config]) => {
          const count = typeCounts[type] || 0;
          if (count === 0) return null;
          return (
            <div key={type} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 4,
              background: config.bg, color: config.color,
              fontSize: 10, fontWeight: 500,
              borderLeft: `3px solid ${config.color}`,
              opacity: hiddenTypes.has(type) ? 0.35 : 1,
            }}>
              {config.label} ({count})
            </div>
          );
        })}
      </div>

      {/* Visualization container */}
      <div
        className="viz-container"
        ref={containerRef}
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md, 8px)',
          border: '1px solid var(--color-border, #e2e8f0)',
          minHeight: 400,
          position: 'relative',
          overflow: 'auto',
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', color: 'var(--color-text-muted)' }}>
            Loading organization hierarchy...
          </div>
        ) : error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: 12 }}>
            <div style={{ color: 'var(--color-error, #dc2626)', fontSize: 14 }}>{error}</div>
            <button onClick={fetchData}
              style={{ padding: '6px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
              Retry
            </button>
          </div>
        ) : filteredTree.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: 12 }}>
            <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
              No organizations to visualize.
            </div>
            <button onClick={() => navigate('/organizations')}
              style={{ padding: '8px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
              Go to Organizations
            </button>
          </div>
        ) : (
          <div className="viz-scroll-area"
            style={{ overflow: 'auto', padding: 24 }}>
            <div style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top center',
              transition: 'transform 0.15s ease',
              minWidth: 'fit-content',
            }}>
              <svg width={svgW} height={svgH} style={{ display: 'block' }}>
                {/* Edges first so nodes paint over them */}
                {edges.map((e, i) => {
                  const x1 = e.from.x;
                  const y1 = e.from.y + BOX_H / 2;
                  const x2 = e.to.x;
                  const y2 = e.to.y - BOX_H / 2;
                  const midY = (y1 + y2) / 2;
                  const path = `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`;
                  return <path key={i} d={path} stroke="#cbd5e1" strokeWidth={1.5} fill="none" />;
                })}
                {/* Nodes */}
                {allNodes.map((n) => {
                  const config = ORG_TYPE_VISUAL[n.type] || ORG_TYPE_VISUAL.unit;
                  const count = peopleCounts[n.id] || 0;
                  return (
                    <g key={n.id} className="viz-card"
                      transform={`translate(${n.x - BOX_W / 2}, ${n.y - BOX_H / 2})`}>
                      <rect width={BOX_W} height={BOX_H} rx={6} ry={6}
                        fill="#fff" stroke={config.color} strokeWidth={1.5} />
                      <rect x={0} y={0} width={4} height={BOX_H} rx={2} ry={2} fill={config.color} />
                      <text x={BOX_W / 2} y={22} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0f172a">
                        {n.name.length > 22 ? `${n.name.slice(0, 21)}...` : n.name}
                      </text>
                      <text x={BOX_W / 2} y={38} textAnchor="middle" fontSize={9} fill={config.color}
                        style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                        {config.label}
                      </text>
                      {count > 0 && (
                        <g transform={`translate(${BOX_W - 42}, ${BOX_H - 16})`}>
                          <rect width={36} height={12} rx={6} ry={6} fill="#ede9fe" />
                          <text x={18} y={9} textAnchor="middle" fontSize={9} fill="#5b21b6" fontWeight={600}>
                            {count}{count === 1 ? ' person' : ' people'}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Print footer */}
      <div className="print-footer" style={{
        display: 'none', padding: '12px 0',
        borderTop: '1px solid #cbd5e1', marginTop: 24,
        fontSize: 10, color: '#94a3b8', textAlign: 'center',
      }}>
        Generated by Procela | {today}
      </div>
    </div>
  );
}
