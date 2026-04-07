import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';

interface Organization {
  id: string;
  name: string;
}

interface Person {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;
  department: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ORG_ADMIN: 'Org Admin',
  PROCESS_OWNER: 'Process Owner',
  DATA_STEWARD: 'Data Steward',
  CONTRIBUTOR: 'Contributor',
  VIEWER: 'Viewer',
};

const roleBadge = (role: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    SUPER_ADMIN: { bg: '#fce7f3', color: '#9d174d' },
    ORG_ADMIN: { bg: '#ede9fe', color: '#5b21b6' },
    PROCESS_OWNER: { bg: '#d1f0eb', color: '#0f4f46' },
    DATA_STEWARD: { bg: '#dbeafe', color: '#1e40af' },
    CONTRIBUTOR: { bg: '#fef3c7', color: '#92400e' },
    VIEWER: { bg: '#f1f5f9', color: '#64748b' },
  };
  const c = colors[role] || colors.VIEWER;
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: c.bg, color: c.color,
  };
};

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};

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

interface FormData {
  orgId: string;
  name: string;
  email: string;
  role: string;
  department: string;
  title: string;
}

const emptyForm: FormData = { orgId: '', name: '', email: '', role: 'VIEWER', department: '', title: '' };

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [filterOrg, setFilterOrg] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [peopleRes, orgsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Person[]; roles: string[] }>('/people'),
        apiClient.get<{ success: boolean; data: Organization[] }>('/organizations'),
      ]);
      setPeople(peopleRes.data || []);
      setRoles(peopleRes.roles || []);
      setOrgs(orgsRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const orgName = (orgId: string) => orgs.find((o) => o.id === orgId)?.name || 'Unknown';

  const openAdd = () => {
    setForm({ ...emptyForm, orgId: orgs.length > 0 ? orgs[0].id : '' });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (person: Person) => {
    setForm({
      orgId: person.orgId, name: person.name, email: person.email,
      role: person.role, department: person.department, title: person.title,
    });
    setEditingId(person.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.orgId) return;
    if (editingId) {
      await apiClient.put(`/people/${editingId}`, form);
    } else {
      await apiClient.post('/people', form);
    }
    setShowForm(false); setEditingId(null); setForm(emptyForm); fetchData();
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/people/${id}`);
    fetchData();
  };

  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const filteredPeople = filterOrg ? people.filter((p) => p.orgId === filterOrg) : people;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>People</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Manage people, their roles, and organization assignments.
          </p>
        </div>
        <button onClick={openAdd} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
          + Add Person
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Person' : 'Add Person'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Email</label>
              <input style={inputStyle} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Organization *</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })}>
                <option value="">-- Select organization --</option>
                {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Role</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Title</label>
              <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Director of Operations" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Department</label>
              <input style={inputStyle} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="e.g. Operations, IT, Finance" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.name.trim() || !form.orgId ? 0.6 : 1 }}
              disabled={!form.name.trim() || !form.orgId}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Person'}
            </button>
          </div>
        </div>
      )}

      {/* Stats & Filter */}
      {people.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{people.length}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total People</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{new Set(people.map((p) => p.orgId)).size}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Organizations</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Filter by Org</div>
            <select style={{ ...inputStyle, appearance: 'auto' as any, padding: '4px 8px' }} value={filterOrg} onChange={(e) => setFilterOrg(e.target.value)}>
              <option value="">All Organizations</option>
              {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : filteredPeople.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>
              {filterOrg ? 'No people in this organization.' : 'No people defined yet.'}
            </p>
            <button onClick={openAdd} style={btnPrimary}>+ Add First Person</button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Organization</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Department</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPeople.map((person) => (
                <tr key={person.id} style={{ transition: 'background 0.1s' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{person.name}</td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{person.email || '--'}</td>
                  <td style={tdStyle}>{orgName(person.orgId)}</td>
                  <td style={tdStyle}><span style={roleBadge(person.role)}>{ROLE_LABELS[person.role] || person.role}</span></td>
                  <td style={tdStyle}>{person.title || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}</td>
                  <td style={tdStyle}>{person.department || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }} onClick={() => openEdit(person)}>Edit</button>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }} onClick={() => handleDelete(person.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
