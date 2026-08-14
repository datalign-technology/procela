import Tabs from '../components/Tabs';
import PageHeader from '../components/PageHeader';
import GovernanceTasksPage from './GovernanceTasksPage';
import GovernanceIssuesPage from './GovernanceIssuesPage';
import DependencyBanner, { useDependencyChecks } from '../components/DependencyBanner';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceWorkPage — tabbed hub for governance tasks and issues.
// Tab state lives in the URL (?tab=tasks|issues) so links and reloads
// preserve the view.
//
// The hub owns one page title; the tab strip sits beneath it and each
// tab's page renders embedded (its own header suppressed, its toolbar
// portaled onto the tab-strip row) so there's a single header, not two.
// ──────────────────────────────────────────────────────────────────────────

export default function GovernanceWorkPage() {
  const deps = useDependencyChecks();

  return (
    <Tabs
      defaultTab="tasks"
      header={
        <>
          <DependencyBanner phase="Governance work flows from established policies and structure." checks={[
            { label: 'Create governance policies', met: deps.hasPolicies, link: '/governance-policies' },
            { label: 'Assign data stewards', met: deps.hasStewards, link: '/people' },
          ]} />
          <PageHeader
            title="Governance Work"
            subtitle="Your inbox of open governance work — tasks waiting for a steward, issues to triage, and approvals you need to sign off."
          />
        </>
      }
      tabs={[
        { id: 'tasks',  label: 'Tasks',  render: ({ actionsSlot }) => <GovernanceTasksPage embedded actionsPortal={actionsSlot} /> },
        { id: 'issues', label: 'Issues', render: ({ actionsSlot }) => <GovernanceIssuesPage embedded actionsPortal={actionsSlot} /> },
      ]}
    />
  );
}
