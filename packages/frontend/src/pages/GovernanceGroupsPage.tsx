import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { GOVERNANCE_ROLES, GOVERNANCE_GROUP_ROLES } from '../types';
import { useToastStore } from '../stores/toastStore';
import { exportCsv } from '../lib/exportCsv';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import IconButton from '../components/IconButton';
import { SkeletonRows } from '../components/Skeleton';
import PageTabNav, { GOVERNANCE_TABS } from '../components/PageTabNav';

// ── Types ──

interface GroupMember {
  personId: string;
  personName: string;
  groupRole: string;
  since: string;
}

interface GovernanceGroup {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  type: string;
  description: string;
  charter: string;
  status: 'ACTIVE' | 'INACTIVE';
  members: GroupMember[];
  children: GovernanceGroup[];
  createdAt: string;
  updatedAt: string;
}

interface GovernanceGroupFlat {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  type: string;
  description: string;
  charter: string;
  status: 'ACTIVE' | 'INACTIVE';
  members: GroupMember[];
  createdAt: string;
  updatedAt: string;
}

interface Person {
  id: string;
  name: string;
}

interface DamaRoleAssignment {
  id: string;
  personId: string;
  personName: string;
  roleType: string;
  scopeType: string;
  scopeId: string;
  since: string;
}

// ── Constants ──

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

const DAMA_ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  CDO: { bg: '#fce7f3', color: '#9d174d' },
  DATA_GOVERNANCE_LEAD: { bg: '#ede9fe', color: '#5b21b6' },
  DATA_OWNER: { bg: '#dbeafe', color: '#1e40af' },
  BUSINESS_DATA_STEWARD: { bg: '#d1fae5', color: '#065f46' },
  DATA_QUALITY_ANALYST: { bg: '#fef3c7', color: '#92400e' },
  TECHNICAL_DATA_STEWARD: { bg: '#e0e7ff', color: '#3730a3' },
  DATA_CUSTODIAN: { bg: '#f1f5f9', color: '#64748b' },
  DATA_ARCHITECT: { bg: '#fce7f3', color: '#831843' },
  DATA_ENGINEER: { bg: '#cffafe', color: '#155e75' },
  DATABASE_ADMINISTRATOR: { bg: '#f1f5f9', color: '#475569' },
};

const GROUP_TYPE_LABELS: Record<string, string> = {
  COUNCIL: 'Data Governance Council',
  OFFICE: 'Data Governance Office',
  COMMITTEE: 'Data Governance Committee',
  STEWARDSHIP_TEAM: 'Data Stewardship Team',
  WORKING_GROUP: 'Working Group',
  COMMUNITY_OF_PRACTICE: 'Community of Practice',
};

const GROUP_TYPE_SHORT: Record<string, string> = {
  COUNCIL: 'Council',
  OFFICE: 'Office',
  COMMITTEE: 'Committee',
  STEWARDSHIP_TEAM: 'Stewardship',
  WORKING_GROUP: 'Working Group',
  COMMUNITY_OF_PRACTICE: 'CoP',
};

const EXPECTED_ROLES_BY_GROUP: Record<string, typeof GOVERNANCE_ROLES> = Object.fromEntries(
  GOVERNANCE_GROUP_ROLES.map((g) => [
    g.groupType,
    GOVERNANCE_ROLES.filter((r) => g.roleTypes.includes(r.roleType)),
  ]),
);

const ROLE_LABELS: Record<string, string> = {
  CHAIR: 'Chair',
  VICE_CHAIR: 'Vice Chair',
  MEMBER: 'Member',
  SECRETARY: 'Secretary',
  ADVISOR: 'Advisor',
};

// ── Badge colors (Governance) ──

const typeBadgeColors: Record<string, { bg: string; color: string }> = {
  COUNCIL: { bg: '#dbeafe', color: '#1e40af' },
  OFFICE: { bg: '#ede9fe', color: '#5b21b6' },
  COMMITTEE: { bg: '#d1f0eb', color: '#0f4f46' },
  STEWARDSHIP_TEAM: { bg: '#fef3c7', color: '#92400e' },
  WORKING_GROUP: { bg: '#e0e7ff', color: '#3730a3' },
  COMMUNITY_OF_PRACTICE: { bg: '#f1f5f9', color: '#64748b' },
};

const roleBadgeColors: Record<string, { bg: string; color: string }> = {
  CHAIR: { bg: '#fce7f3', color: '#9d174d' },
  VICE_CHAIR: { bg: '#ede9fe', color: '#5b21b6' },
  MEMBER: { bg: '#f1f5f9', color: '#64748b' },
  SECRETARY: { bg: '#dbeafe', color: '#1e40af' },
  ADVISOR: { bg: '#fef3c7', color: '#92400e' },
};

