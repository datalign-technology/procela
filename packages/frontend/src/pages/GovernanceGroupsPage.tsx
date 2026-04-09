import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';

interface GroupMember {
  personId: string;
  personName: string;
  groupRole: 'CHAIR' | 'MEMBER' | 'SECRETARY';
  since: string;
}

interface GovernanceGroup {
  id: string;
  orgId: string;
  name: string;
  type: 'COUNCIL' | 'COMMITTEE' | 'STEWARDSHIP_TEAM' | 'WORKING_GROUP' | 'CUSTOM';
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

const TYPE_LABELS: Record<string, string> = {
  COUNCIL: 'Council',
  COMMITTEE: 'Committee',
  STEWARDSHIP_TEAM: 'Stewardship Team',
  WORKING_GROUP: 'Working Group',
  CUSTOM: 'Custom',
};

const ROLE_LABELS: Record<string, string> = {
  CHAIR: 'Chair',
  MEMBER: 'Member',
  SECRETARY: 'Secretary',
};

const typeBadgeColors: Record<string, { bg: string; color: string }> = {
  COUNCIL: { bg: '#dbeafe', color: '#1e40af' },
  COMMITTEE: { bg: '#ede9fe', color: '#5b21b6' },
  STEWARDSHIP_TEAM: { bg: '#d1f0eb', color: '#0f4f46' },
  WORKING_GROUP: { bg: '#fef3c7', color: '#92400e' },
  CUSTOM: { bg: '#f1f5f9', color: '#64748b' },
};

const roleBadgeColors: Record<string, { bg: string; color: string }> = {
  CHAIR: { bg: '#fce7f3', color: '#9d174d' },
  MEMBER: { bg: '#f1f5f9', color: '#64748b' },
  SECRETARY: { bg: '#dbeafe', color: '#1e40af' },
};

const makeBadge = (colors: { bg: string; color: string }): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.color,
});

const statusBadge = (status: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  fontSize: 11, fontWeight: 600,
  background: status === 'ACTIVE' ? '#d1f0eb' : '#f1f5f9',
  color: status === 'ACTIVE' ? '#0f4f46' : '#64748b',
});

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

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--color-border)',
};

interface GroupFormData {
  name: string;
  type: string;
  description: string;
  charter: string;
  status: string;
}

const emptyForm: GroupFormData = { name: '', type: 'COUNCIL', description: '', charter: '', status: 'ACTIVE' };

