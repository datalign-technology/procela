// Phase 3 visualization — the bipartite Process ↔ Data map. Renders
// every activity in scope on the left, every mapped data asset on
// the right, and an SVG curve between each (activityId, assetId)
// mapping. Click either column to focus that node — connected rows
// highlight and unconnected ones fade.
//
// Why bipartite and not force-directed: business users want to
// answer two questions at a glance ("which assets does this step
// use?" and "which steps use this asset?"). A clean two-column
// layout makes both obvious; a force graph buries the answer in
// physics. Cost: it doesn't scale visually past a few hundred edges.
// At that point the filter (by parent process, by system) is the
// release valve.
//
// Orphan assets aren't shown — they have their own page. Activities
// with zero mappings are still listed (visible gap signal, also
// matches the dashboard's "unmapped activities" metric).

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import AttentionCards from '../components/AttentionCards';
import MappingsPage from './MappingsPage';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import EmptyState from '../components/EmptyState';
import Spinner from '../components/Spinner';
import { renderNavIcon } from '../components/navIcons';

interface Ancestor { id: string; name: string; level: string }
interface Activity {
  id: string;
  name: string;
  parentProcessId: string | null;
  parentProcessName: string | null;
  /** Root-first ancestor chain: Value Stream → Process → Sub-process. */
  path?: Ancestor[];
  systemIds: string[];
}

// One row in the left column: either a hierarchy header (a value stream /
// process / sub-process the activities below it roll up to) or an activity.
type LeftRow =
  | { kind: 'header'; id: string; name: string; level: string; depth: number; rowKey: string }
  | { kind: 'activity'; activity: Activity; depth: number };

// Human labels + styling per hierarchy level, so the headers read as a
// nested Value Stream → Process → Sub-process tree above each activity.
const LEVEL_STYLE: Record<string, { label: string; size: number; weight: number; color: string; upper?: boolean }> = {
  VALUE_STREAM: { label: 'Value Stream', size: 11, weight: 700, color: '#475569', upper: true },
  PROCESS:      { label: 'Process',      size: 10.5, weight: 600, color: '#334155' },
  SUBPROCESS:   { label: 'Sub-process',  size: 10, weight: 600, color: '#64748b' },
};

// Grouping levels the user can show/hide via chips. VALUE_STREAM / PROCESS /
// SUBPROCESS group the left (activities) column; DOMAIN groups the right
// (data assets) column. Keys match the ProcessNode level enum exactly.
const LEVEL_TOGGLES: Array<{ key: string; label: string; color: string }> = [
  { key: 'VALUE_STREAM', label: 'Value Streams', color: '#475569' },
  { key: 'PROCESS',      label: 'Processes',     color: '#334155' },
  { key: 'SUBPROCESS',   label: 'Sub-processes', color: '#64748b' },
  { key: 'DOMAIN',       label: 'Data Domains',  color: '#dc2626' },
];

// Turn the sorted activity list into left-column rows, inserting a header
// row each time an ancestor at a given depth changes. Deeper headers reset
// when a shallower one changes so a new value stream re-emits its processes.
// `hiddenLevels` drops whole grouping levels (e.g. Sub-process): the header
// and its indentation contribution disappear, so activities roll up only to
// the levels the user chose to display.
function buildLeftRows(activities: Activity[], hiddenLevels: Set<string>): LeftRow[] {
  const rows: LeftRow[] = [];
  const lastAtDepth: string[] = [];
  for (const a of activities) {
    const visiblePath = (a.path || []).filter((anc) => !hiddenLevels.has(anc.level));
    visiblePath.forEach((anc, depth) => {
      if (lastAtDepth[depth] !== anc.id) {
        rows.push({ kind: 'header', id: anc.id, name: anc.name, level: anc.level, depth, rowKey: `h-${anc.id}-${rows.length}` });
        lastAtDepth[depth] = anc.id;
        lastAtDepth.length = depth + 1; // forget deeper levels
      }
    });
    rows.push({ kind: 'activity', activity: a, depth: visiblePath.length });
  }
  return rows;
}
interface Asset {
  id: string;
  name: string;
  systemId: string;
  systemName: string | null;
  governanceTier: 'BRONZE' | 'SILVER' | 'GOLD';
  /** Data domain the asset rolls up to (null when ungrouped). */
  domainId?: string | null;
  domainName?: string | null;
}

