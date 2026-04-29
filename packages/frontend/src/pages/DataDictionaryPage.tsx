import { useEffect, useState, useCallback } from 'react';
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

interface SystemRef {
  id: string;
  name: string;
  systemType?: string;
}

interface Person {
  id: string;
  name: string;
}

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
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  background: 'var(--color-surface)',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'auto' as any,
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

/* ── Helpers ─────────────────────────────────────────────────────── */

const TIER_COLORS: Record<string, { bg: string; text: string }> = {
  GOLD: { bg: '#fef3c7', text: '#92400e' },
  SILVER: { bg: '#f3f4f6', text: '#374151' },
  BRONZE: { bg: '#fed7aa', text: '#9a3412' },
};

function tierBadge(tier?: string) {
  if (!tier) return null;
  const colors = TIER_COLORS[tier] || { bg: '#e5e7eb', text: '#374151' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.04em',
      background: colors.bg,
      color: colors.text,
    }}>
      {tier}
    </span>
  );
}

function healthBar(score?: number) {
  if (score == null) return <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>N/A</span>;
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block',
        width: 48,
        height: 6,
        background: '#e5e7eb',
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <span style={{ display: 'block', height: '100%', width: `${score}%`, background: color, borderRadius: 3 }} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color }}>{score}%</span>
    </span>
  );
}

/* ── Component ───────────────────────────────────────────────────── */