// ── Styles ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};

const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

const btnIcon: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '2px 6px', fontSize: 11, color: 'var(--color-text-muted)', borderRadius: 4,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--color-border)',
};

const makeBadge = (colors: { bg: string; color: string }): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 6px', borderRadius: 3,
  fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
  background: colors.bg, color: colors.color,
});

const statusBadge = (status: string): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 6px', borderRadius: 3,
  fontSize: 9, fontWeight: 600,
  background: status === 'ACTIVE' ? '#d1f0eb' : '#f1f5f9',
  color: status === 'ACTIVE' ? '#0f4f46' : '#64748b',
});

// ── Helpers ──

interface FlatGroupOption { id: string; name: string; type: string; depth: number; label: string; }

function flattenTreeForSelect(nodes: GovernanceGroup[], depth = 0): FlatGroupOption[] {
  const result: FlatGroupOption[] = [];
  for (const node of nodes) {
    const indent = '\u00A0\u00A0'.repeat(depth);
    result.push({ id: node.id, name: node.name, type: node.type, depth, label: `${indent}${node.name} (${GROUP_TYPE_SHORT[node.type] || node.type})` });
    if (node.children.length > 0) result.push(...flattenTreeForSelect(node.children, depth + 1));
  }
  return result;
}

function collectAllIds(nodes: GovernanceGroup[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    if (node.children.length > 0) ids.push(...collectAllIds(node.children));
  }
  return ids;
}

// Returns which group types can be a valid parent of the given child type
function findValidParentTypes(validChildren: Record<string, string[]>, childType: string): string[] {
  const result: string[] = [];
  for (const [parentType, children] of Object.entries(validChildren)) {
    if (children.includes(childType)) result.push(parentType);
  }
  return result;
}

// ── Form data ──

interface GroupFormData {
  name: string;
  type: string;
  parentId: string | null;
  description: string;
  charter: string;
  status: string;
}

const emptyForm: GroupFormData = { name: '', type: 'COUNCIL', parentId: null, description: '', charter: '', status: 'ACTIVE' };

// ── Tree Node Component ──

function GroupTreeNode({ node, depth, onEdit, onDelete, onAddChild, onSelect, selectedId, expanded, toggleExpand, checkedIds, onToggleCheck }: {
  node: GovernanceGroup; depth: number;
  onEdit: (group: GovernanceGroupFlat) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string, parentType: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  checkedIds: Set<string>;
  onToggleCheck: (id: string) => void;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const memberCount = node.members?.length || 0;
  const typeColor = typeBadgeColors[node.type] || typeBadgeColors.COMMUNITY_OF_PRACTICE;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', paddingLeft: 10 + depth * 18,
          borderBottom: '1px solid var(--color-border)',
          borderLeft: `3px solid ${typeColor.color}`,
          background: isSelected ? 'var(--color-primary-light, #f0f7ff)' : undefined,
          cursor: 'pointer', transition: 'background 0.1s',
          minWidth: 0,
        }}
        onClick={() => onSelect(node.id)}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
      >
        <span onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpand(node.id); }}
          style={{ width: 14, fontSize: 10, color: 'var(--color-text-muted)', cursor: hasChildren ? 'pointer' : 'default', userSelect: 'none' }}>
          {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : '\u2022'}
        </span>
        <input type="checkbox" checked={checkedIds.has(node.id)} onChange={() => onToggleCheck(node.id)} onClick={(e) => e.stopPropagation()} style={{ cursor: 'pointer', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
            <span style={makeBadge(typeColor)}>{GROUP_TYPE_SHORT[node.type] || node.type}</span>
            <span style={statusBadge(node.status)}>{node.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span>
            {memberCount > 0 && <span style={{ fontSize: 9, color: 'var(--color-text-muted)', background: '#f1f5f9', padding: '0px 5px', borderRadius: 8 }}>{memberCount}</span>}
          </div>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <IconButton size="sm" icon="plus" label="Add child group" variant="primary" onClick={() => onAddChild(node.id, node.type)} />
          <IconButton size="sm" icon="edit" label="Edit" onClick={() => onEdit(node)} />
          <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => onDelete(node.id)} />
        </div>
      </div>
      {isExpanded && node.children.map((child) => (
        <GroupTreeNode key={child.id} node={child} depth={depth + 1}
          onEdit={onEdit} onDelete={onDelete} onAddChild={onAddChild}
          onSelect={onSelect} selectedId={selectedId}
          expanded={expanded} toggleExpand={toggleExpand}
          checkedIds={checkedIds} onToggleCheck={onToggleCheck} />
      ))}
    </div>
  );
}

// ── Main Component ──

