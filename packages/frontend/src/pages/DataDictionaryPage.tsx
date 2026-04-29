import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

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
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

/* ── Helpers ─────────────────────────────────────────────────────── */

const TIER_COLORS: Record<string, { bg: string; text: string }> = {
  GOLD: { bg: '#fef3c7', text: '#92400e' },
  SILVER: { bg: '#f3f4f6', text: '#374151' },
  BRONZE: { bg: '#fed7aa', text: '#9a3412' },
};

function tierBadge(tier?: string) {
  if (!tier) return null;
  const c = TIER_COLORS[tier] || { bg: '#e5e7eb', text: '#374151' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', background: c.bg, color: c.text }}>
      {tier}
    </span>
  );
}

function healthDot(score?: number): React.CSSProperties {
  const color = score == null ? '#d1d5db' : score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  return { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 };
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
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

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

  useEffect(() => {
    if (assets.length > 0 && Object.keys(columnsMap).length === 0) {
      setLoadingColumns(true);
      Promise.all(
        assets.map((a) =>
          apiClient.get<{ success: boolean; data: DataAssetColumn[] }>(`/data-assets/${a.id}/columns`)
            .then((r) => [a.id, r.data || []] as [string, DataAssetColumn[]])
            .catch(() => [a.id, []] as [string, DataAssetColumn[]])
        )
      ).then((results) => {
        const map: Record<string, DataAssetColumn[]> = {};
        for (const [id, cols] of results) map[id] = cols;
        setColumnsMap(map);
      }).finally(() => setLoadingColumns(false));
    }
  }, [assets]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Lookups ─────────────────────────────────────────────────── */

  const systemMap = new Map(systems.map((s) => [s.id, s]));
  const personMap = new Map(people.map((p) => [p.id, p]));
  const personName = (id?: string | null) => id ? personMap.get(id)?.name || null : null;

  const domainMap = new Map(domains.map((d) => [d.id, d]));
  const assetDomainMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of domains) for (const aid of d.dataAssetIds || []) m.set(aid, d.id);
    return m;
  }, [domains]);

  /* ── Filtered & grouped ──────────────────────────────────────── */

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
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [assets, searchQuery, filterTier, filterDomain, assetDomainMap, columnsMap]);

  const groupedByDomain = useMemo(() => {
    const grouped = new Map<string | null, DataAssetEntity[]>();
    for (const a of filteredAssets) {
      const did = assetDomainMap.get(a.id) || null;
      if (!grouped.has(did)) grouped.set(did, []);
      grouped.get(did)!.push(a);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return (domainMap.get(a)?.name || '').localeCompare(domainMap.get(b)?.name || '');
    });
  }, [filteredAssets, assetDomainMap, domainMap]);

  const selectedAsset = selectedAssetId ? assets.find((a) => a.id === selectedAssetId) || null : null;
  const selectedCols = selectedAssetId ? columnsMap[selectedAssetId] || [] : [];

  // Auto-select first asset
  useEffect(() => {
    if (!selectedAssetId && filteredAssets.length > 0) setSelectedAssetId(filteredAssets[0].id);
    else if (selectedAssetId && !filteredAssets.find((a) => a.id === selectedAssetId) && filteredAssets.length > 0) setSelectedAssetId(filteredAssets[0].id);
  }, [filteredAssets, selectedAssetId]);

  /* ── Render ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Data Dictionary</h1>
        <div style={{ color: 'var(--color-text-muted)' }}>Loading data dictionary...</div>
      </div>
    );
  }

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
        .col-table tr:nth-child(even) { background: var(--color-bg, #f9fafb); }
      `}</style>

      {/* Header */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Data Dictionary</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            Technical catalog of data assets, columns, ownership, and lineage.
          </p>
        </div>
        <button onClick={() => window.print()} style={btnPrimary}>Print / Export PDF</button>
      </div>

      {assets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontSize: 36, marginBottom: 12, color: 'var(--color-text-muted)' }}>{'📚'}</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No data assets yet</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', maxWidth: 440, margin: '0 auto' }}>
            Create data assets on the Data Assets page to populate this dictionary.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Left: Asset index */}
          <div className="no-print" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'sticky', top: 12, maxHeight: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
            {/* Search + filters */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
              <input
                style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', marginBottom: 8 }}
                placeholder="Search assets & columns..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <select style={{ ...selectStyle, fontSize: 11, padding: '3px 6px', flex: 1 }} value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)}>
                  <option value="">All Domains</option>
                  {domains.sort((a, b) => a.name.localeCompare(b.name)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  <option value="__unassigned__">Unassigned</option>
                </select>
                <select style={{ ...selectStyle, fontSize: 11, padding: '3px 6px', width: 'auto', minWidth: 80 }} value={filterTier} onChange={(e) => setFilterTier(e.target.value)}>
                  <option value="">All Tiers</option>
                  <option value="GOLD">Gold</option>
                  <option value="SILVER">Silver</option>
                  <option value="BRONZE">Bronze</option>
                </select>
              </div>
            </div>

            {/* Asset list grouped by domain */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredAssets.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>No assets match your filters.</div>
              ) : (
                groupedByDomain.map(([domainId, domainAssets]) => {
                  const domain = domainId ? domainMap.get(domainId) : null;
                  return (
                    <div key={domainId || '__unassigned__'}>
                      <div style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-primary)', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 1 }}>
                        {domain?.name || 'Unassigned'} ({domainAssets.length})
                      </div>
                      {domainAssets.map((a) => {
                        const isActive = selectedAssetId === a.id;
                        const colCount = (columnsMap[a.id] || []).length;
                        return (
                          <div
                            key={a.id}
                            onClick={() => setSelectedAssetId(a.id)}
                            style={{
                              padding: '8px 12px', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 8,
                              background: isActive ? '#dbeafe' : 'transparent',
                              borderBottom: '1px solid var(--color-border)',
                              borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg)'; }}
                            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                          >
                            <span style={healthDot(a.healthScore)} title={a.healthScore != null ? `${a.healthScore}% health` : 'No health score'} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                              {colCount > 0 && <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{colCount} columns</div>}
                            </div>
                            {a.governanceTier && (
                              <span style={{ fontSize: 9, fontWeight: 700, color: TIER_COLORS[a.governanceTier]?.text || '#374151', flexShrink: 0 }}>
                                {a.governanceTier.charAt(0)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-muted)', background: 'var(--color-bg)' }}>
              {filteredAssets.length} of {assets.length} assets
            </div>
          </div>

          {/* Right: Asset detail */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', minHeight: 400 }}>
            {selectedAsset ? (() => {
              const sys = systemMap.get(selectedAsset.systemId);
              const ownerDisplay = selectedAsset.ownerName || personName(selectedAsset.owner);
              const stewardDisplay = selectedAsset.stewardName || (selectedAsset.stewardIds?.length ? selectedAsset.stewardIds.map((sid) => personName(sid)).filter(Boolean).join(', ') : null);
              const domainId = assetDomainMap.get(selectedAsset.id);
              const domain = domainId ? domainMap.get(domainId) : null;

              return (
                <div style={{ padding: '24px 28px' }}>
                  {/* Header */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{selectedAsset.name}</h2>
                      {tierBadge(selectedAsset.governanceTier)}
                      {selectedAsset.dataClassification && (
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: '#e0e7ff', color: '#3730a3' }}>
                          {selectedAsset.dataClassification}
                        </span>
                      )}
                    </div>
                    {selectedAsset.description && (
                      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-secondary)', margin: 0 }}>{selectedAsset.description}</p>
                    )}
                  </div>

                  {/* Metadata grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
                    {sys && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>System</div>
                        <div style={{ fontSize: 13 }}>{sys.name}{sys.systemType ? ` (${sys.systemType})` : ''}</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Health</div>
                      <div>{healthBar(selectedAsset.healthScore)}</div>
                    </div>
                    {domain && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Domain</div>
                        <div style={{ fontSize: 13 }}>{domain.name}</div>
                      </div>
                    )}
                    {ownerDisplay && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Owner</div>
                        <div style={{ fontSize: 13 }}>{ownerDisplay}</div>
                      </div>
                    )}
                    {stewardDisplay && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Steward</div>
                        <div style={{ fontSize: 13 }}>{stewardDisplay}</div>
                      </div>
                    )}
                    {selectedAsset.refreshFrequency && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Refresh</div>
                        <div style={{ fontSize: 13 }}>{selectedAsset.refreshFrequency.replace(/_/g, ' ')}</div>
                      </div>
                    )}
                    {selectedAsset.retentionPolicy && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Retention</div>
                        <div style={{ fontSize: 13 }}>{selectedAsset.retentionPolicy}</div>
                      </div>
                    )}
                    {selectedAsset.sourceAsset && (
                      <div style={{ gridColumn: 'span 3' }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Source</div>
                        <div style={{ fontSize: 13, fontFamily: 'monospace' }}>
                          {sys ? `${sys.name} > ` : ''}{selectedAsset.sourceAsset}{selectedAsset.sourceColumn ? ` > ${selectedAsset.sourceColumn}` : ''}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Columns table */}
                  {loadingColumns && selectedCols.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '12px 0' }}>Loading columns...</div>
                  ) : selectedCols.length > 0 ? (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        Columns ({selectedCols.length})
                      </div>
                      <table className="col-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                            <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Name</th>
                            <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', width: 120 }}>Type</th>
                            <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCols.map((col) => (
                            <tr key={col.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                              <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{col.columnName}</td>
                              <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{col.dataType || '--'}</td>
                              <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--color-text-secondary)' }}>{col.description || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
                      No columns defined for this asset.
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 20 }}>
                    Created {new Date(selectedAsset.createdAt).toLocaleDateString()} · Updated {new Date(selectedAsset.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              );
            })() : (
              <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Select a data asset from the list to view its details and columns.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
