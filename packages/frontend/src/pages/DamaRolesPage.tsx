import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import ConfirmDialog from '../components/ConfirmDialog';

interface DamaRoleAssignment {
  id: string;
  personId: string;
  personName: string;
  roleType: string;
  scopeType: 'ORG' | 'DOMAIN';
  scopeId: string;
  since: string;
  createdAt: string;
}

interface Person {
  id: string;
  name: string;
}

interface OrgOption {
  id: string;
  name: string;
}

interface DomainOption {
  id: string;
  name: string;
}

const ROLE_TYPE_LABELS: Record<string, string> = {
  // Executive/Strategic
  CDO: 'Chief Data Officer',
  DATA_GOVERNANCE_LEAD: 'Data Governance Lead',
  // Business
  DATA_OWNER: 'Data Owner',
  BUSINESS_DATA_STEWARD: 'Business Data Steward',
  DATA_QUALITY_ANALYST: 'Data Quality Analyst',
  // Technical
  TECHNICAL_DATA_STEWARD: 'Technical Data Steward',
  DATA_CUSTODIAN: 'Data Custodian',
  DATA_ARCHITECT: 'Data Architect',
  DATA_ENGINEER: 'Data Engineer',
  DATABASE_ADMINISTRATOR: 'Database Administrator',
  // Legacy
  DATA_STEWARD: 'Data Steward (Legacy)',
};

const ROLE_CATEGORIES: Record<string, string> = {
  CDO: 'Executive', DATA_GOVERNANCE_LEAD: 'Executive',
  DATA_OWNER: 'Business', BUSINESS_DATA_STEWARD: 'Business', DATA_QUALITY_ANALYST: 'Business',
  TECHNICAL_DATA_STEWARD: 'Technical', DATA_CUSTODIAN: 'Technical', DATA_ARCHITECT: 'Technical',
  DATA_ENGINEER: 'Technical', DATABASE_ADMINISTRATOR: 'Technical',
  DATA_STEWARD: 'Business',
};

const ROLE_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  // Executive — pink/purple
  CDO: { bg: '#fce7f3', color: '#9d174d' },
  DATA_GOVERNANCE_LEAD: { bg: '#ede9fe', color: '#5b21b6' },
  // Business — blue/teal
  DATA_OWNER: { bg: '#dbeafe', color: '#1e40af' },
  BUSINESS_DATA_STEWARD: { bg: '#d1f0eb', color: '#0f4f46' },
  DATA_QUALITY_ANALYST: { bg: '#f0fdf4', color: '#166534' },
  // Technical — amber/slate
  TECHNICAL_DATA_STEWARD: { bg: '#fef3c7', color: '#92400e' },
  DATA_CUSTODIAN: { bg: '#e2e8f0', color: '#475569' },
  DATA_ARCHITECT: { bg: '#e0e7ff', color: '#3730a3' },
  DATA_ENGINEER: { bg: '#fef9c3', color: '#854d0e' },
  DATABASE_ADMINISTRATOR: { bg: '#f1f5f9', color: '#64748b' },
  // Legacy
  DATA_STEWARD: { bg: '#d1f0eb', color: '#0f4f46' },
};

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

interface FormData {
  personId: string;
  roleType: string;
  scopeType: 'ORG' | 'DOMAIN';
  scopeId: string;
}

const emptyForm: FormData = { personId: '', roleType: 'CDO', scopeType: 'ORG', scopeId: '' };

