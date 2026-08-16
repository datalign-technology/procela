import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
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
import EntityTypeFilter from '../components/EntityTypeFilter';
import { renderNavIcon } from '../components/navIcons';
import { exportEnterpriseDrawio } from '../lib/enterpriseDiagramExport';

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
  // The preset selector was removed; the view always shows everything, and
  // scope is dialed in with the Show-layer toggles + Include-governance.
  const [activeView] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'diagram'>('diagram');
  // Hide nodes with no relationships in the current view — lets users focus
  // on the connected core and drop dangling entities.
  const [hideUnconnected, setHideUnconnected] = useState(false);
  // Governance value streams (Data Governance Management, etc.) are excluded by
  // default so the view opens on the operational picture; flip this to fold
  // them back in. Same domain classifier the Process ↔ Data Map filters on.
  const [includeGovernance, setIncludeGovernance] = useState(false);
  // Cards-mode master-detail: a search box filters items by name, and a
  // summary-tile grid focuses one entity type (null = show all visible types).
  const [search, setSearch] = useState('');
  const [focusType, setFocusType] = useState<string | null>(null);
  // Per-type entity filter. For each entity type, `null` means "show all"
  // (the default, so a fresh view needn't enumerate every id); a Set means
  // "show only these ids"; an empty Set hides the type entirely. Drives the
  // EntityTypeFilter dropdowns in both cards and diagram views.
  const [selectedByType, setSelectedByType] = useState<Record<string, Set<string> | null>>({});
  const setTypeSelection = (type: string, sel: Set<string> | null) =>
    setSelectedByType((prev) => ({ ...prev, [type]: sel }));

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

  // Reset the Cards-mode focus and search whenever the preset changes, so a
  // type focused under one lens doesn't linger (possibly empty) under another.
  useEffect(() => {
    setFocusType(null);
    setSearch('');
  }, [activeView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter by active preset, then by governance toggle, then by the per-type
  // entity filter (the dropdowns).
  const presetNodes = nodes.filter((n) => preset.entityTypes.has(n.type));
  // Whether this preset surfaces any governance value streams — gates the
  // Include-governance toggle so it only appears when there's something to fold
  // in. A governance process node (and its process descendants) carry
  // meta.isGovernance from the backend.
  const hasGovernance = presetNodes.some((n) => n.type === 'process' && n.meta?.isGovernance);
  const govNodes = includeGovernance
    ? presetNodes
    : presetNodes.filter((n) => !(n.type === 'process' && n.meta?.isGovernance));
  // Options for each type's filter dropdown — every available entity of that
  // type (respecting the governance toggle), sorted by name.
  const optionsByType: Record<string, { id: string; label: string }[]> = {};
  for (const n of govNodes) (optionsByType[n.type] ||= []).push({ id: n.id, label: n.label });
  for (const t of Object.keys(optionsByType)) optionsByType[t].sort((a, b) => a.label.localeCompare(b.label));
  // Keep a node when its type is "all" (null) or its id is in the selected set.
  const nodeSelected = (n: GraphNode) => {
    const sel = selectedByType[n.type];
    return sel == null || sel.has(n.id);
  };
  const typeVisibleNodes = govNodes.filter(nodeSelected);
  const typeVisibleIds = new Set(typeVisibleNodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) =>
    preset.edgeTypes.has(e.type) && typeVisibleIds.has(e.source) && typeVisibleIds.has(e.target),
  );
  // "Hide unconnected" drops nodes that have no edge in the current view. Edges
  // only ever connect two visible nodes, so the edge list is unaffected.
  const connectedIds = new Set<string>();
  for (const e of filteredEdges) { connectedIds.add(e.source); connectedIds.add(e.target); }
  const filteredNodes = hideUnconnected
    ? typeVisibleNodes.filter((n) => connectedIds.has(n.id))
    : typeVisibleNodes;

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
  // Types actually rendered as lanes/columns — those with at least one entity
  // still visible after the per-type filter.
  const visibleTypeSet = new Set<string>(typeVisibleNodes.map((n) => n.type));
  const visibleTypes = presetTypes.filter((t) => visibleTypeSet.has(t));

  // Cards-mode master-detail helpers. `effectiveFocus` guards against a
  // focused type that the current preset no longer includes; the search box
  // filters items by label.
  const effectiveFocus = focusType && visibleTypes.includes(focusType) ? focusType : null;
  const searchLc = search.trim().toLowerCase();
  const matchesSearch = (n: GraphNode) => !searchLc || n.label.toLowerCase().includes(searchLc);
  // Which types' items list in the left column: the focused one, or all
  // visible types when nothing is focused. A search always widens to all
  // visible types so matches aren't hidden behind the focus.
  const listTypes = effectiveFocus && !searchLc ? [effectiveFocus] : visibleTypes;

  // One entity row/card, reused for the focused list and the all-types list.
  const renderNode = (n: GraphNode) => {
    const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.process;
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
              <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: statusColor.bg, color: statusColor.color }}>
                {(n.status || '').replace('_', ' ')}
              </span>
            )}
            {n.meta.governanceTier && (() => {
              const c = badgeColor('tier', n.meta.governanceTier);
              return <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: c.bg, color: c.color }}>{tierLabel(n.meta.governanceTier)}</span>;
            })()}
            {n.meta.healthScore != null && (() => {
              const c = badgeColor('health', n.meta.healthScore);
              return <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: c.bg, color: c.color }}>{n.meta.healthScore}% health</span>;
            })()}
            {n.meta.rulesCount > 0 && (
              <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{n.meta.rulesCount} rules</span>
            )}
            {n.meta.role && (
              <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{n.meta.role.replace('_', ' ')}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

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

      {/* Filter bar — one dropdown per entity type. Pick exactly which
          processes / systems / assets / domains / people to show (search +
          multi-select); Clear hides a whole type. Applies to both cards and
          diagram. */}
      {presetTypes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginRight: 2 }}>Filter:</span>
          {presetTypes.map((type) => {
            const cfg = TYPE_CONFIG[type];
            const opts = optionsByType[type] || [];
            if (!cfg || opts.length === 0) return null;
            return (
              <EntityTypeFilter
                key={type}
                cfg={cfg}
                options={opts}
                selected={selectedByType[type] ?? null}
                onChange={(sel) => setTypeSelection(type, sel)}
              />
            );
          })}
        </div>
      )}

      {/* Controls: governance toggle · counts · export · display mode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', fontSize: 13, flexWrap: 'wrap' }}>
        {hasGovernance && (
          <button
            type="button"
            onClick={() => setIncludeGovernance((v) => !v)}
            aria-pressed={includeGovernance}
            title={includeGovernance
              ? 'Hide governance value streams (Data Governance Management, etc.)'
              : 'Show governance value streams (Data Governance Management, etc.)'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              border: `1px solid ${includeGovernance ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: includeGovernance ? 'var(--color-primary-light)' : 'var(--color-surface)',
              color: includeGovernance ? 'var(--color-primary)' : 'var(--color-text-muted)',
            }}
          >
            {includeGovernance ? '✓ ' : ''}Include governance
          </button>
        )}
        {viewMode === 'diagram' && (
          <button
            type="button"
            onClick={() => setHideUnconnected((v) => !v)}
            aria-pressed={hideUnconnected}
            title={hideUnconnected ? 'Show entities with no connections' : 'Hide entities with no connections'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              border: `1px solid ${hideUnconnected ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: hideUnconnected ? 'var(--color-primary-light)' : 'var(--color-surface)',
              color: hideUnconnected ? 'var(--color-primary)' : 'var(--color-text-muted)',
            }}
          >
            {hideUnconnected ? '✓ ' : ''}Hide unconnected
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {filteredNodes.length} entities &middot; {filteredEdges.length} relationships
        </span>
        {viewMode === 'diagram' && filteredNodes.length > 0 && (
          <button
            type="button"
            onClick={() => exportEnterpriseDrawio(filteredNodes, filteredEdges, TYPE_CONFIG, visibleTypes, 'enterprise-view')}
            title="Download this view as an editable .drawio file — opens in diagrams.net (free) for viewing and authoring, and exports to Visio (.vsdx) from there."
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              border: '1px solid var(--color-border)', borderRadius: 999,
              background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
            }}
          >
            Export diagram
          </button>
        )}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Search across every visible entity by name. */}
              <input
                type="text"
                aria-label="Search entities"
                placeholder="Search entities…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%', maxWidth: 360, border: '1px solid var(--color-border)', borderRadius: 6, padding: '7px 12px', fontSize: 13, background: 'var(--color-surface)' }}
              />

              {/* Summary tiles — count per type; click to focus that type's
                  list (click again to show all). Replaces the old Show-chips
                  row and the stacked accordion headers. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                {visibleTypes.map((type) => {
                  const cfg = TYPE_CONFIG[type];
                  const count = (byType[type] || []).length;
                  const active = effectiveFocus === type;
                  return (
                    <button key={type} type="button"
                      onClick={() => setFocusType(active ? null : type)}
                      aria-pressed={active}
                      title={active ? `Show all types` : `Show only ${cfg.plural}`}
                      style={{
                        font: 'inherit', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: 'var(--color-surface)',
                        borderTop: `1px solid ${active ? cfg.color : 'var(--color-border)'}`,
                        borderRight: `1px solid ${active ? cfg.color : 'var(--color-border)'}`,
                        borderBottom: `1px solid ${active ? cfg.color : 'var(--color-border)'}`,
                        borderLeft: `4px solid ${cfg.color}`,
                        borderRadius: 'var(--radius-md)', padding: '10px 12px',
                        boxShadow: active ? `0 0 0 2px ${cfg.color}33` : 'var(--shadow-sm)',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: cfg.bg, color: cfg.color, border: `1.5px solid ${cfg.color}44` }}>
                        {cfg.icon(16)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cfg.plural}</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: cfg.color }}>{count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Item list — the focused type, or all visible types grouped,
                  filtered by the search box. Click an item to trace its
                  dependencies in the panel on the right. */}
              {(() => {
                const groups = listTypes
                  .map((type) => ({ type, cfg: TYPE_CONFIG[type], items: (byType[type] || []).filter(matchesSearch) }))
                  .filter((g) => g.items.length > 0);
                if (groups.length === 0) {
                  return (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '12px 2px' }}>
                      {searchLc ? `No entities match “${search}”.` : 'No entities in this view.'}
                    </div>
                  );
                }
                return groups.map((g) => (
                  <div key={g.type}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 2px 6px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: g.cfg.color }}>
                      <span style={{ display: 'inline-flex' }}>{g.cfg.icon(13)}</span>
                      {g.cfg.plural}
                      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{g.items.length}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                      {g.items.map(renderNode)}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>

        {/* Impact analysis — a persistent right rail in Cards mode (with a
            prompt when nothing is selected); in Diagram mode it only mounts
            once a node is selected so the diagram keeps full width. Sticks
            while scrolling. */}
        {(viewMode === 'cards' || selected) && (
          <Card padding={16} style={{ width: 320, flexShrink: 0, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
            {!selected ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, padding: '4px 2px' }}>
                Select an entity on the left to trace its dependencies across the enterprise — its direct connections and full impact chain appear here.
              </div>
            ) : (<>
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
            </>)}
          </Card>
        )}
      </div>
    </div>
  );
}
