import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import EmptyState from '../components/EmptyState';
import EditableField from '../components/EditableField';
import DetailEditActions from '../components/DetailEditActions';
import Avatar from '../components/Avatar';
import TruncatedText from '../components/TruncatedText';
import { renderNavIcon } from '../components/navIcons';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { errorMessage, errorToast, successToast } from '../lib/errorToast';

// ──────────────────────────────────────────────────────────────────────────
// OrganizationDetailPage — the 360° record for one org at /organizations/:id.
// Two-column master-detail (main relationships + a Facts rail), matching the
// People / Data Asset / System detail family. Opens read-only; the header
// Edit button flips the Facts-rail identity fields into inputs in place
// (useDetailEditMode + EditableField + DetailEditActions); one Save writes
// them. The relationship sections (sub-organizations, people, scoped entities)
// stay read-only. Clicking a node in the org tree navigates here.
//
// Note: organizations carry no "owner" person in the data model (org
// "ownership" is RBAC access-level + the ROI model, not an assigned person),
// so the redesign board's Owner row / column are omitted rather than faked.
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
interface PersonRef { id: string; name: string; title?: string; role?: string; orgIds?: string[] }
interface AgentRef { id: string; orgIds?: string[] }
interface SystemRef { id: string; orgId?: string }
interface DamaRoleRef { id: string; scopeType?: string; scopeId?: string }
interface ProcNodeRef { id: string; level?: string; orgId?: string; orgIds?: string[] }

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
const chartLinkStyle: React.CSSProperties = {
  padding: '8px 14px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const emptyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' };
const linkStyle: React.CSSProperties = { color: 'var(--color-primary)', textDecoration: 'none' };

// Type → pill palette (mirrors the list page's type badges, as dotted pills).
const TYPE_PILL: Record<string, { bg: string; color: string }> = {
  company: { bg: '#dbeafe', color: '#1e40af' },
  division: { bg: '#ede9fe', color: '#5b21b6' },
  department: { bg: '#d1f0eb', color: '#0f4f46' },
  team: { bg: '#fef3c7', color: '#92400e' },
  unit: { bg: '#f1f5f9', color: '#64748b' },
};
function typePill(type: string) {
  const c = TYPE_PILL[type] || TYPE_PILL.unit;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 10px', borderRadius: 11, fontSize: 12, fontWeight: 600, background: c.bg, color: c.color }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: c.color }} />
      {type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Unit'}
    </span>
  );
}

// RBAC access-level badge for the People list.
function roleBadge(role?: string) {
  if (!role) return null;
  const label = role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  return <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>;
}

