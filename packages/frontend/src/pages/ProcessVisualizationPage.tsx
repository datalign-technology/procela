import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import Page from '../components/Page';
import Spinner from '../components/Spinner';
import { installPrintFit } from '../lib/printFit';

// ── Types ──

type NodeLevel = 'VALUE_STREAM' | 'DOMAIN' | 'CAPABILITY' | 'PROCESS' | 'SUBPROCESS' | 'ACTIVITY' | 'TASK' | 'EXECUTION';

interface ProcessNode {
  id: string;
  parentId: string | null;
  level: NodeLevel;
  name: string;
  description: string;
  activityId: string | null;
  status: string;
  orderIndex: number;
  orgIds: string[];
  ownerId: string | null;
  children?: ProcessNode[];
}

interface FlowRelationship {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
}

// ── Level Visual Config ──

const LEVEL_VISUAL: Record<NodeLevel, { bg: string; border: string; width: number; label: string; icon: string }> = {
  VALUE_STREAM: { bg: '#d1f0eb', border: '#0f4f46', width: 280, label: 'Value Stream', icon: '\u2B95' },
  DOMAIN:       { bg: '#ede9fe', border: '#5b21b6', width: 240, label: 'Domain', icon: '\u25CE' },
  CAPABILITY:   { bg: '#dbeafe', border: '#1e40af', width: 240, label: 'Capability', icon: '\u2B50' },
  PROCESS:      { bg: '#fef3c7', border: '#92400e', width: 240, label: 'Process', icon: '\u2699' },
  SUBPROCESS:   { bg: '#fce7f3', border: '#9d174d', width: 220, label: 'Sub-Process', icon: '\u21B3' },
  ACTIVITY:     { bg: '#d1fae5', border: '#065f46', width: 200, label: 'Activity', icon: '\u25B6' },
  TASK:         { bg: '#f1f5f9', border: '#64748b', width: 180, label: 'Task', icon: '\u2022' },
  EXECUTION:    { bg: '#e2e8f0', border: '#475569', width: 180, label: 'System/Execution', icon: '\u2318' },
};

// Use the shared status palette — identical colors across every page now.
import { getStatusColor as _getStatusColor } from '@/lib/statusBadge';
const STATUS_COLORS: Record<string, { bg: string; color: string }> = Object.fromEntries(
  ['DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED'].map((s) => [s, _getStatusColor(s)]),
);

const ALL_OPTIONAL_LEVELS: NodeLevel[] = ['DOMAIN', 'CAPABILITY', 'SUBPROCESS', 'TASK', 'EXECUTION'];

// ── Helpers ──

function buildFlowMap(flows: FlowRelationship[]): Map<string, FlowRelationship[]> {
  const map = new Map<string, FlowRelationship[]>();
  for (const flow of flows) {
    const existing = map.get(flow.fromNodeId) || [];
    existing.push(flow);
    map.set(flow.fromNodeId, existing);
  }
  return map;
}

function isActivityContainer(node: ProcessNode): boolean {
  return (node.level === 'PROCESS' || node.level === 'SUBPROCESS') &&
    (node.children || []).some(c => c.level === 'ACTIVITY');
}

function filterTree(nodes: ProcessNode[], hiddenLevels: Set<NodeLevel>): ProcessNode[] {
  const result: ProcessNode[] = [];
  for (const node of nodes) {
    if (hiddenLevels.has(node.level)) {
      // Skip this node, but include its children promoted up
      const filteredChildren = filterTree(node.children || [], hiddenLevels);
      result.push(...filteredChildren);
    } else {
      const filteredChildren = filterTree(node.children || [], hiddenLevels);
      result.push({ ...node, children: filteredChildren });
    }
  }
  return result;
}

// ── Flow Arrow Component ──

function FlowArrow({ type }: { type: string }) {
  const isSequence = type === 'SEQUENCE';
  const color = isSequence ? '#065f46' : '#9d174d';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '0 4px', minWidth: 36,
      flexShrink: 0, position: 'relative',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ width: 20, height: 2, background: color, position: 'relative', overflow: 'hidden' }}>
          {/* Animated pulse traveling along the line */}
          <div style={{
            position: 'absolute', top: -1, left: 0, width: 8, height: 4,
            background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
            borderRadius: 2, opacity: 0.7,
            animation: 'flowPulse 1.5s linear infinite',
          }} />
        </div>
        <div style={{
          width: 0, height: 0,
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          borderLeft: `6px solid ${color}`,
        }} />
      </div>
      {!isSequence && (
        <span style={{
          fontSize: 8, color: '#9d174d', fontWeight: 600,
          marginTop: 2, whiteSpace: 'nowrap',
        }}>
          {type}
        </span>
      )}
    </div>
  );
}

