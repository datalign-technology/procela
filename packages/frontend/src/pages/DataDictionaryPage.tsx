import { Fragment, useEffect, useState, useCallback, useMemo } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import EmptyState from '../components/EmptyState';
import SortableTh from '../components/SortableTh';
import { SkeletonRows } from '../components/Skeleton';
import { useSortedList } from '../hooks/useSortedList';

/* ── Interfaces ─────────────────────────────────────────────────── */

interface DataAssetEntity {
  id: string;
  name: string;
  description: string;
  systemId: string;
  owner?: string;
  stewardIds?: string[];
  governanceTier?: 'BRONZE' | 'SILVER' | 'GOLD';
  healthScore?: number;
  dataClassification?: string;
  category?: string;
  retentionPolicy?: string;
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
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--color-border)',
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
      {tier}
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

export default function DataDictionaryPage() {
  const { activeOrgId } = useOrgContext();

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
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Data Dictionary</h1>
        <div style={{ color: '#ef4444' }}>Error: {error}</div>
      </div>
    );
  }

  return (
    <div>
      <style>{`
        @media print {
          nav, header, aside, button, .no-print { display: none !important; }
          body { background: white !important; font-size: 11pt; }
          main { padding: 0 !important; }
        }
      `}</style>

      {/* Header */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Data Dictionary</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            Technical catalog of data assets, columns, ownership, and lineage.
          </p>
          {assets.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              <span>{assets.length} assets</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span>{goldCount} gold</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span>{silverCount} silver</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span>{bronzeCount} bronze</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span>{domains.length} domains</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => window.print()} style={btnPrimary}>Print / Export PDF</button>
        </div>
      </div>

      {/* Two-column layout: Domains sidebar + content */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Domains Sidebar */}
        <div className="no-print" style={{
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
          {/* Content header: title, search, tier filter */}
          <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
              {filterDomain
                ? (filterDomain === '__unassigned__' ? 'Unassigned Assets' : domainMap.get(filterDomain)?.name || 'Assets')
                : 'All Assets'}
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>{filteredAssets.length} asset{filteredAssets.length !== 1 ? 's' : ''}</span>
              {filterDomain && (
                <button onClick={() => setFilterDomain('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-muted)', padding: '0 4px' }} title="Clear domain filter">&times;</button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                style={{ ...inputStyle, width: 240, fontSize: 12, padding: '4px 8px' }}
                placeholder="Search assets & columns..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)' }}>Tier:</label>
              <select style={{ ...inputStyle, width: 'auto', minWidth: 110, fontSize: 12, padding: '4px 8px' }} value={filterTier} onChange={(e) => setFilterTier(e.target.value)}>
                <option value="">All</option>
                <option value="GOLD">Gold ({goldCount})</option>
                <option value="SILVER">Silver ({silverCount})</option>
                <option value="BRONZE">Bronze ({bronzeCount})</option>
              </select>
              {filterTier && (
                <button onClick={() => setFilterTier('')} style={{ fontSize: 11, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
              )}
            </div>
          </div>

          {/* Table */}
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            {loading ? (
              <SkeletonRows rows={5} columns={7} />
            ) : assets.length === 0 ? (
              <EmptyState icon={'📚'} title="No data assets yet"
                description="Create data assets on the Data Assets page to populate this dictionary." />
            ) : sorted.length === 0 ? (
              <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                No assets match your filters.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    <th style={{ ...thStyle, width: 32 }} />
                    <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Asset</SortableTh>
                    <SortableTh sortKey="system" active={sortKey} dir={sortDir} onClick={toggleSort}>System</SortableTh>
                    <SortableTh sortKey="domain" active={sortKey} dir={sortDir} onClick={toggleSort}>Domain</SortableTh>
                    <SortableTh sortKey="tier" active={sortKey} dir={sortDir} onClick={toggleSort}>Tier</SortableTh>
                    <SortableTh sortKey="health" active={sortKey} dir={sortDir} onClick={toggleSort}>Health</SortableTh>
                    <SortableTh sortKey="owner" active={sortKey} dir={sortDir} onClick={toggleSort}>Owner</SortableTh>
                    <SortableTh sortKey="columns" active={sortKey} dir={sortDir} onClick={toggleSort}>Columns</SortableTh>
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
                          <td style={{ ...tdStyle, color: sys ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                            {sys ? sys.name : '—'}
                          </td>
                          <td style={{ ...tdStyle, color: domain ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                            {domain ? domain.name : '—'}
                          </td>
                          <td style={tdStyle}>{tierBadge(a.governanceTier)}</td>
                          <td style={tdStyle}>{healthBar(a.healthScore)}</td>
                          <td style={{ ...tdStyle, color: ownerDisplay ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                            {ownerDisplay || '—'}
                            {stewardDisplay && (
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>Steward: {stewardDisplay}</div>
                            )}
                          </td>
                          <td style={{ ...tdStyle, color: cols.length > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                            {cols.length > 0 ? `${cols.length} column${cols.length !== 1 ? 's' : ''}` : (loadingColumns ? '…' : '—')}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={8} style={{ padding: 0, borderTop: '1px solid var(--color-border)', background: '#fafbfc' }}>
                              <div style={{ padding: '14px 22px' }}>
                                {/* Metadata strip */}
                                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: cols.length > 0 ? 12 : 0 }}>
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
                                  {a.retentionPolicy && (
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Retention</div>
                                      <div style={{ fontSize: 12 }}>{a.retentionPolicy}</div>
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
                                        <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Column</th>
                                        <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', width: 140 }}>Type</th>
                                        <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Description</th>
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
