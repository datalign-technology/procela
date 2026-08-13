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
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
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

// One row in the right column: a data-domain header or an asset. Assets
// roll up under their domain the way activities roll up under processes.
type RightRow =
  | { kind: 'domain'; name: string; rowKey: string }
  | { kind: 'asset'; asset: Asset };

// `showDomains` false drops the domain header rows entirely — the assets
// just list flat (no domain grouping).
function buildRightRows(assets: Asset[], showDomains: boolean): RightRow[] {
  if (!showDomains) return assets.map((a) => ({ kind: 'asset' as const, asset: a }));
  const rows: RightRow[] = [];
  let lastDomain: string | null | undefined;
  for (const a of assets) {
    const dom = a.domainName || null;
    if (dom !== lastDomain) {
      rows.push({ kind: 'domain', name: dom || 'No domain', rowKey: `d-${dom ?? 'none'}-${rows.length}` });
      lastDomain = dom;
    }
    rows.push({ kind: 'asset', asset: a });
  }
  return rows;
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

// Colours per linkType. Matches the convention used on the mapping
// cards elsewhere in the app — green = produces, blue = consumes,
// purple = transforms, grey = references.
const LINK_COLOR: Record<string, string> = {
  produces:   '#059669',
  consumes:   '#2563eb',
  transforms: '#7c3aed',
  references: '#64748b',
};

const TIER_COLOR: Record<Asset['governanceTier'], string> = {
  BRONZE: '#92400e',
  SILVER: '#475569',
  GOLD:   '#b45309',
};

const ROW_HEIGHT = 36;
const COL_WIDTH = 280;
const GUTTER = 220;
const PADDING_Y = 60;

export default function ProcessDataMapPage() {
  const { activeOrgId, refreshKey } = useOrgContext();
  const [searchParams, setSearchParams] = useSearchParams();
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
  // Assets sit flush when domains are hidden; otherwise they indent under
  // their domain header. Used for the asset rects and the edge endpoints.
  const assetIndent = hiddenLevels.has('DOMAIN') ? 0 : 18;
  // Which grouping levels actually exist in the data, so we only offer
  // chips that would do something.
  const presentLevels = useMemo(() => {
    const s = new Set<string>();
    for (const a of activities) for (const p of (a.path || [])) s.add(p.level);
    if (assets.some((a) => a.domainName)) s.add('DOMAIN');
    return s;
  }, [activities, assets]);
  const activityY = useMemo(() => {
    const m = new Map<string, number>();
    leftRows.forEach((row, i) => {
      if (row.kind === 'activity') m.set(row.activity.id, PADDING_Y + i * ROW_HEIGHT);
    });
    return m;
  }, [leftRows]);
  // Right column laid out as data-domain headers + asset rows.
  const rightRows = useMemo(() => buildRightRows(assets, !hiddenLevels.has('DOMAIN')), [assets, hiddenLevels]);
  const assetY = useMemo(() => {
    const m = new Map<string, number>();
    rightRows.forEach((row, i) => {
      if (row.kind === 'asset') m.set(row.asset.id, PADDING_Y + i * ROW_HEIGHT);
    });
    return m;
  }, [rightRows]);

  const svgHeight = Math.max(leftRows.length, rightRows.length) * ROW_HEIGHT + PADDING_Y * 2;
  const svgWidth = COL_WIDTH * 2 + GUTTER;

  // Edges connected to the focused node — separate Set so we can
  // render them last (on top) and brighten them.
  const focusedEdges = useMemo(() => {
    if (!focus) return new Set<string>();
    return new Set(
      edges
        .filter((e) =>
          focus.kind === 'activity' ? e.activityId === focus.id : e.assetId === focus.id,
        )
        .map((e) => e.mappingId),
    );
  }, [edges, focus]);

  const focusedNodeIds = useMemo(() => {
    if (!focus) return new Set<string>();
    const ids = new Set<string>([focus.id]);
    for (const e of edges) {
      if (focus.kind === 'activity' && e.activityId === focus.id) ids.add(e.assetId);
      if (focus.kind === 'asset' && e.assetId === focus.id) ids.add(e.activityId);
    }
    return ids;
  }, [edges, focus]);

  return (
    <div>
      <PageHeader
        title="Process ↔ Data map"
        subtitle={viewMode === 'visual'
          ? 'Visual bridge between the business hierarchy and the catalog — activities grouped under their value stream, process and sub-process; data assets grouped under their data domain. Click an activity or asset to focus its connections.'
          : 'Flat, editable list of every activity ↔ data-asset mapping — bulk add / delete, a batch wizard, and orphan cleanup.'}
        actions={
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
        }
      />

      {viewMode === 'table' && <MappingsPage embedded />}

      {viewMode === 'visual' && (
      <>
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 11, color: 'var(--color-text-muted)' }}>
          {Object.entries(LINK_COLOR).map(([k, v]) => (
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 2, background: v, display: 'inline-block' }} /> {k}
            </span>
          ))}
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
        <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff' }}>
          <svg width={svgWidth} height={svgHeight} role="img" aria-label="Process to data asset map">
            {/* Column headers */}
            <text x={COL_WIDTH / 2} y={28} textAnchor="middle" fontSize={12} fontWeight={700} fill="#475569" style={{ textTransform: 'uppercase' }}>
              Activities
            </text>
            <text x={COL_WIDTH + GUTTER + COL_WIDTH / 2} y={28} textAnchor="middle" fontSize={12} fontWeight={700} fill="#475569" style={{ textTransform: 'uppercase' }}>
              Data assets
            </text>

            {/* Edges first so node rectangles sit on top. We split
                into dim + focused passes so the focused edges land
                above their neighbours, not just on top of nothing. */}
            {edges.map((e) => {
              const yA = activityY.get(e.activityId);
              const yB = assetY.get(e.assetId);
              if (yA == null || yB == null) return null;
              const isFocused = focusedEdges.has(e.mappingId);
              if (focus && !isFocused) {
                return (
                  <EdgePath key={e.mappingId} x1={COL_WIDTH} y1={yA + ROW_HEIGHT / 2}
                    x2={COL_WIDTH + GUTTER + assetIndent} y2={yB + ROW_HEIGHT / 2}
                    color={LINK_COLOR[e.linkType] || '#94a3b8'} opacity={0.08} />
                );
              }
              if (focus && isFocused) return null;
              return (
                <EdgePath key={e.mappingId} x1={COL_WIDTH} y1={yA + ROW_HEIGHT / 2}
                  x2={COL_WIDTH + GUTTER + assetIndent} y2={yB + ROW_HEIGHT / 2}
                  color={LINK_COLOR[e.linkType] || '#94a3b8'} opacity={focus ? 0.15 : 0.45} />
              );
            })}
            {focus && edges.filter((e) => focusedEdges.has(e.mappingId)).map((e) => {
              const yA = activityY.get(e.activityId);
              const yB = assetY.get(e.assetId);
              if (yA == null || yB == null) return null;
              return (
                <EdgePath key={`f-${e.mappingId}`} x1={COL_WIDTH} y1={yA + ROW_HEIGHT / 2}
                  x2={COL_WIDTH + GUTTER + assetIndent} y2={yB + ROW_HEIGHT / 2}
                  color={LINK_COLOR[e.linkType] || '#94a3b8'} opacity={0.9} strokeWidth={2} />
              );
            })}

            {/* Left column: hierarchy headers (Value Stream → Process →
                Sub-process) interleaved with the activity rows nested under
                them. Activities indent by their depth so the tree reads
                top-to-bottom; edges still leave the column's right edge. */}
            {leftRows.map((row, i) => {
              const y = PADDING_Y + i * ROW_HEIGHT;
              if (row.kind === 'header') {
                const st = LEVEL_STYLE[row.level] || { label: row.level, size: 10, weight: 600, color: '#64748b' };
                const x = 8 + row.depth * 16;
                return (
                  <g key={row.rowKey}>
                    <rect x={x} y={y + 3} width={2} height={ROW_HEIGHT - 10} fill={st.color} rx={1} />
                    <text x={x + 8} y={y + 13} fontSize={8} fontWeight={600} fill="#94a3b8" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {st.label}
                    </text>
                    <text x={x + 8} y={y + 25} fontSize={st.size} fontWeight={st.weight} fill={st.color} style={st.upper ? { textTransform: 'uppercase', letterSpacing: '0.03em' } : undefined}>
                      {truncate(row.name, 40 - row.depth * 3)}
                    </text>
                  </g>
                );
              }
              const a = row.activity;
              const indent = 8 + row.depth * 16;
              const dim = focus && !focusedNodeIds.has(a.id);
              return (
                <g key={a.id}
                  onClick={() => setFocus((f) => f?.kind === 'activity' && f.id === a.id ? null : { kind: 'activity', id: a.id })}
                  style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
                >
                  <rect x={indent} y={y} width={COL_WIDTH - indent} height={ROW_HEIGHT - 4}
                    fill={focus?.kind === 'activity' && focus.id === a.id ? '#d1fae5' : '#f8fafc'}
                    stroke="#cbd5e1" rx={3} />
                  <text x={indent + 10} y={y + 14} fontSize={11} fontWeight={600} fill="#0f172a">
                    {truncate(a.name, 32 - row.depth * 2)}
                  </text>
                  <text x={indent + 10} y={y + 26} fontSize={9} fill="#64748b">
                    Activity
                  </text>
                </g>
              );
            })}

            {/* Right column: data-domain headers with their assets nested
                beneath (assets roll up to domains like activities roll up
                to processes). */}
            {rightRows.map((row, i) => {
              const y = PADDING_Y + i * ROW_HEIGHT;
              const colX = COL_WIDTH + GUTTER;
              if (row.kind === 'domain') {
                return (
                  <g key={row.rowKey}>
                    <rect x={colX + 8} y={y + 3} width={2} height={ROW_HEIGHT - 10} fill="#dc2626" rx={1} />
                    <text x={colX + 16} y={y + 13} fontSize={8} fontWeight={600} fill="#94a3b8" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Data Domain
                    </text>
                    <text x={colX + 16} y={y + 25} fontSize={11} fontWeight={700} fill="#b91c1c">
                      {truncate(row.name, 38)}
                    </text>
                  </g>
                );
              }
              const a = row.asset;
              const indent = assetIndent;
              const x = colX + indent;
              const dim = focus && !focusedNodeIds.has(a.id);
              return (
                <g key={a.id}
                  onClick={() => setFocus((f) => f?.kind === 'asset' && f.id === a.id ? null : { kind: 'asset', id: a.id })}
                  style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
                >
                  <rect x={x} y={y} width={COL_WIDTH - indent} height={ROW_HEIGHT - 4}
                    fill={focus?.kind === 'asset' && focus.id === a.id ? '#d1fae5' : '#f8fafc'}
                    stroke="#cbd5e1" rx={3} />
                  <text x={x + 10} y={y + 14} fontSize={11} fontWeight={600} fill="#0f172a">
                    {truncate(a.name, 28)}
                  </text>
                  <text x={x + 10} y={y + 26} fontSize={9} fill="#64748b">
                    {a.systemName || 'no system'}
                  </text>
                  <text x={x + (COL_WIDTH - indent) - 38} y={y + 22} fontSize={9} fontWeight={700}
                    fill={TIER_COLOR[a.governanceTier]} textAnchor="start">
                    {a.governanceTier}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {data && data.stats.activityCount > 0 && data.stats.mappedActivityCount < data.stats.activityCount && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
          {data.stats.activityCount - data.stats.mappedActivityCount} activity
          {data.stats.activityCount - data.stats.mappedActivityCount === 1 ? ' has' : 'ies have'} no
          mapped data assets yet.{' '}
          <Link to="/gap-detection">Open Gap Detection →</Link>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// Cubic Bezier connector so adjacent edges don't all overlap. Control
// points are pulled horizontally so the lines leave each node
// horizontally then curve to the target.
function EdgePath({
  x1, y1, x2, y2, color, opacity, strokeWidth = 1,
}: { x1: number; y1: number; x2: number; y2: number; color: string; opacity: number; strokeWidth?: number }) {
  const cx1 = x1 + (x2 - x1) * 0.5;
  const cx2 = x1 + (x2 - x1) * 0.5;
  return (
    <path
      d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
      stroke={color}
      strokeWidth={strokeWidth}
      fill="none"
      opacity={opacity}
    />
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