export default function DataDictionaryPage() {
  const { activeOrgId, activeOrgName } = useOrgContext();

  const [assets, setAssets] = useState<DataAssetEntity[]>([]);
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [systems, setSystems] = useState<SystemRef[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [columnsMap, setColumnsMap] = useState<Record<string, DataAssetColumn[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterDomain, setFilterDomain] = useState('');
  const [filterTier, setFilterTier] = useState('');
  const [filterClassification, setFilterClassification] = useState('');

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

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Fetch columns for all assets after initial load
  useEffect(() => {
    if (assets.length > 0 && Object.keys(columnsMap).length === 0) {
      setLoadingColumns(true);
      Promise.all(
        assets.map((a) =>
          apiClient
            .get<{ success: boolean; data: DataAssetColumn[] }>(`/data-assets/${a.id}/columns`)
            .then((r) => [a.id, r.data || []] as [string, DataAssetColumn[]])
            .catch(() => [a.id, []] as [string, DataAssetColumn[]])
        )
      )
        .then((results) => {
          const map: Record<string, DataAssetColumn[]> = {};
          for (const [id, cols] of results) map[id] = cols;
          setColumnsMap(map);
        })
        .finally(() => setLoadingColumns(false));
    }
  }, [assets]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Lookups ─────────────────────────────────────────────────── */

  const systemMap = new Map(systems.map((s) => [s.id, s]));
  const personMap = new Map(people.map((p) => [p.id, p]));

  const personName = (id?: string | null) => {
    if (!id) return null;
    return personMap.get(id)?.name || null;
  };

  /* ── Build domain-grouped structure ──────────────────────────── */

  // Map of domain id -> domain
  const domainMap = new Map(domains.map((d) => [d.id, d]));

  // Build asset -> domain lookup from domain.dataAssetIds
  const assetDomainMap = new Map<string, string>();
  for (const domain of domains) {
    for (const aid of domain.dataAssetIds || []) {
      assetDomainMap.set(aid, domain.id);
    }
  }

  // Apply filters
  const filteredAssets = assets.filter((a) => {
    if (filterTier && a.governanceTier !== filterTier) return false;
    if (filterClassification && a.dataClassification !== filterClassification) return false;
    if (filterDomain) {
      const domainId = assetDomainMap.get(a.id);
      if (filterDomain === '__unassigned__') {
        if (domainId) return false;
      } else {
        if (domainId !== filterDomain) return false;
      }
    }
    return true;
  });

  // Group by domain
  const grouped = new Map<string | null, DataAssetEntity[]>();
  for (const asset of filteredAssets) {
    const domainId = assetDomainMap.get(asset.id) || null;
    if (!grouped.has(domainId)) grouped.set(domainId, []);
    grouped.get(domainId)!.push(asset);
  }

  // Sort domain keys: named domains alphabetically, null (unassigned) last
  const sortedDomainKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const nameA = domainMap.get(a)?.name || '';
    const nameB = domainMap.get(b)?.name || '';
    return nameA.localeCompare(nameB);
  });

  // Unique classifications for filter
  const classificationOptions = Array.from(new Set(assets.map((a) => a.dataClassification).filter(Boolean))) as string[];

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  /* ── Render ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div>
        <div className="no-print">
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Data Dictionary</h1>
        <div style={{ color: 'var(--color-text-muted)' }}>Loading data dictionary...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="no-print">
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Data Dictionary</h1>
        <div style={{ color: 'var(--color-danger, #ef4444)' }}>Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="data-dictionary">
      <style>{`
        @media print {
          nav, header, aside, button, .no-print { display: none !important; }
          body { background: white !important; font-size: 11pt; font-family: Georgia, 'Times New Roman', serif; }
          main { padding: 0 !important; margin: 0 !important; }
          .dictionary-content { box-shadow: none !important; border: none !important; border-radius: 0 !important; }
          .domain-section { page-break-inside: avoid; }
          .asset-card { page-break-inside: avoid; }
          .print-header { display: block !important; }
          .column-table tr:nth-child(even) { background: #f9fafb !important; }
        }
        .column-table tr:nth-child(even) { background: var(--color-bg, #f9fafb); }
      `}</style>

      {/* Screen header (hidden when printing) */}
      <div className="no-print">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Data Dictionary</h1>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              Comprehensive catalog of data assets, definitions, ownership, and technical details.
            </p>
          </div>
          <button onClick={() => window.print()} style={btnPrimary}>
            Print / Export PDF
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ minWidth: 180 }}>
            <select
              style={selectStyle}
              value={filterDomain}
              onChange={(e) => setFilterDomain(e.target.value)}
            >
              <option value="">All Domains</option>
              {domains
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              <option value="__unassigned__">Unassigned</option>
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <select
              style={selectStyle}
              value={filterClassification}
              onChange={(e) => setFilterClassification(e.target.value)}
            >
              <option value="">All Classifications</option>
              {classificationOptions.sort().map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <select
              style={selectStyle}
              value={filterTier}
              onChange={(e) => setFilterTier(e.target.value)}
            >
              <option value="">All Tiers</option>
              <option value="GOLD">Gold</option>
              <option value="SILVER">Silver</option>
              <option value="BRONZE">Bronze</option>
            </select>
          </div>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            Last published: {today}
          </span>
        </div>
      </div>

      {/* Print header (visible only when printing) */}
      <div className="print-header" style={{ display: 'none', textAlign: 'center', marginBottom: 32, borderBottom: '3px solid #0f4f46', paddingBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f4f46', margin: 0 }}>
          {activeOrgName || 'Organization'}
        </h1>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: '#334155', margin: '8px 0 0' }}>
          Data Dictionary
        </h2>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
          Generated {today}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
          {filteredAssets.length} data asset{filteredAssets.length !== 1 ? 's' : ''} across {sortedDomainKeys.length} domain{sortedDomainKeys.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Dictionary content */}
      <div
        className="dictionary-content"
        style={{
          background: 'var(--color-surface, #fff)',
          border: '1px solid var(--color-border, #e5e7eb)',
          borderRadius: 'var(--radius-md, 8px)',
          padding: 32,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {filteredAssets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
            {assets.length === 0
              ? 'No data assets have been defined yet. Create data assets in the Data Assets tab to populate this dictionary.'
              : 'No data assets match the selected filters.'}
          </div>
        ) : (
          sortedDomainKeys.map((domainId) => {
            const domain = domainId ? domainMap.get(domainId) : null;
            const domainAssets = grouped.get(domainId) || [];
            const domainName = domain?.name || 'Unassigned';

            // Sort assets alphabetically within each domain
            const sortedAssets = domainAssets.slice().sort((a, b) => a.name.localeCompare(b.name));

            return (
              <div key={domainId || '__unassigned__'} className="domain-section" style={{ marginBottom: 40 }}>
                {/* Domain header */}
                <div style={{
                  borderTop: '3px solid var(--color-primary, #0f4f46)',
                  paddingTop: 16,
                  marginBottom: 20,
                }}>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-primary, #0f4f46)', margin: 0 }}>
                    {domainName}
                  </h2>
                  {domain && (
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 6 }}>
                      <span>
                        {domain.ownerName && (
                          <>
                            <strong>Owner:</strong> {domain.ownerName}
                          </>
                        )}
                        {domain.stewards && domain.stewards.length > 0 && (
                          <>
                            {domain.ownerName ? ' | ' : ''}
                            <strong>Steward{domain.stewards.length > 1 ? 's' : ''}:</strong>{' '}
                            {domain.stewards.map((s) => s.name).join(', ')}
                          </>
                        )}
                      </span>
                      {domain.description && (
                        <div style={{ marginTop: 4, color: 'var(--color-text-muted)' }}>
                          {domain.description}
                        </div>
                      )}
                    </div>
                  )}
                  {!domain && (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      Data assets not assigned to any domain.
                    </div>
                  )}
                </div>

                {/* Asset cards */}
                {sortedAssets.map((asset) => {
                  const cols = columnsMap[asset.id] || [];
                  const sys = systemMap.get(asset.systemId);
                  const ownerDisplay = asset.ownerName || personName(asset.owner);
                  const stewardDisplay =
                    asset.stewardName ||
                    (asset.stewardIds && asset.stewardIds.length > 0
                      ? asset.stewardIds.map((sid) => personName(sid)).filter(Boolean).join(', ')
                      : null);

                  return (
                    <div
                      key={asset.id}
                      className="asset-card"
                      style={{
                        border: '1px solid var(--color-border, #e5e7eb)',
                        padding: 20,
                        marginBottom: 16,
                      }}
                    >
                      {/* Asset header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>
                          {asset.name}
                        </h3>
                      </div>

                      {/* System */}
                      {sys && (
                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                          <strong>System:</strong> {sys.name}
                          {sys.systemType ? ` (${sys.systemType})` : ''}
                        </div>
                      )}

                      {/* Tier, Health, Classification row */}
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 13 }}>
                        {asset.governanceTier && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <strong>Tier:</strong> {tierBadge(asset.governanceTier)}
                          </span>
                        )}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <strong>Health:</strong> {healthBar(asset.healthScore)}
                        </span>
                        {asset.dataClassification && (
                          <span>
                            <strong>Classification:</strong>{' '}
                            <span style={{
                              display: 'inline-block',
                              padding: '1px 6px',
                              borderRadius: 3,
                              fontSize: 11,
                              fontWeight: 600,
                              background: '#e0e7ff',
                              color: '#3730a3',
                            }}>
                              {asset.dataClassification}
                            </span>
                          </span>
                        )}
                      </div>

                      {/* Owner & Steward */}
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                        {ownerDisplay && (
                          <>
                            <strong>Owner:</strong> {ownerDisplay}
                          </>
                        )}
                        {stewardDisplay && (
                          <>
                            {ownerDisplay ? ' | ' : ''}
                            <strong>Steward:</strong> {stewardDisplay}
                          </>
                        )}
                      </div>

                      {/* Description */}
                      {asset.description && (
                        <div style={{ fontSize: 13, color: 'var(--color-text)', marginBottom: 12, lineHeight: 1.5 }}>
                          {asset.description}
                        </div>
                      )}

                      {/* Columns table */}
                      {loadingColumns && cols.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          Loading columns...
                        </div>
                      ) : cols.length > 0 ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Columns
                          </div>
                          <table className="column-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid var(--color-border, #e5e7eb)' }}>
                                <th style={{ textAlign: 'left', padding: '4px 10px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                  Name
                                </th>
                                <th style={{ textAlign: 'left', padding: '4px 10px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                  Type
                                </th>
                                <th style={{ textAlign: 'left', padding: '4px 10px', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                  Description
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {cols.map((col) => (
                                <tr key={col.id} style={{ borderBottom: '1px solid var(--color-border, #f1f5f9)' }}>
                                  <td style={{ padding: '4px 10px', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                                    {col.columnName}
                                  </td>
                                  <td style={{ padding: '4px 10px', fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                                    {col.dataType || '--'}
                                  </td>
                                  <td style={{ padding: '4px 10px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                    {col.description || ''}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      {/* Source and metadata footer */}
                      {(asset.sourceAsset || asset.refreshFrequency || asset.retentionPolicy) && (
                        <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--color-border, #f1f5f9)', fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                          {asset.sourceAsset && (
                            <span>
                              <strong>Source:</strong>{' '}
                              {sys ? `${sys.name} ` : ''}
                              {asset.sourceAsset}
                              {asset.sourceColumn ? ` > ${asset.sourceColumn}` : ''}
                            </span>
                          )}
                          {asset.refreshFrequency && (
                            <span>
                              <strong>Refresh:</strong> {asset.refreshFrequency}
                            </span>
                          )}
                          {asset.retentionPolicy && (
                            <span>
                              <strong>Retention:</strong> {asset.retentionPolicy}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}

        {/* Footer */}
        <div style={{
          borderTop: '2px solid var(--color-border, #e5e7eb)',
          paddingTop: 16,
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--color-text-muted, #94a3b8)',
          marginTop: 24,
        }}>
          Generated by Procela -- {today}
        </div>
      </div>
    </div>
  );
}