interface Edge {
  mappingId: string;
  activityId: string;
  assetId: string;
  linkType: string;
}
interface GraphResponse {
  activities: Activity[];
  assets: Asset[];
  edges: Edge[];
  stats: {
    activityCount: number;
    assetCount: number;
    edgeCount: number;
    mappedActivityCount: number;
  };
}

// Per link-type cell marker for the matrix (board C4): a short code whose
// colour encodes direction — Reads (input) blue, Writes (output) green,
// Transforms outline, References dashed. The R/W hexes are the documented
// blue/green info-badge pairs (kept literal so they don't drift).
interface LinkMark { code: string; label: string; bg: string; fg: string; border?: string; dashed?: boolean }
const LINK_MARK: Record<string, LinkMark> = {
  consumes:   { code: 'R',   label: 'Reads (input)',   bg: '#E6EEF9', fg: '#24508F' },
  produces:   { code: 'W',   label: 'Writes (output)', bg: '#DCEFE5', fg: '#17604B' },
  transforms: { code: 'T',   label: 'Transforms',      bg: 'transparent', fg: 'var(--color-text-secondary)', border: 'var(--color-border)' },
  references: { code: 'Ref', label: 'References',       bg: 'transparent', fg: 'var(--color-text-secondary)', border: 'var(--color-border)', dashed: true },
};
// Legend / cell render order.
const LINK_MARK_ORDER = ['consumes', 'produces', 'transforms', 'references'];
// A neutral marker for a mapping whose link type is none of the four (so a
// mapping still reads as "linked" rather than silently showing an empty cell).
const NEUTRAL_MARK: LinkMark = { code: '•', label: 'Linked', bg: 'var(--color-primary-light)', fg: 'var(--color-primary)' };
// Resolve a stored link type to a marker. The field is a free string whose
// values vary by source — the mapping UI writes consumes/produces/transforms/
// references, while seeded/imported data uses INPUT/OUTPUT — so fold synonyms
// to one of the four directional markers (unknown → neutral).
function markFor(linkType: string): LinkMark {
  switch ((linkType || '').toLowerCase()) {
    case 'input': case 'consumes': case 'consume': case 'read': case 'reads':
      return LINK_MARK.consumes;
    case 'output': case 'produces': case 'produce': case 'write': case 'writes':
      return LINK_MARK.produces;
    case 'transform': case 'transforms':
      return LINK_MARK.transforms;
    case 'reference': case 'references': case 'ref':
      return LINK_MARK.references;
    default:
      return NEUTRAL_MARK;
  }
}

const TIER_PILL: Record<Asset['governanceTier'], { bg: string; fg: string; label: string }> = {
  BRONZE: { bg: '#FBE9D9', fg: '#9A4A0E', label: 'Bronze' },
  SILVER: { bg: '#E8ECF1', fg: '#475569', label: 'Silver' },
  GOLD:   { bg: '#FBF0DA', fg: '#8A6400', label: 'Gold' },
};

