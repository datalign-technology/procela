import { useSearchParams } from 'react-router-dom';
import GovernanceTasksPage from './GovernanceTasksPage';
import GovernanceIssuesPage from './GovernanceIssuesPage';
import DependencyBanner, { useDependencyChecks } from '../components/DependencyBanner';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceWorkPage — tabbed hub for governance tasks and issues.
// Tab state lives in the URL (?tab=tasks|issues) so links and reloads
// preserve the view.
// ──────────────────────────────────────────────────────────────────────────

type WorkTab = 'tasks' | 'issues';

const TABS: { id: WorkTab; label: string }[] = [
  { id: 'tasks',  label: 'Tasks' },
  { id: 'issues', label: 'Issues' },
];

export default function GovernanceWorkPage() {
  const deps = useDependencyChecks();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as WorkTab | null;
  const active: WorkTab = TABS.some((t) => t.id === tabParam) ? (tabParam as WorkTab) : 'tasks';

  const setActive = (id: WorkTab) => setSearchParams({ tab: id }, { replace: true });

  return (
    <div>
      <DependencyBanner phase="Governance work flows from established policies and structure." checks={[
        { label: 'Create governance policies', met: deps.hasPolicies, link: '/governance-policies' },
        { label: 'Assign data stewards', met: deps.hasStewards, link: '/people' },
      ]} />
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Governance Work</h1>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
          Manage governance tasks, issues, and approvals.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Governance work views"
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
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
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

      {active === 'tasks' && <GovernanceTasksPage />}
      {active === 'issues' && <GovernanceIssuesPage />}
    </div>
  );
}
