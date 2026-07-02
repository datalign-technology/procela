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
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';

interface Activity {
  id: string;
  name: string;
  parentProcessId: string | null;
  parentProcessName: string | null;
  systemIds: string[];
}
interface Asset {
  id: string;
  name: string;
  systemId: string;
  systemName: string | null;
  governanceTier: 'BRONZE' | 'SILVER' | 'GOLD';
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
  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ kind: 'activity' | 'asset'; id: string } | null>(null);
  const [systemFilter, setSystemFilter] = useState<string>('');
  const [includeGov, setIncludeGov] = useState(false);

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
    } catch (e: any) {
      setError(e?.message || 'Failed to load process-data map');
    }
  }, [activeOrgId, includeGov, refreshKey]);

  useEffect(() => { load(); }, [load]);

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
    filteredActivities = [...filteredActivities].sort((a, b) => {
      const pa = a.parentProcessName || '';
      const pb = b.parentProcessName || '';
      if (pa !== pb) return pa.localeCompare(pb);
      return a.name.localeCompare(b.name);
    });
    filteredAssets = [...filteredAssets].sort((a, b) => {
      const sa = a.systemName || '';
      const sb = b.systemName || '';
      if (sa !== sb) return sa.localeCompare(sb);
      return a.name.localeCompare(b.name);
    });
    return {
      activities: filteredActivities,
      assets: filteredAssets,
      edges: filteredEdges,
      systemOptions: allSystems,
    };
  }, [data, systemFilter]);

  const activityY = useMemo(() => {
    const m = new Map<string, number>();
    activities.forEach((a, i) => m.set(a.id, PADDING_Y + i * ROW_HEIGHT));
    return m;
  }, [activities]);
  const assetY = useMemo(() => {
    const m = new Map<string, number>();
    assets.forEach((a, i) => m.set(a.id, PADDING_Y + i * ROW_HEIGHT));
    return m;
  }, [assets]);

  const svgHeight = Math.max(activities.length, assets.length) * ROW_HEIGHT + PADDING_Y * 2;
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
        subtitle="Visual bridge between the business hierarchy and the catalog. Click an activity or asset to focus its connections."
        meta={data && (
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-text-muted)' }}>
            <span>{data.stats.activityCount} activities</span>
            <span>{data.stats.assetCount} mapped assets</span>
            <span>{data.stats.edgeCount} mappings</span>
            <span>{data.stats.mappedActivityCount}/{data.stats.activityCount} activities have at least one mapping</span>
          </div>
        )}
      />

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

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#7f1d1d', borderRadius: 4 }}>
          {error}
        </div>
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
                    x2={COL_WIDTH + GUTTER} y2={yB + ROW_HEIGHT / 2}
                    color={LINK_COLOR[e.linkType] || '#94a3b8'} opacity={0.08} />
                );
              }
              if (focus && isFocused) return null;
              return (
                <EdgePath key={e.mappingId} x1={COL_WIDTH} y1={yA + ROW_HEIGHT / 2}
                  x2={COL_WIDTH + GUTTER} y2={yB + ROW_HEIGHT / 2}
                  color={LINK_COLOR[e.linkType] || '#94a3b8'} opacity={focus ? 0.15 : 0.45} />
              );
            })}
            {focus && edges.filter((e) => focusedEdges.has(e.mappingId)).map((e) => {
              const yA = activityY.get(e.activityId);
              const yB = assetY.get(e.assetId);
              if (yA == null || yB == null) return null;
              return (
                <EdgePath key={`f-${e.mappingId}`} x1={COL_WIDTH} y1={yA + ROW_HEIGHT / 2}
                  x2={COL_WIDTH + GUTTER} y2={yB + ROW_HEIGHT / 2}
                  color={LINK_COLOR[e.linkType] || '#94a3b8'} opacity={0.9} strokeWidth={2} />
              );
            })}

            {/* Activity rows */}
            {activities.map((a) => {
              const y = activityY.get(a.id)!;
              const dim = focus && !focusedNodeIds.has(a.id);
              return (
                <g key={a.id}
                  onClick={() => setFocus((f) => f?.kind === 'activity' && f.id === a.id ? null : { kind: 'activity', id: a.id })}
                  style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
                >
                  <rect x={0} y={y} width={COL_WIDTH} height={ROW_HEIGHT - 4}
                    fill={focus?.kind === 'activity' && focus.id === a.id ? '#d1fae5' : '#f8fafc'}
                    stroke="#cbd5e1" rx={3} />
                  <text x={10} y={y + 14} fontSize={11} fontWeight={600} fill="#0f172a">
                    {truncate(a.name, 34)}
                  </text>
                  <text x={10} y={y + 26} fontSize={9} fill="#64748b">
                    {a.parentProcessName ? truncate(a.parentProcessName, 40) : 'no parent'}
                  </text>
                </g>
              );
            })}

            {/* Asset rows */}
            {assets.map((a) => {
              const y = assetY.get(a.id)!;
              const dim = focus && !focusedNodeIds.has(a.id);
              const x = COL_WIDTH + GUTTER;
              return (
                <g key={a.id}
                  onClick={() => setFocus((f) => f?.kind === 'asset' && f.id === a.id ? null : { kind: 'asset', id: a.id })}
                  style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
                >
                  <rect x={x} y={y} width={COL_WIDTH} height={ROW_HEIGHT - 4}
                    fill={focus?.kind === 'asset' && focus.id === a.id ? '#d1fae5' : '#f8fafc'}
                    stroke="#cbd5e1" rx={3} />
                  <text x={x + 10} y={y + 14} fontSize={11} fontWeight={600} fill="#0f172a">
                    {truncate(a.name, 30)}
                  </text>
                  <text x={x + 10} y={y + 26} fontSize={9} fill="#64748b">
                    {a.systemName || 'no system'}
                  </text>
                  <text x={x + COL_WIDTH - 38} y={y + 22} fontSize={9} fontWeight={700}
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
