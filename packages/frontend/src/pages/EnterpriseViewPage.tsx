import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import { useTierLabel } from '../lib/governanceTier';
import { useOrgContext } from '../stores/orgContext';
import { getStatusColor } from '../lib/statusBadge';
import { clickable } from '../lib/a11y';
import { badgeColor } from '../lib/badgeColors';
import HelpPopover from '../components/HelpPopover';
import EnterpriseDiagram from '../components/EnterpriseDiagram';
import { renderNavIcon } from '../components/navIcons';

// ── Types ──

interface GraphNode {
  id: string;
  type: 'process' | 'system' | 'data-asset' | 'person' | 'domain';
  label: string;
  status?: string;
  meta: Record<string, any>;
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

// Each type's icon is a callable that returns the same SVG the
// sidebar uses for the corresponding route \u2014 Processes, Systems,
// Data Assets, Domains, People. Previously this map hard-coded
// Unicode glyphs (\u2630 \u2699 \u26C1 \u2637 \u263B) which didn't match the sidebar's
// line-art icon set; the Enterprise View header, the summary
// cards, the diagram, and the detail-panel chip all render one
// of these, so every visual reference to a menu item stayed
// consistent with the rail entry after we switched.
const TYPE_CONFIG: Record<string, { color: string; bg: string; icon: (size: number) => React.ReactNode; label: string; plural: string; route: string }> = {
  process:      { color: '#2563eb', bg: '#dbeafe', route: '/processes',    icon: (size) => renderNavIcon('/processes',    { size, strokeWidth: 1.8 }), label: 'Process',    plural: 'Processes' },
  system:       { color: '#7c3aed', bg: '#ede9fe', route: '/systems',      icon: (size) => renderNavIcon('/systems',      { size, strokeWidth: 1.8 }), label: 'System',     plural: 'Systems' },
  'data-asset': { color: '#059669', bg: '#d1fae5', route: '/data-assets',  icon: (size) => renderNavIcon('/data-assets',  { size, strokeWidth: 1.8 }), label: 'Data Asset', plural: 'Data Assets' },
  // Palette entries stay hex on purpose — they're tied to the
  // companion bg colour and shouldn't drift if a semantic
  // variable is retuned. See design-audit PR 3/5.
  domain:       { color: '#dc2626', bg: '#fee2e2', route: '/data-domains', icon: (size) => renderNavIcon('/data-domains', { size, strokeWidth: 1.8 }), label: 'Domain',     plural: 'Domains' },
  person:       { color: '#d97706', bg: '#fef3c7', route: '/people',       icon: (size) => renderNavIcon('/people',       { size, strokeWidth: 1.8 }), label: 'Person',     plural: 'People' },
};

const COLUMN_ORDER: string[] = ['process', 'system', 'data-asset', 'domain', 'person'];

// Preset views — each defines which entity types to show and which edge types matter
interface ViewPreset {
  label: string;
  description: string;
  entityTypes: Set<string>;
  edgeTypes: Set<string>;
}

const VIEW_PRESETS: Record<string, ViewPreset> = {
  all: {
    label: 'Everything',
    description: 'All entities and relationships',
    entityTypes: new Set(['process', 'system', 'data-asset', 'domain', 'person']),
    edgeTypes: new Set(['hierarchy', 'hosted-by', 'owned-by', 'mapping', 'governs', 'lineage']),
  },
  'process-system-data': {
    label: 'Process → System → Data',
    description: 'How processes connect to systems and the data they hold',
    entityTypes: new Set(['process', 'system', 'data-asset']),
    edgeTypes: new Set(['hierarchy', 'hosted-by', 'mapping']),
  },
  'process-data': {
    label: 'Process → Data Mappings',
    description: 'Which data assets each process consumes or produces',
    entityTypes: new Set(['process', 'data-asset']),
    edgeTypes: new Set(['hierarchy', 'mapping']),
  },
  'system-data': {
    label: 'System → Data Assets',
    description: 'Which data lives in which system',
    entityTypes: new Set(['system', 'data-asset']),
    edgeTypes: new Set(['hosted-by', 'lineage']),
  },
  governance: {
    label: 'Governance',
    description: 'Domains, assets, and their owners',
    entityTypes: new Set(['domain', 'data-asset', 'person']),
    edgeTypes: new Set(['governs', 'owned-by']),
  },
  ownership: {
    label: 'Ownership & People',
    description: 'Who owns what across processes, assets, and domains',
    entityTypes: new Set(['process', 'data-asset', 'domain', 'person']),
    edgeTypes: new Set(['owned-by']),
  },
  lineage: {
    label: 'Data Lineage',
    description: 'How data flows between systems',
    entityTypes: new Set(['system', 'data-asset']),
    edgeTypes: new Set(['lineage', 'hosted-by']),
  },
};

// ── Component ──

export default function EnterpriseViewPage() {
  const { activeOrgId } = useOrgContext();
  const tierLabel = useTierLabel();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'diagram'>('cards');

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: { nodes: GraphNode[]; edges: GraphEdge[] }; summary: Summary }>(`/enterprise-view${query}`);
      if (res.data) {
        setNodes(res.data.nodes || []);
        setEdges(res.data.edges || []);
      }
      setSummary(res.summary || null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load enterprise view');
    }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const preset = VIEW_PRESETS[activeView] || VIEW_PRESETS.all;