// ── Activity Row (horizontal flow) ──

function ActivityRow({ activities, flowMap }: { activities: ProcessNode[]; flowMap: Map<string, FlowRelationship[]> }) {
  // Determine order based on flow relationships
  const ordered = useMemo(() => {
    if (activities.length <= 1) return activities;

    const activityIds = new Set(activities.map(a => a.id));
    const hasIncoming = new Set<string>();

    for (const activity of activities) {
      const outgoing = (flowMap.get(activity.id) || []).filter(f => activityIds.has(f.toNodeId));
      for (const f of outgoing) hasIncoming.add(f.toNodeId);
    }

    // Find starting nodes (no incoming within this set)
    const starts = activities.filter(a => !hasIncoming.has(a.id));
    if (starts.length === 0) return activities;

    const result: ProcessNode[] = [];
    const visited = new Set<string>();
    const queue = [...starts];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      result.push(current);

      const outgoing = (flowMap.get(current.id) || []).filter(f => activityIds.has(f.toNodeId));
      for (const f of outgoing) {
        const target = activities.find(a => a.id === f.toNodeId);
        if (target && !visited.has(target.id)) queue.push(target);
      }
    }

    // Add any remaining (not connected by flows)
    for (const a of activities) {
      if (!visited.has(a.id)) result.push(a);
    }

    return result;
  }, [activities, flowMap]);

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start',
      gap: 0, flexWrap: 'wrap', padding: '4px 0',
      maxWidth: 1200,
    }}>
      {ordered.map((activity, idx) => {
        const activityFlows = (flowMap.get(activity.id) || []).filter(
          f => ordered.some(a => a.id === f.toNodeId)
        );
        const nextExists = idx < ordered.length - 1;
        const flowToNext = activityFlows.find(
          f => f.toNodeId === ordered[idx + 1]?.id
        );

        return (
          <div key={activity.id} style={{ display: 'flex', alignItems: 'flex-start' }}>
            <VisualCard node={activity} />
            {nextExists && (
              <FlowArrow type={flowToNext?.type || 'SEQUENCE'} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Visual Card ──

function VisualCard({ node }: { node: ProcessNode }) {
  const config = LEVEL_VISUAL[node.level];
  const statusStyle = STATUS_COLORS[node.status] || STATUS_COLORS.DRAFT;

  return (
    <div
      className="viz-card"
      style={{
        width: config.width,
        background: config.bg,
        borderLeft: `3px solid ${config.border}`,
        borderRadius: 6,
        padding: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        flexShrink: 0,
      }}
    >
      {/* Level badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 6,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 7px', borderRadius: 4,
          fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
          background: `${config.border}18`, color: config.border,
        }}>
          {config.icon} {config.label}
        </span>
        {node.activityId && (
          <span style={{
            fontSize: 9, color: config.border,
            fontFamily: 'monospace', whiteSpace: 'nowrap',
            background: '#fff', padding: '1px 4px', borderRadius: 3,
            border: '1px solid #e2e8f0',
          }}>
            {node.activityId}
          </span>
        )}
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '1px 5px',
          borderRadius: 3, marginLeft: 'auto',
          background: statusStyle.bg, color: statusStyle.color,
        }}>
          {node.status}
        </span>
      </div>

      {/* Name */}
      <div style={{
        fontSize: node.level === 'VALUE_STREAM' ? 15 : 13,
        fontWeight: 600, color: '#1e293b',
        lineHeight: 1.3,
      }}>
        {node.name}
      </div>

      {/* Description */}
      {node.description && (
        <div style={{
          fontSize: 11, color: '#64748b',
          marginTop: 4, lineHeight: 1.4,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {node.description}
        </div>
      )}
    </div>
  );
}

// ── Vertical Connector Line ──

function VerticalConnector() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'center',
      padding: '2px 0',
    }}>
      <div style={{
        width: 2, height: 20,
        background: '#cbd5e1',
      }} />
    </div>
  );
}

// ── Visual Node (recursive tree) ──

function VisualNode({ node, flowMap }: { node: ProcessNode; flowMap: Map<string, FlowRelationship[]> }) {
  const children = node.children || [];
  const activityChildren = children.filter(c => c.level === 'ACTIVITY');
  const nonActivityChildren = children.filter(c => c.level !== 'ACTIVITY');
  const hasActivityRow = activityChildren.length > 0 && isActivityContainer(node);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <VisualCard node={node} />

      {/* Activity children shown as horizontal flow */}
      {hasActivityRow && (
        <>
          <VerticalConnector />
          <ActivityRow activities={activityChildren} flowMap={flowMap} />
          {/* Sub-items of activities (tasks, executions) */}
          {activityChildren.some(a => (a.children || []).length > 0) && (
            <div style={{
              display: 'flex', justifyContent: 'flex-start', gap: 16,
              flexWrap: 'wrap', marginTop: 4,
            }}>
              {activityChildren
                .filter(a => (a.children || []).length > 0)
                .map(activity => (
                  <div key={activity.id} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                  }}>
                    <div style={{
                      fontSize: 9, color: '#64748b', marginBottom: 4,
                      fontWeight: 500,
                    }}>
                      {activity.name}
                    </div>
                    <div style={{
                      display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start',
                    }}>
                      {(activity.children || []).map(child => (
                        <VisualNode key={child.id} node={child} flowMap={flowMap} />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      {/* Non-activity children shown as vertical tree */}
      {nonActivityChildren.length > 0 && (
        <>
          <VerticalConnector />
          {/* Horizontal branch line */}
          {nonActivityChildren.length > 1 && (
            <div style={{
              display: 'flex', justifyContent: 'center',
              width: '100%', position: 'relative',
            }}>
              <div style={{
                position: 'absolute', top: 0,
                height: 2, background: '#cbd5e1',
                left: `calc(50% / ${nonActivityChildren.length})`,
                right: `calc(50% / ${nonActivityChildren.length})`,
              }} />
            </div>
          )}
          <div style={{
            display: 'flex', justifyContent: 'center',
            gap: 20, flexWrap: 'wrap',
          }}>
            {nonActivityChildren.map(child => (
              <div key={child.id} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
                {nonActivityChildren.length > 1 && <VerticalConnector />}
                <VisualNode node={child} flowMap={flowMap} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Print Styles ──

const PRINT_STYLE_ID = 'procela-viz-print-styles';

function ensurePrintStyles() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      /* Hide shell chrome */
      nav, header, aside,
      .sidebar, [class*="sidebar"], [class*="Sidebar"],
      [class*="header"], [class*="Header"],
      [class*="chatPanel"], [class*="ChatPanel"],
      [class*="sessionTimeout"], [class*="toast"],
      [class*="shell"] > aside {
        display: none !important;
      }

      /* Reset layout so content is full-width */
      [class*="shell"] {
        display: block !important;
      }
      [class*="main"] {
        display: block !important;
      }
      [class*="content"] {
        padding: 0 !important;
        overflow: visible !important;
      }

      /* Hide controls bar */
      .viz-controls {
        display: none !important;
      }

      /* Show print header/footer */
      .print-header {
        display: block !important;
      }
      .print-footer {
        display: block !important;
      }

      /* Make diagram fill page */
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
        padding: 0 !important;
      }

      /* Scale the diagram down to fit the page width (set by installPrintFit)
         so a wide tree isn't clipped at the edge — a PDF can't scroll. */
      [data-print-fit] {
        transform: scale(var(--print-fit)) !important;
        transform-origin: top left !important;
      }

      /* White background for print */
      body, .viz-container, .viz-scroll-area {
        background: white !important;
      }

      /* Ensure cards print properly */
      .viz-card {
        break-inside: avoid;
        box-shadow: none !important;
        border: 1px solid #e2e8f0 !important;
      }

      @page {
        margin: 0.5in;
        size: landscape;
      }
    }
  `;
  document.head.appendChild(style);
}

// ── Main Page ──

export default function ProcessVisualizationPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName } = useOrgContext();
  const [tree, setTree] = useState<ProcessNode[]>([]);
  const [flows, setFlows] = useState<FlowRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hiddenLevels, setHiddenLevels] = useState<Set<NodeLevel>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const printFitRef = useRef<HTMLDivElement>(null);

  // Inject print styles on mount + scale the diagram to fit the page on print
  // (a wide tree would otherwise clip at the page edge in a PDF).
  useEffect(() => {
    ensurePrintStyles();
    return installPrintFit(() => printFitRef.current);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [catalogRes, flowsRes] = await Promise.all([
        apiClient.get<{ success: boolean; tree: ProcessNode[]; stats: any; validChildren: Record<string, string[]> }>(`/process-catalog${qp}`),
        apiClient.get<{ success: boolean; data: FlowRelationship[] }>('/process-catalog/flows'),
      ]);
      setTree(catalogRes.tree || []);
      setFlows(flowsRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load process data'));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const flowMap = useMemo(() => buildFlowMap(flows), [flows]);

  const filteredTree = useMemo(() => {
    if (hiddenLevels.size === 0) return tree;
    return filterTree(tree, hiddenLevels);
  }, [tree, hiddenLevels]);

  const toggleLevel = (level: NodeLevel) => {
    setHiddenLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.15, 2));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.15, 0.3));
  const handleZoomReset = () => setZoom(1);

  const handlePrint = () => {
    window.print();
  };

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <Page>
      {/* Print header - hidden on screen, shown on print */}
      <div className="print-header" style={{
        display: 'none',
        padding: '16px 0',
        borderBottom: '2px solid #0f4f46',
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0f4f46' }}>
          Procela — Process Hierarchy
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
          onClick={() => navigate('/processes')}
          style={{
            padding: '8px 16px', background: 'var(--color-surface)',
            color: 'var(--color-text)', border: '1px solid var(--color-border)',
            borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {'\u2190'} Back to Process Catalog
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
          display: 'flex', alignItems: 'center', gap: 4,
          marginLeft: 8,
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 6, padding: '2px 4px',
        }}>
          <button
            onClick={handleZoomOut}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, fontWeight: 700, color: 'var(--color-text)',
              padding: '4px 8px', borderRadius: 4,
            }}
            title="Zoom out"
          >
            -
          </button>
          <span style={{
            fontSize: 12, color: 'var(--color-text-secondary)',
            minWidth: 42, textAlign: 'center',
          }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, fontWeight: 700, color: 'var(--color-text)',
              padding: '4px 8px', borderRadius: 4,
            }}
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={handleZoomReset}
            style={{
              background: 'none', border: '1px solid var(--color-border)',
              borderRadius: 4, cursor: 'pointer',
              fontSize: 10, color: 'var(--color-text-muted)',
              padding: '3px 6px',
            }}
            title="Reset zoom"
          >
            Reset
          </button>
        </div>

        {/* Level filters */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginLeft: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>
            Show:
          </span>
          {ALL_OPTIONAL_LEVELS.map(level => {
            const config = LEVEL_VISUAL[level];
            const isHidden = hiddenLevels.has(level);
            return (
              <label
                key={level}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, cursor: 'pointer',
                  padding: '2px 6px', borderRadius: 4,
                  background: isHidden ? '#f1f5f9' : config.bg,
                  color: isHidden ? '#94a3b8' : config.border,
                  border: `1px solid ${isHidden ? '#e2e8f0' : config.border + '44'}`,
                  opacity: isHidden ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={() => toggleLevel(level)}
                  style={{ width: 12, height: 12, margin: 0 }}
                />
                {config.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Color legend */}
      <div className="viz-controls" style={{
        display: 'flex', gap: 6, marginBottom: 16,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>
          Legend:
        </span>
        {(Object.entries(LEVEL_VISUAL) as [NodeLevel, typeof LEVEL_VISUAL[NodeLevel]][]).map(([level, config]) => (
          <div
            key={level}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 4,
              background: config.bg, color: config.border,
              fontSize: 10, fontWeight: 500,
              borderLeft: `3px solid ${config.border}`,
              opacity: hiddenLevels.has(level) ? 0.35 : 1,
            }}
          >
            {config.icon} {config.label}
          </div>
        ))}
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
          <Spinner center label="Loading…" />
        ) : error ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '4rem', gap: 12,
          }}>
            <div style={{ color: 'var(--color-error, #dc2626)', fontSize: 14 }}>
              {error}
            </div>
            <button
              onClick={fetchData}
              style={{
                padding: '6px 16px', background: 'var(--color-primary)',
                color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : filteredTree.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '4rem', gap: 12,
          }}>
            <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
              No process hierarchy to visualize.
            </div>
            <button
              onClick={() => navigate('/processes')}
              style={{
                padding: '8px 16px', background: 'var(--color-primary)',
                color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Go to Process Catalog
            </button>
          </div>
        ) : (
          <div
            className="viz-scroll-area"
            style={{
              overflow: 'auto', padding: 24,
            }}
          >
            <div ref={printFitRef} style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              transition: 'transform 0.15s ease',
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 32,
              minWidth: 'fit-content',
            }}>
              {filteredTree.map(rootNode => (
                <VisualNode key={rootNode.id} node={rootNode} flowMap={flowMap} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Print footer - hidden on screen, shown on print */}
      <div className="print-footer" style={{
        display: 'none',
        padding: '12px 0',
        borderTop: '1px solid #cbd5e1',
        marginTop: 24,
        fontSize: 10, color: '#94a3b8',
        textAlign: 'center',
      }}>
        Generated by Procela | {today}
      </div>
    </Page>
  );
}
