import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { errorToast, successToast } from '../lib/errorToast';
import { SkeletonRows } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import OrgPicker from '../components/OrgPicker';

// ──────────────────────────────────────────────────────────────────────────
// PersonDetailPage — the "Person 360" view promoted from a modal to its
// own page at /people/:id. Gives every person record a shareable URL,
// real breadcrumbs, and keyboard back/forward navigation.
//
// Shares the existing /people/:id/360 API endpoint with the legacy modal;
// the modal is still present in PeoplePage for any old entry points. The
// Manage button on the People list now routes here as the primary flow.
// ──────────────────────────────────────────────────────────────────────────

interface Person360Data {
  person: { id: string; orgIds: string[]; name: string; email: string; role: string; title: string };
  orgAssignments: { id: string; name: string; type: string }[];
  damaRoles: { id: string; roleType: string; scopeType: string; scopeId: string; scopeName: string; since: string }[];
  governanceGroups: { groupId: string; groupName: string; groupType: string; groupRole: string; since: string }[];
  ownedProcessNodes: { id: string; name: string; level: string; status: string }[];
  dataAssets: { id: string; name: string; governanceTier: string; relation: string }[];
  allGroups: { id: string; name: string; type: string }[];
  allDomains: { id: string; name: string; ownerId: string | null; stewardIds: string[] }[];
  allDamaRoleTypes: string[];
}

const DAMA_ROLE_LABELS: Record<string, string> = {
  CDO: 'Chief Data Officer',
  DATA_GOVERNANCE_LEAD: 'Data Governance Lead',
  DATA_OWNER: 'Data Owner',
  BUSINESS_DATA_STEWARD: 'Business Data Steward',
  DATA_QUALITY_ANALYST: 'Data Quality Analyst',
  TECHNICAL_DATA_STEWARD: 'Technical Data Steward',
  DATA_CUSTODIAN: 'Data Custodian',
  DATA_ARCHITECT: 'Data Architect',
  DATA_ENGINEER: 'Data Engineer',
  DATABASE_ADMINISTRATOR: 'Database Administrator',
  DATA_STEWARD: 'Data Steward (Legacy)',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 16,
  marginBottom: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 10,
};