export default function DamaRolesPage() {
  const { activeOrgId } = useOrgContext();
  const [roles, setRoles] = useState<DamaRoleAssignment[]>([]);
  const [roleTypes, setRoleTypes] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [error, setError] = useState('');
  const [showDeleteAll, setShowDeleteAll] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [rolesRes, summaryRes, peopleRes, orgsRes, domainsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DamaRoleAssignment[]; roleTypes: string[] }>(`/dama-roles${query}`),
        apiClient.get<{ success: boolean; data: Record<string, number> }>('/dama-roles/summary'),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: OrgOption[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: DomainOption[] }>(`/data-domains${query}`),
      ]);
      setRoles(rolesRes.data || []);
      setRoleTypes(rolesRes.roleTypes || []);
      setSummary(summaryRes.data || {});
      setPeople(peopleRes.data || []);
      setOrgs(orgsRes.data || []);
      setDomains(domainsRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => {
    setForm({
      ...emptyForm,
      scopeId: activeOrgId || (orgs.length > 0 ? orgs[0].id : ''),
    });
    setError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.personId || !form.roleType || !form.scopeId) return;
    setError('');
    try {
      await apiClient.post('/dama-roles', form);
      setShowForm(false);
      setForm(emptyForm);
      fetchData();
    } catch (err: any) {
      setError(err?.message || 'Failed to assign role');
    }
  };

  const handleRemove = async (id: string) => {
    await apiClient.delete(`/dama-roles/${id}`);
    fetchData();
  };

  const handleCancel = () => { setShowForm(false); setError(''); setForm(emptyForm); };

  const scopeOptions = form.scopeType === 'ORG' ? orgs : domains;

  const scopeName = (scopeType: string, scopeId: string) => {
    if (scopeType === 'ORG') {
      return orgs.find((o) => o.id === scopeId)?.name || scopeId;
    }
    return domains.find((d) => d.id === scopeId)?.name || scopeId;
  };

  const roleBadge = (roleType: string): React.CSSProperties => {
    const c = ROLE_TYPE_COLORS[roleType] || { bg: '#f1f5f9', color: '#64748b' };
    return {
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.color,
    };
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>DAMA Roles</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Assign DAMA data management roles to people across organizations and data domains.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {roles.length > 0 && (
            <button
              onClick={() => setShowDeleteAll(true)}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
            >
              Delete All
            </button>
          )}
          {roles.length > 0 && (
            <button
              onClick={() => exportCsv('dama-roles.csv', ['Person', 'DAMA Role', 'Scope Type', 'Scope', 'Since'], roles.map((r) => [
                r.personName,
                ROLE_TYPE_LABELS[r.roleType] || r.roleType,
                r.scopeType,
                scopeName(r.scopeType, r.scopeId),
                new Date(r.since).toLocaleDateString(),
              ]))}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              Export CSV
            </button>
          )}
          <button onClick={openAdd} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            + Assign Role
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.keys(ROLE_TYPE_LABELS).map((rt) => {
          const c = ROLE_TYPE_COLORS[rt] || { bg: '#f1f5f9', color: '#64748b' };
          return (
            <div key={rt} style={{
              flex: '1 1 120px', minWidth: 120, background: 'var(--color-surface)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              padding: '10px 14px', boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{summary[rt] || 0}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {ROLE_TYPE_LABELS[rt]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Assign Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Assign DAMA Role</h3>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#dc2626' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Person *</label>
              <select style={selectStyle} value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })}>
                <option value="">-- Select person --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>DAMA Role *</label>
              <select style={selectStyle} value={form.roleType} onChange={(e) => setForm({ ...form, roleType: e.target.value })}>
                <optgroup label="Executive/Strategic">
                  {(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS)).filter((rt) => ROLE_CATEGORIES[rt] === 'Executive').map((rt) => (
                    <option key={rt} value={rt}>{ROLE_TYPE_LABELS[rt] || rt}</option>
                  ))}
                </optgroup>
                <optgroup label="Business">
                  {(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS)).filter((rt) => ROLE_CATEGORIES[rt] === 'Business').map((rt) => (
                    <option key={rt} value={rt}>{ROLE_TYPE_LABELS[rt] || rt}</option>
                  ))}
                </optgroup>
                <optgroup label="Technical">
                  {(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS)).filter((rt) => ROLE_CATEGORIES[rt] === 'Technical').map((rt) => (
                    <option key={rt} value={rt}>{ROLE_TYPE_LABELS[rt] || rt}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Scope Type *</label>
              <select style={selectStyle} value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value as 'ORG' | 'DOMAIN', scopeId: '' })}>
                <option value="ORG">Organization</option>
                <option value="DOMAIN">Data Domain</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Scope *</label>
              <select style={selectStyle} value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })}>
                <option value="">-- Select {form.scopeType === 'ORG' ? 'organization' : 'data domain'} --</option>
                {scopeOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.personId || !form.scopeId ? 0.6 : 1 }}
              disabled={!form.personId || !form.scopeId}
              onClick={handleSave}
            >
              Assign Role
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteAll}
        title="Delete All DAMA Roles?"
        message={`This will permanently delete all ${roles.length} DAMA role assignments. This cannot be undone.`}
        confirmLabel="Delete All"
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/dama-roles/all');
          fetchData();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : roles.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)', lineHeight: 1.6, maxWidth: 500, margin: '0 auto' }}>
              No DAMA role assignments yet. Use the + Assign Role button to assign data management roles to people in your organization.
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={thStyle}>Person</th>
                <th style={thStyle}>DAMA Role</th>
                <th style={thStyle}>Scope Type</th>
                <th style={thStyle}>Scope</th>
                <th style={thStyle}>Since</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} style={{ transition: 'background 0.1s' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{role.personName}</td>
                  <td style={tdStyle}>
                    <span style={roleBadge(role.roleType)}>
                      {ROLE_TYPE_LABELS[role.roleType] || role.roleType}
                    </span>
                  </td>
                  <td style={tdStyle}>{role.scopeType}</td>
                  <td style={tdStyle}>{scopeName(role.scopeType, role.scopeId)}</td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>
                    {new Date(role.since).toLocaleDateString()}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }}
                      onClick={() => handleRemove(role.id)}
                      title="Remove"
                    >
                      Remove
                    </button>
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