export default function GovernanceGroupsPage() {
  const { activeOrgId } = useOrgContext();
  const [groups, setGroups] = useState<GovernanceGroup[]>([]);
  const [groupTypes, setGroupTypes] = useState<string[]>([]);
  const [groupRoles, setGroupRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GroupFormData>(emptyForm);

  // Members panel state
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GovernanceGroup | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [memberPersonId, setMemberPersonId] = useState('');
  const [memberRole, setMemberRole] = useState('MEMBER');

  const fetchGroups = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: GovernanceGroup[]; groupTypes: string[]; groupRoles: string[] }>(`/governance-groups${query}`);
      setGroups(res.data || []);
      setGroupTypes(res.groupTypes || []);
      setGroupRoles(res.groupRoles || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  const fetchGroupDetail = useCallback(async (id: string) => {
    try {
      const res = await apiClient.get<{ success: boolean; data: GovernanceGroup }>(`/governance-groups/${id}`);
      setSelectedGroup(res.data || null);
    } catch { /* */ }
  }, []);

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
      setSelectedGroup(null);
    }
  }, [selectedGroupId, fetchGroupDetail, fetchPeople]);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };

  const openEdit = (group: GovernanceGroup) => {
    setForm({
      name: group.name, type: group.type, description: group.description,
      charter: group.charter, status: group.status,
    });
    setEditingId(group.id); setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.type) return;
    if (editingId) {
      await apiClient.put(`/governance-groups/${editingId}`, form);
    } else {
      await apiClient.post('/governance-groups', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
    }
    setShowForm(false); setEditingId(null); setForm(emptyForm); fetchGroups();
    if (selectedGroupId) fetchGroupDetail(selectedGroupId);
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/governance-groups/${id}`);
    if (selectedGroupId === id) { setSelectedGroupId(null); setSelectedGroup(null); }
    fetchGroups();
  };

  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const handleSelectGroup = (id: string) => {
    setSelectedGroupId(selectedGroupId === id ? null : id);
    setMemberPersonId(''); setMemberRole('MEMBER');
  };

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

  // Compute stats
  const typeCounts = groups.reduce<Record<string, number>>((acc, g) => {
    acc[g.type] = (acc[g.type] || 0) + 1;
    return acc;
  }, {});

  // People already in the selected group
  const existingMemberIds = new Set(selectedGroup?.members.map((m) => m.personId) || []);
  const availablePeople = people.filter((p) => !existingMemberIds.has(p.id));

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Governance Groups</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Manage governance councils, committees, and working groups.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {groups.length > 0 && (
            <button
              onClick={() => exportCsv('governance-groups.csv', ['Name', 'Type', 'Description', 'Members', 'Status'], groups.map((g) => [
                g.name,
                TYPE_LABELS[g.type] || g.type,
                g.description,
                String(g.members.length),
                g.status,
              ]))}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              Export CSV
            </button>
          )}
          <button onClick={openAdd} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            + Add Group
          </button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Governance Group' : 'Add New Governance Group'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Governance Council" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type *</label>
              <select style={selectStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {groupTypes.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description of this group's purpose" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Charter</label>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.charter} onChange={(e) => setForm({ ...form, charter: e.target.value })} placeholder="Group charter, responsibilities, and scope" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !form.name.trim() || !form.type ? 0.6 : 1 }} disabled={!form.name.trim() || !form.type} onClick={handleSave}>
              {editingId ? 'Save Changes' : 'Add Group'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      {groups.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{groups.length}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Groups</div>
          </div>
          {Object.entries(typeCounts).map(([type, count]) => (
            <div key={type} style={{ flex: 1, minWidth: 120, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{count}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{TYPE_LABELS[type] || type}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : groups.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>No governance groups defined yet. Use the + Add Group button above to get started.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Members</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, width: 120, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}
                  style={{ transition: 'background 0.1s', background: selectedGroupId === group.id ? 'var(--color-primary-light, #f0f7ff)' : undefined, cursor: 'pointer' }}
                  onMouseEnter={(e) => { if (selectedGroupId !== group.id) e.currentTarget.style.background = 'var(--color-bg)'; }}
                  onMouseLeave={(e) => { if (selectedGroupId !== group.id) e.currentTarget.style.background = ''; }}
                  onClick={() => handleSelectGroup(group.id)}
                >
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{group.name}</td>
                  <td style={tdStyle}>
                    <span style={makeBadge(typeBadgeColors[group.type] || typeBadgeColors.CUSTOM)}>
                      {TYPE_LABELS[group.type] || group.type}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: group.description ? 'var(--color-text-secondary)' : 'var(--color-text-muted)', maxWidth: 300 }}>
                    {group.description || '--'}
                  </td>
                  <td style={tdStyle}>{group.members.length}</td>
                  <td style={tdStyle}>
                    <span style={statusBadge(group.status)}>{group.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }} onClick={() => openEdit(group)}>Edit</button>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }} onClick={() => handleDelete(group.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Members Panel */}
      {selectedGroupId && selectedGroup && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginTop: 20, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>
              Members of "{selectedGroup.name}"
            </h3>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12 }} onClick={() => { setSelectedGroupId(null); setSelectedGroup(null); }}>
              Close
            </button>
          </div>

          {/* Add Member Form */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, padding: 12, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
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
            <button
              style={{ ...btnPrimary, padding: '6px 14px', fontSize: 12, opacity: !memberPersonId ? 0.6 : 1, whiteSpace: 'nowrap' }}
              disabled={!memberPersonId}
              onClick={handleAddMember}
            >
              Add Member
            </button>
          </div>

          {/* Members Table */}
          {selectedGroup.members.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center', padding: '1.5rem' }}>
              No members yet. Use the form above to add people to this group.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  <th style={thStyle}>Person Name</th>
                  <th style={thStyle}>Group Role</th>
                  <th style={thStyle}>Since</th>
                  <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedGroup.members.map((member) => (
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
                    <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>
                      {new Date(member.since).toLocaleDateString()}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }} onClick={() => handleRemoveMember(member.personId)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
