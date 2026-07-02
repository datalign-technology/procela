import { Fragment, useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { thStyle, tdStyle } from '../lib/tableStyles';
import PageHeader from '../components/PageHeader';
import { useOrgContext } from '../stores/orgContext';
import ExportMenu from '../components/ExportMenu';
import SavedViewsMenu from '../components/SavedViewsMenu';
import { ExportPayload } from '../lib/export';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import SortableTh from '../components/SortableTh';
import { SkeletonRows } from '../components/Skeleton';
import { useSortedList } from '../hooks/useSortedList';
import { tierLabel } from '../lib/governanceTier';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';

/* ── Interfaces ─────────────────────────────────────────────────── */

interface DataAssetEntity {
  id: string;
  name: string;
  description: string;
  systemId: string;
  owner?: string;
  ownerPersonId?: string | null;
  stewardIds?: string[];
  governanceTier?: 'BRONZE' | 'SILVER' | 'GOLD';
  healthScore?: number;
  healthScoreAt?: string | null;
  dataClassification?: string;
  dataType?: string;
  /** @deprecated use dataType */
  category?: string;
  /** @deprecated use retentionDuration + retentionReason */
  retentionPolicy?: string;
  retentionDuration?: { value: number; unit: 'DAYS' | 'MONTHS' | 'YEARS' };
  retentionReason?: string;
  refreshFrequency?: string;
  sourceConnectionId?: string;
  sourceAsset?: string;
  sourceColumn?: string;
  createdAt: string;
  updatedAt: string;
  domainName?: string | null;
  ownerName?: string | null;
  stewardName?: string | null;
}

interface DataDomain {
  id: string;
  orgId: string;
  name: string;
  description: string;
  ownerId: string | null;
  ownerName: string | null;
  stewardIds: string[];
  stewards: { id: string; name: string }[];
  dataAssetIds: string[];
  assets: { id: string; name: string }[];
  status: string;
}

interface SystemRef { id: string; name: string; systemType?: string; }
interface Person { id: string; name: string; }

interface DataAssetColumn {
  id: string;
  dataAssetId: string;
  columnName: string;
  dataType?: string;
  description?: string;
  sourceConnectionId?: string;
  sourceAsset?: string;
  sourceColumn?: string;
}

/* ── Styles ──────────────────────────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

/* ── Helpers ─────────────────────────────────────────────────────── */

const TIER_COLORS: Record<string, { bg: string; text: string }> = {
  GOLD: { bg: '#fef3c7', text: '#92400e' },
  SILVER: { bg: '#f3f4f6', text: '#374151' },
  BRONZE: { bg: '#fed7aa', text: '#9a3412' },
};

function tierBadge(tier?: string) {
  if (!tier) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  const c = TIER_COLORS[tier] || { bg: '#e5e7eb', text: '#374151' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', background: c.bg, color: c.text }}>
      {tierLabel(tier)}
    </span>
  );
}

function healthBar(score?: number) {
  if (score == null) return <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>N/A</span>;
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', width: 60, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${score}%`, background: color, borderRadius: 3 }} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color }}>{score}%</span>
    </span>
  );
}

/* ── Component ───────────────────────────────────────────────────── */

type DictColId = 'system' | 'domain' | 'tier' | 'health' | 'owner' | 'columns';
const DICT_COLUMN_DEFS: Array<{ id: DictColId; label: string; defaultVisible: boolean }> = [
  { id: 'system',  label: 'System',  defaultVisible: true  },
  { id: 'domain',  label: 'Domain',  defaultVisible: true  },
  { id: 'tier',    label: 'Tier',    defaultVisible: true  },
  { id: 'health',  label: 'Health',  defaultVisible: true  },
  { id: 'owner',   label: 'Owner',   defaultVisible: true  },
  { id: 'columns', label: 'Columns', defaultVisible: true  },
];

