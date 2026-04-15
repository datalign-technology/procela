import { useSearchParams } from 'react-router-dom';
import GovernanceGroupsPage from './GovernanceGroupsPage';
import DataDomainsPage from './DataDomainsPage';
import DamaRolesPage from './DamaRolesPage';

// ──────────────────────────────────────────────────────────────────────────
// GovernancePage — tabbed aggregator over the three governance sub-pages
// (groups, domains, roles). Tab state lives in the URL so links and
// reloads preserve the view; reachable individually via their legacy
// routes for deep-link compatibility.
// ──────────────────────────────────────────────────────────────────────────

type GovTab = 'groups' | 'domains' | 'roles';

const TABS: { id: GovTab; label: string }[] = [
  { id: 'groups',  label: 'Governance Groups' },
  { id: 'domains', label: 'Data Domains' },
  { id: 'roles',   label: 'Governance Roles' },
];

export default function GovernancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as GovTab | null;
  const active: GovTab = TABS.some((t) => t.id === tabParam) ? (tabParam as GovTab) : 'groups';

  const setActive = (id: GovTab) => setSearchParams({ tab: id }, { replace: true });

  return (
    <div>
      <div
        role="tablist"
        aria-label="Governance views"
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
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {active === 'groups' && <GovernanceGroupsPage />}
      {active === 'domains' && <DataDomainsPage />}
      {active === 'roles' && <DamaRolesPage />}
    </div>
  );
}
