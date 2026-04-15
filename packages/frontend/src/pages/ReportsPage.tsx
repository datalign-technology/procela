import { lazy, Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SkeletonRows } from '../components/Skeleton';

// Lazy-load each report so they don't all mount on first nav.
const ExecutiveReportPage = lazy(() => import('./ExecutiveReportPage'));
const ScorecardPage       = lazy(() => import('./ScorecardPage'));
const GapDetectionPage    = lazy(() => import('./GapDetectionPage'));
const RaciMatrixPage      = lazy(() => import('./RaciMatrixPage'));
const ComparisonPage      = lazy(() => import('./ComparisonPage'));

// ──────────────────────────────────────────────────────────────────────────
// ReportsPage — consolidated home for the five analysis views that used
// to be separate sidebar entries (Executive Report, Scorecard, Gap
// Detection, RACI Matrix, Comparison). Tabs share the same chrome and
// the active tab is encoded in the URL (?tab=scorecard) so links are
// shareable and refresh preserves the view.
//
// Each tab renders the existing page component verbatim — no logic was
// duplicated. Legacy routes (/report, /scorecard, /gap-detection, /raci,
// /processes/compare) still resolve directly for deep links that already
// exist in the wild.
// ──────────────────────────────────────────────────────────────────────────

type ReportTab = 'executive' | 'scorecard' | 'gaps' | 'raci' | 'compare';

const TABS: { id: ReportTab; label: string; description: string }[] = [
  { id: 'executive', label: 'Executive Report', description: 'One-page overview for leadership.' },
  { id: 'scorecard', label: 'Scorecard',        description: 'Data and governance health by dimension.' },
  { id: 'gaps',      label: 'Gap Detection',    description: 'Process steps and assets missing coverage.' },
  { id: 'raci',      label: 'RACI Matrix',      description: 'Responsibility grid across processes and people.' },
  { id: 'compare',   label: 'Compare Streams',  description: 'Side-by-side value-stream comparison.' },
];

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as ReportTab | null;
  const active: ReportTab = TABS.some((t) => t.id === tabParam) ? (tabParam as ReportTab) : 'executive';

  // If a user landed on one of the legacy /report /scorecard /raci etc.
  // routes, the route file still renders the page directly; this hub is
  // opt-in via /reports. No redirect logic needed here.
  useEffect(() => {
    if (!tabParam) setSearchParams({ tab: 'executive' }, { replace: true });
  }, [tabParam, setSearchParams]);

  const setActive = (id: ReportTab) => setSearchParams({ tab: id }, { replace: true });

  const TabContent = (() => {
    switch (active) {
      case 'executive': return <ExecutiveReportPage />;
      case 'scorecard': return <ScorecardPage />;
      case 'gaps':      return <GapDetectionPage />;
      case 'raci':      return <RaciMatrixPage />;
      case 'compare':   return <ComparisonPage />;
    }
  })();

  const activeTab = TABS.find((t) => t.id === active)!;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Reports</h1>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
          {activeTab.description}
        </p>
      </div>

      {/* Tabs */}
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
                padding: '10px 18px',
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

      {/* Active report */}
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