export default function DataDictionaryPage() {
  const { activeOrgId } = useOrgContext();
  const navigate = useNavigate();

  const dictCols = useColumnPicker<DictColId>('procela.dataDictionary.visibleCols.v1', DICT_COLUMN_DEFS);
  const [assets, setAssets] = useState<DataAssetEntity[]>([]);
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [systems, setSystems] = useState<SystemRef[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [columnsMap, setColumnsMap] = useState<Record<string, DataAssetColumn[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterDomain, setFilterDomain] = useState('');
  const [filterTier, setFilterTier] = useState('');
  const [expandedAssetIds, setExpandedAssetIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpandedAssetIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [assetsRes, domainsRes, systemsRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DataAssetEntity[] }>(`/data-assets${query}`),
        apiClient.get<{ success: boolean; data: DataDomain[] }>(`/data-domains${query}`),
        apiClient.get<{ success: boolean; data: SystemRef[] }>(`/systems${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
      ]);
      setAssets(assetsRes.data || []);
      setDomains(domainsRes.data || []);
      setSystems(systemsRes.data || []);
      setPeople(peopleRes.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load data dictionary');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Fan-out: pull columns for every asset so we can show a count column and
  // expandable column tables. Cached by asset id; refreshes when the asset
  // list changes.
  useEffect(() => {
    if (assets.length === 0) return;
    const missing = assets.filter((a) => !columnsMap[a.id]);
    if (missing.length === 0) return;
    setLoadingColumns(true);
    Promise.all(
      missing.map((a) =>
        apiClient.get<{ success: boolean; data: DataAssetColumn[] }>(`/data-assets/${a.id}/columns`)
          .then((r) => [a.id, r.data || []] as [string, DataAssetColumn[]])
          .catch(() => [a.id, []] as [string, DataAssetColumn[]])
      )
    ).then((results) => {
      setColumnsMap((prev) => {
        const next = { ...prev };
        for (const [id, cols] of results) next[id] = cols;
        return next;
      });
    }).finally(() => setLoadingColumns(false));
  }, [assets]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Lookups ─────────────────────────────────────────────────── */

  const systemMap = useMemo(() => new Map(systems.map((s) => [s.id, s])), [systems]);
  const personMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const personName = useCallback((id?: string | null) => id ? personMap.get(id)?.name || null : null, [personMap]);

  const domainMap = useMemo(() => new Map(domains.map((d) => [d.id, d])), [domains]);
  const assetDomainMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of domains) for (const aid of d.dataAssetIds || []) m.set(aid, d.id);
    return m;
  }, [domains]);

  /* ── Filtered ────────────────────────────────────────────────── */

  const filteredAssets = useMemo(() => {
    let result = assets;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        (columnsMap[a.id] || []).some((c) => c.columnName.toLowerCase().includes(q))
      );
    }
    if (filterTier) result = result.filter((a) => a.governanceTier === filterTier);
    if (filterDomain) {
      if (filterDomain === '__unassigned__') result = result.filter((a) => !assetDomainMap.has(a.id));
      else result = result.filter((a) => assetDomainMap.get(a.id) === filterDomain);
    }
    return result;
  }, [assets, searchQuery, filterTier, filterDomain, assetDomainMap, columnsMap]);

  const { sorted, sortKey, sortDir, toggleSort } = useSortedList<DataAssetEntity>(
    filteredAssets,
    {
      name: (a, b) => a.name.localeCompare(b.name),
      system: (a, b) => (systemMap.get(a.systemId)?.name || '').localeCompare(systemMap.get(b.systemId)?.name || ''),
      domain: (a, b) => {
        const ad = assetDomainMap.get(a.id);
        const bd = assetDomainMap.get(b.id);
        return (ad ? domainMap.get(ad)?.name || '' : '').localeCompare(bd ? domainMap.get(bd)?.name || '' : '');
      },
      tier: (a, b) => (a.governanceTier || '').localeCompare(b.governanceTier || ''),
      health: (a, b) => (a.healthScore ?? -1) - (b.healthScore ?? -1),
      owner: (a, b) => (a.ownerName || personName(a.owner) || '').localeCompare(b.ownerName || personName(b.owner) || ''),
      columns: (a, b) => (columnsMap[a.id]?.length || 0) - (columnsMap[b.id]?.length || 0),
    },
    'name',
  );

  const goldCount = assets.filter((a) => a.governanceTier === 'GOLD').length;
  const silverCount = assets.filter((a) => a.governanceTier === 'SILVER').length;
  const bronzeCount = assets.filter((a) => a.governanceTier === 'BRONZE').length;

  /* ── Render ──────────────────────────────────────────────────── */

  if (error) {
    return (
      <div>
        <PageHeader title="Data Dictionary" />
        <div style={{ color: '#ef4444' }}>Error: {error}</div>
      </div>
    );
  }

  const buildDictionaryExport = (): ExportPayload => ({
    filenameBase: 'data-dictionary',
    sheetName: 'Data Dictionary',
    headers: ['Asset', 'Description', 'System', 'Domain', 'Tier', 'Health', 'Owner', 'Steward', 'Data Type', 'Classification', 'Refresh', 'Retention', 'Retention Reason', 'Source', 'Columns'],
    rows: sorted.map((a) => {
        const sys = systemMap.get(a.systemId);
        const did = assetDomainMap.get(a.id);
        const dom = did ? domainMap.get(did) : null;
        const ownerDisplay = a.ownerName || personName(a.ownerPersonId) || personName(a.owner) || '';
        const stewardDisplay = a.stewardName
          || (a.stewardIds?.length ? a.stewardIds.map((sid) => personName(sid)).filter(Boolean).join('; ') : '');
        const cols = columnsMap[a.id] || [];
        const source = a.sourceAsset
          ? `${sys ? sys.name + ' > ' : ''}${a.sourceAsset}${a.sourceColumn ? ' > ' + a.sourceColumn : ''}`
          : '';
        const retention = a.retentionDuration
          ? `${a.retentionDuration.value} ${a.retentionDuration.unit.toLowerCase()}`
          : (a.retentionPolicy || '');
        return [
          a.name,
          a.description || '',
          sys?.name || '',
          dom?.name || '',
          a.governanceTier || '',
          a.healthScore != null ? `${a.healthScore}%` : '',
          ownerDisplay,
          stewardDisplay,
          a.dataType || a.category || '',
          a.dataClassification || '',
          (a.refreshFrequency || '').replace(/_/g, ' '),
          retention,
          a.retentionReason || '',
          source,
          cols.length > 0 ? cols.map((c) => `${c.columnName}${c.dataType ? ':' + c.dataType : ''}`).join('; ') : '',
        ];
      }),
  });

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Data Dictionary"
        subtitle="Technical catalog of data assets, columns, ownership, and lineage."
        meta={assets.length > 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{assets.length} assets</span>
            <span style={{ color: 'var(--color-border)' }}>&middot;</span>
            <span>{goldCount} {tierLabel('GOLD').toLowerCase()}</span>
            <span style={{ color: 'var(--color-border)' }}>&middot;</span>
            <span>{silverCount} {tierLabel('SILVER').toLowerCase()}</span>
            <span style={{ color: 'var(--color-border)' }}>&middot;</span>
            <span>{bronzeCount} {tierLabel('BRONZE').toLowerCase()}</span>
            <span style={{ color: 'var(--color-border)' }}>&middot;</span>
            <span>{domains.length} domains</span>
          </div>
        ) : undefined}
        actions={
          <>
            <SavedViewsMenu
              pageKey="data-dictionary"
              currentFilters={{ searchQuery, filterDomain, filterTier }}
              onApply={(f) => {
                setSearchQuery((f.searchQuery as string) || '');
                setFilterDomain((f.filterDomain as string) || '');
                setFilterTier((f.filterTier as string) || '');
              }}
            />
            {assets.length > 0 && (
              <ExportMenu build={buildDictionaryExport} />
            )}
            <ColumnPicker state={dictCols} />
          </>
        }
      />

      {/* Two-column layout: Domains sidebar + content */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Domains Sidebar */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 10,
          position: 'sticky',
          top: 12,
          maxHeight: 'calc(100vh - 180px)',
          overflowY: 'auto',
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, padding: '0 4px' }}>
            Domains
          </div>
          <div
            onClick={() => setFilterDomain('')}
            style={{
              padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
              fontWeight: !filterDomain ? 600 : 400,
              background: !filterDomain ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
              color: !filterDomain ? 'var(--color-primary)' : 'var(--color-text)',
            }}
            onMouseEnter={(e) => { if (filterDomain) e.currentTarget.style.background = 'var(--color-bg)'; }}
            onMouseLeave={(e) => { if (filterDomain) e.currentTarget.style.background = 'transparent'; }}
          >
            All Assets ({assets.length})
          </div>
          {domains.slice().sort((a, b) => a.name.localeCompare(b.name)).map((d) => {
            const count = assets.filter((a) => assetDomainMap.get(a.id) === d.id).length;
            if (count === 0) return null;
            const isActive = filterDomain === d.id;
            return (
              <div
                key={d.id}
                onClick={() => setFilterDomain(isActive ? '' : d.id)}
                style={{
                  padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '0 5px', borderRadius: 8, fontWeight: 500 }}>{count}</span>
              </div>
            );
          })}
          {assets.some((a) => !assetDomainMap.has(a.id)) && (
            <div
              onClick={() => setFilterDomain(filterDomain === '__unassigned__' ? '' : '__unassigned__')}
              style={{
                padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                fontWeight: filterDomain === '__unassigned__' ? 600 : 400,
                background: filterDomain === '__unassigned__' ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
                color: filterDomain === '__unassigned__' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                fontStyle: 'italic',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
              onMouseEnter={(e) => { if (filterDomain !== '__unassigned__') e.currentTarget.style.background = 'var(--color-bg)'; }}
              onMouseLeave={(e) => { if (filterDomain !== '__unassigned__') e.currentTarget.style.background = 'transparent'; }}
            >
              <span>Unassigned</span>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '0 5px', borderRadius: 8, fontWeight: 500 }}>{assets.filter((a) => !assetDomainMap.has(a.id)).length}</span>
            </div>
          )}
        </div>

        {/* Content area */}
        <div>
          {/* Filters (left-aligned, mirrors Data Assets) */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search assets & columns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
            />
            <select style={{ ...selectStyle, width: 'auto', minWidth: 130 }} value={filterTier} onChange={(e) => setFilterTier(e.target.value)}>
              <option value="">All Tiers</option>
              <option value="GOLD">{tierLabel('GOLD')} ({goldCount})</option>
              <option value="SILVER">{tierLabel('SILVER')} ({silverCount})</option>
              <option value="BRONZE">{tierLabel('BRONZE')} ({bronzeCount})</option>
            </select>
            {(filterTier || searchQuery || filterDomain) && (
              <>
                <button
                  onClick={() => { setFilterTier(''); setSearchQuery(''); setFilterDomain(''); }}
                  style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}
                >
                  Clear Filters
                </button>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Showing {filteredAssets.length} of {assets.length}
                </span>
              </>
            )}
          </div>

          {/* Table */}
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            {loading ? (
              <SkeletonRows rows={5} columns={7} />
            ) : assets.length === 0 ? (
              <EmptyState
                icon={renderNavIcon('/data-dictionary')}
                title="No data assets yet"
                description="The data dictionary mirrors what's in your Data Assets catalog. Add your first asset there and it'll show up here automatically."
                action={{ label: 'Go to Data Assets', onClick: () => navigate('/data-assets') }}
              />
            ) : sorted.length === 0 ? (
              <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                No assets match your filters.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    <th scope="col" style={{ ...thStyle, width: 32 }} />
                    <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Asset</SortableTh>
                    {dictCols.isVisible('system') && <SortableTh sortKey="system" active={sortKey} dir={sortDir} onClick={toggleSort}>System</SortableTh>}
                    {dictCols.isVisible('domain') && <SortableTh sortKey="domain" active={sortKey} dir={sortDir} onClick={toggleSort}>Domain</SortableTh>}
                    {dictCols.isVisible('tier') && <SortableTh sortKey="tier" active={sortKey} dir={sortDir} onClick={toggleSort}>Tier</SortableTh>}
                    {dictCols.isVisible('health') && <SortableTh sortKey="health" active={sortKey} dir={sortDir} onClick={toggleSort}>Health</SortableTh>}
                    {dictCols.isVisible('owner') && <SortableTh sortKey="owner" active={sortKey} dir={sortDir} onClick={toggleSort}>Owner</SortableTh>}
                    {dictCols.isVisible('columns') && <SortableTh sortKey="columns" active={sortKey} dir={sortDir} onClick={toggleSort}>Columns</SortableTh>}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((a) => {
                    const sys = systemMap.get(a.systemId);
                    const domainId = assetDomainMap.get(a.id);
                    const domain = domainId ? domainMap.get(domainId) : null;
                    const ownerDisplay = a.ownerName || personName(a.owner);
                    const stewardDisplay = a.stewardName
                      || (a.stewardIds?.length ? a.stewardIds.map((sid) => personName(sid)).filter(Boolean).join(', ') : null);
                    const cols = columnsMap[a.id] || [];
                    const isExpanded = expandedAssetIds.has(a.id);
                    return (
                      <Fragment key={a.id}>
                        <tr style={{ transition: 'background 0.1s', cursor: 'pointer' }}
                          onClick={() => toggleExpand(a.id)}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                          <td style={{ ...tdStyle, textAlign: 'center', width: 32, color: 'var(--color-text-muted)' }}>
                            <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 500 }}>
                            {a.name}
                            {a.description && (
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }} title={a.description}>
                                {a.description}
                              </div>
                            )}
                          </td>
                          {dictCols.isVisible('system') && (
                            <td style={{ ...tdStyle, color: sys ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                              {sys ? sys.name : '—'}
                            </td>
                          )}
                          {dictCols.isVisible('domain') && (
                            <td style={{ ...tdStyle, color: domain ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                              {domain ? domain.name : '—'}
                            </td>
                          )}
                          {dictCols.isVisible('tier') && <td style={tdStyle}>{tierBadge(a.governanceTier)}</td>}
                          {dictCols.isVisible('health') && <td style={tdStyle}>{healthBar(a.healthScore)}</td>}
                          {dictCols.isVisible('owner') && (
                            <td style={{ ...tdStyle, color: ownerDisplay ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                              {ownerDisplay || '—'}
                              {stewardDisplay && (
                                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>Steward: {stewardDisplay}</div>
                              )}
                            </td>
                          )}
                          {dictCols.isVisible('columns') && (
                            <td style={{ ...tdStyle, color: cols.length > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                              {cols.length > 0 ? `${cols.length} column${cols.length !== 1 ? 's' : ''}` : (loadingColumns ? '…' : '—')}
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={8} style={{ padding: 0, borderTop: '1px solid var(--color-border)', background: '#fafbfc' }}>
                              <div style={{ padding: '14px 22px' }}>
                                {/* Metadata strip */}
                                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: cols.length > 0 ? 12 : 0 }}>
                                  {(a.dataType || a.category) && (
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data Type</div>
                                      <div style={{ fontSize: 12 }}>{a.dataType || a.category}</div>
                                    </div>
                                  )}
                                  {a.dataClassification && (
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Classification</div>
                                      <div style={{ fontSize: 12 }}>{a.dataClassification}</div>
                                    </div>
                                  )}
                                  {a.refreshFrequency && (
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Refresh</div>
                                      <div style={{ fontSize: 12 }}>{a.refreshFrequency.replace(/_/g, ' ')}</div>
                                    </div>
                                  )}
                                  {(a.retentionDuration || a.retentionPolicy) && (
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Retention</div>
                                      <div style={{ fontSize: 12 }}>
                                        {a.retentionDuration
                                          ? `${a.retentionDuration.value} ${a.retentionDuration.unit.toLowerCase()}`
                                          : a.retentionPolicy}
                                        {a.retentionReason && (
                                          <span style={{ color: 'var(--color-text-muted)' }}> — {a.retentionReason}</span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  {a.sourceAsset && (
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source</div>
                                      <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
                                        {sys ? `${sys.name} > ` : ''}{a.sourceAsset}{a.sourceColumn ? ` > ${a.sourceColumn}` : ''}
                                      </div>
                                    </div>
                                  )}
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Updated</div>
                                    <div style={{ fontSize: 12 }}>{new Date(a.updatedAt).toLocaleDateString()}</div>
                                  </div>
                                </div>
                                {/* Columns */}
                                {cols.length > 0 ? (
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
                                    <thead>
                                      <tr style={{ background: 'var(--color-bg)' }}>
                                        <th scope="col" style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Column</th>
                                        <th scope="col" style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', width: 140 }}>Type</th>
                                        <th scope="col" style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Description</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {cols.map((col) => (
                                        <tr key={col.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                          <td style={{ padding: '6px 12px', fontFamily: 'monospace' }}>{col.columnName}</td>
                                          <td style={{ padding: '6px 12px', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>{col.dataType || '—'}</td>
                                          <td style={{ padding: '6px 12px', color: 'var(--color-text-secondary)' }}>{col.description || ''}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                    {loadingColumns ? 'Loading columns…' : 'No columns defined for this asset.'}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