export default function ProcessDataMapPage() {
  const { activeOrgId, refreshKey } = useOrgContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Visual (the bridge) vs Table (the editable Data Mapping list). Default
  // to visual; persisted in ?view= so it's shareable and the retired
  // /mappings route can deep-link straight to the table.
  const viewMode: 'visual' | 'table' = searchParams.get('view') === 'table' ? 'table' : 'visual';
  const setViewMode = (m: 'visual' | 'table') => {
    const next = new URLSearchParams(searchParams);
    if (m === 'table') next.set('view', 'table'); else next.delete('view');
    setSearchParams(next, { replace: true });
  };
  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Toolbar slot on the Visual/Table toggle row — the embedded Table view
  // (MappingsPage) portals its toolbar here so it sits level with the toggle,
  // matching the other tabbed hubs instead of dropping onto a second row.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState<{ kind: 'activity' | 'asset'; id: string } | null>(null);
  const [systemFilter, setSystemFilter] = useState<string>('');
  const [includeGov, setIncludeGov] = useState(false);
  // Which grouping levels to display (Value Streams / Processes /
  // Sub-processes on the left, Data Domains on the right). A hidden level
  // drops its headers (and, for the hierarchy, its indentation).
  const [hiddenLevels, setHiddenLevels] = useState<Set<string>>(new Set());
  const toggleLevel = (lvl: string) => setHiddenLevels((prev) => {
    const next = new Set(prev);
    if (next.has(lvl)) next.delete(lvl); else next.add(lvl);
    return next;
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (activeOrgId) qs.set('orgId', activeOrgId);
      if (includeGov) qs.set('includeGovernance', '1');
      const res = await apiClient.get<{ success: boolean; data: GraphResponse }>(
        `/process-catalog/data-graph${qs.toString() ? `?${qs}` : ''}`,
      );
      setData(res.data);
    } catch (e) {
      setError(errorMessage(e, 'Failed to load process-data map'));
    }
  }, [activeOrgId, includeGov, refreshKey]);

  useEffect(() => { load(); }, [load]);

  // The visual always opens with focus mode off. `focus` starts null on
  // mount, but it would otherwise persist across a Visual → Table → Visual
  // round-trip (same component), so clearing it whenever the view changes
  // guarantees the visual lands unfocused every time.
  useEffect(() => { setFocus(null); }, [viewMode]);

  // Apply the system filter and compute layout. We keep activities
  // ordered by parent process for visual grouping; assets by system.
  const { activities, assets, edges, systemOptions } = useMemo(() => {
    if (!data) return { activities: [], assets: [], edges: [], systemOptions: [] as string[] };
    const allSystems = Array.from(
      new Set([
        ...data.assets.map((a) => a.systemName).filter(Boolean) as string[],
      ]),
    ).sort();
    let filteredEdges = data.edges;
    let filteredAssets = data.assets;
    let filteredActivities = data.activities;
    if (systemFilter) {
      filteredAssets = data.assets.filter((a) => a.systemName === systemFilter);
      const assetIds = new Set(filteredAssets.map((a) => a.id));
      filteredEdges = data.edges.filter((e) => assetIds.has(e.assetId));
      const activityIds = new Set(filteredEdges.map((e) => e.activityId));
      filteredActivities = data.activities.filter((a) => activityIds.has(a.id));
    }
    // Sort by the full ancestor path (Value Stream → Process → Sub-process)
    // then name, so activities under the same branch stay contiguous and
    // the header rows read as a clean tree.
    filteredActivities = [...filteredActivities].sort((a, b) => {
      const pa = (a.path || []).map((p) => p.name).join(' / ');
      const pb = (b.path || []).map((p) => p.name).join(' / ');
      if (pa !== pb) return pa.localeCompare(pb);
      return a.name.localeCompare(b.name);
    });
    // Group by data domain (null domains sort last), then by name, so the
    // right column reads as domain headers with their assets beneath.
    filteredAssets = [...filteredAssets].sort((a, b) => {
      const da = a.domainName || '￿';
      const db = b.domainName || '￿';
      if (da !== db) return da.localeCompare(db);
      return a.name.localeCompare(b.name);
    });
    return {
      activities: filteredActivities,
      assets: filteredAssets,
      edges: filteredEdges,
      systemOptions: allSystems,
    };
  }, [data, systemFilter]);

  // Left column laid out as hierarchy headers + activity rows.
  const leftRows = useMemo(() => buildLeftRows(activities, hiddenLevels), [activities, hiddenLevels]);
  // Which grouping levels actually exist in the data, so we only offer
  // chips that would do something.
  const presentLevels = useMemo(() => {
    const s = new Set<string>();
    for (const a of activities) for (const p of (a.path || [])) s.add(p.level);
    if (assets.some((a) => a.domainName)) s.add('DOMAIN');
    return s;
  }, [activities, assets]);

  // ── Matrix model (board C4) ──────────────────────────────────────────────
  // Assets become columns grouped by data domain; each activity row carries a
  // marker per asset it reads / writes / transforms / references.
  const showDomains = !hiddenLevels.has('DOMAIN');
  // Consecutive assets (already sorted by domain) folded into column groups.
  const domainGroups = useMemo(() => {
    if (!showDomains) return assets.length ? [{ name: '', assets }] : [];
    const groups: { name: string; assets: Asset[] }[] = [];
    let last: string | null | undefined;
    for (const a of assets) {
      const dom = a.domainName || null;
      if (groups.length === 0 || dom !== last) { groups.push({ name: dom || 'No domain', assets: [] }); last = dom; }
      groups[groups.length - 1].assets.push(a);
    }
    return groups;
  }, [assets, showDomains]);
  // (activityId|assetId) → linkType, first wins (one marker per cell).
  const edgeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of edges) { const k = `${e.activityId}|${e.assetId}`; if (!m.has(k)) m.set(k, e.linkType); }
    return m;
  }, [edges]);
  const usedAssetIds = useMemo(() => new Set(edges.map((e) => e.assetId)), [edges]);
  const colCount = 1 + assets.length;

  const focusedNodeIds = useMemo(() => {
    if (!focus) return new Set<string>();
    const ids = new Set<string>([focus.id]);
    for (const e of edges) {
      if (focus.kind === 'activity' && e.activityId === focus.id) ids.add(e.assetId);
      if (focus.kind === 'asset' && e.assetId === focus.id) ids.add(e.activityId);
    }
    return ids;
  }, [edges, focus]);

  // Activities with at least one mapped data asset. An activity NOT in this
  // set is a coverage gap — the map flags it inline (dashed attention-orange
  // outline + "No data" badge) so gaps read straight off the board, matching
  // the mock-ups and the Gap Detection story, instead of only as a footnote.
  const mappedActivityIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of edges) s.add(e.activityId);
    return s;
  }, [edges]);

  // "Needs attention" counts the board leads with (matching the mock-ups): the
  // two gaps the map exists to surface — activities carrying no data, and data
  // assets no activity uses. Each card jumps to where you fix it.
  const noDataActivityCount = useMemo(
    () => activities.filter((a) => !mappedActivityIds.has(a.id)).length,
    [activities, mappedActivityIds],
  );
  const unusedAssetCount = useMemo(() => {
    const used = new Set(edges.map((e) => e.assetId));
    return assets.filter((a) => !used.has(a.id)).length;
  }, [assets, edges]);

  return (
    <div>
      <PageHeader
        title="Process ↔ Data map"
        subtitle={viewMode === 'visual'
          ? 'Reconciliation matrix — activities down the side (grouped by value stream and process), data assets across the top (grouped by data domain). Each cell shows how the activity uses that asset: Reads, Writes, Transforms or References. Click an activity or asset to focus it.'
          : 'Flat, editable list of every activity ↔ data-asset mapping — bulk add / delete, a batch wizard, and orphan cleanup.'}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Table view portals its toolbar (wizard / export / add) here so
                it rides on the same row as the Visual/Table toggle. */}
            <div ref={setActionsSlot} style={{ display: 'flex', gap: 8, alignItems: 'center' }} />
          <div role="tablist" aria-label="View" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 999, overflow: 'hidden', background: 'var(--color-surface)' }}>
            {(['visual', 'table'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={viewMode === m}
                onClick={() => setViewMode(m)}
                style={{
                  padding: '4px 14px', fontSize: 12, fontWeight: viewMode === m ? 600 : 400,
                  border: 'none', cursor: 'pointer',
                  background: viewMode === m ? 'var(--color-primary)' : 'transparent',
                  color: viewMode === m ? '#fff' : 'var(--color-text)',
                }}
              >
                {m === 'visual' ? 'Visual' : 'Table'}
              </button>
            ))}
          </div>
          </div>
        }
      />

      {viewMode === 'table' && <MappingsPage embedded actionsPortal={actionsSlot} />}

      {viewMode === 'visual' && (
      <>
      {(activities.length > 0 || assets.length > 0) && (
        <AttentionCards
          caption="The two gaps this map exists to surface"
          minCardWidth={220}
          cards={[
            { key: 'noData', count: noDataActivityCount, label: 'Activities with no data', hint: 'Opens Gap Detection', priority: true,
              onClick: () => navigate('/gap-detection') },
            { key: 'unused', count: unusedAssetCount, label: 'Unused data assets', hint: 'Opens Data Assets → Unmapped',
              onClick: () => navigate('/data-assets?attention=unmapped') },
          ]}
        />
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '12px 0', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          System filter:&nbsp;
          <select
            value={systemFilter}
            onChange={(e) => { setSystemFilter(e.target.value); setFocus(null); }}
            style={{ fontSize: 12, padding: '3px 6px' }}
          >
            <option value="">All systems</option>
            {systemOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={includeGov}
            onChange={(e) => setIncludeGov(e.target.checked)}
          />
          Include governance activities
        </label>
        {focus && (
          <button
            type="button"
            onClick={() => setFocus(null)}
            style={{
              fontSize: 11, padding: '3px 10px', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer',
            }}
          >
            Clear focus
          </button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {LINK_MARK_ORDER.map((k) => {
            const mk = LINK_MARK[k];
            return (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 20, borderRadius: 4, fontSize: 10, fontWeight: 700, background: mk.bg, color: mk.fg, border: mk.border ? `1px ${mk.dashed ? 'dashed' : 'solid'} ${mk.border}` : undefined }}>{mk.code}</span>
                {mk.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Grouping toggles — pick which levels roll up the two columns.
          Only levels present in the data get a chip. */}
      {LEVEL_TOGGLES.some((l) => presentLevels.has(l.key)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginRight: 2 }}>Group by:</span>
          {LEVEL_TOGGLES.filter((l) => presentLevels.has(l.key)).map((l) => {
            const on = !hiddenLevels.has(l.key);
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => toggleLevel(l.key)}
                aria-pressed={on}
                title={`${on ? 'Hide' : 'Show'} ${l.label}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  border: `1px solid ${on ? l.color : 'var(--color-border)'}`,
                  background: on ? l.color : 'var(--color-surface)',
                  color: on ? '#fff' : 'var(--color-text-muted)',
                  textDecoration: on ? 'none' : 'line-through',
                }}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#7f1d1d', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {!data && !error && (
        <Spinner center label="Loading…" />
      )}

      {data && activities.length === 0 && assets.length === 0 && (
        <EmptyState
          icon={renderNavIcon('/processes/data-map')}
          title="Nothing to map yet"
          description="Once activities are mapped to data assets via the Process Catalog, they'll show up here as a connected graph."
        />
      )}

      {data && (activities.length > 0 || assets.length > 0) && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: '100%' }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--color-surface)', textAlign: 'left', padding: '12px 16px', minWidth: 300, borderBottom: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', verticalAlign: 'bottom', color: 'var(--color-text-muted)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Activity <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>&middot; grouped by value stream and process</span>
                </th>
                {showDomains
                  ? domainGroups.map((g, gi) => (
                      <th key={`dg-${gi}`} colSpan={g.assets.length} style={{ textAlign: 'left', padding: '10px 12px 6px', borderBottom: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{g.name}</th>
                    ))
                  : <th colSpan={assets.length} style={{ borderBottom: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)' }} />}
              </tr>
              <tr>
                {assets.map((a) => {
                  const unused = !usedAssetIds.has(a.id);
                  const tier = TIER_PILL[a.governanceTier];
                  const focused = focus?.kind === 'asset' && focus.id === a.id;
                  return (
                    <th key={a.id} style={{ textAlign: 'left', padding: '8px 12px 10px', borderBottom: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)', minWidth: 128, verticalAlign: 'top', background: focused ? 'var(--color-primary-light)' : 'var(--color-surface)' }}>
                      <button type="button" onClick={() => setFocus((f) => f?.kind === 'asset' && f.id === a.id ? null : { kind: 'asset', id: a.id })} style={{ display: 'block', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--color-text)', fontWeight: 600, fontSize: 13 }}>{a.name}</button>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 400 }}>{a.systemName || 'no system'}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, height: 22, padding: '0 8px', borderRadius: 11, fontSize: 11, fontWeight: 600, background: tier.bg, color: tier.fg }}><span style={{ width: 6, height: 6, borderRadius: 3, background: tier.fg }} />{tier.label}</span>
                      {unused && <span style={{ display: 'block', marginTop: 6, fontSize: 11, fontWeight: 600, color: 'var(--color-attention)' }}>Not used by any process</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {leftRows.map((row) => {
                if (row.kind === 'header') {
                  const st = LEVEL_STYLE[row.level];
                  return (
                    <tr key={row.rowKey}>
                      <td colSpan={colCount} style={{ padding: `10px 16px 6px ${16 + row.depth * 16}px`, background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>
                        <span style={{ color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginRight: 8 }}>{st ? st.label : row.level}</span>
                        <span style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 13 }}>{row.name}</span>
                      </td>
                    </tr>
                  );
                }
                const act = row.activity;
                const isGap = !mappedActivityIds.has(act.id);
                const actFocused = focus?.kind === 'activity' && focus.id === act.id;
                const dim = focus ? !focusedNodeIds.has(act.id) : false;
                return (
                  <tr key={act.id} style={{ opacity: dim ? 0.4 : 1 }}>
                    <td style={{ position: 'sticky', left: 0, background: actFocused ? 'var(--color-primary-light)' : 'var(--color-surface)', padding: `10px 16px 10px ${16 + row.depth * 16}px`, borderBottom: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)' }}>
                      <button type="button" onClick={() => setFocus((f) => f?.kind === 'activity' && f.id === act.id ? null : { kind: 'activity', id: act.id })} style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{act.name}</button>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>Activity</span>
                      {isGap && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4, height: 22, padding: '0 8px', borderRadius: 11, background: 'var(--color-attention-bg)', color: 'var(--color-attention)', fontSize: 11, fontWeight: 600 }}><span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--color-attention)' }} />No data linked</span>}
                    </td>
                    {assets.map((a) => {
                      const lt = edgeMap.get(`${act.id}|${a.id}`);
                      const mk = lt ? markFor(lt) : null;
                      return (
                        <td key={a.id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)', textAlign: 'center' }}>
                          {mk ? (
                            <span title={`${mk.label} — ${act.name} / ${a.name}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 26, height: 24, padding: '0 6px', borderRadius: 5, fontSize: 11, fontWeight: 700, background: mk.bg, color: mk.fg, border: mk.border ? `1px ${mk.dashed ? 'dashed' : 'solid'} ${mk.border}` : undefined }}>{mk.code}</span>
                          ) : (
                            <button type="button" aria-label={`Add mapping: ${act.name} and ${a.name}`} title={`Add mapping: ${act.name} and ${a.name}`} onClick={() => setViewMode('table')} style={{ width: 26, height: 24, border: '1px dashed var(--color-border)', background: 'transparent', borderRadius: 5, color: 'var(--color-text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: 0.55, fontSize: 14, lineHeight: 1 }}>+</button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.stats.activityCount > 0 && data.stats.mappedActivityCount < data.stats.activityCount && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
          {data.stats.activityCount - data.stats.mappedActivityCount}{' '}
          {data.stats.activityCount - data.stats.mappedActivityCount === 1 ? 'activity has' : 'activities have'} no
          mapped data assets yet.{' '}
          <Link to="/gap-detection">Open Gap Detection →</Link>
        </div>
      )}
      </>
      )}
    </div>
  );
}

