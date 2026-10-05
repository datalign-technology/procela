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
import {
  ExpandedDecisionRight,
  CATEGORY_LABELS,
  type DecisionRight,
  type DecisionPerson,
  type DecisionGroup,
} from './DecisionRightsPage';

// ──────────────────────────────────────────────────────────────────────────
// DecisionRightDetailPage — the full record for one decision right at
// /decision-rights/:id, matching the People/Agent/Skill detail-page family.
// Reuses the shared ExpandedDecisionRight body (view → Edit → Save) the list
// used inline, now rendered on its own page with a breadcrumb + Back link.
// ──────────────────────────────────────────────────────────────────────────

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

export default function DecisionRightDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const { activeOrgId } = useOrgContext();
  const [row, setRow] = useState<DecisionRight | null>(null);
  const [people, setPeople] = useState<DecisionPerson[]>([]);
  const [groups, setGroups] = useState<DecisionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRow = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [res, pplRes, grpRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DecisionRight }>(`/decision-rights/${id}`),
        apiClient.get<{ success: boolean; data: DecisionPerson[] }>('/people'),
        apiClient.get<{ success: boolean; data: DecisionGroup[] }>(`/governance-groups${query}`).catch(() => ({ success: true, data: [] as DecisionGroup[] })),
      ]);
      setRow(res.data);
      setPeople(pplRes.data || []);
      setGroups(grpRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load decision right'));
    } finally {
      setLoading(false);
    }
  }, [id, activeOrgId]);

  useEffect(() => { fetchRow(); }, [fetchRow]);
  useBreadcrumbLeaf(row?.decision);

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Decision right" title="Loading…" actions={<Link to="/decision-rights" style={backLinkStyle}>{'←'} Back to Decision Rights</Link>} />
        <Card><SkeletonRows rows={3} columns={2} /></Card>
      </div>
    );
  }

  if (error || !row) {
    return (
      <EmptyState
        title="Couldn't load this decision right"
        description={error || 'It may have been deleted.'}
        action={{ label: 'Back to Decision Rights', onClick: () => navigate('/decision-rights') }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        kicker="Decision right"
        title={row.decision}
        copyId={row.id}
        copyLabel="Copy decision-right ID"
        subtitle={CATEGORY_LABELS[row.category] || row.category}
        actions={<Link to="/decision-rights" style={backLinkStyle}>{'←'} Back to Decision Rights</Link>}
      />
      <Card>
        <ExpandedDecisionRight
          row={row}
          people={people}
          groups={groups}
          orgId={activeOrgId}
          canEdit={isAdmin}
          onSaved={fetchRow}
          showRecommends
          showApproves
          showInformed
          showEscalation
        />
      </Card>
    </div>
  );
}
