import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonRows } from '../components/Skeleton';
import HelpPopover from '../components/HelpPopover';
import PersonPicker from '../components/PersonPicker';
import { GOVERNANCE_ROLES, GOVERNANCE_GROUP_ROLES } from '../types';
import { getRoleReference, RACI_COLOR, RACI_LABEL, Raci } from '../lib/roleDefinitions';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceGroupDetailPage — single composition surface for one governance
// group. Replaces the five-page tour (Groups → Roles → RACI → Policies →
// Calendar) with one cohesive view of everything that body owns or does.
//
// Sections:
//   1. Header     — name / type / parent breadcrumb / edit / delete
//   2. Composition — expected role slate + members + their governance
//                    roles, with the typical RACI letter shown on each
//                    role chip so users see at a glance what each role
//                    is accountable / responsible / consulted / informed
//                    for. Inline role-add per slot.
//   3. Decision rights — every right where this group is decider / on
//                        the recommend / approve / informed list.
//   4. Policies — derived via member role assignments (a policy is
//                  "owned" by a role-holder; we surface those).
//   5. Calendar  — upcoming events where any member is an attendee.
//   6. RACI snapshot — activities where members are R / A / C / I,
//                       compact read-only table linking to the full
//                       matrix for edits.
//
// Data: all reads use existing endpoints; no backend changes. Mutations
// (member add/remove, role assign/unassign, delete group) call the same
// routes the list page uses, so they stay in lockstep.
// ──────────────────────────────────────────────────────────────────────────

interface GroupMember {
  personId: string;
  groupRole: string;
  since: string;
  personName?: string;
}

interface GroupDetail {
  id: string;
  orgId: string;
  parentId: string | null;
  parentName: string | null;
  name: string;
  type: string;
  description: string;
  charter: string;
  status: string;
  members: GroupMember[];
  children: Array<{ id: string; name: string; type: string }>;
}


interface DamaRole {
  id: string;
  personId: string | null;
  agentId: string | null;
  personName: string | null;
  agentName: string | null;
  roleType: string;
  scopeType: string;
  scopeId: string;
  since: string;
}

interface DecisionRight {
  id: string;
  decision: string;
  category: string;
  deciderType: 'PERSON' | 'ROLE' | 'GROUP';
  decider: string | null;
  recommends: string[];
  approves: string[];
  informed: string[];
}

interface Policy {
  id: string;
  code: string;
  name: string;
  status: string;
  category: string;
  ownerAssignmentId: string | null;
}

interface CalendarEvent {
  id: string;
  name: string;
  eventType: string;
  cadence: string;
  attendees: string[];
  nextOccurrence: string | null;
}

interface RaciRow {
  nodeId: string;
  nodeName: string;
  nodePath: string;
  level: string;
  assignments: Array<{ personId: string; personName: string; raci: 'R' | 'A' | 'C' | 'I' }>;
}

const GROUP_TYPE_LABELS: Record<string, string> = {
  COUNCIL: 'Data Governance Council',
  OFFICE: 'Data Governance Office',
  COMMITTEE: 'Data Governance Committee',
  STEWARDSHIP_TEAM: 'Data Stewardship Team',
  WORKING_GROUP: 'Working Group',
  COMMUNITY_OF_PRACTICE: 'Community of Practice',
};

const GROUP_ROLE_LABELS: Record<string, string> = {
  CHAIR: 'Chair',
  VICE_CHAIR: 'Vice Chair',
  MEMBER: 'Member',
  SECRETARY: 'Secretary',
  ADVISOR: 'Advisor',
};

const DAMA_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  GOVERNANCE_ROLES.map((r) => [r.roleType, r.label]),
);

const EXPECTED_ROLES_BY_GROUP: Record<string, typeof GOVERNANCE_ROLES> = Object.fromEntries(
  GOVERNANCE_GROUP_ROLES.map((g) => [
    g.groupType,
    GOVERNANCE_ROLES.filter((r) => g.roleTypes.includes(r.roleType)),
  ]),
);

