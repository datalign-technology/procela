import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { errorMessage } from '../lib/errorToast';
import { ExpandedRule, type QualityRule } from './DataQualityPage';

// ──────────────────────────────────────────────────────────────────────────
// DataQualityRuleDetailPage — the full record for one quality rule at
// /data-assets/rules/:id, matching the People detail-page family. Reuses the
// shared ExpandedRule body (view → Edit → Save) on its own page, so the Rules
// tab opens a record the same way the Registry tab does (a detail page, not a
// modal).
// ──────────────────────────────────────────────────────────────────────────

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};
const BACK = '/data-assets?tab=rules';

export default function DataQualityRuleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = usePermissions();
  const [rule, setRule] = useState<QualityRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Header slot the detail body portals its Edit / Save·Cancel cluster into,
  // so it sits in the PageHeader next to Back (the People detail-page layout).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  const fetchRule = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: QualityRule }>(`/data-quality/${id}`);
      setRule(res.data);
    } catch (err) {
      setError(errorMessage(err, 'Could not load quality rule'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchRule(); }, [fetchRule]);
  useBreadcrumbLeaf(rule?.name);

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Quality rule" title="Loading…" actions={<Link to={BACK} style={backLinkStyle}>{'←'} Back to Data Assets</Link>} />
        <Card><SkeletonRows rows={3} columns={2} /></Card>
      </div>
    );
  }

  if (error || !rule) {
    return (
      <EmptyState
        title="Couldn't load this rule"
        description={error || 'It may have been deleted.'}
        action={{ label: 'Back to Data Assets', onClick: () => navigate(BACK) }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        kicker="Quality rule"
        title={rule.name}
        copyId={rule.id}
        copyLabel="Copy rule ID"
        subtitle={rule.dataAssetName || rule.dataAssetId}
        actions={<>
          <Link to={BACK} style={backLinkStyle}>{'←'} Back to Data Assets</Link>
          <span ref={setActionsSlot} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} />
        </>}
      />
      <Card>
        <ExpandedRule rule={rule} canWrite={canWrite} onSaved={fetchRule} actionsSlot={actionsSlot} />
      </Card>
    </div>
  );
}
