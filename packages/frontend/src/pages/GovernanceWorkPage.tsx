import { useCallback, useEffect, useState } from 'react';
import Tabs from '../components/Tabs';
import PageHeader from '../components/PageHeader';
import GovernanceTasksPage from './GovernanceTasksPage';
import GovernanceIssuesPage from './GovernanceIssuesPage';
import DependencyBanner, { useDependencyChecks } from '../components/DependencyBanner';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useRefreshOnFocus } from '../hooks/usePolling';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceWorkPage — tabbed hub for governance tasks and issues.
// Tab state lives in the URL (?tab=tasks|issues) so links and reloads
// preserve the view.
//
// The hub owns one page title; the tab strip sits beneath it and each
// tab's page renders embedded (its own header suppressed, its toolbar
// portaled onto the tab-strip row) so there's a single header, not two.
// Each tab label carries a live count of OPEN work (not the catalogue total),
// so the strip reads as an inbox — what's still waiting, per lane.
// ──────────────────────────────────────────────────────────────────────────

interface Summary {
  byStatus?: Record<string, number>;
}

export default function GovernanceWorkPage() {
  const deps = useDependencyChecks();
  const { activeOrgId } = useOrgContext();
  const [openTasks, setOpenTasks] = useState<number | null>(null);
  const [openIssues, setOpenIssues] = useState<number | null>(null);

  const loadCounts = useCallback(async () => {
    const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
    try {
      const [tasksRes, issuesRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Summary }>(`/governance-tasks/summary${query}`),
        apiClient.get<{ success: boolean; data: Summary }>(`/governance-issues/summary${query}`),
      ]);
      const ts = tasksRes.data?.byStatus || {};
      const is = issuesRes.data?.byStatus || {};
      setOpenTasks((ts.OPEN || 0) + (ts.IN_PROGRESS || 0));
      setOpenIssues((is.OPEN || 0) + (is.INVESTIGATING || 0) + (is.IN_PROGRESS || 0));
    } catch {
      // Counts are a convenience; a failed probe just leaves the labels bare.
      setOpenTasks(null);
      setOpenIssues(null);
    }
  }, [activeOrgId]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useRefreshOnFocus(loadCounts);

  const tasksLabel = openTasks != null && openTasks > 0 ? `Tasks (${openTasks})` : 'Tasks';
  const issuesLabel = openIssues != null && openIssues > 0 ? `Issues (${openIssues})` : 'Issues';

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
        { id: 'tasks',  label: tasksLabel,  render: ({ actionsSlot }) => <GovernanceTasksPage embedded actionsPortal={actionsSlot} /> },
        { id: 'issues', label: issuesLabel, render: ({ actionsSlot }) => <GovernanceIssuesPage embedded actionsPortal={actionsSlot} /> },
      ]}
    />
  );
}
