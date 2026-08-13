import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SecondaryButton from '../components/SecondaryButton';
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'diagram'>('cards');
  // Per-type visibility — lets the user hide/show whole lanes (Processes,
  // Systems, Domains, …) in both the cards and diagram views, on top of
  // the preset filter.
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const toggleType = (type: string) => setHiddenTypes((prev) => {
    const next = new Set(prev);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: { nodes: GraphNode[]; edges: GraphEdge[] }; summary: Summary }>(`/enterprise-view${query}`);
      if (res.data) {
        setNodes(res.data.nodes || []);
        setEdges(res.data.edges || []);
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load enterprise view');
    }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const preset = VIEW_PRESETS[activeView] || VIEW_PRESETS.all;

  // Open the active preset's entity sections by default (on first load and
  // whenever the preset changes) so the catalog shows content immediately
  // instead of a wall of collapsed sections.
  useEffect(() => {
    setExpandedCols(new Set(COLUMN_ORDER.filter((t) => preset.entityTypes.has(t))));
  }, [activeView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter by active preset, then by the user's per-type visibility.
  // countByType is taken pre-hidden so the toggle chips keep showing each
  // type's real count even while it's hidden.
  const presetNodes = nodes.filter((n) => preset.entityTypes.has(n.type));
  const countByType: Record<string, number> = {};
  for (const n of presetNodes) countByType[n.type] = (countByType[n.type] || 0) + 1;
  const filteredNodes = presetNodes.filter((n) => !hiddenTypes.has(n.type));
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


  const presetTypes = COLUMN_ORDER.filter((t) => preset.entityTypes.has(t));
  // Types actually rendered as lanes/columns — preset types minus any the
  // user has toggled off.
  const visibleTypes = presetTypes.filter((t) => !hiddenTypes.has(t));

  return (
    <div>
      {/* Toolbar — spans full width above the catalog / impact split */}
      <PageHeader
        title="Enterprise View"
        subtitle="See how processes, systems, data assets, domains, and people connect across the enterprise."
      >
        <HelpPopover id="enterprise-view-intro" title="Enterprise View" showInitially>
          See all processes, systems, assets, domains, and people in one place.
          Click a category to expand it, then click an item to run impact analysis — a panel
          shows every entity connected to your selection.
        </HelpPopover>
      </PageHeader>

      {/* View selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {Object.entries(VIEW_PRESETS).map(([key, v]) => (
          <button key={key}
            onClick={() => { setActiveView(key); setSelected(null); }}
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

      {/* Active view meta + display-mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', fontSize: 13, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{preset.label}</span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{preset.description}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-muted)' }}>
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
                padding: '4px 14px', fontSize: 12, fontWeight: viewMode === mode ? 600 : 400,
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

      {/* Entity-type visibility — hide/show a whole lane (Processes,
          Systems, Domains, …) in both views. Chips reflect the active
          preset; clicking one toggles that type off/on. */}
      {presetTypes.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginRight: 2 }}>Show:</span>
          {presetTypes.map((type) => {
            const cfg = TYPE_CONFIG[type];
            if (!cfg) return null;
            const on = !hiddenTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                aria-pressed={on}
                title={`${on ? 'Hide' : 'Show'} ${cfg.plural}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  border: `1px solid ${on ? cfg.color : 'var(--color-border)'}`,
                  background: on ? cfg.bg : 'var(--color-surface)',
                  color: on ? cfg.color : 'var(--color-text-muted)',
                  textDecoration: on ? 'none' : 'line-through',
                }}
              >
                <span style={{ display: 'inline-flex', opacity: on ? 1 : 0.5 }}>{cfg.icon(13)}</span>
                {cfg.plural}
                <span style={{ fontWeight: 400, opacity: 0.8 }}>({countByType[type] || 0})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Catalog + impact split. The page scrolls normally; the impact
          panel sticks so it stays visible while scrolling the catalog,
          and it only takes up space when a node is actually selected. */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {nodes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
                No entities found. Create processes, systems, and data assets to see the enterprise view.
              </p>
            </div>
          ) : viewMode === 'diagram' ? (
            <EnterpriseDiagram
              nodes={filteredNodes}
              edges={filteredEdges}
              selected={selected}
              impactSet={impactSet}
              onSelect={(n) => selectNode(n as GraphNode)}
              typeConfig={TYPE_CONFIG}
              columnOrder={visibleTypes}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!selected && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '2px' }}>
                  Tip: click any item to trace its full dependency chain across the enterprise.
                </div>
              )}
              {/* One expandable card per entity type — the count lives in the
                  header, and expanding reveals the items inline. This merges
                  the old summary-card row and section bars into a single
                  control per category. */}
              {visibleTypes.map((type) => {
                const cfg = TYPE_CONFIG[type];
                const items = byType[type] || [];
                const isOpen = expandedCols.has(type);
                const disabled = items.length === 0;
                return (
                  <Card key={type} padding={0} style={{ overflow: 'hidden', borderLeft: `4px solid ${cfg.color}` }}>
                    <div
                      {...clickable(() => !disabled && toggleCol(type), { label: `Toggle ${cfg.plural}`, disabled })}
                      aria-expanded={disabled ? undefined : isOpen}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                        cursor: disabled ? 'default' : 'pointer', userSelect: 'none', opacity: disabled ? 0.55 : 1,
                      }}
                    >
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        background: cfg.bg, color: cfg.color, border: `1.5px solid ${cfg.color}44`,
                      }}>
                        {cfg.icon(15)}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{cfg.plural}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: cfg.color }}>{items.length}</span>
                      {!disabled && (
                        <ChevronDown
                          size={18}
                          style={{
                            marginLeft: 'auto', color: 'var(--color-text-muted)',
                            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s',
                          }}
                        />
                      )}
                    </div>

                    {isOpen && !disabled && (
                      <div style={{ borderTop: '1px solid var(--color-border)', padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
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
                                  {n.meta.description || n.meta.level || n.meta.systemType || n.meta.email || '—'}
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
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Impact analysis — only mounted when a node is selected, so the
            catalog gets the full width otherwise. Sticks while scrolling. */}
        {selected && (
          <Card padding={16} style={{ width: 320, flexShrink: 0, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
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
              <SecondaryButton onClick={() => setSelected(null)} aria-label="Close impact panel" style={{ padding: '4px 8px' }}>
                <X size={14} />
              </SecondaryButton>
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
                    const direction = e.source === selected.id ? '→' : '←';
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
          </Card>
        )}
      </div>
    </div>
  );
}
