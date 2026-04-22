import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import { exportCsv } from '../lib/exportCsv';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';

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
  padding: '6px 14px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '6px 14px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};

const btnIcon: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '2px 6px', fontSize: 11, color: 'var(--color-text-muted)', borderRadius: 4,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12, borderTop: '1px solid var(--color-border)',
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

function GroupTreeNode({ node, depth, onEdit, onDelete, onAddChild, onSelect, selectedId, expanded, toggleExpand }: {
  node: GovernanceGroup; depth: number;
  onEdit: (group: GovernanceGroupFlat) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string, parentType: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
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
          expanded={expanded} toggleExpand={toggleExpand} />
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

  // DAMA roles for the members of the selected group
  const [memberDamaRoles, setMemberDamaRoles] = useState<DamaRoleAssignment[]>([]);
  const [assignRolePersonId, setAssignRolePersonId] = useState('');
  const [assignRoleType, setAssignRoleType] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GroupFormData>(emptyForm);
  // When adding a child, restrict the type dropdown to valid child types
  const [allowedTypes, setAllowedTypes] = useState<string[] | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
    } else {
      setSelectedGroupDetail(null);
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

  // ── Computed values ──

  const typeCounts = flatGroups.reduce<Record<string, number>>((acc, g) => {
    acc[g.type] = (acc[g.type] || 0) + 1;
    return acc;
  }, {});

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

  if (loading) return <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Governance Groups</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
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

      {/* Governance Hierarchy Guidance */}
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12, padding: '8px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
        <strong>Recommended structure:</strong> Council {'\u2192'} Office {'\u2192'} Committee {'\u2192'} Stewardship Teams {'\u2192'} Working Groups {'\u2192'} Communities of Practice
      </div>

      {/* Stats Bar */}
      {flatGroups.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto', minWidth: 100, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{flatGroups.length}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Total Groups</div>
          </div>
          {groupTypes.filter((t) => typeCounts[t]).map((type) => (
            <div key={type} style={{ flex: '0 0 auto', minWidth: 100, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{typeCounts[type]}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                <span style={makeBadge(typeBadgeColors[type] || typeBadgeColors.COMMUNITY_OF_PRACTICE)}>{GROUP_TYPE_SHORT[type] || type}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            {editingId ? 'Edit Governance Group' : allowedTypes ? 'Add Child Group' : 'Add New Governance Group'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Governance Council" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Type *</label>
              <select style={selectStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, parentId: form.parentId })}>
                {typeOptions.map((t) => {
                  const isRecommended = recommendedTypes.length > 0 && recommendedTypes.includes(t);
                  const label = groupTypeLabels[t] || GROUP_TYPE_LABELS[t] || t;
                  return <option key={t} value={t}>{label}{isRecommended ? ' (recommended)' : ''}</option>;
                })}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Parent Group</label>
              <select style={selectStyle} value={form.parentId || ''} onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}>
                <option value="">-- No parent (top-level) --</option>
                {getValidParentOptions().map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Description</label>
              <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description of this group's purpose" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Charter</label>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.charter} onChange={(e) => setForm({ ...form, charter: e.target.value })} placeholder="Group charter, responsibilities, and scope" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !form.name.trim() || !form.type ? 0.6 : 1 }} disabled={!form.name.trim() || !form.type} onClick={handleSave}>
              {editingId ? 'Save Changes' : 'Add Group'}
            </button>
          </div>
        </div>
      )}

      {/* Tree View */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
        {/* Tree toolbar */}
        <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
          <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-primary)' }} onClick={expandAll}>Expand All</button>
          <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-primary)' }} onClick={collapseAll}>Collapse All</button>
        </div>

        {/* Tree body — no inner scroll container. The page itself
            scrolls when needed; `overflowY: auto` on the wrapper
            implicitly coerces overflow-x to auto too, which was
            adding a spurious horizontal scrollbar on any pixel
            overshoot. */}
        <div>
          {tree.length === 0 && !showForm ? (
            <div style={{ textAlign: 'center', padding: '3rem 2rem' }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No governance groups defined yet. Use the + Add Group button above to get started.</p>
            </div>
          ) : (
            tree.map((node) => (
              <GroupTreeNode key={node.id} node={node} depth={0}
                onEdit={openEdit} onDelete={(id) => setConfirmDelete(id)} onAddChild={openAddChild}
                onSelect={handleSelect} selectedId={selectedGroupId}
                expanded={expanded} toggleExpand={toggleExpand} />
            ))
          )}
        </div>
      </div>

      {/* Members Panel */}
      {selectedGroupId && selectedGroupDetail && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginTop: 16, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Members of "{selectedGroupDetail.name}"</h3>
                <span style={makeBadge(typeBadgeColors[selectedGroupDetail.type] || typeBadgeColors.COMMUNITY_OF_PRACTICE)}>{GROUP_TYPE_SHORT[selectedGroupDetail.type] || selectedGroupDetail.type}</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{selectedGroupDetail.members?.length || 0} {(selectedGroupDetail.members?.length || 0) === 1 ? 'member' : 'members'}</span>
              </div>
              {selectedGroupDetail.description && <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{selectedGroupDetail.description}</p>}
              <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>Tip: You can also manage group memberships from Organizations → click "Manage" on any person.</p>
            </div>
            <button style={{ ...btnIcon, fontSize: 12 }} onClick={() => { setSelectedGroupId(null); setSelectedGroupDetail(null); }}>Close</button>
          </div>

          {/* Add Member Form */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, padding: 10, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ flex: 2 }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Person</label>
              <select style={selectStyle} value={memberPersonId} onChange={(e) => setMemberPersonId(e.target.value)}>
                <option value="">-- Select person --</option>
                {availablePeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Role</label>
              <select style={selectStyle} value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
                {groupRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
              </select>
            </div>
            <button
              style={{ ...btnPrimary, padding: '6px 14px', fontSize: 12, opacity: !memberPersonId ? 0.6 : 1, whiteSpace: 'nowrap' }}
              disabled={!memberPersonId}
              onClick={handleAddMember}
            >
              Add Member
            </button>
          </div>

          {/* Members Table */}
          {(!selectedGroupDetail.members || selectedGroupDetail.members.length === 0) ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 12, textAlign: 'center', padding: '1.5rem' }}>
              No members yet. Use the form above to add people to this group.
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

          {/* Assign DAMA Role */}
          {selectedGroupDetail.members?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Assign Governance Role
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 10, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Member</label>
                  <select style={selectStyle} value={assignRolePersonId} onChange={(e) => setAssignRolePersonId(e.target.value)}>
                    <option value="">-- Select member --</option>
                    {(selectedGroupDetail.members || []).map((m: GroupMember) => (
                      <option key={m.personId} value={m.personId}>{m.personName}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>DAMA Role</label>
                  <select style={selectStyle} value={assignRoleType} onChange={(e) => setAssignRoleType(e.target.value)}>
                    <option value="">-- Select role --</option>
                    <optgroup label="Executive / Strategic">
                      <option value="CDO">Chief Data Officer</option>
                      <option value="DATA_GOVERNANCE_LEAD">Data Governance Lead</option>
                    </optgroup>
                    <optgroup label="Business">
                      <option value="DATA_OWNER">Data Owner</option>
                      <option value="BUSINESS_DATA_STEWARD">Business Data Steward</option>
                      <option value="DATA_QUALITY_ANALYST">Data Quality Analyst</option>
                    </optgroup>
                    <optgroup label="Technical">
                      <option value="TECHNICAL_DATA_STEWARD">Technical Data Steward</option>
                      <option value="DATA_CUSTODIAN">Data Custodian</option>
                      <option value="DATA_ARCHITECT">Data Architect</option>
                      <option value="DATA_ENGINEER">Data Engineer</option>
                      <option value="DATABASE_ADMINISTRATOR">Database Administrator</option>
                    </optgroup>
                  </select>
                </div>
                <button
                  style={{ ...btnPrimary, padding: '6px 14px', fontSize: 12, opacity: (!assignRolePersonId || !assignRoleType) ? 0.6 : 1, whiteSpace: 'nowrap' }}
                  disabled={!assignRolePersonId || !assignRoleType}
                  onClick={handleAssignDamaRole}
                >
                  Assign Role
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
