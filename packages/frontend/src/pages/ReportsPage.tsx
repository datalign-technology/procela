import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { SkeletonRows } from '../components/Skeleton';
import PageHeader from '../components/PageHeader';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

const ExecutiveReportPage = lazy(() => import('./ExecutiveReportPage'));
const ScorecardPage       = lazy(() => import('./ScorecardPage'));

type ReportTab = 'executive' | 'scorecard' | 'analysis';

const TABS: { id: ReportTab; label: string; description: string }[] = [
  { id: 'executive', label: 'Executive Report', description: 'One-page overview for leadership.' },
  { id: 'scorecard', label: 'Scorecard',        description: 'Data and governance health by dimension.' },
  { id: 'analysis',  label: 'Analysis',         description: 'Saved cube pivots — the same reports you build on the Analysis page.' },
];

interface SavedAnalysisReport {
  id: string;
  name: string;
  description: string | null;
  ownerName: string | null;
  updatedAt: string;
}

// Surfaces Analysis-page saved reports here so the two "report homes"
// aren't disconnected. Read-only list + a link into the builder, where
// the report can be loaded/edited.
function AnalysisReportsTab() {
  const { activeOrgId } = useOrgContext();
  const [reports, setReports] = useState<SavedAnalysisReport[] | null>(null);

  useEffect(() => {
    const q = activeOrgId ? `?orgId=${encodeURIComponent(activeOrgId)}` : '';
    apiClient.get<{ success: boolean; data: SavedAnalysisReport[] }>(`/analysis-reports${q}`)
      .then((r) => setReports(r.data || []))
      .catch(() => setReports([]));
  }, [activeOrgId]);

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Pivot reports are built and edited on the Analysis page; saved ones appear here too.
        </div>
        <Link to="/analysis" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}>
          Open Analysis builder →
        </Link>
      </div>
      {reports === null ? (
        <SkeletonRows rows={4} columnWidths={[220, null, 120]} />
      ) : reports.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
          No saved analysis reports yet. Build a pivot on the Analysis page and save it.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {reports.map((r) => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                {r.description && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.description}</div>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                {r.ownerName ? `by ${r.ownerName}` : ''}
              </div>
              <Link to="/analysis" style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                Open →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as ReportTab | null;
  const active: ReportTab = TABS.some((t) => t.id === tabParam) ? (tabParam as ReportTab) : 'executive';

  useEffect(() => {
    if (!tabParam) setSearchParams({ tab: 'executive' }, { replace: true });
  }, [tabParam, setSearchParams]);

  const setActive = (id: ReportTab) => setSearchParams({ tab: id }, { replace: true });

  const TabContent = (() => {
    switch (active) {
      case 'executive': return <ExecutiveReportPage />;
      case 'scorecard': return <ScorecardPage />;
      case 'analysis':  return <AnalysisReportsTab />;
    }
  })();

  const activeTab = TABS.find((t) => t.id === active)!;

  return (
    <div>
      <PageHeader title="Reports" subtitle={activeTab.description} />

      <div
        role="tablist"
        aria-label="Report views"
        style={{
          display: 'flex', gap: 2, marginBottom: 16,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              style={{
                padding: '8px 16px',
                fontSize: 13, fontWeight: isActive ? 600 : 500,
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <Suspense fallback={
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <SkeletonRows rows={6} columns={4} />
        </div>
      }>
        {TabContent}
      </Suspense>
    </div>
  );
}
