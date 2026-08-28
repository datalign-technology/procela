import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SkeletonRows } from '../components/Skeleton';
import PageHeader from '../components/PageHeader';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';

interface UserReportSummary {
  id: string;
  name: string;
  description: string;
  visibility: 'private' | 'org';
  primaryEntity: string;
  columnCount: number;
  updatedAt: string;
}

// ── User Reports tab — saved Report Builder definitions ────────────────────

function UserReportsTab() {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const [reports, setReports] = useState<UserReportSummary[] | null>(null);

  const load = useCallback(() => {
    if (!activeOrgId) { setReports([]); return; }
    apiClient.get<{ success: boolean; data: UserReportSummary[] }>(`/reports?orgId=${activeOrgId}`)
      .then((r) => setReports(r.data || []))
      .catch(() => setReports([]));
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      await apiClient.delete(`/reports/${id}`);
      addToast('success', `Deleted "${name}".`);
      load();
    } catch {
      addToast('error', 'Delete failed.');
    }
  };

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Reports you've built with the Report Builder. Click any to open it.
        </div>
        <Link
          to="/reports/builder"
          style={{
            fontSize: 13, fontWeight: 600,
            color: '#fff', background: 'var(--color-primary)',
            padding: '6px 14px', borderRadius: 4, textDecoration: 'none',
          }}
        >
          + New report
        </Link>
      </div>
      {reports === null ? (
        <SkeletonRows rows={4} columnWidths={[220, null, 120]} />
      ) : reports.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          No reports yet. Click <strong>+ New report</strong> to build one.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {reports.map((r) => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.name}
                  {r.visibility === 'private' && (
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                      PRIVATE
                    </span>
                  )}
                </div>
                {r.description && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.description}</div>}
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {r.primaryEntity} · {r.columnCount} {r.columnCount === 1 ? 'column' : 'columns'}
                </div>
              </div>
              <button
                onClick={() => navigate(`/reports/builder/${r.id}`)}
                style={{ fontSize: 12, color: 'var(--color-primary)', background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Open →
              </button>
              <button
                onClick={() => remove(r.id, r.name)}
                style={{ fontSize: 12, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                title="Delete report"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReportsPage() {
  // Reports is now just the report catalog + Builder. The Executive Report and
  // Governance Maturity Scorecard tabs were removed, so the tab bar is gone too.
  return (
    <div>
      <PageHeader title="Reports" subtitle="Reports you and your org have built against the Procela data model." />
      <UserReportsTab />
    </div>
  );
}
