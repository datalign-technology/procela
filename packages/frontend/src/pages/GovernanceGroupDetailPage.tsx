import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Tabs from '../components/Tabs';
import Card from '../components/Card';
import EditableField from '../components/EditableField';
import DetailEditActions from '../components/DetailEditActions';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import SectionLabel from '../components/SectionLabel';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import { usePermissions } from '../hooks/usePermissions';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonRows } from '../components/Skeleton';
import HelpPopover from '../components/HelpPopover';
import PersonPicker from '../components/PersonPicker';
import Avatar from '../components/Avatar';
import { renderNavIcon } from '../components/navIcons';
import { GOVERNANCE_ROLES, GOVERNANCE_GROUP_ROLES } from '../types';
import { getRoleReference, RACI_COLOR, RACI_LABEL, RACI_DESCRIPTION, Raci } from '../lib/roleDefinitions';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceGroupDetailPage — single composition surface for one governance
// group. Replaces the five-page tour (Groups → Roles → RACI → Policies →
// Calendar) with one cohesive view of everything that body owns or does.
//
// Sections:
//   1. Header     — name / type / parent breadcrumb / edit
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
  // Exactly one of (personId, agentId) is set. Agent members are
  // restricted to the ADVISOR groupRole — the backend rejects any
  // other role for an agent so accountability for voting / chairing
  // / signing stays with humans.
  personId: string | null;
  agentId: string | null;
  groupRole: string;
  since: string;
  personName?: string | null;
  agentName?: string | null;
}

interface AgentOption {
  id: string;
  name: string;
  status: string;
  orgIds: string[];
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

// Short, human type label for the kicker ("Governance group · Council") — the
// full GROUP_TYPE_LABELS repeats the title ("Data Governance Council"), which
// is why the old secondary label read as a duplicate.
const GROUP_TYPE_SHORT: Record<string, string> = {
  COUNCIL: 'Council',
  OFFICE: 'Office',
  COMMITTEE: 'Committee',
  STEWARDSHIP_TEAM: 'Stewardship team',
  WORKING_GROUP: 'Working group',
  COMMUNITY_OF_PRACTICE: 'Community of practice',
};

const GROUP_ROLE_LABELS: Record<string, string> = {
  CHAIR: 'Chair',
  VICE_CHAIR: 'Vice Chair',
  MEMBER: 'Member',
  SECRETARY: 'Secretary',
  ADVISOR: 'Advisor',
};

// Seat ("their place on this group") colour — Chair stands out, Member is
// neutral, everything else a quiet blue-grey.
const seatColor = (role: string): { bg: string; color: string } =>
  role === 'CHAIR' ? { bg: '#dcefe5', color: '#17604b' }
  : role === 'MEMBER' ? { bg: 'var(--color-bg)', color: 'var(--color-text-secondary)' }
  : { bg: '#e5ecf3', color: '#364a5e' };

const DAMA_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  GOVERNANCE_ROLES.map((r) => [r.roleType, r.label]),
);

const EXPECTED_ROLES_BY_GROUP: Record<string, typeof GOVERNANCE_ROLES> = Object.fromEntries(
  GOVERNANCE_GROUP_ROLES.map((g) => [
    g.groupType,
    GOVERNANCE_ROLES.filter((r) => g.roleTypes.includes(r.roleType)),
  ]),
);

// The group's editable record fields (name / type / status / description /
// charter). Member & role management stays live on its own panels.
interface GroupEditable {
  name: string;
  type: string;
  status: string;
  parentId: string | null;
  description: string;
  charter: string;
}

interface GroupFlat {
  id: string;
  parentId: string | null;
  name: string;
}

