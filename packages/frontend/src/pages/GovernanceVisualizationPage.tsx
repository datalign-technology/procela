import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';

// ── Types ──

interface GroupMember {
  personId: string;
  personName?: string;
  groupRole: string;
  since: string;
}

interface GovernanceGroup {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  type: string;
  description: string;
  charter: string;
  status: 'ACTIVE' | 'INACTIVE';
  members: GroupMember[];
  children: GovernanceGroup[];
}

// ── Visual Config ──

const TYPE_VISUAL: Record<string, { bg: string; border: string; label: string }> = {
  COUNCIL:               { bg: '#dbeafe', border: '#1e40af', label: 'Council' },
  OFFICE:                { bg: '#ede9fe', border: '#5b21b6', label: 'Office' },
  COMMITTEE:             { bg: '#d1f0eb', border: '#0f4f46', label: 'Committee' },
  STEWARDSHIP_TEAM:      { bg: '#fef3c7', border: '#92400e', label: 'Stewardship Team' },
  WORKING_GROUP:         { bg: '#e0e7ff', border: '#3730a3', label: 'Working Group' },
  COMMUNITY_OF_PRACTICE: { bg: '#f1f5f9', border: '#64748b', label: 'Community of Practice' },
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  ACTIVE:   { bg: '#d1f0eb', color: '#0f4f46' },
  INACTIVE: { bg: '#f1f5f9', color: '#64748b' },
};

// ── Helper: find chair ──

function findChair(members: GroupMember[]): string | null {
  const chair = members.find((m) => m.groupRole === 'CHAIR');
  return chair?.personName || null;
}

// ── Print Styles ──

const PRINT_STYLE_ID = 'procela-gov-viz-print-styles';

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
      .gov-viz-controls {
        display: none !important;
      }

      /* Show print header/footer */
      .gov-print-header {
        display: block !important;
      }
      .gov-print-footer {
        display: block !important;
      }

      /* Make diagram fill page */
      .gov-viz-container {
        transform: none !important;
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
      }

      .gov-viz-scroll-area {
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
      }

      /* White background for print */
      body, .gov-viz-container, .gov-viz-scroll-area {
        background: white !important;
      }

      /* Ensure cards print properly */
      .gov-viz-card {
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

// ── Enrich tree with member names ──

async function enrichTree(tree: GovernanceGroup[], client: { get: (url: string) => Promise<any> }): Promise<GovernanceGroup[]> {
  // Fetch people to resolve member names
  const peopleMap = new Map<string, string>();
  try {
    const res = await client.get('/people');
    for (const p of (res as any).data || []) {
      peopleMap.set(p.id, p.name);
    }
  } catch { /* */ }

  function enrichNode(node: GovernanceGroup): GovernanceGroup {
    return {
      ...node,
      members: node.members.map((m) => ({
        ...m,
        personName: peopleMap.get(m.personId) || 'Unknown',
      })),
      children: node.children.map(enrichNode),
    };
  }

  return tree.map(enrichNode);
}

// ── Vertical Connector Line ──

function VerticalConnector() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'center',
      padding: '2px 0',
    }}>
      <div style={{
        width: 2, height: 24,
        background: '#cbd5e1',
      }} />
    </div>
  );
}

// ── Visual Card ──

