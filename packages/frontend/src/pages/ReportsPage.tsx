import { lazy, Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SkeletonRows } from '../components/Skeleton';

const ExecutiveReportPage = lazy(() => import('./ExecutiveReportPage'));
const ScorecardPage       = lazy(() => import('./ScorecardPage'));

type ReportTab = 'executive' | 'scorecard';

const TABS: { id: ReportTab; label: string; description: string }[] = [
  { id: 'executive', label: 'Executive Report', description: 'One-page overview for leadership.' },
  { id: 'scorecard', label: 'Scorecard',        description: 'Data and governance health by dimension.' },
];

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
    }
  })();

  const activeTab = TABS.find((t) => t.id === active)!;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Reports</h1>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
          {activeTab.description}
        </p>
      </div>

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