export default function GovernanceGroupsPage() {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  // Data state
  const [flatGroups, setFlatGroups] = useState<GovernanceGroupFlat[]>([]);
  const [tree, setTree] = useState<GovernanceGroup[]>([]);
  const [groupTypes, setGroupTypes] = useState<string[]>([]);
  const [groupTypeLabels, setGroupTypeLabels] = useState<Record<string, string>>({});
  const [validChildren, setValidChildren] = useState<Record<string, string[]>>({});
  const [groupRoles, setGroupRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Tree state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // Detail state (for members panel)
  const [selectedGroupDetail, setSelectedGroupDetail] = useState<any>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [memberPersonId, setMemberPersonId] = useState('');
  const [memberRole, setMemberRole] = useState('MEMBER');
  const [showAddMember, setShowAddMember] = useState(false);

  // DAMA roles for the members of the selected group
  const [memberDamaRoles, setMemberDamaRoles] = useState<DamaRoleAssignment[]>([]);
  const [assignRolePersonId, setAssignRolePersonId] = useState('');
  const [assignRoleType, setAssignRoleType] = useState('');

  // Recommendations for selected group
  interface GroupRecommendation {
    name: string;
    type: string;
    typeLabel: string;
    description: string;
    charter: string;
    reason: string;
    exists: boolean;
  }
  const [recommendations, setRecommendations] = useState<GroupRecommendation[]>([]);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [creatingRec, setCreatingRec] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GroupFormData>(emptyForm);
  // When adding a child, restrict the type dropdown to valid child types
  const [allowedTypes, setAllowedTypes] = useState<string[] | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const toggleCheck = (id: string) => setCheckedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleCheckAll = () => {
    if (checkedIds.size === flatGroups.length) setCheckedIds(new Set());
    else setCheckedIds(new Set(flatGroups.map((g) => g.id)));
  };

  // ── Data fetching ──

  const fetchGroups = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{
        success: boolean;
        data: GovernanceGroupFlat[];
        tree: GovernanceGroup[];
        groupTypes: string[];
        groupTypeLabels: Record<string, string>;
        validChildren: Record<string, string[]>;
        groupRoles: string[];
      }>(`/governance-groups${query}`);
      setFlatGroups(res.data || []);
      setTree(res.tree || []);
      setGroupTypes(res.groupTypes || []);
      setGroupTypeLabels(res.groupTypeLabels || {});
      setValidChildren(res.validChildren || {});
      setGroupRoles(res.groupRoles || []);
    } catch { /* */ }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const fetchGroupDetail = useCallback(async (id: string) => {
    try {
      const res = await apiClient.get<{ success: boolean; data: any }>(`/governance-groups/${id}`);
      const detail = res.data || null;
      setSelectedGroupDetail(detail);

      // Fetch DAMA roles for all members of this group
      if (detail?.members?.length > 0) {
        const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
        const rolesRes = await apiClient.get<{ success: boolean; data: DamaRoleAssignment[]; roleTypes: string[] }>(`/dama-roles${query}`);
        const allRoles = rolesRes.data || [];
        const memberIds = new Set(detail.members.map((m: GroupMember) => m.personId));
        setMemberDamaRoles(allRoles.filter((r) => memberIds.has(r.personId)));
      } else {
        setMemberDamaRoles([]);
      }

      // Fetch recommendations for this group
      try {
        const recRes = await apiClient.get<{ success: boolean; data: GroupRecommendation[] }>(`/governance-groups/${id}/recommendations`);
        setRecommendations(recRes.data || []);
      } catch { setRecommendations([]); }
    } catch { /* */ }
  }, [activeOrgId]);

  const fetchPeople = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: Person[] }>('/people');
      setPeople(res.data || []);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  useEffect(() => {
    if (selectedGroupId) {
      fetchGroupDetail(selectedGroupId);
      fetchPeople();
      setShowRecommendations(false);
    } else {
      setSelectedGroupDetail(null);
      setRecommendations([]);
    }
  }, [selectedGroupId, fetchGroupDetail, fetchPeople]);

  // ── Tree handlers ──

  const toggleExpand = (id: string) => setExpanded((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const expandAll = () => setExpanded(new Set(collectAllIds(tree)));
  const collapseAll = () => setExpanded(new Set());

  const handleSelect = (id: string) => {
    setSelectedGroupId(selectedGroupId === id ? null : id);
    setMemberPersonId(''); setMemberRole('MEMBER');
  };

  // ── Form handlers ──

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm);
    setEditingId(null);
    setAllowedTypes(null); // all types allowed for top-level
    setShowForm(true);
  };

  const openAddChild = (parentId: string, parentType: string) => {
    const recommended = validChildren[parentType] || [];
    const defaultType = recommended.length > 0 ? recommended[0] : groupTypes[0];
    setForm({ ...emptyForm, parentId, type: defaultType });
    setEditingId(null);
    setAllowedTypes(null); // show all types — recommended ones will be highlighted
    setShowForm(true);
  };

  const openEdit = (group: GovernanceGroupFlat) => {
    setForm({
      name: group.name, type: group.type, parentId: group.parentId,
      description: group.description, charter: group.charter, status: group.status,
    });
    setEditingId(group.id);
    setAllowedTypes(null); // all types in edit mode
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.type) return;
    const payload = {
      ...form,
      ...(activeOrgId ? { orgId: activeOrgId } : {}),
    };
    let res: any;
    if (editingId) {
      res = await apiClient.put(`/governance-groups/${editingId}`, payload);
      addToast('success', 'Governance group updated');
    } else {
      res = await apiClient.post('/governance-groups', payload);
      addToast('success', 'Governance group created');
    }
    setShowForm(false); setEditingId(null); setForm(emptyForm); setAllowedTypes(null);
    fetchGroups();
    if (selectedGroupId) fetchGroupDetail(selectedGroupId);
    // Show governance recommendation warning if returned
    if (res?.warning) {
      setTimeout(() => alert(res.warning), 100);
    }
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/governance-groups/${id}`);
    if (selectedGroupId === id) { setSelectedGroupId(null); setSelectedGroupDetail(null); }
    addToast('success', 'Governance group deleted');
    fetchGroups();
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(checkedIds);
    await Promise.all(ids.map((id) => apiClient.delete(`/governance-groups/${id}`)));
    addToast('success', `Deleted ${ids.length} governance group${ids.length === 1 ? '' : 's'}`);
    setCheckedIds(new Set());
    if (selectedGroupId && checkedIds.has(selectedGroupId)) {
      setSelectedGroupId(null);
      setSelectedGroupDetail(null);
    }
    fetchGroups();
  };

  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); setAllowedTypes(null); };

  // ── Member handlers ──

  const handleAddMember = async () => {
    if (!selectedGroupId || !memberPersonId || !memberRole) return;
    try {
      await apiClient.post(`/governance-groups/${selectedGroupId}/members`, { personId: memberPersonId, groupRole: memberRole });
      setMemberPersonId(''); setMemberRole('MEMBER');
      fetchGroupDetail(selectedGroupId);
      fetchGroups();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add member');
    }
  };

  const handleRemoveMember = async (personId: string) => {
    if (!selectedGroupId) return;
    await apiClient.delete(`/governance-groups/${selectedGroupId}/members/${personId}`);
    fetchGroupDetail(selectedGroupId);
    fetchGroups();
  };

  const handleAssignDamaRole = async () => {
    if (!assignRolePersonId || !assignRoleType || !activeOrgId) return;
    try {
      await apiClient.post('/dama-roles', {
        personId: assignRolePersonId,
        roleType: assignRoleType,
        scopeType: 'ORG',
        scopeId: activeOrgId,
      });
      // Auto-add as group member if not already a member
      if (selectedGroupId && selectedGroupDetail) {
        const isMember = (selectedGroupDetail.members || []).some((m: GroupMember) => m.personId === assignRolePersonId);
        if (!isMember) {
          try {
            await apiClient.post(`/governance-groups/${selectedGroupId}/members`, {
              personId: assignRolePersonId,
              groupRole: 'MEMBER',
            });
          } catch { /* may already be a member */ }
        }
      }
      addToast('success', `Assigned ${DAMA_ROLE_LABELS[assignRoleType] || assignRoleType}`);
      setAssignRolePersonId('');
      setAssignRoleType('');
      if (selectedGroupId) fetchGroupDetail(selectedGroupId);
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Failed to assign role';
      addToast('error', msg);
    }
  };

  const handleRemoveDamaRole = async (roleId: string) => {
    try {
      await apiClient.delete(`/dama-roles/${roleId}`);
      addToast('success', 'Role removed');
      if (selectedGroupId) fetchGroupDetail(selectedGroupId);
    } catch {
      addToast('error', 'Failed to remove role');
    }
  };

  const handleCreateRecommended = async (rec: GroupRecommendation) => {
    if (!selectedGroupId) return;
    setCreatingRec(rec.name);
    try {
      await apiClient.post('/governance-groups', {
        name: rec.name,
        type: rec.type,
        description: rec.description,
        charter: rec.charter,
        status: 'ACTIVE',
        orgId: activeOrgId || undefined,
        parentId: selectedGroupId,
      });
      addToast('success', `Created "${rec.name}"`);
      fetchGroups();
      fetchGroupDetail(selectedGroupId);
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Failed to create group';
      addToast('error', msg);
    } finally {
      setCreatingRec(null);
    }
  };

  // ── Computed values ──

  const existingMemberIds = new Set(selectedGroupDetail?.members?.map((m: GroupMember) => m.personId) || []);
  const availablePeople = people.filter((p) => !existingMemberIds.has(p.id));

  // For the parent dropdown in the form: show all groups (flattened tree), filtered by valid parents for the selected type
  const treeOptions = flattenTreeForSelect(tree);

  // Filter parent options: only groups whose validChildren include the selected type
  const getValidParentOptions = () => {
    if (!form.type) return treeOptions;
    const validParentTypes = findValidParentTypes(validChildren, form.type);
    return treeOptions.filter((opt) => {
      // Don't allow selecting the group being edited as its own parent
      if (editingId && opt.id === editingId) return false;
      return validParentTypes.includes(opt.type);
    });
  };

  // Determine which types to show in the type dropdown
  const typeOptions = groupTypes; // always show all types
  const parentGroup = form.parentId ? flatGroups.find((g) => g.id === form.parentId) : null;
  const recommendedTypes = parentGroup ? (validChildren[parentGroup.type] || []) : [];

  // ── Render ──

  if (loading) return (
    <div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
        <SkeletonRows rows={5} columns={4} />
      </div>
    </div>
  );

  return (
    <div>
      <PageTabNav tabs={GOVERNANCE_TABS} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Governance Groups</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Manage governance councils, committees, and working groups. {flatGroups.length} groups total.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {flatGroups.length > 0 && (
            <IconButton icon="trash" label="Delete all groups" variant="danger"
              onClick={() => setShowDeleteAll(true)} />
          )}
          {flatGroups.length > 0 && (
            <IconButton icon="eye" label="Visualize"
              onClick={() => navigate('/governance/visualization')} />
          )}
          {flatGroups.length > 0 && (
            <IconButton icon="download" label="Export CSV"
              onClick={() => exportCsv('governance-groups.csv', ['Name', 'Type', 'Parent', 'Description', 'Members', 'Status'], flatGroups.map((g) => [
                g.name,
                GROUP_TYPE_LABELS[g.type] || g.type,
                flatGroups.find((p) => p.id === g.parentId)?.name || '',
                g.description,
                String(g.members.length),
                g.status,
              ]))} />
          )}
          {canWrite && (
            <IconButton icon="settings"
              label={
                flatGroups.length > 0
                  ? `Generate disabled — ${flatGroups.length} group${flatGroups.length === 1 ? '' : 's'} already exist. Delete all to regenerate.`
                  : 'Generate governance template'
              }
              disabled={flatGroups.length > 0}
              onClick={() => setConfirmGenerate(true)} />
          )}
          {canWrite && (
            <IconButton icon="plus" label="Add group" variant="primary" onClick={openAdd} />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmGenerate}
        title="Generate Governance Structure?"
        message="This will create a standard DAMA-aligned governance structure: Council, Office, Committee, Stewardship Teams, and Working Group. You can customize the structure after creation."
        confirmLabel="Generate"
        variant="primary"
        onConfirm={async () => {
          setConfirmGenerate(false);
          try {
            await apiClient.post('/governance-groups/generate-template', { orgId: activeOrgId || undefined });
            addToast('success', 'Governance structure generated');
            fetchGroups();
          } catch { addToast('error', 'Failed to generate governance structure'); }
        }}
        onCancel={() => setConfirmGenerate(false)}
      />
      <ConfirmDialog
        open={showDeleteAll}
        title="Delete All Governance Groups?"
        message={`This will permanently delete all ${flatGroups.length} governance groups. This cannot be undone.`}
        confirmLabel="Delete All"
        requireTypedConfirmation="DELETE"
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/governance-groups/all');
          setSelectedGroupId(null);
          setSelectedGroupDetail(null);
          fetchGroups();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Governance Group?"
        message="This will permanently delete this governance group and its children. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          const id = confirmDelete;
          setConfirmDelete(null);
          if (id) await handleDelete(id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${checkedIds.size} Governance Group${checkedIds.size === 1 ? '' : 's'}?`}
        message="This will permanently delete the selected governance groups and re-parent any children. This cannot be undone."
        confirmLabel={`Delete ${checkedIds.size}`}
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Governance Hierarchy Guidance */}
      {flatGroups.length === 0 ? (
        <div style={{ marginBottom: 12, padding: '14px 16px', background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)', borderRadius: 'var(--radius-md)', border: '1px solid #93c5fd', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1e40af', marginBottom: 2 }}>
              Recommended structure: Council {'\u2192'} Office {'\u2192'} Committee {'\u2192'} Stewardship Teams {'\u2192'} Working Groups {'\u2192'} Communities of Practice
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Get started quickly by creating the core governance groups in one click.</div>
          </div>
          <button
            style={{ ...btnPrimary, whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={async () => {
              if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
              try {
                const councilRes = await apiClient.post<{ success: boolean; data: { id: string } }>('/governance-groups', {
                  name: 'Data Governance Council', type: 'COUNCIL', parentId: null, orgId: activeOrgId, description: 'Top-level governance body providing strategic direction and oversight for data governance.', status: 'ACTIVE',
                });
                const councilId = councilRes.data?.id;
                if (councilId) {
                  await apiClient.post('/governance-groups', {
                    name: 'Data Governance Office', type: 'OFFICE', parentId: councilId, orgId: activeOrgId, description: 'Operational arm responsible for day-to-day data governance execution.', status: 'ACTIVE',
                  });
                  await apiClient.post('/governance-groups', {
                    name: 'Data Governance Committee', type: 'COMMITTEE', parentId: councilId, orgId: activeOrgId, description: 'Cross-functional committee coordinating data governance initiatives.', status: 'ACTIVE',
                  });
                }
                addToast('success', 'Created recommended governance structure');
                fetchGroups();
              } catch {
                addToast('error', 'Failed to create recommended structure');
              }
            }}
          >
            Create Recommended Structure
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12, padding: '6px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
          <span style={{ opacity: 0.8 }}>Recommended structure:</span> Council {'\u2192'} Office {'\u2192'} Committee {'\u2192'} Stewardship Teams {'\u2192'} Working Groups {'\u2192'} Communities of Practice
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            {editingId ? 'Edit Governance Group' : allowedTypes ? 'Add Child Group' : 'Add New Governance Group'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Governance Council" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type *</label>
              <select style={selectStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, parentId: form.parentId })}>
                {typeOptions.map((t) => {
                  const isRecommended = recommendedTypes.length > 0 && recommendedTypes.includes(t);
                  const label = groupTypeLabels[t] || GROUP_TYPE_LABELS[t] || t;
                  return <option key={t} value={t}>{label}{isRecommended ? ' (recommended)' : ''}</option>;
                })}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Parent Group</label>
              <select style={selectStyle} value={form.parentId || ''} onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}>
                <option value="">-- No parent (top-level) --</option>
                {getValidParentOptions().map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description of this group's purpose" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Charter</label>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.charter} onChange={(e) => setForm({ ...form, charter: e.target.value })} placeholder="Group charter, responsibilities, and scope" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !form.name.trim() || !form.type ? 0.6 : 1, cursor: !form.name.trim() || !form.type ? 'not-allowed' : 'pointer' }} disabled={!form.name.trim() || !form.type} onClick={handleSave}>
              {editingId ? 'Save Changes' : 'Add Group'}
            </button>
          </div>
        </div>
      )}

      {/* Bulk Action Bar */}
      {checkedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{checkedIds.size} selected</span>
          <button onClick={() => setConfirmBulkDelete(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            Delete Selected
          </button>
          <button onClick={() => setCheckedIds(new Set())}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            Clear Selection
          </button>
        </div>
      )}

      {/* Master-Detail Layout: Tree (left) + Detail (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16 }}>
        {/* Left Panel — Tree View */}
        <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', alignSelf: 'start' }}>
          {/* Tree toolbar */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)', alignItems: 'center' }}>
            <input type="checkbox" checked={flatGroups.length > 0 && checkedIds.size === flatGroups.length} onChange={toggleCheckAll} style={{ cursor: 'pointer' }} title="Select all" />
            <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-primary)' }} onClick={expandAll}>Expand All</button>
            <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-primary)' }} onClick={collapseAll}>Collapse All</button>
          </div>

          {/* Tree body */}
          <div>
            {tree.length === 0 && !showForm ? (
              <EmptyState
                icon={'☷'}
                title="No governance groups defined yet"
                description="Use the + Add Group button above to get started."
                action={{ label: '+ Add Group', onClick: openAdd }}
              />
            ) : (
              tree.map((node) => (
                <GroupTreeNode key={node.id} node={node} depth={0}
                  onEdit={openEdit} onDelete={(id) => setConfirmDelete(id)} onAddChild={openAddChild}
                  onSelect={handleSelect} selectedId={selectedGroupId}
                  expanded={expanded} toggleExpand={toggleExpand}
                  checkedIds={checkedIds} onToggleCheck={toggleCheck} />
              ))
            )}
          </div>
        </div>

        {/* Right Panel — Detail */}
        <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
          {selectedGroupId && selectedGroupDetail ? (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600 }}>Members of "{selectedGroupDetail.name}"</h3>
                    <span style={makeBadge(typeBadgeColors[selectedGroupDetail.type] || typeBadgeColors.COMMUNITY_OF_PRACTICE)}>{GROUP_TYPE_SHORT[selectedGroupDetail.type] || selectedGroupDetail.type}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{selectedGroupDetail.members?.length || 0} {(selectedGroupDetail.members?.length || 0) === 1 ? 'member' : 'members'}</span>
                  </div>
                  {selectedGroupDetail.description && <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{selectedGroupDetail.description}</p>}
                  <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>Tip: You can also manage group memberships from Organizations {'→'} click "Manage" on any person.</p>
                </div>
                <button style={{ ...btnIcon, fontSize: 12 }} onClick={() => { setSelectedGroupId(null); setSelectedGroupDetail(null); }}>Close</button>
              </div>

              {/* Expected Governance Roles */}
              {EXPECTED_ROLES_BY_GROUP[selectedGroupDetail.type] && (() => {
                const expectedRoles = EXPECTED_ROLES_BY_GROUP[selectedGroupDetail.type];
                const requiredCount = expectedRoles.filter((r) => r.required).length;
                const requiredFilled = expectedRoles.filter((r) => r.required && memberDamaRoles.some((d) => d.roleType === r.roleType)).length;
                return (
                  <div style={{ marginBottom: 16, padding: 14, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Governance Roles
                      </div>
                      <span style={{ fontSize: 11, color: requiredFilled === requiredCount ? '#16a34a' : '#dc2626' }}>
                        {requiredFilled} of {requiredCount} required roles filled
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {expectedRoles.map((expected) => {
                        const assigned = memberDamaRoles.filter((r) => r.roleType === expected.roleType);
                        const isFilled = assigned.length > 0;
                        const canAddMore = expected.multiAssign || assigned.length === 0;
                        return (
                          <div key={expected.roleType} style={{
                            padding: '10px 14px',
                            background: 'var(--color-surface)',
                            border: `1px solid ${isFilled ? '#bbf7d0' : expected.required ? '#fecaca' : 'var(--color-border)'}`,
                            borderLeft: `3px solid ${isFilled ? '#22c55e' : expected.required ? '#ef4444' : '#d1d5db'}`,
                            borderRadius: 'var(--radius-md)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                              <span style={{
                                width: 18, height: 18, borderRadius: '50%', marginTop: 1,
                                background: isFilled ? '#22c55e' : 'transparent',
                                border: isFilled ? 'none' : '1.5px solid #d1d5db',
                                color: '#fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 700, flexShrink: 0,
                              }}>
                                {isFilled ? '✓' : ''}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: isFilled ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                                    {expected.label}
                                  </span>
                                  <span style={{
                                    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
                                    background: expected.required ? '#fef2f2' : '#f0f9ff',
                                    color: expected.required ? '#b91c1c' : '#0369a1',
                                  }}>
                                    {expected.required ? 'Required' : 'Optional'}
                                  </span>
                                  {expected.multiAssign && (
                                    <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: '#f5f3ff', color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                      Multiple
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{expected.purpose}</div>
                                {assigned.length > 0 && (
                                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {assigned.map((a) => (
                                      <span key={a.id} style={{ fontSize: 11, padding: '2px 8px', background: '#d1f0eb', color: '#0f4f46', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        {a.personName}
                                        <button onClick={() => handleRemoveDamaRole(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0f4f46', fontSize: 12, padding: 0, lineHeight: 1 }}>&times;</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {canAddMore && (
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                                  <select
                                    style={{ ...selectStyle, width: 'auto', minWidth: 140, fontSize: 11, padding: '4px 8px' }}
                                    value={assignRoleType === expected.roleType ? assignRolePersonId : ''}
                                    onChange={(e) => { setAssignRoleType(expected.roleType); setAssignRolePersonId(e.target.value); }}
                                  >
                                    <option value="">Select person...</option>
                                    {people.filter((p) => !assigned.some((a) => a.personId === p.id)).map((p) => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                  <button
                                    style={{ ...btnPrimary, padding: '3px 10px', fontSize: 11, opacity: !(assignRoleType === expected.roleType && assignRolePersonId) ? 0.5 : 1, cursor: !(assignRoleType === expected.roleType && assignRolePersonId) ? 'not-allowed' : 'pointer' }}
                                    disabled={!(assignRoleType === expected.roleType && assignRolePersonId)}
                                    onClick={handleAssignDamaRole}
                                  >
                                    Assign
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Add Member (collapsed by default) */}
              <div style={{ marginBottom: 12 }}>
                {!showAddMember ? (
                  <button onClick={() => setShowAddMember(true)} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                    + Add member without governance role
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 10, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Person</label>
                      <select style={selectStyle} value={memberPersonId} onChange={(e) => setMemberPersonId(e.target.value)}>
                        <option value="">-- Select person --</option>
                        {availablePeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Group Role</label>
                      <select style={selectStyle} value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
                        {groupRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                      </select>
                    </div>
                    <button style={btnSecondary} onClick={() => { setShowAddMember(false); setMemberPersonId(''); setMemberRole('MEMBER'); }}>Cancel</button>
                    <button
                      style={{ ...btnPrimary, opacity: !memberPersonId ? 0.6 : 1, cursor: !memberPersonId ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                      disabled={!memberPersonId}
                      onClick={() => { handleAddMember(); setShowAddMember(false); }}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              {/* Members Table */}
              {(!selectedGroupDetail.members || selectedGroupDetail.members.length === 0) ? (
                <p style={{ color: 'var(--color-text-muted)', fontSize: 12, textAlign: 'center', padding: '1.5rem' }}>
                  No members yet. Assign governance roles above to add people to this group.
                </p>
              ) : (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg)' }}>
                        <th style={thStyle}>Person Name</th>
                        <th style={thStyle}>Group Role</th>
                        <th style={thStyle}>DAMA Roles</th>
                        <th style={thStyle}>Since</th>
                        <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedGroupDetail.members.map((member: GroupMember) => {
                        const personRoles = memberDamaRoles.filter((r) => r.personId === member.personId);
                        return (
                          <tr key={member.personId}
                            style={{ transition: 'background 0.1s' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                          >
                            <td style={{ ...tdStyle, fontWeight: 500 }}>{member.personName}</td>
                            <td style={tdStyle}>
                              <span style={makeBadge(roleBadgeColors[member.groupRole] || roleBadgeColors.MEMBER)}>
                                {ROLE_LABELS[member.groupRole] || member.groupRole}
                              </span>
                            </td>
                            <td style={tdStyle}>
                              {personRoles.length > 0 ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                  {personRoles.map((r) => (
                                    <span key={r.id} style={{ ...makeBadge(DAMA_ROLE_COLORS[r.roleType] || { bg: '#f1f5f9', color: '#64748b' }), display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                      {DAMA_ROLE_LABELS[r.roleType] || r.roleType}
                                      <button
                                        onClick={() => handleRemoveDamaRole(r.id)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: 'inherit', padding: 0, lineHeight: 1, opacity: 0.7 }}
                                        title="Remove role"
                                      >&times;</button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>None assigned</span>
                              )}
                            </td>
                            <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>
                              {new Date(member.since).toLocaleDateString()}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 11, padding: '2px 6px' }} onClick={() => handleRemoveMember(member.personId)}>Remove</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}


              {/* Recommended Child Groups */}
              {recommendations.length > 0 && !showRecommendations && (
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => setShowRecommendations(true)}
                    style={{
                      padding: '6px 14px', fontSize: 12, fontWeight: 500,
                      background: 'var(--color-surface)', color: '#1e40af',
                      border: '1px solid #93c5fd', borderRadius: 'var(--radius-md)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{'ℹ'}</span>
                    Explore Recommendations ({recommendations.length})
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    DAMA best practices suggest additional groups under this one
                  </span>
                </div>
              )}
              {showRecommendations && recommendations.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, color: '#2563eb' }}>{'ℹ'}</span>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Recommended Groups</div>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        Based on DAMA best practices{selectedGroupDetail.type === 'COMMITTEE' || selectedGroupDetail.type === 'OFFICE' ? ' and your data domains' : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => setShowRecommendations(false)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-text-muted)' }}
                    >
                      Hide
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {recommendations.map((rec) => (
                      <div key={rec.name} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px',
                        background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
                        border: '1px solid #bfdbfe',
                        borderRadius: 'var(--radius-md)',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{rec.name}</span>
                            <span style={makeBadge(typeBadgeColors[rec.type] || typeBadgeColors.COMMUNITY_OF_PRACTICE)}>
                              {GROUP_TYPE_SHORT[rec.type] || rec.typeLabel}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{rec.reason}</div>
                        </div>
                        <button
                          onClick={() => handleCreateRecommended(rec)}
                          disabled={creatingRec !== null}
                          style={{
                            padding: '5px 14px', fontSize: 11, fontWeight: 500,
                            background: '#fff', color: '#1e40af',
                            border: '1px solid #93c5fd', borderRadius: 4,
                            cursor: creatingRec ? 'not-allowed' : 'pointer',
                            opacity: creatingRec ? 0.6 : 1,
                            whiteSpace: 'nowrap', flexShrink: 0,
                          }}
                        >
                          {creatingRec === rec.name ? 'Creating...' : 'Create'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', padding: 32,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              minHeight: 200, color: 'var(--color-text-muted)', textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>{'←'}</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Select a group</div>
              <div style={{ fontSize: 12 }}>Click on a governance group in the tree to view its members, roles, and recommendations.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
