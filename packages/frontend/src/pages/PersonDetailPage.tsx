import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import { useOrgContext } from '../stores/orgContext';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import { errorMessage, errorToast, successToast } from '../lib/errorToast';
import { clickable } from '../lib/a11y';
import { SkeletonRows } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import OrgPicker from '../components/OrgPicker';
import SkillPicker from '../components/SkillPicker';
import OrgRolePill from '../components/OrgRolePill';
import SecurityCard from '../components/SecurityCard';
import SectionLabel from '../components/SectionLabel';

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
  person: {
    id: string;
    orgIds: string[];
    accessibleOrgIds: string[];
    name: string;
    email: string;
    role: string;
    title: string;
    skillIds?: string[];
    // Per-org role overrides. When absent for a given org the
    // person.role fallback applies.
    orgRoles?: Array<{ orgId: string; role: string }>;
    // Security flags. Optional because legacy records predate them
    // and the SecurityCard treats absence-of-active as "active".
    active?: boolean;
    mfaEnrolled?: boolean;
    webauthnCredentials?: Array<{ id: string; label: string; createdAt: string }>;
    webauthnEnrolled?: boolean;
    locked?: boolean;
    lockedUntil?: string;
  };
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
};

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 16,
  marginBottom: 16,
};

interface FlatOrg { id: string; parentId: string | null; name: string; type: string; }

// OrgRolePill moved to components/OrgRolePill.tsx for unit testing.

