import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { useOrgContext } from '../stores/orgContext';
import { errorMessage } from '../lib/errorToast';
import { ExpandedTask, type GovernanceTask } from './GovernanceTasksPage';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceTaskDetailPage — the full record for one governance task at
// /governance-work/tasks/:id, matching the People detail-page family. Reuses
// the shared ExpandedTask body (view → Edit → Save) on its own page.
// ──────────────────────────────────────────────────────────────────────────

interface Person { id: string; name: string; }

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};
const BACK = '/governance-work?tab=tasks';

export default function GovernanceTaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const { activeOrgId } = useOrgContext();
  const [task, setTask] = useState<GovernanceTask | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTask = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [res, pplRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovernanceTask }>(`/governance-tasks/${id}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
      ]);
      setTask(res.data);
      setPeople(pplRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load task'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchTask(); }, [fetchTask]);
  useBreadcrumbLeaf(task?.title);

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Governance task" title="Loading…" actions={<Link to={BACK} style={backLinkStyle}>{'←'} Back to Governance Work</Link>} />
        <Card><SkeletonRows rows={3} columns={2} /></Card>
      </div>
    );
  }

  if (error || !task) {
    return (
      <EmptyState
        title="Couldn't load this task"
        description={error || 'It may have been deleted.'}
        action={{ label: 'Back to Governance Work', onClick: () => navigate(BACK) }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        kicker="Governance task"
        title={task.title}
        copyId={task.id}
        copyLabel="Copy task ID"
        subtitle={task.taskType.replace(/_/g, ' ')}
        actions={<Link to={BACK} style={backLinkStyle}>{'←'} Back to Governance Work</Link>}
      />
      <Card>
        <ExpandedTask task={task} people={people} orgId={activeOrgId} canEdit={isAdmin} onSaved={fetchTask} />
      </Card>
    </div>
  );
}
