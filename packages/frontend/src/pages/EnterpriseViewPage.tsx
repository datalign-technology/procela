import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { apiClient } from '../api/client';
import {
  collapseProcessHierarchy,
  availableLevels,
  collapseBranch,
  LEVEL_PLURAL,
  type ProcessLevel,
} from '../lib/collapseHierarchy';
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

// Per-relationship (edge-type) display: a plain verb + a key colour, so the
// selection panel can group a node's links the way the mock does and a legend
// can explain the lines. Colours are a fixed key (not --color-* tokens).
const REL_META: Record<string, { label: string; color: string; dash?: string }> = {
  hierarchy:  { label: 'Contains',  color: '#9A9D9A' },
  'hosted-by':{ label: 'Hosted by', color: '#24508F' },
  governs:    { label: 'Governs',   color: '#A4262C' },
  'owned-by': { label: 'Owned by',  color: '#9A4A0E' },
  mapping:    { label: 'Uses',      color: '#364A5E', dash: 'dashed' },
  lineage:    { label: 'Lineage',   color: '#17604B', dash: 'dotted' },
};
const REL_ORDER = ['hierarchy', 'hosted-by', 'uses', 'mapping', 'governs', 'owned-by', 'lineage'];

// Title-case labels for the process-depth (drill) control.
const DEPTH_LABEL: Record<ProcessLevel, string> = {
  VALUE_STREAM: 'Value Streams',
  PROCESS: 'Processes',
  SUBPROCESS: 'Sub-processes',
  ACTIVITY: 'Activities',
};

// Process levels that can be linked to a data asset (mappings live at the
// activity level and below); higher levels drill down into the map instead.
const MAPPABLE_LEVELS = new Set(['ACTIVITY', 'TASK', 'EXECUTION']);