export default function GovernanceGroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const { isAdmin } = usePermissions();
  const addToast = useToastStore((s) => s.addToast);
  const openRoleDrawer = useRoleDrawerStore((s) => s.open);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [allGroups, setAllGroups] = useState<GroupFlat[]>([]);
  const [damaRoles, setDamaRoles] = useState<DamaRole[]>([]);
  const [decisionRights, setDecisionRights] = useState<DecisionRight[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [raciRows, setRaciRows] = useState<RaciRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-member / assign-role local state. addMemberType drives the
  // Person/Agent toggle in the add panel; agents are restricted to
  // the ADVISOR groupRole so when type flips to 'agent' the role
  // selector is locked to ADVISOR and hidden.
  const [addMemberType, setAddMemberType] = useState<'person' | 'agent'>('person');
  const [addMemberPersonId, setAddMemberPersonId] = useState('');
  const [addMemberAgentId, setAddMemberAgentId] = useState('');
  const [addMemberRole, setAddMemberRole] = useState('MEMBER');
  const [assignRoleSlot, setAssignRoleSlot] = useState<string | null>(null);  // roleType currently being assigned
  const [assignRolePersonId, setAssignRolePersonId] = useState('');

  // Confirms
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<GroupMember | null>(null);

  // Per-member "⋯" actions menu, and the header overflow menu (org chart /
  // delete). Keyed by member id; closes on any outside click.
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  useEffect(() => {
    if (!rowMenuId && !headerMenuOpen) return;
    const close = () => { setRowMenuId(null); setHeaderMenuOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId, headerMenuOpen]);

  // ── Fetch everything ──
  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const orgQuery = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [groupRes, listRes, damaRes, drRes, polRes, calRes, raciRes, agentsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GroupDetail }>(`/governance-groups/${id}`),
        apiClient.get<{ success: boolean; data: GroupFlat[] }>(`/governance-groups${orgQuery}`).catch(() => ({ data: [] } as any)),
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
        apiClient.get<{ success: boolean; data: AgentOption[] }>(`/agents${orgQuery}`).catch(() => ({ data: [] } as any)),
      ]);
      setGroup(groupRes.data);
      setAllGroups(((listRes as any).data || []) as GroupFlat[]);
      setDamaRoles(damaRes.data || []);
      setDecisionRights(drRes.data || []);
      setPolicies(polRes.data || []);
      setCalendarEvents(calRes.data || []);
      setAgents(((agentsRes as any).data || []).filter((a: AgentOption) => a.status === 'ACTIVE'));

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

  // End the breadcrumb trail on the group's name (Dashboard › Groups › Data Council).
  useBreadcrumbLeaf(group?.name);

  // Record-field view/edit (name / type / status / description / charter),
  // driven by the shared useDetailEditMode so it reads and behaves like every
  // other detail surface. Member / role management stays live on its own
  // panels. The hook reseeds from `group` once it loads (serialised compare).
  const m = useDetailEditMode<GroupEditable>(
    {
      name: group?.name ?? '',
      type: group?.type ?? 'COUNCIL',
      status: group?.status ?? 'ACTIVE',
      parentId: group?.parentId ?? null,
      description: group?.description ?? '',
      charter: group?.charter ?? '',
    },
    async (draft) => {
      if (!group) return;
      if (!draft.name.trim()) { addToast('error', 'Name is required'); throw new Error('no-name'); }
      try {
        await apiClient.put(`/governance-groups/${group.id}`, draft);
        setGroup((g) => (g ? { ...g, ...draft } : g));
        addToast('success', 'Group updated');
      } catch (e) {
        addToast('error', e instanceof Error ? e.message : 'Update failed');
        throw e;
      }
    },
  );

  // Parent options for the re-parent select: every other group except this
  // one and its descendants (choosing a descendant would make a cycle).
  const parentOptions = useMemo(() => {
    if (!group) return [] as GroupFlat[];
    const childrenByParent = new Map<string | null, GroupFlat[]>();
    for (const g of allGroups) {
      const arr = childrenByParent.get(g.parentId) || [];
      arr.push(g);
      childrenByParent.set(g.parentId, arr);
    }
    const excluded = new Set<string>([group.id]);
    const stack = [group.id];
    while (stack.length) {
      const pid = stack.pop() as string;
      for (const c of childrenByParent.get(pid) || []) {
        if (!excluded.has(c.id)) { excluded.add(c.id); stack.push(c.id); }
      }
    }
    return allGroups
      .filter((g) => !excluded.has(g.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [group, allGroups]);

  // ── Derived: per-member role assignments ──
  // Person-keyed set used by derived person views (DAMA roles,
  // calendar attendees, RACI rows). Agent members are advisory only
  // and don't surface in those person-keyed lookups.
  const memberIds = useMemo(
    () => new Set((group?.members || []).map((m) => m.personId).filter((id): id is string => !!id)),
    [group]
  );
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
    if (!group) return;
    const isAgent = addMemberType === 'agent';
    if (isAgent && !addMemberAgentId) return;
    if (!isAgent && !addMemberPersonId) return;
    try {
      const payload: Record<string, unknown> = isAgent
        ? { agentId: addMemberAgentId, groupRole: 'ADVISOR' }
        : { personId: addMemberPersonId, groupRole: addMemberRole };
      await apiClient.post(`/governance-groups/${group.id}/members`, payload);
      addToast('success', 'Member added');
      setAddMemberPersonId('');
      setAddMemberAgentId('');
      setAddMemberRole('MEMBER');
      setAddMemberType('person');
      fetchAll();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Add failed');
    }
  };

  const handleRemoveMember = async (m: GroupMember) => {
    if (!group) return;
    try {
      const memberId = m.agentId || m.personId;
      await apiClient.delete(`/governance-groups/${group.id}/members/${memberId}`);
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
      addToast('success', 'Governance group deleted');
      navigate('/governance-groups');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setConfirmDeleteGroup(false);
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
      icon={<AlertTriangle size={36} strokeWidth={1.8} />}
      title={error || 'Group not found'}
      description="The governance group you're looking for may have been deleted, or you don't have access."
      action={{ label: '← Back to Groups', onClick: () => navigate('/governance-groups') }}
    />
  );

  // ── Derived member helpers for the redesigned composition view ──
  const chairMember = group.members.find((mm) => mm.groupRole === 'CHAIR') || null;
  const secretaryMember = group.members.find((mm) => mm.groupRole === 'SECRETARY') || null;
  const memberDisplayName = (mm: GroupMember) => mm.agentId ? (mm.agentName || mm.agentId || 'Agent') : (mm.personName || mm.personId || 'Unknown');
  // Typical RACI letters a member carries, via their governance roles.
  const memberRaciLetters = (personRoles: DamaRole[]): Raci[] => {
    const set = new Set<Raci>();
    for (const r of personRoles) {
      const ref = getRoleReference(r.roleType);
      (ref?.typicalDecisions || []).slice(0, 3).forEach((d) => set.add(d.raci));
    }
    return Array.from(set);
  };

  // Shared right rail — Facts + Expected roles — rendered beside every tab's
  // main column, since the group's facts stay relevant whichever facet is open.
  const factsRail = (
    <>
      <Card padding={0}>
        <div style={{ padding: '14px 18px' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Facts</h2>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '104px 1fr', rowGap: 10, fontSize: 13 }}>
            <dt style={{ color: 'var(--color-text-muted)' }}>Type</dt><dd style={{ margin: 0 }}>{GROUP_TYPE_SHORT[group.type] || group.type}</dd>
            <dt style={{ color: 'var(--color-text-muted)' }}>Reports to</dt>
            <dd style={{ margin: 0 }}>{group.parentId ? <Link to={`/governance-groups/${group.parentId}`} style={{ color: 'var(--color-primary)' }}>{group.parentName || 'Parent group'}</Link> : <span style={{ color: 'var(--color-text-muted)' }}>Top level (no parent)</span>}</dd>
            <dt style={{ color: 'var(--color-text-muted)' }}>Sub-groups</dt>
            <dd style={{ margin: 0 }}>{group.children.length === 0 ? <span style={{ color: 'var(--color-text-muted)' }}>None</span> : <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{group.children.map((c) => <Link key={c.id} to={`/governance-groups/${c.id}`} style={{ color: 'var(--color-primary)' }}>{c.name}</Link>)}</span>}</dd>
            <dt style={{ color: 'var(--color-text-muted)' }}>Chair</dt><dd style={{ margin: 0 }}>{chairMember ? memberDisplayName(chairMember) : <span style={{ color: 'var(--color-text-muted)' }}>Not set</span>}</dd>
            <dt style={{ color: 'var(--color-text-muted)' }}>Secretary</dt><dd style={{ margin: 0 }}>{secretaryMember ? memberDisplayName(secretaryMember) : <span style={{ color: 'var(--color-text-muted)' }}>Not set</span>}</dd>
            <dt style={{ color: 'var(--color-text-muted)' }}>Status</dt><dd style={{ margin: 0 }}>{group.status === 'ACTIVE' ? 'Active' : 'Inactive'}</dd>
          </dl>
        </div>
      </Card>
      {expectedRoles.length > 0 && (
        <Card padding={0}>
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Expected roles</h2>
              <span style={{ fontSize: 13, fontWeight: 600, color: requiredFilled === requiredExpected.length ? 'var(--color-success)' : 'var(--color-warning)' }}>{requiredFilled} of {requiredExpected.length}</span>
            </div>
            <p style={{ margin: '4px 0 12px', fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>Roles a {(GROUP_TYPE_SHORT[group.type] || 'group').toLowerCase()} should include. Assigning one here also assigns it org-wide.</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {expectedRoles.map((er) => {
                const assigned = memberRoles.filter((r) => r.roleType === er.roleType);
                const filled = assigned.length > 0;
                return (
                  <li key={er.roleType} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span aria-hidden="true" style={{ width: 16, flexShrink: 0, color: filled ? 'var(--color-success)' : er.required ? 'var(--color-warning)' : 'var(--color-text-muted)', fontWeight: 700 }}>{filled ? '✓' : er.required ? '!' : '○'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{er.label}</span>
                    {filled ? (
                      <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', textAlign: 'right' }}>{assigned.map((a) => a.personName).filter(Boolean).join(', ')}</span>
                    ) : isAdmin ? (
                      <button type="button" onClick={() => { setAssignRoleSlot(er.roleType); setAssignRolePersonId(''); }} style={{ fontSize: 12.5, color: 'var(--color-primary)', background: 'none', border: 0, cursor: 'pointer', padding: 0, fontWeight: 600 }}>Assign</button>
                    ) : <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>Unfilled</span>}
                  </li>
                );
              })}
            </ul>
            {isAdmin && assignRoleSlot && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Assign {DAMA_ROLE_LABELS[assignRoleSlot] || assignRoleSlot} to</div>
                <PersonPicker mode="single" valueMode="id" value={assignRolePersonId || null} onChange={(id) => setAssignRolePersonId(id || '')} orgId={activeOrgId || undefined} placeholder="Pick a person…" />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <Button size="sm" variant="primary" disabled={!assignRolePersonId} onClick={() => handleAssignRole(assignRoleSlot, assignRolePersonId)}>Assign</Button>
                  <Button size="sm" onClick={() => { setAssignRoleSlot(null); setAssignRolePersonId(''); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );

  // Wrap a tab's content in the main column, with the shared Facts rail beside.
  const twoCol = (main: React.ReactNode) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      <main style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>{main}</main>
      <aside aria-label="Group facts" style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>{factsRail}</aside>
    </div>
  );

  return (
    <div>
      {/* Header leads; the five owned/derived sections become tabs so the
          page reads as one entity with facets, not a long scroll. */}
      <Tabs
        header={
      <PageHeader
        kicker={`Governance group · ${GROUP_TYPE_SHORT[group.type] || group.type}`}
        title={group.name}
        copyId={group.id}
        copyLabel="Copy group ID"
        actions={
          <>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={headerMenuOpen}
                onClick={(e) => { e.stopPropagation(); setHeaderMenuOpen((v) => !v); }}
                style={{ width: 34, height: 34, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
              >⋯</button>
              {headerMenuOpen && (
                <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 38, right: 0, zIndex: 30, minWidth: 180, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                  <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); navigate('/governance/visualization'); }} style={menuItemStyle}>View in org chart</button>
                  {isAdmin && <button type="button" role="menuitem" onClick={() => { setHeaderMenuOpen(false); setConfirmDeleteGroup(true); }} style={{ ...menuItemStyle, color: 'var(--color-error)' }}>Delete group</button>}
                </div>
              )}
            </span>
            <DetailEditActions
              editing={m.isEditing}
              canEdit={isAdmin}
              dirty={m.dirty}
              saving={m.saving}
              onEdit={m.enter}
              onCancel={m.cancel}
              onSave={m.save}
            />
          </>
        }
        meta={
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: group.status === 'ACTIVE' ? '#d1fae5' : '#f1f5f9', color: group.status === 'ACTIVE' ? '#065f46' : '#64748b' }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor' }} />{group.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </span>
            {requiredExpected.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: requiredFilled === requiredExpected.length ? '#d1fae5' : '#fffbeb', color: requiredFilled === requiredExpected.length ? '#065f46' : 'var(--color-warning)' }}>
                Required roles {requiredFilled} of {requiredExpected.length} filled
              </span>
            )}
          </>
        }
      />
        }
        tabs={[
          { id: 'composition', label: `Members ${group.members.length}`, render: () => twoCol(
      <>
      {/* Edit mode shows the group's record fields; view mode shows the
          charter. The rest of the record (type / parent / status) lives in the
          Facts rail, so it isn't duplicated here. */}
      {m.isEditing ? (
        <Card>
          <SectionLabel marginBottom={12}>Edit group</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="Group name" />
            <EditableField label="Type" editing value={m.draft.type} onChange={(v) => m.set('type', v)} type="select" options={Object.keys(GROUP_TYPE_LABELS).map((t) => ({ value: t, label: GROUP_TYPE_LABELS[t] }))}>{GROUP_TYPE_LABELS[group.type] || group.type}</EditableField>
            <EditableField label="Status" editing value={m.draft.status} onChange={(v) => m.set('status', v)} type="select" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]}>{group.status === 'ACTIVE' ? 'Active' : 'Inactive'}</EditableField>
            <EditableField label="Parent group" editing value={m.draft.parentId ?? ''} onChange={(v) => m.set('parentId', v || null)} type="select" options={[{ value: '', label: '— None (top-level) —' }, ...parentOptions.map((g) => ({ value: g.id, label: g.name }))]}>{group.parentName || 'Top-level'}</EditableField>
          </div>
          <div style={{ marginTop: 14 }}>
            <EditableField label="Description" editing type="textarea" value={m.draft.description} onChange={(v) => m.set('description', v)} placeholder="What this group does" emptyText="No description" />
          </div>
          <div style={{ marginTop: 14 }}>
            <EditableField label="Charter" editing type="textarea" value={m.draft.charter} onChange={(v) => m.set('charter', v)} placeholder="The group's charter / mandate" emptyText="No charter" />
          </div>
        </Card>
      ) : group.charter ? (
        <Card padding={0}>
          <div style={{ padding: '16px 20px' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Charter</h2>
            <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', color: 'var(--color-text)' }}>{group.charter}</p>
          </div>
        </Card>
      ) : null}

      {/* Members */}
      <Card padding={0}>
        <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Members <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>{group.members.length}</span></h2>
          <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>Seat = their place on this group. Governance role = their org-wide job (drives RACI).</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th scope="col" style={th2}>Member</th>
                <th scope="col" style={th2}>Seat</th>
                <th scope="col" style={th2}>Governance role</th>
                <th scope="col" style={th2} title="Typical RACI letters these roles carry">Usual RACI</th>
                <th scope="col" style={{ ...th2, textAlign: 'right' }}><span style={srOnly}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {group.members.length === 0 && (
                <tr><td colSpan={5} style={{ ...td2, textAlign: 'center', color: 'var(--color-text-muted)', padding: 20 }}>No members yet. Add one below.</td></tr>
              )}
              {group.members.map((mm) => {
                const isAgent = !!mm.agentId;
                const memberId = (mm.agentId || mm.personId) as string;
                const displayName = memberDisplayName(mm);
                const detailPath = isAgent ? '/agents' : `/people/${mm.personId}`;
                const personRoles = isAgent ? [] : memberRoles.filter((r) => r.personId === mm.personId);
                const raci = memberRaciLetters(personRoles);
                const seatC = seatColor(mm.groupRole);
                return (
                  <tr key={memberId}>
                    <td style={td2}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={displayName} size="sm" />
                        <Link to={detailPath} style={{ color: 'var(--color-text)', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {isAgent && <span title="AI agent" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 3, background: '#ede9fe', color: '#5b21b6' }}>{renderNavIcon('/agents', { size: 11, strokeWidth: 2 })}Agent</span>}
                          {displayName}
                        </Link>
                      </span>
                    </td>
                    <td style={td2}><span style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 13, background: seatC.bg, color: seatC.color, fontSize: 12.5, fontWeight: 600 }}>{GROUP_ROLE_LABELS[mm.groupRole] || mm.groupRole}</span></td>
                    <td style={td2}>
                      {isAgent ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12.5, fontStyle: 'italic' }}>Advisor — no governance role</span>
                       : personRoles.length === 0 ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12.5 }}>None yet</span>
                       : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{personRoles.map((r) => <button key={r.id} type="button" onClick={() => openRoleDrawer(r.roleType)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 13, color: 'var(--color-primary)', cursor: 'pointer' }}>{DAMA_ROLE_LABELS[r.roleType] || r.roleType}</button>)}</span>}
                    </td>
                    <td style={td2}>
                      {raci.length === 0 ? <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                       : <span style={{ display: 'inline-flex', gap: 4 }}>{raci.map((l) => { const c = RACI_COLOR[l]; return <span key={l} title={`${RACI_LABEL[l]}: ${RACI_DESCRIPTION[l]}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 26, height: 22, padding: '0 6px', borderRadius: 6, background: c.bg, color: c.text, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, fontWeight: 600 }}>{l}</span>; })}</span>}
                    </td>
                    <td style={{ ...td2, textAlign: 'right' }}>
                      {isAdmin ? (
                        <span style={{ position: 'relative', display: 'inline-flex' }}>
                          <button type="button" aria-label={`More actions for ${displayName}`} aria-haspopup="menu" aria-expanded={rowMenuId === memberId} onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === memberId ? null : memberId); }} style={{ width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8, color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
                          {rowMenuId === memberId && (
                            <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 200, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                              <Link to={detailPath} role="menuitem" onClick={() => setRowMenuId(null)} style={{ ...menuItemStyle, display: 'block', textDecoration: 'none' }}>Open profile</Link>
                              {personRoles.map((r) => <button key={r.id} type="button" role="menuitem" onClick={() => { setRowMenuId(null); handleUnassignRole(r.id); }} style={menuItemStyle}>Remove {DAMA_ROLE_LABELS[r.roleType] || r.roleType} role</button>)}
                              <button type="button" role="menuitem" onClick={() => { setRowMenuId(null); setConfirmRemoveMember(mm); }} style={{ ...menuItemStyle, color: 'var(--color-error)' }}>Remove from group</button>
                            </div>
                          )}
                        </span>
                      ) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Add-member footer — people or agent advisors. Agents are locked to
            the ADVISOR seat so accountability for voting / chairing / signing
            stays with humans (backend AGENT_ALLOWED_GROUP_ROLES). Admin only. */}
        {isAdmin && (
          <div style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)', padding: '14px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', height: 38 }}>
                {(['person', 'agent'] as const).map((t) => {
                  const active = addMemberType === t;
                  return (
                    <button key={t} type="button"
                      onClick={() => { setAddMemberType(t); setAddMemberPersonId(''); setAddMemberAgentId(''); setAddMemberRole(t === 'agent' ? 'ADVISOR' : 'MEMBER'); }}
                      style={{ padding: '0 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: active ? (t === 'agent' ? '#ede9fe' : 'var(--color-surface)') : 'transparent', color: active ? (t === 'agent' ? '#5b21b6' : 'var(--color-text)') : 'var(--color-text-muted)', border: 'none', borderRight: t === 'person' ? '1px solid var(--color-border)' : 'none' }}>
                      {t === 'agent' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{renderNavIcon('/agents', { size: 12, strokeWidth: 2 })}AI agent</span> : 'Person'}
                    </button>
                  );
                })}
              </div>
              {addMemberType === 'person' ? (
                <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
                  <PersonPicker mode="single" valueMode="id" value={addMemberPersonId || null} onChange={(id) => setAddMemberPersonId(id || '')} orgId={activeOrgId || undefined} placeholder="Pick a person…" />
                </div>
              ) : (
                <select value={addMemberAgentId} onChange={(e) => setAddMemberAgentId(e.target.value)} style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320, height: 38, fontSize: 13, padding: '0 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
                  <option value="">Pick an agent…</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              {addMemberType === 'person' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Seat
                  <select value={addMemberRole} onChange={(e) => setAddMemberRole(e.target.value)} style={{ height: 38, fontSize: 13, padding: '0 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
                    {Object.entries(GROUP_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              ) : (
                <span title="Agents may only serve as Advisor so accountability for voting / chairing / signing stays with humans." style={{ fontSize: 11, padding: '6px 10px', borderRadius: 'var(--radius-md)', background: '#ede9fe', color: '#5b21b6', fontWeight: 600 }}>Advisor only</span>
              )}
              <Button size="md" variant="primary" onClick={handleAddMember} disabled={addMemberType === 'agent' ? !addMemberAgentId : !addMemberPersonId}>Add member</Button>
            </div>
            {addMemberType === 'agent' && agents.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 8 }}>No active agents in this org — create one on the Agents page first.</div>
            )}
          </div>
        )}
      </Card>
      </>
          ) },
          { id: 'decision-rights', label: `Decision Rights ${groupDRs.length}`, render: () => twoCol(
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
          <div style={{ overflowX: 'auto' }}>
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
          </div>
        )}
      </SectionShell>
          ) },
          { id: 'policies', label: `Documents ${memberPolicies.length}`, render: () => twoCol(
      <SectionShell
        title={`Documents (${memberPolicies.length})`}
        hint="Policies and standards owned by anyone holding a governance role inside this group. Edit on the Documents page."
        link={{ label: 'Open Documents ↗', to: '/governance-policies' }}
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
          ) },
          { id: 'calendar', label: `Meetings ${memberEvents.length}`, render: () => twoCol(
      <SectionShell
        title={`Meetings (${memberEvents.length})`}
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
          ) },
          { id: 'raci', label: `RACI ${groupRaciRows.length}`, render: () => twoCol(
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
          <div style={{ overflowX: 'auto' }}>
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
          </div>
        )}
      </SectionShell>
          ) },
        ]}
      />

      <ConfirmDialog
        open={!!confirmRemoveMember}
        title="Remove this member?"
        message={confirmRemoveMember ? `Remove ${confirmRemoveMember.agentName || confirmRemoveMember.personName || 'this member'} from ${group.name}? ${confirmRemoveMember.agentId ? 'The agent will remain available to assign elsewhere.' : 'Their organization-level governance role assignments will not be deleted — only their membership in this group.'}` : ''}
        confirmLabel="Remove from group"
        onCancel={() => setConfirmRemoveMember(null)}
        onConfirm={() => confirmRemoveMember && handleRemoveMember(confirmRemoveMember)}
      />

      <ConfirmDialog
        open={confirmDeleteGroup}
        title="Delete this governance group?"
        message={`Permanently delete ${group.name} and its sub-groups. This cannot be undone. Members' org-wide governance roles are not deleted — only their membership here.`}
        confirmLabel="Delete group"
        onCancel={() => setConfirmDeleteGroup(false)}
        onConfirm={handleDeleteGroup}
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

// ── Table cell styles ──
const th: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textAlign: 'left', padding: '8px 8px',
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td: React.CSSProperties = {
  padding: '8px', borderBottom: '1px solid var(--color-border)', verticalAlign: 'top',
};

// Members-table header/cell (a touch roomier than the compact snapshot tables).
const th2: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600,
  letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)',
  borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)',
};
const td2: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--color-border)', verticalAlign: 'middle' };
const srOnly: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' };
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};