export default function GovernanceGroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const openRoleDrawer = useRoleDrawerStore((s) => s.open);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [damaRoles, setDamaRoles] = useState<DamaRole[]>([]);
  const [decisionRights, setDecisionRights] = useState<DecisionRight[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [raciRows, setRaciRows] = useState<RaciRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-member / assign-role local state
  const [addMemberPersonId, setAddMemberPersonId] = useState('');
  const [addMemberRole, setAddMemberRole] = useState('MEMBER');
  const [assignRoleSlot, setAssignRoleSlot] = useState<string | null>(null);  // roleType currently being assigned
  const [assignRolePersonId, setAssignRolePersonId] = useState('');

  // Confirms
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<GroupMember | null>(null);

  // ── Fetch everything ──
  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const orgQuery = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [groupRes, damaRes, drRes, polRes, calRes, raciRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GroupDetail }>(`/governance-groups/${id}`),
        apiClient.get<{ success: boolean; data: DamaRole[] }>(`/dama-roles${orgQuery}`),
        apiClient.get<{ success: boolean; data: DecisionRight[] }>(`/decision-rights${orgQuery}`),
        apiClient.get<{ success: boolean; data: Policy[] }>(`/governance-policies${orgQuery}`),
        apiClient.get<{ success: boolean; data: CalendarEvent[] }>(`/governance-calendar${orgQuery}`),
        // /dashboard/raci returns a matrix-shaped payload
        // (rows × columns × matrix cells), not the flat
        // row-with-assignments shape this page wants. We reshape
        // on read so groupRaciRows can filter by member id.
        apiClient.get<{
          success: boolean;
          data: {
            rows: Array<{ id: string; name: string; level: string; parentName: string | null }>;
            columns: Array<{ personId: string; name: string }>;
            matrix: Record<string, Record<string, 'R' | 'A' | 'C' | 'I' | undefined>>;
          };
        }>(`/dashboard/raci${orgQuery}`).catch(() => ({ data: { rows: [], columns: [], matrix: {} } })),
      ]);
      setGroup(groupRes.data);
      setDamaRoles(damaRes.data || []);
      setDecisionRights(drRes.data || []);
      setPolicies(polRes.data || []);
      setCalendarEvents(calRes.data || []);

      // Reshape /dashboard/raci into RaciRow[]. The backend ships
      // a matrix keyed by node id × person id; we materialise an
      // assignments[] per row so the rest of the page can stay
      // shape-agnostic.
      const raciData = (raciRes as any).data || { rows: [], columns: [], matrix: {} };
      const personNameById: Record<string, string> = {};
      for (const c of (raciData.columns || [])) personNameById[c.personId] = c.name;
      const reshapedRaci: RaciRow[] = (raciData.rows || []).map((r: any) => {
        const cell = raciData.matrix?.[r.id] || {};
        const assignments: RaciRow['assignments'] = Object.entries(cell)
          .filter(([, raci]) => raci === 'R' || raci === 'A' || raci === 'C' || raci === 'I')
          .map(([personId, raci]) => ({
            personId,
            personName: personNameById[personId] || personId,
            raci: raci as 'R' | 'A' | 'C' | 'I',
          }));
        return {
          nodeId: r.id,
          nodeName: r.name,
          nodePath: r.parentName ? `${r.parentName} > ${r.name}` : r.name,
          level: r.level,
          assignments,
        };
      });
      setRaciRows(reshapedRaci);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load group');
    } finally {
      setLoading(false);
    }
  }, [id, activeOrgId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Derived: per-member role assignments ──
  const memberIds = useMemo(() => new Set((group?.members || []).map((m) => m.personId)), [group]);
  const memberRoles = useMemo(
    () => damaRoles.filter((r) => r.personId && memberIds.has(r.personId)),
    [damaRoles, memberIds],
  );

  const expectedRoles = group ? (EXPECTED_ROLES_BY_GROUP[group.type] || []) : [];
  const requiredExpected = expectedRoles.filter((r) => r.required);
  const requiredFilled = requiredExpected.filter((r) =>
    memberRoles.some((m) => m.roleType === r.roleType),
  ).length;

  // ── Derived: decision rights this group owns or contributes to ──
  const groupDRs = useMemo(() => {
    if (!group) return [] as Array<{ dr: DecisionRight; role: 'Decider' | 'Recommends' | 'Approves' | 'Informed' }>;
    const matches: Array<{ dr: DecisionRight; role: 'Decider' | 'Recommends' | 'Approves' | 'Informed' }> = [];
    for (const dr of decisionRights) {
      if (dr.deciderType === 'GROUP' && dr.decider === group.id) matches.push({ dr, role: 'Decider' });
      else if (dr.recommends?.includes(group.id)) matches.push({ dr, role: 'Recommends' });
      else if (dr.approves?.includes(group.id)) matches.push({ dr, role: 'Approves' });
      else if (dr.informed?.includes(group.id)) matches.push({ dr, role: 'Informed' });
    }
    return matches;
  }, [decisionRights, group]);

  // ── Derived: policies owned via member role assignments ──
  const memberPolicies = useMemo(() => {
    const memberRoleIds = new Set(memberRoles.map((r) => r.id));
    return policies.filter((p) => p.ownerAssignmentId && memberRoleIds.has(p.ownerAssignmentId));
  }, [policies, memberRoles]);

  // ── Derived: upcoming calendar events for members ──
  const memberEvents = useMemo(() => {
    return calendarEvents
      .filter((e) => e.attendees && e.attendees.some((id) => memberIds.has(id)))
      .sort((a, b) => (a.nextOccurrence || '￿').localeCompare(b.nextOccurrence || '￿'));
  }, [calendarEvents, memberIds]);

  // ── Derived: RACI snapshot — activities where members are R/A/C/I ──
  const groupRaciRows = useMemo(() => {
    return raciRows
      .map((row) => ({
        ...row,
        // Defensive (|| []) — if the response shape ever drifts
        // and a row arrives without assignments, we skip it
        // instead of crashing the whole page.
        assignments: (row.assignments || []).filter((a) => memberIds.has(a.personId)),
      }))
      .filter((row) => row.assignments.length > 0)
      .slice(0, 25);  // keep the snapshot compact; full matrix link covers the rest
  }, [raciRows, memberIds]);

  // ── Handlers ──
  const handleAddMember = async () => {
    if (!group || !addMemberPersonId) return;
    try {
      await apiClient.post(`/governance-groups/${group.id}/members`, { personId: addMemberPersonId, groupRole: addMemberRole });
      addToast('success', 'Member added');
      setAddMemberPersonId('');
      setAddMemberRole('MEMBER');
      fetchAll();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Add failed');
    }
  };

  const handleRemoveMember = async (m: GroupMember) => {
    if (!group) return;
    try {
      await apiClient.delete(`/governance-groups/${group.id}/members/${m.personId}`);
      addToast('success', 'Member removed');
      fetchAll();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Remove failed');
    } finally {
      setConfirmRemoveMember(null);
    }
  };

  const handleAssignRole = async (roleType: string, personId: string) => {
    if (!group || !personId) return;
    try {
      // If the person isn't a member yet, add them first so the
      // governance role they're being given is contextual to this body.
      if (!memberIds.has(personId)) {
        await apiClient.post(`/governance-groups/${group.id}/members`, { personId, groupRole: 'MEMBER' });
      }
      await apiClient.post('/dama-roles', {
        orgId: activeOrgId,
        personId,
        roleType,
        scopeType: 'ORG',
        scopeId: activeOrgId,
      });
      addToast('success', 'Role assigned');
      setAssignRoleSlot(null);
      setAssignRolePersonId('');
      fetchAll();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Assign failed');
    }
  };

  const handleUnassignRole = async (roleAssignmentId: string) => {
    try {
      await apiClient.delete(`/dama-roles/${roleAssignmentId}`);
      addToast('success', 'Role removed');
      fetchAll();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Remove failed');
    }
  };

  const handleDeleteGroup = async () => {
    if (!group) return;
    try {
      await apiClient.delete(`/governance-groups/${group.id}`);
      addToast('success', 'Group deleted');
      navigate('/governance-groups');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Delete failed');
      setConfirmDelete(false);
    }
  };

  // ── Render ──
  if (loading) return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
      <SkeletonRows rows={6} columnWidths={[140, null, null, 100]} />
    </div>
  );

  if (error || !group) return (
    <EmptyState
      icon={'⚠'}
      title={error || 'Group not found'}
      description="The governance group you're looking for may have been deleted, or you don't have access."
      action={{ label: '← Back to Groups', onClick: () => navigate('/governance-groups') }}
    />
  );

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          <Link to="/governance-groups" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>← Governance Groups</Link>
          {group.parentName && (
            <>
              <span style={{ margin: '0 6px' }}>›</span>
              <span>{group.parentName}</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{group.name}</h1>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
            {GROUP_TYPE_LABELS[group.type] || group.type}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: group.status === 'ACTIVE' ? '#d1fae5' : '#f1f5f9', color: group.status === 'ACTIVE' ? '#065f46' : '#64748b' }}>
            {group.status}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button size="sm" onClick={() => navigate('/governance-groups')}>← Back to list</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </div>
        </div>
        {group.description && (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 6, marginBottom: 0 }}>
            {group.description}
          </p>
        )}
      </div>

      {/* ── Section 1: Composition ── */}
      <SectionShell
        title="Composition"
        hint="Members and the governance roles they hold. Required roles for this group type are tracked at the top. Each role chip shows its typical RACI letter on common decisions."
      >
        {/* Expected role slate */}
        {expectedRoles.length > 0 && (
          <div style={{
            padding: 12, marginBottom: 12,
            background: requiredFilled === requiredExpected.length ? '#f0fdf4' : '#fffbeb',
            border: `1px solid ${requiredFilled === requiredExpected.length ? '#bbf7d0' : '#fde68a'}`,
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6 }}>
              Expected roles ({requiredFilled}/{requiredExpected.length} required filled)
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
              Governance roles are <strong>org-wide</strong> — assigning one here is the
              same assignment shown on the Governance Roles page and the Governance
              Groups expected-role panel.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {expectedRoles.map((er) => {
                const assigned = memberRoles.filter((m) => m.roleType === er.roleType);
                const filled = assigned.length > 0;
                const indicator = filled ? '✓' : er.required ? '✗' : '○';
                const color = filled ? '#065f46' : er.required ? '#991b1b' : '#64748b';
                const bg = filled ? '#d1fae5' : er.required ? '#fee2e2' : '#f1f5f9';
                return (
                  <button
                    key={er.roleType}
                    onClick={() => { setAssignRoleSlot(er.roleType); setAssignRolePersonId(''); }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 4, border: `1px solid ${color}33`,
                      background: bg, color, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    }}
                    title={`${assigned.length} assigned${er.required ? ' (required)' : ''} — click to assign`}
                  >
                    <span style={{ fontWeight: 700 }}>{indicator}</span>
                    <span>{er.label}</span>
                    <span style={{ fontSize: 10, opacity: 0.8 }}>{assigned.length}</span>
                  </button>
                );
              })}
            </div>
            {/* Inline assign panel for the active slot */}
            {assignRoleSlot && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '8px 10px', background: 'var(--color-surface)', borderRadius: 4, border: '1px solid var(--color-border)' }}>
                <span style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Assign {DAMA_ROLE_LABELS[assignRoleSlot]} to:</span>
                <div style={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
                  <PersonPicker
                    mode="single"
                    valueMode="id"
                    value={assignRolePersonId || null}
                    onChange={(id) => setAssignRolePersonId(id || '')}
                    orgId={activeOrgId || undefined}
                    placeholder="Pick a person…"
                  />
                </div>
                <Button size="sm" variant="primary" onClick={() => handleAssignRole(assignRoleSlot, assignRolePersonId)} disabled={!assignRolePersonId}>
                  Assign
                </Button>
                <Button size="sm" onClick={() => { setAssignRoleSlot(null); setAssignRolePersonId(''); }}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Members table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th scope="col" style={th}>Member</th>
              <th scope="col" style={th}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  Group role
                  <HelpPopover id="group-role-vs-governance-role" title="Group role vs governance role">
                    <strong>Group role</strong> is the person's seat on this body — Chair,
                    Member, Secretary, etc. It's local to the group and has no RACI effect.
                    <strong> Governance roles</strong> (next column) are the org-wide DAMA
                    roles — Data Owner, Steward, CDO — that drive RACI and ownership.
                    Someone can be a group <em>Member</em> with no governance role, or hold
                    a governance role without sitting on any group.
                  </HelpPopover>
                </span>
              </th>
              <th scope="col" style={th}>Governance roles</th>
              <th scope="col" style={{ ...th, width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {group.members.length === 0 && (
              <tr><td colSpan={4} style={{ ...td, color: 'var(--color-text-muted)', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
                No members yet. Use the panel below to add one.
              </td></tr>
            )}
            {group.members.map((m) => {
              const personRoles = memberRoles.filter((r) => r.personId === m.personId);
              return (
                <tr key={m.personId}>
                  <td style={td}>
                    <Link to={`/people/${m.personId}`} style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>
                      {m.personName || m.personId}
                    </Link>
                  </td>
                  <td style={td}>{GROUP_ROLE_LABELS[m.groupRole] || m.groupRole}</td>
                  <td style={td}>
                    {personRoles.length === 0 ? (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>— no roles yet</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {personRoles.map((r) => (
                          <RoleChip
                            key={r.id}
                            roleType={r.roleType}
                            onOpenDrawer={() => openRoleDrawer(r.roleType)}
                            onRemove={() => handleUnassignRole(r.id)}
                          />
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      onClick={() => setConfirmRemoveMember(m)}
                      aria-label={`Remove ${m.personName || 'member'}`}
                      style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--color-error, #dc2626)' }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Add-member panel */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '8px 10px', background: 'var(--color-bg)', borderRadius: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Add member:</span>
          <div style={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
            <PersonPicker
              mode="single"
              valueMode="id"
              value={addMemberPersonId || null}
              onChange={(id) => setAddMemberPersonId(id || '')}
              orgId={activeOrgId || undefined}
              placeholder="Pick a person…"
            />
          </div>
          <select
            value={addMemberRole}
            onChange={(e) => setAddMemberRole(e.target.value)}
            style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 4 }}
          >
            {Object.entries(GROUP_ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <Button size="sm" variant="primary" onClick={handleAddMember} disabled={!addMemberPersonId}>
            Add
          </Button>
        </div>
      </SectionShell>

      {/* ── Section 2: Decision Rights this group owns ── */}
      <SectionShell
        title={`Decision Rights (${groupDRs.length})`}
        hint="Decisions where this group is the decider, recommends, approves, or is informed. Edit the full list on the Decision Rights page."
        link={{ label: 'Open Decision Rights ↗', to: '/decision-rights' }}
      >
        {groupDRs.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            No decision rights reference this group.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th scope="col" style={th}>Decision</th>
                <th scope="col" style={th}>Category</th>
                <th scope="col" style={{ ...th, width: 110 }}>This group's role</th>
              </tr>
            </thead>
            <tbody>
              {groupDRs.map(({ dr, role }) => (
                <tr key={dr.id}>
                  <td style={td}>{dr.decision}</td>
                  <td style={td}><span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{dr.category}</span></td>
                  <td style={td}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: role === 'Decider' ? '#dbeafe' : '#f1f5f9', color: role === 'Decider' ? '#1e40af' : '#475569', fontWeight: 600 }}>
                      {role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionShell>

      {/* ── Section 3: Policies via members ── */}
      <SectionShell
        title={`Policies (${memberPolicies.length})`}
        hint="Policies owned by anyone holding a governance role inside this group. Edit on the Policies page."
        link={{ label: 'Open Policies ↗', to: '/governance-policies' }}
      >
        {memberPolicies.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            No policies are owned by this group's members yet.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {memberPolicies.map((p) => (
              <li key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 10, fontSize: 13 }}>
                <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', color: 'var(--color-text-muted)' }}>{p.code}</span>
                <span style={{ flex: 1 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{p.category}</span>
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: p.status === 'ACTIVE' ? '#d1fae5' : '#f1f5f9', color: p.status === 'ACTIVE' ? '#065f46' : '#64748b' }}>
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionShell>

      {/* ── Section 4: Calendar — upcoming events for members ── */}
      <SectionShell
        title={`Calendar (${memberEvents.length})`}
        hint="Recurring events where at least one member is an attendee. Manage cadence and attendees on the Calendar page."
        link={{ label: 'Open Calendar ↗', to: '/governance-calendar' }}
      >
        {memberEvents.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            No calendar events involve this group yet.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {memberEvents.slice(0, 10).map((e) => (
              <li key={e.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 10, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{e.name}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{e.cadence.replace(/_/g, ' ').toLowerCase()}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {e.nextOccurrence ? new Date(e.nextOccurrence).toLocaleDateString() : '—'}
                </span>
              </li>
            ))}
            {memberEvents.length > 10 && (
              <li style={{ padding: '6px 0', fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center' }}>
                + {memberEvents.length - 10} more — see Calendar
              </li>
            )}
          </ul>
        )}
      </SectionShell>

      {/* ── Section 5: RACI snapshot ── */}
      <SectionShell
        title={`RACI snapshot (${groupRaciRows.length}${raciRows.length > 0 && groupRaciRows.length < 25 ? '' : '+'} activities)`}
        hint="Process activities where at least one member is Responsible, Accountable, Consulted, or Informed. Edit cells on the RACI matrix page."
        link={{ label: 'Open RACI matrix ↗', to: '/raci' }}
      >
        {groupRaciRows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            No RACI assignments for this group's members.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th scope="col" style={th}>Activity</th>
                <th scope="col" style={th}>Members involved</th>
              </tr>
            </thead>
            <tbody>
              {groupRaciRows.map((row) => (
                <tr key={row.nodeId}>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{row.nodeName}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{row.nodePath}</div>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {row.assignments.map((a) => {
                        const c = RACI_COLOR[a.raci];
                        return (
                          <span key={`${a.personId}-${a.raci}`} title={`${a.personName} — ${RACI_LABEL[a.raci]}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999, background: c.bg, color: c.text, fontSize: 11, fontWeight: 500 }}>
                            <span style={{ fontWeight: 700, fontSize: 10, padding: '0 4px', borderRadius: 3, background: c.text, color: '#fff' }}>{a.raci}</span>
                            {a.personName}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionShell>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this governance group?"
        message={`Delete "${group.name}"? Members will be detached but their organization-level role assignments will remain. Decision rights, policies, and calendar events that reference this group will need to be updated manually.`}
        confirmLabel="Delete group"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDeleteGroup}
      />
      <ConfirmDialog
        open={!!confirmRemoveMember}
        title="Remove this member?"
        message={confirmRemoveMember ? `Remove ${confirmRemoveMember.personName || 'this person'} from ${group.name}? Their organization-level governance role assignments will not be deleted — only their membership in this group.` : ''}
        confirmLabel="Remove from group"
        onCancel={() => setConfirmRemoveMember(null)}
        onConfirm={() => confirmRemoveMember && handleRemoveMember(confirmRemoveMember)}
      />
    </div>
  );
}

// ── SectionShell ──
function SectionShell({
  title, hint, link, children,
}: {
  title: string;
  hint?: string;
  link?: { label: string; to: string };
  children: React.ReactNode;
}) {
  return (
    <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
        {hint && <HelpPopover id={`group-detail-${title}`} title={title}>{hint}</HelpPopover>}
        {link && (
          <Link to={link.to} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none' }}>
            {link.label}
          </Link>
        )}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </section>
  );
}

// ── RoleChip — shows the role label plus its typical RACI letters on
//    common decisions, derived from roleDefinitions.ts. Clicking the
//    role opens the full Role Detail drawer; the × removes the
//    assignment. ──
function RoleChip({
  roleType, onOpenDrawer, onRemove,
}: { roleType: string; onOpenDrawer: () => void; onRemove: () => void }) {
  // Top RACI letters this role typically holds. Use the first three
  // typicalDecisions so the chip stays compact; the drawer shows the
  // full set. Deduplicate so 'A A A' renders as just 'A'.
  const ref = getRoleReference(roleType);
  const topRaci = (ref?.typicalDecisions || []).slice(0, 3).map((d) => d.raci);
  const distinctRaci: Raci[] = Array.from(new Set(topRaci));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 12, background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: 11 }}>
      <button
        onClick={onOpenDrawer}
        style={{ background: 'transparent', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'var(--color-text)', fontWeight: 500 }}
      >
        {DAMA_ROLE_LABELS[roleType] || roleType}
      </button>
      {distinctRaci.length > 0 && (
        <span style={{ display: 'inline-flex', gap: 2 }} title="Typical RACI authority on common decisions">
          {distinctRaci.map((l) => {
            const c = RACI_COLOR[l];
            return (
              <span key={l} style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: c.bg, color: c.text, fontSize: 9, fontWeight: 700, textAlign: 'center', lineHeight: '14px' }}>
                {l}
              </span>
            );
          })}
        </span>
      )}
      <button onClick={onRemove} aria-label="Remove role"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12, padding: 0, lineHeight: 1 }}>
        ×
      </button>
    </span>
  );
}

// ── Table cell styles ──
const th: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textAlign: 'left', padding: '8px 8px',
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td: React.CSSProperties = {
  padding: '8px', borderBottom: '1px solid var(--color-border)', verticalAlign: 'top',
};
