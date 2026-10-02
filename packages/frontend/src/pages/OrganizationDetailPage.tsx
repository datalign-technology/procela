import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import EmptyState from '../components/EmptyState';
import EditableField from '../components/EditableField';
import DetailEditActions from '../components/DetailEditActions';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { errorMessage, errorToast, successToast } from '../lib/errorToast';

// ──────────────────────────────────────────────────────────────────────────
// OrganizationDetailPage — the full record for one org at /organizations/:id.
// Opens read-only; the header Edit button flips the Identity fields into
// inputs in place (useDetailEditMode + EditableField + DetailEditActions),
// one Save writes them. The relationship cards (children, people) stay
// read-only. Clicking a node in the org tree navigates here.
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

interface OrgEditable {
  name: string;
  type: string;
  industry: string;
  description: string;
  parentId: string | null;
}

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};
const chipLinkStyle: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none',
};
const emptyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' };

// Known org-type ordering; we offer the distinct types present plus these as
// a floor, so the select always covers the real taxonomy.
const KNOWN_TYPES = ['company', 'division', 'department', 'team', 'unit'];

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = usePermissions();
  const [orgs, setOrgs] = useState<OrgFlat[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
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

  const m = useDetailEditMode<OrgEditable>(
    {
      name: org?.name ?? '',
      type: org?.type ?? '',
      industry: org?.industry ?? '',
      description: org?.description ?? '',
      parentId: org?.parentId ?? null,
    },
    async (draft) => {
      if (!id) return;
      try {
        await apiClient.put(`/organizations/${id}`, draft);
        successToast('Organization updated');
        await fetchAll();
      } catch (err) { errorToast(err, 'Failed to update organization'); throw err; }
    },
  );

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

  const typeOptions = Array.from(new Set([...KNOWN_TYPES, ...orgs.map((o) => o.type).filter(Boolean)]))
    .map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));
  const parentOptions = [
    { value: '', label: 'None (top level)' },
    ...orgs.filter((o) => o.id !== org.id).map((o) => ({ value: o.id, label: o.name })),
  ];

  return (
    <div>
      <PageHeader
        kicker="Organization"
        title={org.name}
        copyId={org.id}
        copyLabel="Copy organization ID"
        subtitle={<span style={{ textTransform: 'capitalize' }}>{org.type}</span>}
        actions={
          <DetailEditActions
            editing={m.isEditing}
            canEdit={canWrite}
            dirty={m.dirty}
            saving={m.saving}
            onEdit={m.enter}
            onCancel={m.cancel}
            onSave={m.save}
            before={<Link to="/organizations" style={backLinkStyle}>{'←'} Back to Organizations</Link>}
          />
        }
      />

      {/* Identity */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={10}>Identity</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {m.isEditing && (
            <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="Organization name" />
          )}
          <EditableField
            label="Type"
            editing={m.isEditing}
            value={m.draft.type}
            onChange={(v) => m.set('type', v)}
            type="select"
            options={typeOptions}
          >
            <span style={{ textTransform: 'capitalize' }}>{org.type}</span>
          </EditableField>
          <EditableField
            label="Industry"
            editing={m.isEditing}
            value={m.draft.industry}
            onChange={(v) => m.set('industry', v)}
            placeholder="e.g. Utilities"
            emptyText="Not set"
          />
          <EditableField
            label="Parent"
            editing={m.isEditing}
            renderEdit={() => (
              <select
                aria-label="Parent"
                value={m.draft.parentId ?? ''}
                onChange={(e) => m.set('parentId', e.target.value || null)}
                style={{ fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 8px', width: '100%', background: 'var(--color-surface)', color: 'var(--color-text)', appearance: 'auto', boxSizing: 'border-box' }}
              >
                {parentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          >
            {parent
              ? <Link to={`/organizations/${parent.id}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{parent.name}</Link>
              : <span style={emptyStyle}>None (top level)</span>}
          </EditableField>
        </div>
        <div style={{ marginTop: 14 }}>
          <EditableField
            label="Description"
            editing={m.isEditing}
            type="textarea"
            value={m.draft.description}
            onChange={(v) => m.set('description', v)}
            placeholder="What this organization does"
            emptyText="No description"
          >
            {org.description ? <span style={{ color: 'var(--color-text-secondary)' }}>{org.description}</span> : undefined}
          </EditableField>
        </div>
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