// Shared pill style for the detail-panel Connect / drill actions.
const connectLinkStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
  border: '1px solid var(--color-primary)', cursor: 'pointer',
  background: 'var(--color-primary-light)', color: 'var(--color-primary)',
  textDecoration: 'none',
};

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
  // Default to the Diagram (swim-lane) view — the layout the enterprise-view
  // board leads with. It draws every relationship, dimming the rest to
  // emphasise the selected item's links; Hide-unconnected and the type
  // filters trim it down. The Cards list stays a click away via the toggle.
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
  // Process drill depth. The tree renders down to `depthLevel`; anything deeper
  // collapses into its ancestor and its data/system edges roll up. `expandedIds`
  // is the per-branch override — a process drilled into while the rest stay
  // collapsed. Default to the deepest level so the view opens fully expanded
  // (today's behaviour) and drill-UP is the new opt-in.
  const [depthLevel, setDepthLevel] = useState<ProcessLevel>('ACTIVITY');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Toggle one process branch open/closed. Collapsing also drops descendants
  // from the set so re-expanding starts one level down again.
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) =>
      prev.has(id) ? collapseBranch(prev, id, edges) : new Set(prev).add(id),
    );

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

  // Collapse the process hierarchy to the chosen depth first (rolling edges up
  // to the nearest visible ancestor), then run the existing preset / governance
  // / per-type filters over the collapsed graph. Levels available for the drill
  // control come from the FULL node set so a segment doesn't vanish once you've
  // drilled past it.
  const { nodes: cNodes, edges: cEdges, expandControls } = useMemo(
    () => collapseProcessHierarchy(nodes, edges, depthLevel, expandedIds),
    [nodes, edges, depthLevel, expandedIds],
  );
  const processLevels = useMemo(() => availableLevels(nodes), [nodes]);

  // Reset the Cards-mode focus and search whenever the preset changes, so a
  // type focused under one lens doesn't linger (possibly empty) under another.
  useEffect(() => {
    setFocusType(null);
    setSearch('');
  }, [activeView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Changing the global depth clears per-branch expansions so the view is
  // predictable (a drilled-in branch doesn't linger under a different depth).
  useEffect(() => { setExpandedIds(new Set()); }, [depthLevel]);

  // A node that collapses out of view can't stay selected.
  useEffect(() => {
    if (selected && !cNodes.some((n) => n.id === selected.id)) setSelected(null);
  }, [cNodes, selected]);

  // Filter by active preset, then by governance toggle, then by the per-type
  // entity filter (the dropdowns).
  const presetNodes = cNodes.filter((n) => preset.entityTypes.has(n.type));
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
  const filteredEdges = cEdges.filter((e) =>
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

  const nodeMap = new Map(cNodes.map((n) => [n.id, n]));

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
  // Only the selected item's *direct* neighbours light up; everything else
  // greys out, so the map reads as "pick an item, see its links" (the
  // selected node included so it stays highlighted).
  const directSet = new Set<string>();
  if (selected) {
    directSet.add(selected.id);
    for (const e of directEdges) { directSet.add(e.source); directSet.add(e.target); }
  }
  // The selected node's links grouped by relationship (edge type), ordered by
  // REL_ORDER then anything else, for the panel.
  const directByRel: Array<{ type: string; meta: { label: string; color: string; dash?: string }; items: Array<{ node: GraphNode; dir: string; edgeLabel: string }> }> = [];
  if (selected) {
    const map = new Map<string, Array<{ node: GraphNode; dir: string; edgeLabel: string }>>();
    for (const e of directEdges) {
      const otherId = e.source === selected.id ? e.target : e.source;
      const other = nodeMap.get(otherId);
      if (!other) continue;
      (map.get(e.type) ?? map.set(e.type, []).get(e.type)!).push({ node: other, dir: e.source === selected.id ? '→' : '←', edgeLabel: e.label });
    }
    const types = Array.from(map.keys()).sort((a, b) => {
      const ia = REL_ORDER.indexOf(a), ib = REL_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    for (const t of types) directByRel.push({ type: t, meta: REL_META[t] || { label: t.replace(/-/g, ' '), color: '#5F6461' }, items: map.get(t)! });
  }
  // "Gaps in this view" — data assets in view with no owner and no domain.
  // A data-asset endpoint of an owned-by / governs edge means it has an owner
  // / domain respectively.
  const ownedAssetIds = new Set<string>();
  const domainedAssetIds = new Set<string>();
  for (const e of filteredEdges) {
    for (const end of [e.source, e.target]) {
      const nd = nodeMap.get(end);
      if (nd?.type !== 'data-asset') continue;
      if (e.type === 'owned-by') ownedAssetIds.add(end);
      if (e.type === 'governs') domainedAssetIds.add(end);
    }
  }
  const gapAssets = filteredNodes.filter((n) => n.type === 'data-asset' && !ownedAssetIds.has(n.id) && !domainedAssetIds.has(n.id));

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
    const isImpacted = selected && directSet.has(n.id) && !isSelected;
    const isDimmed = selected && !directSet.has(n.id);
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
          {/* Drill-into-this-branch affordance. Expand reveals this process's
              hidden children; collapse hides them again. */}
          {(() => {
            const ec = expandControls.get(n.id);
            if (!ec) return null;
            return (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleExpand(n.id); }}
                style={{
                  marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, color: 'var(--color-primary)',
                }}
              >
                {ec.state === 'expand'
                  ? `＋ ${ec.count} ${LEVEL_PLURAL[ec.childLevel]}`
                  : `− Hide ${LEVEL_PLURAL[ec.childLevel]}`}
              </button>
            );
          })()}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Toolbar — spans full width above the catalog / impact split */}
      <PageHeader
        title="Enterprise View"
        subtitle="See how processes, systems, data assets, domains, and people connect. Pick anything to trace it."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div role="tablist" aria-label="Display mode" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--color-surface)' }}>
              {(['cards', 'diagram'] as const).map((mode) => (
                <button
                  key={mode}
                  role="tab"
                  aria-selected={viewMode === mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    padding: '7px 14px', fontSize: 13, fontWeight: viewMode === mode ? 600 : 500,
                    border: 'none', cursor: 'pointer',
                    background: viewMode === mode ? 'var(--color-primary-light)' : 'transparent',
                    color: viewMode === mode ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  }}
                >
                  {mode === 'cards' ? 'Cards' : 'Diagram'}
                </button>
              ))}
            </div>
            {viewMode === 'diagram' && filteredNodes.length > 0 && (
              <button
                type="button"
                onClick={() => exportEnterpriseDrawio(filteredNodes, filteredEdges, TYPE_CONFIG, visibleTypes, 'enterprise-view')}
                title="Download this view as an editable .drawio file — opens in diagrams.net (free) and exports to Visio (.vsdx) from there."
                style={{ height: 40, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 8, fontSize: 14, fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}
              >
                Export diagram
              </button>
            )}
          </div>
        }
      >
        <HelpPopover id="enterprise-view-intro" title="Enterprise View" showInitially>
          See all processes, systems, assets, domains, and people in one place.
          Click a category to focus it, then click an item to trace its links — a panel
          lists everything it connects to, grouped by relationship.
        </HelpPopover>
      </PageHeader>

      {/* Filter bar — one white card (board E5): a "Show" label + a dropdown
          per entity type (search + multi-select; Clear hides a whole type),
          then the process-depth / governance / connection controls and the
          live counts. Applies to both Cards and Diagram. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '12px 16px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', fontSize: 13, flexWrap: 'wrap' }}>
        {presetTypes.length > 0 && (
          <>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginRight: 2 }}>Show</span>
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
            <span aria-hidden="true" style={{ width: 1, height: 24, background: 'var(--color-border-subtle)', margin: '0 4px' }} />
          </>
        )}
        {/* Process depth (drill up / drill down). Renders down to the chosen
            level; deeper nodes collapse into their ancestor with their data /
            system edges rolled up. Only offered when the catalog actually has
            more than one process level. */}
        {presetTypes.includes('process') && processLevels.length > 1 && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Process detail:</span>
            <div role="group" aria-label="Process detail" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 999, overflow: 'hidden', background: 'var(--color-surface)' }}>
              {processLevels.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setDepthLevel(lvl)}
                  aria-pressed={depthLevel === lvl}
                  title={`Show the process tree down to ${DEPTH_LABEL[lvl]}`}
                  style={{
                    padding: '3px 10px', fontSize: 11, fontWeight: depthLevel === lvl ? 600 : 400,
                    border: 'none', cursor: 'pointer',
                    background: depthLevel === lvl ? 'var(--color-primary)' : 'transparent',
                    color: depthLevel === lvl ? '#fff' : 'var(--color-text-secondary)',
                  }}
                >
                  {DEPTH_LABEL[lvl]}
                </button>
              ))}
            </div>
          </div>
        )}
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
              expandControls={expandControls}
              onToggleExpand={toggleExpand}
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
          <div style={{ width: 320, flexShrink: 0, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card padding={16}>
            {!selected ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, padding: '4px 2px' }}>
                Pick an entity on the left to trace it — its links appear here, grouped by relationship, and everything it isn't linked to greys out.
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {(() => {
                  const id = selected.id;
                  const href = selected.type === 'system' ? `/systems/${id}`
                    : selected.type === 'data-asset' ? `/data-assets/${id}`
                    : selected.type === 'person' ? `/people/${id}`
                    : selected.type === 'domain' ? `/data-domains?highlight=${id}`
                    : `/processes?highlight=${id}`;
                  return <Link to={href} style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none', whiteSpace: 'nowrap' }}>Open page</Link>;
                })()}
                <SecondaryButton onClick={() => setSelected(null)} aria-label="Close panel" style={{ padding: '4px 8px' }}>
                  <X size={14} />
                </SecondaryButton>
              </div>
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

            {/* Connect & drill actions — bridge from viewing a process/activity
                to authoring its data / system links. Activities (and levels
                below) deep-link to the Data Mapping editor prefilled to this
                node; higher levels open the Process ↔ Data Map to drill down.
                Expandable branches also get an inline expand/collapse here so
                the diagram's small caret isn't the only way to drill. */}
            {selected.type === 'process' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {MAPPABLE_LEVELS.has(selected.meta.level) ? (
                  <Link
                    to={`/processes/data-map?view=table&newFor=${selected.id}`}
                    style={connectLinkStyle}
                  >
                    Connect data / system →
                  </Link>
                ) : (
                  <Link to="/processes/data-map" style={connectLinkStyle}>
                    Open in Process ↔ Data Map →
                  </Link>
                )}
                {(() => {
                  const ec = expandControls.get(selected.id);
                  if (!ec) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => toggleExpand(selected.id)}
                      style={{
                        ...connectLinkStyle,
                        background: 'var(--color-surface)',
                        color: 'var(--color-text-secondary)',
                        borderColor: 'var(--color-border)',
                      }}
                    >
                      {ec.state === 'expand'
                        ? `＋ ${ec.count} ${LEVEL_PLURAL[ec.childLevel]}`
                        : `− Hide ${LEVEL_PLURAL[ec.childLevel]}`}
                    </button>
                  );
                })()}
              </div>
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

            {/* Links grouped by relationship — the heart of the trace. */}
            {directByRel.length === 0 ? (
              <div style={{ padding: 14, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                No links recorded for this item in the current view.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {directByRel.map((grp) => (
                  <div key={grp.type}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                      <span style={{ width: 16, borderTop: `2px ${grp.meta.dash || 'solid'} ${grp.meta.color}` }} />
                      {grp.meta.label} <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{grp.items.length}</span>
                    </div>
                    <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
                      {grp.items.map(({ node, edgeLabel }) => (
                        <li key={node.id + grp.type} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <button type="button" onClick={() => setSelected(node)} title={`${node.label} — ${edgeLabel}`}
                            style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'baseline', padding: '6px 0 6px 24px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>{TYPE_CONFIG[node.type]?.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            </>)}
          </Card>

          {/* Gaps in this view — assets with no owner and no domain. */}
          {gapAssets.length > 0 && (
            <Card padding={16}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Gaps in this view</h2>
              <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, fontSize: 14 }}>
                {gapAssets.slice(0, 8).map((n, i) => (
                  <li key={n.id} style={{ padding: '8px 0', borderBottom: i === Math.min(gapAssets.length, 8) - 1 ? 'none' : '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <button type="button" onClick={() => { const nd = nodeMap.get(n.id); if (nd) setSelected(nd as GraphNode); }} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text)' }}>{n.label}</button>
                    <span style={{ fontSize: 12, color: 'var(--color-warning)', fontWeight: 600, flexShrink: 0 }}>No owner · no domain</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Relationship key — explains the line colours. */}
          <Card padding={16}>
            <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Relationship key</h2>
            <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, fontSize: 13, color: 'var(--color-text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
              {REL_ORDER.filter((t) => REL_META[t]).map((t) => (
                <li key={t} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 16, borderTop: `2px ${REL_META[t].dash || 'solid'} ${REL_META[t].color}` }} />
                  {REL_META[t].label}
                </li>
              ))}
            </ul>
          </Card>
          </div>
        )}
      </div>
    </div>
  );
}
