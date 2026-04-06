import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { INDUSTRIES } from '../types';

interface Organization {
  id: string;
  name: string;
  industry: string;
  department: string;
  createdAt: string;
  updatedAt: string;
}

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
  name: string;
  industry: string;
  department: string;
}

const emptyForm: FormData = { name: '', industry: '', department: '' };

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: Organization[] }>('/organizations');
      setOrgs(res.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };

  const openEdit = (org: Organization) => {
    setForm({ name: org.name, industry: org.industry, department: org.department });
    setEditingId(org.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingId) {
      await apiClient.put(`/organizations/${editingId}`, form);
    } else {
      await apiClient.post('/organizations', form);
    }
    setShowForm(false); setEditingId(null); setForm(emptyForm); fetchData();
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/organizations/${id}`);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Cannot delete this organization');
    }
  };

  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Organizations</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Manage the organizations involved in your value streams and processes.
          </p>
        </div>
        <button onClick={openAdd} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
          + Add Organization
        </button>
      </div>

      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Organization' : 'Add Organization'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Organization name" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Industry</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
                <option value="">-- Select industry --</option>
                {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Department / Business Unit</label>
              <input style={inputStyle} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="e.g. Operations, Finance" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1 }} disabled={!form.name.trim()} onClick={handleSave}>
              {editingId ? 'Save Changes' : 'Add Organization'}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : orgs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>No organizations defined yet.</p>
            <button onClick={openAdd} style={btnPrimary}>+ Add Your First Organization</button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Industry</th>
                <th style={thStyle}>Department</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{org.name}</td>
                  <td style={tdStyle}>{org.industry || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}</td>
                  <td style={tdStyle}>{org.department || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }} onClick={() => openEdit(org)}>Edit</button>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }} onClick={() => handleDelete(org.id)}>Delete</button>
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
