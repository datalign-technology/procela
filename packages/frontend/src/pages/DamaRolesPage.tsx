import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';

interface DamaRoleAssignment {
  id: string;
  personId: string;
  personName: string;
  roleType: string;
  scopeType: 'ORG';
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
};

const ROLE_CATEGORIES: Record<string, string> = {
  CDO: 'Executive', DATA_GOVERNANCE_LEAD: 'Executive',
  DATA_OWNER: 'Business', BUSINESS_DATA_STEWARD: 'Business', DATA_QUALITY_ANALYST: 'Business',
  TECHNICAL_DATA_STEWARD: 'Technical', DATA_CUSTODIAN: 'Technical', DATA_ARCHITECT: 'Technical',
  DATA_ENGINEER: 'Technical', DATABASE_ADMINISTRATOR: 'Technical',
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
  scopeType: 'ORG';
  scopeId: string;
}

const emptyForm: FormData = { personId: '', roleType: 'CDO', scopeType: 'ORG', scopeId: '' };

export default function DamaRolesPage() {
  const { activeOrgId } = useOrgContext();
  const [roles, setRoles] = useState<DamaRoleAssignment[]>([]);
  const [roleTypes, setRoleTypes] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [, setDomains] = useState<DomainOption[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [error, setError] = useState('');
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [filterRoleType, setFilterRoleType] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [rolesRes, summaryRes, peopleRes, orgsRes, domainsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DamaRoleAssignment[]; roleTypes: string[] }>(`/dama-roles${query}`),
        apiClient.get<{ success: boolean; data: Record<string, number> }>(`/dama-roles/summary${query}`),
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

  // ── Bulk select handlers ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRoles.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredRoles.map((r) => r.id)));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/dama-roles/${id}`)));
    setSelectedIds(new Set());
    fetchData();
  };

  const handleCancel = () => { setShowForm(false); setError(''); setForm(emptyForm); };

  // Apply the card-click filter to the table.
  const filteredRoles = filterRoleType ? roles.filter((r) => r.roleType === filterRoleType) : roles;

  const scopeName = (scopeId: string) => {
    return orgs.find((o) => o.id === scopeId)?.name || scopeId;
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
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Governance Roles</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Assign data management governance roles to people across organizations and data domains.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {roles.length > 0 && (
            <IconButton icon="trash" label="Delete all roles" variant="danger"
              onClick={() => setShowDeleteAll(true)} />
          )}
          {roles.length > 0 && (
            <IconButton icon="download" label="Export CSV"
              onClick={() => exportCsv('governance-roles.csv', ['Person', 'Governance Role', 'Organization', 'Since'], roles.map((r) => [
                r.personName,
                ROLE_TYPE_LABELS[r.roleType] || r.roleType,
                scopeName(r.scopeId),
                new Date(r.since).toLocaleDateString(),
              ]))} />
          )}
          <IconButton icon="plus" label="Assign role" variant="primary" onClick={openAdd} />
        </div>
      </div>

      {/* Summary cards — click to filter the table to that role type.
          Click again (or click the active card) to clear the filter. */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.keys(ROLE_TYPE_LABELS).map((rt) => {
          const c = ROLE_TYPE_COLORS[rt] || { bg: '#f1f5f9', color: '#64748b' };
          const count = summary[rt] || 0;
          const isActive = filterRoleType === rt;
          return (
            <div key={rt}
              onClick={() => setFilterRoleType(isActive ? null : rt)}
              style={{
                flex: '1 1 120px', minWidth: 120, background: 'var(--color-surface)',
                border: `2px solid ${isActive ? c.color : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px', boxShadow: isActive ? `0 0 0 1px ${c.color}22` : 'var(--shadow-sm)',
                cursor: 'pointer',
                opacity: count === 0 && !isActive ? 0.55 : 1,
                transition: 'border-color 0.12s, box-shadow 0.12s',
              }}
              title={count > 0 ? `Click to ${isActive ? 'clear filter' : `show ${ROLE_TYPE_LABELS[rt]} assignments`}` : 'No assignments'}
            >
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{count}</div>
              <div style={{ fontSize: 11, color: isActive ? c.color : 'var(--color-text-muted)', fontWeight: isActive ? 600 : 400, marginTop: 2 }}>
                {ROLE_TYPE_LABELS[rt]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Active filter chip */}
      {filterRoleType && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 6px 4px 12px', borderRadius: 999,
            background: '#eff6ff', color: '#1e40af', fontSize: 12, fontWeight: 500,
          }}>
            Showing: {ROLE_TYPE_LABELS[filterRoleType] || filterRoleType}
            <button
              onClick={() => setFilterRoleType(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#1e40af', fontSize: 14, lineHeight: 1, padding: '0 6px' }}
            >&times;</button>
          </span>
        </div>
      )}

      {/* Assign Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Assign Governance Role</h3>
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
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Governance Role *</label>
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
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Organization *</label>
              <select style={selectStyle} value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })}>
                <option value="">-- Select organization --</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Domain ownership (owner/steward) is managed directly on the Data Domain.
              </div>
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
        title="Delete All Governance Roles?"
        message={`This will permanently delete all ${roles.length} governance role assignments. This cannot be undone.`}
        confirmLabel="Delete All"
        requireTypedConfirmation="DELETE"
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/dama-roles/all');
          setSelectedIds(new Set());
          fetchData();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Governance Role?"
        message="This will permanently delete this role assignment. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          const id = confirmDelete;
          setConfirmDelete(null);
          if (id) await handleRemove(id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Governance Roles?"
        message={`Delete ${selectedIds.size} selected role assignments? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedIds.size} selected</span>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Delete Selected
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : roles.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>
              No governance roles defined yet. Use the + Assign Role button above to get started.
            </p>
          </div>
        ) : filteredRoles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)', fontSize: 13 }}>
            No assignments for {ROLE_TYPE_LABELS[filterRoleType || ''] || filterRoleType}.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                  <input type="checkbox"
                    checked={filteredRoles.length > 0 && selectedIds.size === filteredRoles.length}
                    onChange={toggleSelectAll} />
                </th>
                <th style={thStyle}>Person</th>
                <th style={thStyle}>Governance Role</th>
                <th style={thStyle}>Organization</th>
                <th style={thStyle}>Since</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoles.map((role) => {
                const isSelected = selectedIds.has(role.id);
                return (
                <tr key={role.id} style={{ transition: 'background 0.1s', background: isSelected ? '#f0f9ff' : '' }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                  <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(role.id)} />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{role.personName}</td>
                  <td style={tdStyle}>
                    <span style={roleBadge(role.roleType)}>
                      {ROLE_TYPE_LABELS[role.roleType] || role.roleType}
                    </span>
                  </td>
                  <td style={tdStyle}>{scopeName(role.scopeId)}</td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>
                    {new Date(role.since).toLocaleDateString()}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(role.id)} />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