function GovernanceCard({ group }: { group: GovernanceGroup }) {
  const config = TYPE_VISUAL[group.type] || TYPE_VISUAL.COMMUNITY_OF_PRACTICE;
  const statusStyle = STATUS_COLORS[group.status] || STATUS_COLORS.INACTIVE;
  const chair = findChair(group.members);

  return (
    <div
      className="gov-viz-card"
      style={{
        width: 260,
        background: config.bg,
        borderLeft: `3px solid ${config.border}`,
        borderRadius: 6,
        padding: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        flexShrink: 0,
      }}
    >
      {/* Type badge */}
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
          {config.label}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '1px 5px',
          borderRadius: 3, marginLeft: 'auto',
          background: statusStyle.bg, color: statusStyle.color,
        }}>
          {group.status === 'ACTIVE' ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Name */}
      <div style={{
        fontSize: 14,
        fontWeight: 600, color: '#1e293b',
        lineHeight: 1.3,
      }}>
        {group.name}
      </div>

      {/* Description */}
      {group.description && (
        <div style={{
          fontSize: 11, color: '#64748b',
          marginTop: 4, lineHeight: 1.4,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {group.description}
        </div>
      )}

      {/* Footer info */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginTop: 8, fontSize: 11, color: '#64748b',
      }}>
        <span style={{
          background: '#fff', padding: '1px 6px', borderRadius: 3,
          border: '1px solid #e2e8f0', fontWeight: 500,
        }}>
          {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
        </span>
        {chair && (
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            Chair: {chair}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Visual Node (recursive tree) ──

function VisualNode({ group }: { group: GovernanceGroup }) {
  const children = group.children || [];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <GovernanceCard group={group} />

      {children.length > 0 && (
        <>
          <VerticalConnector />
          {/* Horizontal branch line */}
          {children.length > 1 && (
            <div style={{
              display: 'flex', justifyContent: 'center',
              width: '100%', position: 'relative',
            }}>
              <div style={{
                position: 'absolute', top: 0,
                height: 2, background: '#cbd5e1',
                left: `calc(50% / ${children.length})`,
                right: `calc(50% / ${children.length})`,
              }} />
            </div>
          )}
          <div style={{
            display: 'flex', justifyContent: 'center',
            gap: 20, flexWrap: 'wrap',
          }}>
            {children.map((child) => (
              <div key={child.id} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
                {children.length > 1 && <VerticalConnector />}
                <VisualNode group={child} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ──

export default function GovernanceVisualizationPage() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName } = useOrgContext();
  const [tree, setTree] = useState<GovernanceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Inject print styles on mount
  useEffect(() => {
    ensurePrintStyles();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{
        success: boolean;
        tree: GovernanceGroup[];
      }>(`/governance-groups${qp}`);
      const enriched = await enrichTree(res.tree || [], apiClient);
      setTree(enriched);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load governance data'));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.15, 2));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.15, 0.3));
  const handleZoomReset = () => setZoom(1);

  const handlePrint = () => {
    window.print();
  };

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div>
      {/* Print header - hidden on screen, shown on print */}
      <div className="gov-print-header" style={{
        display: 'none',
        padding: '16px 0',
        borderBottom: '2px solid #0f4f46',
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0f4f46' }}>
          Procela — Data Governance Structure
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
      <div className="gov-viz-controls" style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 16, flexWrap: 'wrap',
      }}>
        <button
          onClick={() => navigate('/governance-groups')}
          style={{
            padding: '8px 16px', background: 'var(--color-surface)',
            color: 'var(--color-text)', border: '1px solid var(--color-border)',
            borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {'\u2190'} Back to Governance Groups
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
      </div>

      {/* Color legend */}
      <div className="gov-viz-controls" style={{
        display: 'flex', gap: 6, marginBottom: 16,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>
          Legend:
        </span>
        {(Object.entries(TYPE_VISUAL) as [string, typeof TYPE_VISUAL[string]][]).map(([type, config]) => (
          <div
            key={type}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 4,
              background: config.bg, color: config.border,
              fontSize: 10, fontWeight: 500,
              borderLeft: `3px solid ${config.border}`,
            }}
          >
            {config.label}
          </div>
        ))}
      </div>

      {/* Visualization container */}
      <div
        className="gov-viz-container"
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
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '4rem', color: 'var(--color-text-muted)',
          }}>
            Loading governance structure...
          </div>
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
        ) : tree.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '4rem', gap: 12,
          }}>
            <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
              No governance structure to visualize.
            </div>
            <button
              onClick={() => navigate('/governance-groups')}
              style={{
                padding: '8px 16px', background: 'var(--color-primary)',
                color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Go to Governance Groups
            </button>
          </div>
        ) : (
          <div
            className="gov-viz-scroll-area"
            style={{
              overflow: 'auto', padding: 24,
            }}
          >
            <div style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              transition: 'transform 0.15s ease',
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 32,
              minWidth: 'fit-content',
            }}>
              {tree.map((rootNode) => (
                <VisualNode key={rootNode.id} group={rootNode} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Print footer - hidden on screen, shown on print */}
      <div className="gov-print-footer" style={{
        display: 'none',
        padding: '12px 0',
        borderTop: '1px solid #cbd5e1',
        marginTop: 24,
        fontSize: 10, color: '#94a3b8',
        textAlign: 'center',
      }}>
        Generated by Procela | {today}
      </div>
    </div>
  );
}
