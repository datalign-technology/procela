// Phase 3 reverse view: data assets that exist in the catalog but
// have zero mapping rows pointing at them. The forward Discover loop
// asks "what data supports this step?"; this page asks the inverse —
// "what data do we have that nobody's using?".
//
// Most useful as a cleanup signal (delete / archive / reassign) and
// as a fresh-mapping hint (orphans that look process-shaped probably
// belong on a step nobody's mapped yet). We don't try to suggest
// where they belong here — that's the forward loop's job. We just
// surface them so a steward can investigate.

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { thStyle, tdStyle } from '../lib/tableStyles';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import { SkeletonRows } from '../components/Skeleton';

interface OrphanAsset {
  id: string;
  name: string;
  description: string;
  systemId: string;
  systemName: string | null;
  governanceTier: 'BRONZE' | 'SILVER' | 'GOLD';
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
}

const TIER_COLORS: Record<OrphanAsset['governanceTier'], { bg: string; fg: string }> = {
  BRONZE: { bg: '#fef3c7', fg: '#92400e' },
  SILVER: { bg: '#e2e8f0', fg: '#334155' },
  GOLD:   { bg: '#fce7c0', fg: '#92400e' },
};

export default function OrphanAssetsPage() {
  const { activeOrgId, refreshKey } = useOrgContext();
  const [rows, setRows] = useState<OrphanAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: OrphanAsset[] }>(
        `/data-assets/orphans${activeOrgId ? `?orgId=${activeOrgId}` : ''}`,
      );
      setRows(res.data || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load orphan assets');
      setRows([]);
    }
  }, [activeOrgId, refreshKey]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Orphan data assets"
        subtitle="Data assets in the catalog that aren't mapped to any process step. Investigate, retire, or map them to a step that uses them."
      />

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#7f1d1d', borderRadius: 4, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {rows === null && <SkeletonRows rows={5} columns={5} />}

      {rows !== null && rows.length === 0 && !error && (
        <EmptyState
          icon={renderNavIcon('/data-assets/orphans')}
          title="No orphan assets"
          description="Every data asset in this org is mapped to at least one process step. Nothing to clean up here right now."
        />
      )}

      {rows !== null && rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>System</th>
              <th style={thStyle}>Owner</th>
              <th style={thStyle}>Tier</th>
              <th style={thStyle}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const tier = TIER_COLORS[a.governanceTier] || TIER_COLORS.BRONZE;
              return (
                <tr key={a.id}>
                  <td style={tdStyle}>
                    <Link to={`/data-assets?id=${a.id}`} style={{ fontWeight: 500 }}>{a.name}</Link>
                    {a.description && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {a.description.length > 120 ? a.description.slice(0, 120) + '…' : a.description}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>{a.systemName || '—'}</td>
                  <td style={tdStyle}>{a.ownerName || '—'}</td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: tier.bg, color: tier.fg, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>{a.governanceTier}</span>
                  </td>
                  <td style={tdStyle}>{new Date(a.updatedAt).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