interface FlatOrg { id: string; parentId: string | null; name: string; type: string; }

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const [data, setData] = useState<Person360Data | null>(null);
  const [allOrgs, setAllOrgs] = useState<FlatOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetch360 = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [personRes, orgsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Person360Data }>(`/people/${id}/360`),
        apiClient.get<{ success: boolean; data: FlatOrg[] }>('/organizations'),
      ]);
      setData(personRes.data);
      setAllOrgs(orgsRes.data || []);
    } catch (err: any) {
      setError(err?.message || 'Could not load person');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetch360(); }, [fetch360]);

  // Toggle an org in the person's assignment list, persisting immediately.
  // Backend requires at least one assignment, so we block the last unassign.
  const toggleOrgAssignment = async (orgId: string) => {
    if (!data) return;
    const current = data.person.orgIds || [];
    const isAssigned = current.includes(orgId);
    const next = isAssigned ? current.filter((x) => x !== orgId) : [...current, orgId];
    if (next.length === 0) {
      errorToast(null, 'A person must belong to at least one organization.');
      return;
    }
    // Optimistic update.
    const snapshot = data;
    setData({ ...data, person: { ...data.person, orgIds: next } });
    setBusy(true);
    try {
      await apiClient.put(`/people/${data.person.id}`, { orgIds: next });
      await fetch360();
    } catch (err) {
      setData(snapshot);
      errorToast(err, 'Failed to update org assignment');
    } finally {
      setBusy(false);
    }
  };

  // ── Mutations ──
  const toggleGroup = async (groupId: string, isMember: boolean, role = 'MEMBER') => {
    if (!data) return;
    // Optimistic toggle so the UI feels instant.
    const snapshot = data;
    const nextGroups = isMember
      ? data.governanceGroups.filter((g) => g.groupId !== groupId)
      : [
          ...data.governanceGroups,
          {
            groupId,
            groupName: data.allGroups.find((g) => g.id === groupId)?.name || '',
            groupType: data.allGroups.find((g) => g.id === groupId)?.type || '',
            groupRole: role,
            since: new Date().toISOString(),
          },
        ];
    setData({ ...data, governanceGroups: nextGroups });
    setBusy(true);
    try {
      if (isMember) await apiClient.delete(`/governance-groups/${groupId}/members/${data.person.id}`);
      else await apiClient.post(`/governance-groups/${groupId}/members`, { personId: data.person.id, groupRole: role });
      await fetch360();
    } catch (err) {
      setData(snapshot);
      errorToast(err, 'Failed to update group membership');
    } finally {
      setBusy(false);
    }
  };

  const removeDamaRole = async (roleId: string) => {
    if (!data) return;
    setBusy(true);
    try {
      await apiClient.delete(`/dama-roles/${roleId}`);
      await fetch360();
      successToast('Role removed');
    } catch (err) {
      errorToast(err, 'Failed to remove governance role');
    } finally {
      setBusy(false);
    }
  };

  const toggleDomainOwner = async (domainId: string, isCurrentOwner: boolean) => {
    if (!data) return;
    setBusy(true);
    try {
      await apiClient.put(`/data-domains/${domainId}`, {
        ownerId: isCurrentOwner ? null : data.person.id,
      });
      await fetch360();
    } catch (err) {
      errorToast(err, 'Failed to update data domain owner');
    } finally {
      setBusy(false);
    }
  };

  const toggleDomainSteward = async (domainId: string, isSteward: boolean, currentStewardIds: string[]) => {
    if (!data) return;
    setBusy(true);
    try {
      const nextStewardIds = isSteward
        ? currentStewardIds.filter((x) => x !== data.person.id)
        : [...currentStewardIds, data.person.id];
      await apiClient.put(`/data-domains/${domainId}`, { stewardIds: nextStewardIds });
      await fetch360();
    } catch (err) {
      errorToast(err, 'Failed to update steward list');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div style={cardStyle}>
          <SkeletonRows rows={3} columns={3} />
        </div>
        <div style={cardStyle}>
          <SkeletonRows rows={4} columns={3} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        title="Couldn't load this person"
        description={error || 'The person may have been deleted.'}
        action={{ label: 'Back to People', onClick: () => navigate('/people') }}
      />
    );
  }

  const p = data.person;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>Person</div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{p.name}</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            {p.email && <span>{p.email}</span>}
            {p.title && <span>{p.email ? ' \u2022 ' : ''}{p.title}</span>}
          </div>
        </div>
        <Link
          to="/people"
          style={{ padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none' }}
        >
          {'\u2190'} Back to People
        </Link>
      </div>

      {/* Identity summary */}
      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Identity</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Application role</div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{p.role}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Email</div>
            <div style={{ fontSize: 13 }}>{p.email || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Title</div>
            <div style={{ fontSize: 13 }}>{p.title || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</div>
          </div>
        </div>
      </div>

      {/* Org Assignments — editable via shared picker. Uses the Working-In
          context as the default scope so a Tidewater Electric admin sees
          that subtree first, with a one-click expand to all orgs. */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={sectionTitleStyle}>Assigned organizations ({(data.person.orgIds || []).length})</div>
          {busy && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Saving\u2026</span>}
        </div>
        {/* Selected chips — compact summary above the picker. */}
        {(data.person.orgIds || []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {(data.person.orgIds || []).map((oid) => {
              const o = allOrgs.find((x) => x.id === oid);
              if (!o) return null;
              const isLast = (data.person.orgIds || []).length === 1;
              return (
                <span key={oid}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 4px 4px 10px',
                    borderRadius: 999,
                    background: 'var(--color-primary-light)',
                    color: 'var(--color-primary)',
                    fontSize: 12,
                  }}
                >
                  <strong>{o.name}</strong>
                  <span style={{ fontSize: 10, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{o.type}</span>
                  <button
                    onClick={() => toggleOrgAssignment(oid)}
                    disabled={isLast || busy}
                    aria-label={`Unassign from ${o.name}`}
                    title={isLast ? 'Cannot unassign the last org' : `Unassign from ${o.name}`}
                    style={{
                      background: 'transparent', border: 'none',
                      cursor: isLast || busy ? 'not-allowed' : 'pointer',
                      color: 'var(--color-primary)', fontSize: 14, lineHeight: 1,
                      padding: '0 8px', borderRadius: 999,
                      opacity: isLast ? 0.4 : 1,
                    }}
                  >&times;</button>
                </span>
              );
            })}
          </div>
        )}
        <OrgPicker
          orgs={allOrgs}
          selectedIds={new Set(data.person.orgIds || [])}
          onToggle={toggleOrgAssignment}
          scopeOrgId={activeOrgId || null}
          initialScope="subtree"
          isDisabled={(orgId) => {
            // Block unchecking the one-and-only assignment. Matches the
            // backend's non-empty-orgIds guard and avoids the toast.
            const current = data.person.orgIds || [];
            return current.length === 1 && current[0] === orgId;
          }}
          maxHeight={260}
          placeholder="Search organizations (press / to focus)"
        />
      </div>

      {/* Governance roles */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={sectionTitleStyle}>Governance roles ({data.damaRoles.length})</div>
        </div>
        {data.damaRoles.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No governance roles assigned.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.damaRoles.map((r) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', background: 'var(--color-bg)', borderRadius: 6,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{DAMA_ROLE_LABELS[r.roleType] || r.roleType}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {r.scopeType === 'ORG' ? 'Organization' : 'Domain'}: {r.scopeName}
                  </div>
                </div>
                <button
                  onClick={() => removeDamaRole(r.id)}
                  disabled={busy}
                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: busy ? 'default' : 'pointer', fontSize: 12 }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
          Add a governance role from the Governance Roles page.
        </p>
      </div>

      {/* Governance groups */}
      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Governance groups</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.allGroups.map((group) => {
            const membership = data.governanceGroups.find((g) => g.groupId === group.id);
            const isMember = !!membership;
            return (
              <label
                key={group.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', borderRadius: 6,
                  background: isMember ? '#eff6ff' : 'transparent',
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={isMember}
                  disabled={busy}
                  onChange={() => toggleGroup(group.id, isMember)}
                />
                <span style={{ fontSize: 13, fontWeight: isMember ? 500 : 400 }}>{group.name}</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{group.type}</span>
                {membership && (
                  <span style={{ fontSize: 10, marginLeft: 'auto', color: 'var(--color-primary)', fontWeight: 600 }}>
                    {membership.groupRole}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Data domain ownership / stewardship — only shows domains
          where the person IS owner or steward by default; an "Assign
          to domain" toggle reveals the rest so the page isn't cluttered
          with every domain in the system. */}
      <DomainResponsibilities
        allDomains={data.allDomains}
        personId={p.id}
        busy={busy}
        onToggleOwner={toggleDomainOwner}
        onToggleSteward={toggleDomainSteward}
      />

      {/* Related processes */}
      {data.ownedProcessNodes.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Owned process nodes ({data.ownedProcessNodes.length})</div>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.ownedProcessNodes.map((pn) => (
              <li key={pn.id} style={{ fontSize: 13, padding: '4px 10px', background: 'var(--color-bg)', borderRadius: 6 }}>
                {pn.name}
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 8, textTransform: 'uppercase' }}>{pn.level}</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 8 }}>{pn.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Domain responsibilities sub-component ──
// Split out so the expand/collapse state is local to this card and doesn't
// re-render the entire page on every toggle.

function DomainResponsibilities({ allDomains, personId, busy, onToggleOwner, onToggleSteward }: {
  allDomains: Array<{ id: string; name: string; ownerId: string | null; stewardIds: string[] }>;
  personId: string;
  busy: boolean;
  onToggleOwner: (domainId: string, isCurrentOwner: boolean) => void;
  onToggleSteward: (domainId: string, isSteward: boolean, currentStewardIds: string[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const assigned = allDomains.filter((d) => d.ownerId === personId || d.stewardIds.includes(personId));
  const unassigned = allDomains.filter((d) => d.ownerId !== personId && !d.stewardIds.includes(personId));

  const renderRow = (d: typeof allDomains[0]) => {
    const isOwner = d.ownerId === personId;
    const isSteward = d.stewardIds.includes(personId);
    return (
      <div
        key={d.id}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '6px 10px', borderRadius: 6,
          background: (isOwner || isSteward) ? 'var(--color-bg)' : 'transparent',
        }}
      >
        <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: busy ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={isOwner} disabled={busy} onChange={() => onToggleOwner(d.id, isOwner)} />
          Owner
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: busy ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={isSteward} disabled={busy} onChange={() => onToggleSteward(d.id, isSteward, d.stewardIds)} />
          Steward
        </label>
      </div>
    );
  };

  return (
    <div style={cardStyle}>
      <div style={sectionTitleStyle}>
        Data domain responsibilities{assigned.length > 0 ? ` (${assigned.length})` : ''}
      </div>

      {allDomains.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No data domains defined in the system.</div>
      )}

      {/* Show only assigned domains by default — clean for the common case. */}
      {assigned.length === 0 && allDomains.length > 0 && !showAll && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Not assigned to any data domains.
        </div>
      )}

      {assigned.map(renderRow)}

      {/* Expand to show unassigned domains so the admin can add new ones. */}
      {unassigned.length > 0 && (
        <>
          <button
            onClick={() => setShowAll((v) => !v)}
            style={{
              marginTop: 8, background: 'transparent', border: 'none',
              cursor: 'pointer', fontSize: 12, color: 'var(--color-primary)',
              padding: 0, fontWeight: 500,
            }}
          >
            {showAll
              ? `Hide ${unassigned.length} unassigned domain${unassigned.length === 1 ? '' : 's'}`
              : `Assign to domain\u2026 (${unassigned.length} available)`}
          </button>
          {showAll && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {unassigned.map(renderRow)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
