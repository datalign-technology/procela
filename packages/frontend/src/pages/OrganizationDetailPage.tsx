import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { errorMessage } from '../lib/errorToast';

// ──────────────────────────────────────────────────────────────────────────
// OrganizationDetailPage — the full record for one org at /organizations/:id.
// Promotes the Organizations page's right master-detail pane into a full,
// shareable, breadcrumbed page, matching the detail-page family (Person /
// Agent / Skill / Glossary). Clicking a node in the org tree navigates here.
// ──────────────────────────────────────────────────────────────────────────

interface OrgFlat {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  industry: string;
  description: string;
  headCount?: number;
}
interface PersonRef { id: string; name: string; orgIds?: string[] }

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};
const chipLinkStyle: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none',
};
const emptyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<OrgFlat[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [orgRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: OrgFlat[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: PersonRef[] }>('/people'),
      ]);
      setOrgs(orgRes.data || []);
      setPeople(peopleRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load organization'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  const org = orgs.find((o) => o.id === id) || null;
  useBreadcrumbLeaf(org?.name);

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Organization" title="Loading…" actions={<Link to="/organizations" style={backLinkStyle}>{'←'} Back to Organizations</Link>} />
        <Card><SkeletonRows rows={3} columns={2} /></Card>
      </div>
    );
  }

  if (error || !org) {
    return (
      <EmptyState
        title="Couldn't load this organization"
        description={error || 'The organization may have been deleted or is outside your access.'}
        action={{ label: 'Back to Organizations', onClick: () => navigate('/organizations') }}
      />
    );
  }

  const parent = org.parentId ? orgs.find((o) => o.id === org.parentId) || null : null;
  const children = orgs.filter((o) => o.parentId === org.id);
  const members = people.filter((p) => (p.orgIds || []).includes(org.id));

  return (
    <div>
      <PageHeader
        kicker="Organization"
        title={org.name}
        copyId={org.id}
        copyLabel="Copy organization ID"
        subtitle={<span style={{ textTransform: 'capitalize' }}>{org.type}</span>}
        actions={<Link to="/organizations" style={backLinkStyle}>{'←'} Back to Organizations</Link>}
      />

      {/* Identity */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={10}>Identity</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <Field label="Type"><span style={{ textTransform: 'capitalize' }}>{org.type}</span></Field>
          <Field label="Industry">{org.industry || <span style={emptyStyle}>Not set</span>}</Field>
          <Field label="Parent">{parent ? <Link to={`/organizations/${parent.id}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{parent.name}</Link> : <span style={emptyStyle}>None (top level)</span>}</Field>
        </div>
        {org.description && (
          <div style={{ marginTop: 14 }}>
            <Field label="Description"><span style={{ color: 'var(--color-text-secondary)' }}>{org.description}</span></Field>
          </div>
        )}
      </Card>

      {/* Child organizations */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Child organizations ({children.length})</SectionLabel>
        {children.length === 0 ? <div style={emptyStyle}>No child organizations</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {children.map((c) => <Link key={c.id} to={`/organizations/${c.id}`} style={chipLinkStyle} title={c.type}>{c.name}</Link>)}
          </div>
        )}
      </Card>

      {/* People */}
      <Card>
        <SectionLabel marginBottom={8}>People ({members.length})</SectionLabel>
        {members.length === 0 ? <div style={emptyStyle}>No people assigned to this organization</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {members.map((p) => <Link key={p.id} to={`/people/${p.id}`} style={chipLinkStyle}>{p.name}</Link>)}
          </div>
        )}
      </Card>
    </div>
  );
}
