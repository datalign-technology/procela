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
import { ExpandedIssue, type GovernanceIssue } from './GovernanceIssuesPage';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceIssueDetailPage — the full record for one governance issue at
// /governance-work/issues/:id, matching the People detail-page family. Reuses
// the shared ExpandedIssue body (view → Edit → Save) on its own page.
// ──────────────────────────────────────────────────────────────────────────

interface Person { id: string; name: string; }
interface DataDomain { id: string; name: string; }

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};
const BACK = '/governance-work?tab=issues';

export default function GovernanceIssueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const { activeOrgId } = useOrgContext();
  const [issue, setIssue] = useState<GovernanceIssue | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIssue = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [res, pplRes, domRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovernanceIssue }>(`/governance-issues/${id}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: DataDomain[] }>(`/data-domains${query}`).catch(() => ({ success: true, data: [] as DataDomain[] })),
      ]);
      setIssue(res.data);
      setPeople(pplRes.data || []);
      setDomains(domRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load issue'));
    } finally {
      setLoading(false);
    }
  }, [id, activeOrgId]);

  useEffect(() => { fetchIssue(); }, [fetchIssue]);
  useBreadcrumbLeaf(issue?.title);

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Governance issue" title="Loading…" actions={<Link to={BACK} style={backLinkStyle}>{'←'} Back to Governance Work</Link>} />
        <Card><SkeletonRows rows={3} columns={2} /></Card>
      </div>
    );
  }

  if (error || !issue) {
    return (
      <EmptyState
        title="Couldn't load this issue"
        description={error || 'It may have been deleted.'}
        action={{ label: 'Back to Governance Work', onClick: () => navigate(BACK) }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        kicker="Governance issue"
        title={issue.title}
        copyId={issue.id}
        copyLabel="Copy issue ID"
        subtitle={issue.issueType.replace(/_/g, ' ')}
        actions={<Link to={BACK} style={backLinkStyle}>{'←'} Back to Governance Work</Link>}
      />
      <Card>
        <ExpandedIssue issue={issue} people={people} domains={domains} orgId={activeOrgId} canEdit={isAdmin} onSaved={fetchIssue} />
      </Card>
    </div>
  );
}