const KNOWN_TYPES = ['company', 'division', 'department', 'team', 'unit'];

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = usePermissions();
  const [orgs, setOrgs] = useState<OrgFlat[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [agents, setAgents] = useState<AgentRef[]>([]);
  const [systems, setSystems] = useState<SystemRef[]>([]);
  const [damaRoles, setDamaRoles] = useState<DamaRoleRef[]>([]);
  const [procNodes, setProcNodes] = useState<ProcNodeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setError(null);
    // Orgs + people are required (identity / sub-orgs / members). The scoped
    // counts are best-effort — a 403 on an admin-only list just shows "—".
    try {
      const [orgRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: OrgFlat[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: PersonRef[] }>('/people'),
      ]);
      setOrgs(orgRes.data || []);
      setPeople(peopleRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load organization'));
      setLoading(false);
      return;
    }
    const [ag, sys, roles, proc] = await Promise.allSettled([
      apiClient.get<{ success: boolean; data: AgentRef[] }>('/agents'),
      apiClient.get<{ success: boolean; data: SystemRef[] }>('/systems'),
      apiClient.get<{ success: boolean; data: DamaRoleRef[] }>('/dama-roles'),
      apiClient.get<{ success: boolean; data: ProcNodeRef[] }>('/process-catalog'),
    ]);
    if (ag.status === 'fulfilled') setAgents(ag.value.data || []);
    if (sys.status === 'fulfilled') setSystems(sys.value.data || []);
    if (roles.status === 'fulfilled') setDamaRoles(roles.value.data || []);
    if (proc.status === 'fulfilled') setProcNodes(proc.value.data || []);
    setLoading(false);
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

  // Descendant set (self + all transitive children) — the unit's whole subtree.
  const subtreeIds = new Set<string>([org.id]);
  {
    let added = true;
    while (added) {
      added = false;
      for (const o of orgs) {
        if (o.parentId && subtreeIds.has(o.parentId) && !subtreeIds.has(o.id)) { subtreeIds.add(o.id); added = true; }
      }
    }
  }
  const descendants = orgs.filter((o) => o.id !== org.id && subtreeIds.has(o.id));

  const directCount = (orgId: string) => people.filter((p) => (p.orgIds || []).includes(orgId)).length;
  const members = people.filter((p) => (p.orgIds || []).includes(org.id));
  const totalPeople = people.filter((p) => (p.orgIds || []).some((oid) => subtreeIds.has(oid))).length;
  const divisionCount = descendants.filter((o) => o.type === 'division').length;
  const departmentCount = descendants.filter((o) => o.type === 'department').length;

  // Subtree-inclusive counts for the "Also scoped here" cards — matching how
  // the global org selector scopes each list (org + its sub-organizations).
  const systemsCount = systems.filter((s) => s.orgId && subtreeIds.has(s.orgId)).length;
  const agentsCount = agents.filter((a) => (a.orgIds || []).some((oid) => subtreeIds.has(oid))).length;
  const rolesCount = damaRoles.filter((r) => r.scopeType === 'ORG' && r.scopeId && subtreeIds.has(r.scopeId)).length;
  const processCount = procNodes.filter((n) => n.level === 'PROCESS' && ((n.orgId && subtreeIds.has(n.orgId)) || (n.orgIds || []).some((oid) => subtreeIds.has(oid)))).length;
  const scopedLoaded = { systems: systems.length > 0, agents: agents.length > 0, roles: damaRoles.length > 0, proc: procNodes.length > 0 };

  const typeOptions = Array.from(new Set([...KNOWN_TYPES, ...orgs.map((o) => o.type).filter(Boolean)]))
    .map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));
  const parentOptions = [
    { value: '', label: 'None (top level)' },
    ...orgs.filter((o) => o.id !== org.id).map((o) => ({ value: o.id, label: o.name })),
  ];

  const scopedCards = [
    { route: '/systems', label: 'Systems', count: systemsCount, loaded: scopedLoaded.systems },
    { route: '/agents', label: 'Agents', count: agentsCount, loaded: scopedLoaded.agents },
    { route: '/dama-roles', label: 'Governance roles', count: rolesCount, loaded: scopedLoaded.roles },
    { route: '/processes', label: 'Processes', count: processCount, loaded: scopedLoaded.proc },
  ];

  const sectionCardStyle: React.CSSProperties = { marginBottom: 16 };

  return (
    <div>
      <PageHeader
        kicker="Organization"
        title={org.name}
        copyId={org.id}
        copyLabel="Copy organization ID"
        subtitle={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{typePill(org.type)}<span style={{ color: 'var(--color-text-muted)' }}>{parent ? `in ${parent.name}` : 'Top level'}</span></span>}
        actions={
          <DetailEditActions
            editing={m.isEditing}
            canEdit={canWrite}
            dirty={m.dirty}
            saving={m.saving}
            onEdit={m.enter}
            onCancel={m.cancel}
            onSave={m.save}
            before={
              <>
                <Link to="/organizations" style={backLinkStyle}>{'←'} Back</Link>
                <Link to="/organizations/visualization" style={chartLinkStyle}>{renderNavIcon('/organizations', { size: 14 })} View in chart</Link>
              </>
            }
          />
        }
      />

      {/* Two-column: relationships (main) + Facts rail (aside). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <main style={{ flex: '999 1 540px', minWidth: 0 }}>

          {/* About — editable description (+ name while editing). */}
          <Card style={sectionCardStyle}>
            <SectionLabel marginBottom={10}>About</SectionLabel>
            {m.isEditing && (
              <div style={{ marginBottom: 14 }}>
                <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="Organization name" />
              </div>
            )}
            <EditableField
              label="Description"
              editing={m.isEditing}
              type="textarea"
              value={m.draft.description}
              onChange={(v) => m.set('description', v)}
              placeholder="What this organization does"
              emptyText="No description"
            >
              {org.description ? <span style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{org.description}</span> : undefined}
            </EditableField>
          </Card>

          {/* Sub-organizations */}
          <Card padding={0} style={sectionCardStyle}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <SectionLabel marginBottom={0}>Sub-organizations ({children.length})</SectionLabel>
            </div>
            {children.length === 0 ? (
              <div style={{ padding: 16, ...emptyStyle }}>No sub-organizations</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <th style={{ padding: '8px 16px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Name</th>
                      <th style={{ padding: '8px 16px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', textAlign: 'right', whiteSpace: 'nowrap' }}>People</th>
                    </tr>
                  </thead>
                  <tbody>
                    {children.map((c) => {
                      const grandkids = orgs.filter((o) => o.parentId === c.id).length;
                      // c's own subtree total people.
                      const cSub = new Set<string>([c.id]);
                      let add = true;
                      while (add) { add = false; for (const o of orgs) { if (o.parentId && cSub.has(o.parentId) && !cSub.has(o.id)) { cSub.add(o.id); add = true; } } }
                      const cTotal = people.filter((p) => (p.orgIds || []).some((oid) => cSub.has(oid))).length;
                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '10px 16px' }}>
                            <Link to={`/organizations/${c.id}`} style={{ color: 'var(--color-text)', fontWeight: 600, textDecoration: 'none' }}>{c.name}</Link>
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{c.type}{grandkids > 0 ? ` · ${grandkids} sub-unit${grandkids === 1 ? '' : 's'}` : ''}</span>
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {directCount(c.id)} <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>({cTotal} total)</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* People directly in this org */}
          <Card padding={0} style={sectionCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <SectionLabel marginBottom={0}>People ({members.length} direct · {totalPeople} incl. sub-organizations)</SectionLabel>
              <Link to="/people" style={{ ...linkStyle, fontSize: 13, fontWeight: 600 }}>See all in People</Link>
            </div>
            {members.length === 0 ? (
              <div style={{ padding: 16, ...emptyStyle }}>No people assigned directly to this organization</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {members.map((p) => (
                  <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                    <Avatar name={p.name} size="md" />
                    <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <Link to={`/people/${p.id}`} style={{ color: 'var(--color-text)', fontWeight: 600, textDecoration: 'none' }}>{p.name}</Link>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>
                        <TruncatedText text={p.title} />
                      </span>
                    </span>
                    {roleBadge(p.role)}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Also scoped to this organization — count cards that link out. */}
          <Card style={sectionCardStyle}>
            <SectionLabel marginBottom={4}>Also scoped to this organization</SectionLabel>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>Things filtered by this organization (and its sub-organizations) elsewhere in the app.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {scopedCards.map((c) => (
                <Link key={c.route} to={c.route} style={{ display: 'block', padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', textDecoration: 'none', color: 'var(--color-text)', background: 'var(--color-surface)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-muted)' }}>{renderNavIcon(c.route, { size: 14 })}{c.label}</span>
                  <span style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{c.loaded ? c.count : '—'}</span>
                </Link>
              ))}
            </div>
          </Card>
        </main>

        {/* Facts rail — editable identity (Type / Industry / Parent) + read-only
            roll-ups. Owner is intentionally absent (orgs have no owner field). */}
        <aside style={{ flex: '1 1 300px', minWidth: 0 }}>
          <Card>
            <SectionLabel marginBottom={12}>Facts</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <EditableField label="Type" editing={m.isEditing} value={m.draft.type} onChange={(v) => m.set('type', v)} type="select" options={typeOptions}>
                <span style={{ textTransform: 'capitalize' }}>{org.type}</span>
              </EditableField>
              <EditableField label="Industry" editing={m.isEditing} value={m.draft.industry} onChange={(v) => m.set('industry', v)} placeholder="e.g. Utilities" emptyText="Not set" />
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
                  ? <Link to={`/organizations/${parent.id}`} style={linkStyle}>{parent.name}</Link>
                  : <span style={emptyStyle}>None — top level</span>}
              </EditableField>

              {/* Read-only roll-ups */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>People</div>
                <div style={{ fontVariantNumeric: 'tabular-nums' }}>{members.length} direct · {totalPeople} total</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>Structure</div>
                <div style={{ fontVariantNumeric: 'tabular-nums' }}>{divisionCount} division{divisionCount === 1 ? '' : 's'} · {departmentCount} department{departmentCount === 1 ? '' : 's'}</div>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