function InlineField({ label, value, field, personId, onSaved }: {
  label: string; value: string; field: string; personId: string; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const save = async () => {
    if (draft !== value) {
      try {
        await apiClient.put(`/people/${personId}`, { [field]: draft });
        successToast(`${label} updated`);
        onSaved();
      } catch (err) { errorToast(err, `Failed to update ${label.toLowerCase()}`); }
    }
    setEditing(false);
  };
  if (editing) {
    return (
      <div>
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</div>
        <input autoFocus value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          style={{ fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4, padding: '3px 8px', width: '100%', background: 'var(--color-surface)' }}
        />
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{label}</div>
      <div
        {...clickable(() => { setDraft(value); setEditing(true); }, { label: `Edit ${label}` })}
        style={{ fontSize: 13, cursor: 'pointer' }}
        title="Click to edit"
      >
        {value || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Click to set...</span>}
      </div>
    </div>
  );
}

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const openRoleDrawer = useRoleDrawerStore((s) => s.open);
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
    } catch (err) {
      setError(errorMessage(err, 'Could not load person'));
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

  // Set / clear a per-org role override for the person at one org.
  // Pass role=null to clear (the person.role fallback then applies).
  const setOrgRole = async (orgId: string, role: string | null) => {
    if (!data) return;
    setBusy(true);
    try {
      await apiClient.put(`/people/${data.person.id}/org-role`, { orgId, role });
      await fetch360();
    } catch (err) {
      errorToast(err, 'Failed to update org role');
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
      <PageHeader
        kicker="Person"
        title={p.name}
        subtitle={
          <>
            {p.email && <span>{p.email}</span>}
            {p.title && <span>{p.email ? ' \u2022 ' : ''}{p.title}</span>}
          </>
        }
        actions={
          <Link
            to="/people"
            style={{ padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none' }}
          >
            {'\u2190'} Back to People
          </Link>
        }
      />

      {/* Identity summary */}
      <div style={cardStyle}>
        <SectionLabel marginBottom={10}>Identity</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2 }}>Application role</div>
            <select
              value={p.role}
              onChange={async (e) => {
                try {
                  await apiClient.put(`/people/${p.id}`, { role: e.target.value });
                  successToast(`Role changed to ${e.target.value.replace('_', ' ')}`);
                  fetch360();
                } catch (err) { errorToast(err, 'Failed to change role'); }
              }}
              style={{
                fontSize: 13, fontWeight: 500, border: '1px solid var(--color-border)',
                borderRadius: 4, padding: '3px 8px', background: 'var(--color-surface)',
                cursor: 'pointer',
              }}
            >
              {['SUPER_ADMIN', 'ORG_ADMIN', 'EDITOR', 'CONTRIBUTOR', 'VIEWER'].map((r) => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <InlineField label="Email" value={p.email} field="email" personId={p.id} onSaved={fetch360} />
          <InlineField label="Job Title" value={p.title} field="title" personId={p.id} onSaved={fetch360} />
          {/* "Job Role" editor removed: it duplicated Job Title as a second
              free-text job descriptor. The jobRole field itself is kept (it
              backs the RACI "group by Job Role" dimension and sync mapping)
              — just no longer edited from a second inline box here. */}
        </div>
      </div>

      {/* Org Assignments — editable via shared picker. Uses the Working-In
          context as the default scope so a Tidewater Electric admin sees
          that subtree first, with a one-click expand to all orgs. */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionLabel marginBottom={10}>Assigned organizations ({(data.person.orgIds || []).length})</SectionLabel>
          {busy && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Saving\u2026</span>}
        </div>
        {/* Selected chips — compact summary above the picker. Each
            chip shows the effective role at that org. Click the role
            pill to swap in a per-org override; click the × to
            unassign. */}
        {(data.person.orgIds || []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {(data.person.orgIds || []).map((oid) => {
              const o = allOrgs.find((x) => x.id === oid);
              if (!o) return null;
              const isLast = (data.person.orgIds || []).length === 1;
              const override = (data.person.orgRoles || []).find((r) => r.orgId === oid);
              const effectiveRole = override?.role || data.person.role;
              return (
                <div key={oid}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 4px 4px 10px',
                    borderRadius: 8,
                    background: 'var(--color-primary-light)',
                    color: 'var(--color-primary)',
                    fontSize: 12,
                  }}
                >
                  <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</strong>
                  <span style={{ fontSize: 10, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{o.type}</span>
                  <OrgRolePill
                    role={effectiveRole}
                    isOverride={!!override}
                    disabled={busy}
                    onChange={(role) => setOrgRole(oid, role)}
                  />
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
                </div>
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
          aria-label="Search organizations" placeholder="Search organizations (press / to focus)"
        />
      </div>

      {/* Skills */}
      <div style={cardStyle}>
        <SkillPicker
          orgId={activeOrgId || undefined}
          selectedSkillIds={p.skillIds || []}
          onChange={async (skillIds) => {
            if (!data) return;
            const snapshot = data;
            setData({ ...data, person: { ...data.person, skillIds } });
            setBusy(true);
            try {
              await apiClient.put(`/people/${p.id}`, { skillIds });
              successToast('Skills updated');
            } catch (err) {
              setData(snapshot);
              errorToast(err, 'Failed to update skills');
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          maxHeight={220}
          label="Skills"
        />
      </div>

      {/* Governance roles */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <SectionLabel marginBottom={10}>Governance roles ({data.damaRoles.length})</SectionLabel>
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
                  <button
                    type="button"
                    onClick={() => openRoleDrawer(r.roleType)}
                    title="Learn about this role"
                    style={{
                      background: 'none', border: 'none', padding: 0,
                      fontSize: 13, fontWeight: 500, color: 'var(--color-text)',
                      cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted',
                      textUnderlineOffset: 3, fontFamily: 'inherit',
                    }}
                  >
                    {DAMA_ROLE_LABELS[r.roleType] || r.roleType}
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    Organization: {r.scopeName}
                  </div>
                </div>
                <button
                  onClick={() => removeDamaRole(r.id)}
                  disabled={busy}
                  style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: busy ? 'default' : 'pointer', fontSize: 12 }}
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
        <SectionLabel marginBottom={10}>Governance groups</SectionLabel>
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
          <SectionLabel marginBottom={10}>Owned process nodes ({data.ownedProcessNodes.length})</SectionLabel>
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

      {/* Security — admin-only panel for credential lifecycle.
        *  Surfaces deactivate / reactivate (soft-delete state) and
        *  Reset MFA (forces the user back through enrollment on
        *  next login). Hidden for non-admins so the usual people
        *  page doesn't grow these controls for everyone. */}
      <SecurityCard person={p} onChanged={fetch360} />
      {/* Per-person Discussion and Activity panels removed: low-value
          per-person threaded comments, and a per-user audit feed that
          duplicates the global Audit Log filtered by user. */}
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
      <SectionLabel marginBottom={10}>
        Data domain responsibilities{assigned.length > 0 ? ` (${assigned.length})` : ''}
      </SectionLabel>

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