  // Filter nodes and edges by active preset
  const filteredNodes = nodes.filter((n) => preset.entityTypes.has(n.type));
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) =>
    preset.edgeTypes.has(e.type) && filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
  );

  // Group visible nodes by type
  const byType: Record<string, GraphNode[]> = {};
  for (const col of COLUMN_ORDER) byType[col] = [];
  for (const n of filteredNodes) {
    if (byType[n.type]) byType[n.type].push(n);
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Impact analysis BFS — uses filtered edges so it respects the active view
  const impactSet = new Set<string>();
  if (selected) {
    const queue = [selected.id];
    impactSet.add(selected.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of filteredEdges) {
        if (e.source === current && !impactSet.has(e.target)) {
          impactSet.add(e.target); queue.push(e.target);
        }
        if (e.target === current && !impactSet.has(e.source)) {
          impactSet.add(e.source); queue.push(e.source);
        }
      }
    }
  }

  // Group impacted nodes by type for the sidebar
  const impactByType: Record<string, GraphNode[]> = {};
  if (selected) {
    for (const id of impactSet) {
      if (id === selected.id) continue;
      const n = nodeMap.get(id);
      if (!n) continue;
      if (!impactByType[n.type]) impactByType[n.type] = [];
      impactByType[n.type].push(n);
    }
  }

  // Direct connections for the selected node
  const directEdges = selected
    ? filteredEdges.filter((e) => e.source === selected.id || e.target === selected.id)
    : [];

  const toggleCol = (type: string) => {
    setExpandedCols((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const selectNode = (n: GraphNode) => {
    setSelected((prev) => prev?.id === n.id ? null : n);
  };

  if (loading) {
    return (
      <div>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <SkeletonRows rows={5} columns={4} />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <PageHeader title="Enterprise View" />
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: 24, textAlign: 'center',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: 'var(--color-text-muted)' }}><AlertTriangle size={32} strokeWidth={1.8} /></div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn't load enterprise view</div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 16 }}>{loadError}</div>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            style={{ padding: '8px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const cardStyle = (type: string, count: number): React.CSSProperties => {
    const cfg = TYPE_CONFIG[type];
    return {
      flex: 1, minWidth: 140, padding: '14px 16px', borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface)', border: `1px solid var(--color-border)`,
      borderLeft: `4px solid ${cfg.color}`,
      cursor: count > 0 ? 'pointer' : 'default',
    };
  };

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
      <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0 }}>
      {/* Main content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px 20px 0' }}>
        {/* Header */}
        <PageHeader
          title="Enterprise View"
          subtitle="See how processes, systems, data assets, domains, and people connect across the enterprise."
        >
          <HelpPopover id="enterprise-view-intro" title="Enterprise View" showInitially>
            See all processes, systems, assets, domains, and people in one place.
            Click any card to expand, then click an item to run impact analysis — the sidebar
            shows every entity connected to your selection.
          </HelpPopover>
        </PageHeader>

        {/* View selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {Object.entries(VIEW_PRESETS).map(([key, v]) => (
            <button key={key}
              onClick={() => {
                setActiveView(key);
                setSelected(null);
                // Auto-expand entity types in this preset
                setExpandedCols(new Set(
                  COLUMN_ORDER.filter((t) => VIEW_PRESETS[key].entityTypes.has(t)),
                ));
              }}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: activeView === key ? 600 : 400,
                cursor: 'pointer', border: `1px solid ${activeView === key ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: activeView === key ? 'var(--color-primary)' : 'var(--color-surface)',
                color: activeView === key ? '#fff' : 'var(--color-text)',
              }}
              title={v.description}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Active view description + display-mode toggle */}
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16, padding: '6px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{preset.label}:</span>
          <span>{preset.description}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11 }}>
            {filteredNodes.length} entities &middot; {filteredEdges.length} relationships
          </span>
          <div role="tablist" aria-label="Display mode" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 999, overflow: 'hidden', background: 'var(--color-surface)' }}>
            {(['cards', 'diagram'] as const).map((mode) => (
              <button
                key={mode}
                role="tab"
                aria-selected={viewMode === mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: viewMode === mode ? 600 : 400,
                  border: 'none', cursor: 'pointer',
                  background: viewMode === mode ? 'var(--color-primary)' : 'transparent',
                  color: viewMode === mode ? '#fff' : 'var(--color-text)',
                }}
              >
                {mode === 'cards' ? 'Cards' : 'Diagram'}
              </button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        {summary && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            {COLUMN_ORDER.filter((t) => preset.entityTypes.has(t)).map((type) => {
              const cfg = TYPE_CONFIG[type];
              const count = byType[type]?.length || 0;
              const isOpen = expandedCols.has(type);
              return (
                <div key={type} style={cardStyle(type, count)}
                  {...clickable(() => toggleCol(type), { label: `Expand ${cfg.plural}`, disabled: count === 0 })}
                  aria-expanded={count > 0 ? isOpen : undefined}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: cfg.color }}>{count}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>{cfg.plural}</div>
                    </div>
                    <span style={{ opacity: 0.4, display: 'inline-flex' }}>{cfg.icon(20)}</span>
                  </div>
                  {count > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
                      {isOpen ? '\u25BC Collapse' : '\u25B6 Expand to view'}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Relationships card */}
            <div style={{ flex: 1, minWidth: 140, padding: '14px 16px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: '4px solid #64748b' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#64748b' }}>{filteredEdges.length}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>Relationships</div>
                </div>
                <span style={{ fontSize: 20, opacity: 0.4 }}>{'\u2194'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Diagram view */}
        {viewMode === 'diagram' && (
          <EnterpriseDiagram
            nodes={filteredNodes}
            edges={filteredEdges}
            selected={selected}
            impactSet={impactSet}
            onSelect={(n) => selectNode(n as GraphNode)}
            typeConfig={TYPE_CONFIG}
            columnOrder={COLUMN_ORDER.filter((t) => preset.entityTypes.has(t))}
          />
        )}

        {/* Cards view — grouped columns, each entity type as an expandable section */}
        {viewMode === 'cards' && COLUMN_ORDER.filter((t) => preset.entityTypes.has(t)).map((type) => {
          const cfg = TYPE_CONFIG[type];
          const items = byType[type] || [];
          const isOpen = expandedCols.has(type);
          if (items.length === 0) return null;
          return (
            <div key={type} style={{ marginBottom: 16 }}>
              {/* Section header */}
              <div
                {...clickable(() => toggleCol(type), { label: `Toggle ${cfg.plural} section` })}
                aria-expanded={isOpen}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: cfg.bg, borderRadius: 'var(--radius-md)',
                  cursor: 'pointer', userSelect: 'none',
                  border: `1px solid ${cfg.color}22`,
                }}
              >
                <span style={{ fontSize: 10, color: cfg.color }}>{isOpen ? '\u25BC' : '\u25B6'}</span>
                <span style={{ display: 'inline-flex', color: cfg.color }}>{cfg.icon(16)}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: cfg.color }}>{cfg.plural}</span>
                <span style={{ fontSize: 12, color: cfg.color, opacity: 0.6, marginLeft: 4 }}>({items.length})</span>
              </div>

              {/* Items */}
              {isOpen && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, padding: '10px 0 0 0' }}>
                  {items.map((n) => {
                    const isSelected = selected?.id === n.id;
                    const isImpacted = selected && impactSet.has(n.id) && !isSelected;
                    const isDimmed = selected && !impactSet.has(n.id);
                    const statusColor = n.status ? getStatusColor(n.status) : null;
                    return (
                      <div key={n.id}
                        {...clickable(() => selectNode(n), { label: `Select ${n.label}` })}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '10px 12px', borderRadius: 'var(--radius-md)',
                          background: isSelected ? cfg.bg : 'var(--color-surface)',
                          border: `1px solid ${isSelected ? cfg.color : isImpacted ? cfg.color + '66' : 'var(--color-border)'}`,
                          cursor: 'pointer', opacity: isDimmed ? 0.35 : 1,
                          boxShadow: isSelected ? `0 0 0 2px ${cfg.color}33` : 'none',
                          transition: 'opacity 0.15s, border-color 0.15s',
                          animation: isImpacted ? 'nodeGlow 2s ease-in-out infinite' : 'none',
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = cfg.color + '88'; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = isImpacted ? cfg.color + '66' : 'var(--color-border)'; }}
                      >
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: cfg.bg, color: cfg.color, fontSize: 14,
                          border: `1.5px solid ${cfg.color}44`,
                        }}>
                          {cfg.icon(16)}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {n.label}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                            {n.meta.description || n.meta.level || n.meta.systemType || n.meta.email || '\u2014'}
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                            {statusColor && (
                              <span style={{
                                fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                                background: statusColor.bg, color: statusColor.color,
                              }}>
                                {(n.status || '').replace('_', ' ')}
                              </span>
                            )}
                            {n.meta.governanceTier && (() => {
                              const c = badgeColor('tier', n.meta.governanceTier);
                              return (
                                <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: c.bg, color: c.color }}>
                                  {tierLabel(n.meta.governanceTier)}
                                </span>
                              );
                            })()}
                            {n.meta.healthScore != null && (() => {
                              const c = badgeColor('health', n.meta.healthScore);
                              return (
                                <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: c.bg, color: c.color }}>
                                  {n.meta.healthScore}% health
                                </span>
                              );
                            })()}
                            {n.meta.rulesCount > 0 && (
                              <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>
                                {n.meta.rulesCount} rules
                              </span>
                            )}
                            {n.meta.role && (
                              <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>
                                {n.meta.role.replace('_', ' ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {nodes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
              No entities found. Create processes, systems, and data assets to see the enterprise view.
            </p>
          </div>
        )}
      </div>

      {/* Sidebar — impact analysis panel */}
      <div style={{
        width: 320, flexShrink: 0, background: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)', padding: 16, overflowY: 'auto',
      }}>
        {!selected ? (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Impact Analysis</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              Select any item to see its full dependency chain across the organization.
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginTop: 8 }}>
              Use this to understand the impact of changes — for example, if a system is being
              deprecated, you can see which processes, assets, and people are affected.
            </p>
            <div style={{ marginTop: 20, padding: 12, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', fontSize: 11, color: 'var(--color-text-muted)' }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>How to use</div>
              <div style={{ marginBottom: 4 }}>1. Expand a category by clicking a summary card</div>
              <div style={{ marginBottom: 4 }}>2. Click any item to select it</div>
              <div style={{ marginBottom: 4 }}>3. Connected items stay visible; unrelated items dim</div>
              <div>4. Browse the impact list here to see all dependencies</div>
            </div>
          </div>
        ) : (
          <div>
            {/* Selected node header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, borderRadius: '50%',
                  background: TYPE_CONFIG[selected.type]?.bg,
                  color: TYPE_CONFIG[selected.type]?.color,
                  fontSize: 14,
                }}>
                  {TYPE_CONFIG[selected.type]?.icon(16)}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{selected.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                    {TYPE_CONFIG[selected.type]?.label}
                  </div>
                </div>
              </div>
              <button onClick={() => setSelected(null)}
                style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                {'\u2715'}
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

            {/* Description */}
            {selected.meta.description && (
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
                {selected.meta.description}
              </p>
            )}

            {/* Meta details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
              {Object.entries(selected.meta).filter(([k]) => k !== 'description').map(([k, v]) => (
                v != null && v !== '' ? (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <span style={{ color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}</span>
                    <span style={{ fontWeight: 500, maxWidth: 160, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(v)}</span>
                  </div>
                ) : null
              ))}
            </div>

            {/* Direct connections */}
            {directEdges.length > 0 && (
              <>
                <h4 style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                  Direct Connections ({directEdges.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
                  {directEdges.map((e) => {
                    const otherId = e.source === selected.id ? e.target : e.source;
                    const other = nodeMap.get(otherId);
                    if (!other) return null;
                    const cfg = TYPE_CONFIG[other.type] || TYPE_CONFIG.process;
                    const direction = e.source === selected.id ? '\u2192' : '\u2190';
                    return (
                      <div key={e.id}
                        {...clickable(() => setSelected(other), { label: `Select ${other.label}` })}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                          borderRadius: 4, cursor: 'pointer', fontSize: 12,
                          background: 'var(--color-bg)',
                        }}
                        onMouseEnter={(ev) => { ev.currentTarget.style.background = cfg.bg; }}
                        onMouseLeave={(ev) => { ev.currentTarget.style.background = 'var(--color-bg)'; }}
                      >
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{direction}</span>
                        <span style={{ display: 'inline-flex', color: cfg.color }}>{cfg.icon(12)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{other.label}</div>
                          <div style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{e.label}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Full impact by type */}
            <h4 style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Full Impact ({impactSet.size - 1} entities)
            </h4>
            {impactSet.size <= 1 ? (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No dependencies found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {COLUMN_ORDER.map((type) => {
                  const items = impactByType[type];
                  if (!items || items.length === 0) return null;
                  const cfg = TYPE_CONFIG[type];
                  return (
                    <div key={type}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: cfg.color, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ display: 'inline-flex' }}>{cfg.icon(12)}</span> {cfg.plural} ({items.length})
                      </div>
                      {items.map((n) => (
                        <div key={n.id}
                          {...clickable(() => setSelected(n), { label: `Select ${n.label}` })}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                            borderRadius: 4, cursor: 'pointer', fontSize: 12,
                            borderLeft: `3px solid ${cfg.color}44`,
                            marginBottom: 2,
                          }}
                          onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--color-bg)'; }}
                          onMouseLeave={(ev) => { ev.currentTarget.style.background = ''; }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</div>
                          </div>
                          {n.status && (
                            <span style={{
                              fontSize: 8, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                              background: getStatusColor(n.status).bg,
                              color: getStatusColor(n.status).color,
                            }}>
                              {n.status.replace('_', ' ')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}
