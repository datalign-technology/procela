import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';

// ──────────────────────────────────────────────────────────────────────────
// Agents — non-human actors (AI models, service accounts, pipelines, bots)
// that participate in the org like people do. Deliberately lighter than
// PeoplePage: no 360 view with DAMA roles / governance memberships.
// ──────────────────────────────────────────────────────────────────────────

interface OrganizationRef {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
}

interface Person {
  id: string;
  name: string;
}

interface Agent {
  id: string;
  orgIds: string[];
  name: string;
  agentType: string;
  description: string;
  provider: string;
  status: 'ACTIVE' | 'PAUSED' | 'RETIRED';
  ownerPersonId: string;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  name: string;
  orgIds: string[];
  agentType: string;
  description: string;
  provider: string;
  status: 'ACTIVE' | 'PAUSED' | 'RETIRED';
  ownerPersonId: string;
}

const emptyForm: FormData = {
  name: '', orgIds: [], agentType: 'AI',
  description: '', provider: '',
  status: 'ACTIVE', ownerPersonId: '',
};

// ── Inline styles (matching the rest of the app) ──

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
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12, borderTop: '1px solid var(--color-border)',
};

const TYPE_BADGES: Record<string, { bg: string; color: string }> = {
  AI:              { bg: '#ede9fe', color: '#5b21b6' },
  SERVICE_ACCOUNT: { bg: '#dbeafe', color: '#1e40af' },
  PIPELINE:        { bg: '#d1f0eb', color: '#0f4f46' },
  BOT:             { bg: '#fef3c7', color: '#92400e' },
  OTHER:           { bg: '#f1f5f9', color: '#64748b' },
};
const STATUS_BADGES: Record<string, { bg: string; color: string }> = {
  ACTIVE:  { bg: '#d1f0eb', color: '#0f4f46' },
  PAUSED:  { bg: '#fef3c7', color: '#92400e' },
  RETIRED: { bg: '#f1f5f9', color: '#64748b' },
};

export default function AgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [orgs, setOrgs] = useState<OrganizationRef[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [agentTypes, setAgentTypes] = useState<string[]>(['AI', 'SERVICE_ACCOUNT', 'PIPELINE', 'BOT', 'OTHER']);
  const [agentStatuses, setAgentStatuses] = useState<string[]>(['ACTIVE', 'PAUSED', 'RETIRED']);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const selectedOrgId = searchParams.get('orgId') || '';
  const applyOrgFilter = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('orgId', id); else next.delete('orgId');
    setSearchParams(next, { replace: true });
  };

  const fetchData = useCallback(async () => {
    try {
      const [agentRes, orgRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Agent[]; agentTypes: string[]; agentStatuses: string[] }>('/agents'),
        apiClient.get<{ success: boolean; data: OrganizationRef[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
      ]);
      setAgents(agentRes.data || []);
      if (agentRes.agentTypes) setAgentTypes(agentRes.agentTypes);
      if (agentRes.agentStatuses) setAgentStatuses(agentRes.agentStatuses);
      setOrgs(orgRes.data || []);
      setPeople(peopleRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const orgNameById: Record<string, string> = {};
  for (const o of orgs) orgNameById[o.id] = o.name;
  const personNameById: Record<string, string> = {};
  for (const p of people) personNameById[p.id] = p.name;

  const filtered = selectedOrgId
    ? agents.filter((a) => a.orgIds.includes(selectedOrgId))
    : agents;

  const openAdd = () => {
    setForm({ ...emptyForm, orgIds: selectedOrgId ? [selectedOrgId] : [] });
    setEditingId(null);
    setShowForm(true);
  };
  const openEdit = (a: Agent) => {
    setForm({
      name: a.name, orgIds: a.orgIds, agentType: a.agentType,
      description: a.description, provider: a.provider,
      status: a.status, ownerPersonId: a.ownerPersonId,
    });
    setEditingId(a.id);
    setShowForm(true);
  };
  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };
  const handleSave = async () => {
    if (!form.name.trim() || form.orgIds.length === 0) return;
    try {
      if (editingId) await apiClient.put(`/agents/${editingId}`, form);
      else await apiClient.post('/agents', form);
      handleCancel();
      fetchData();
    } catch { /* */ }
  };
  const handleDelete = async (id: string) => {
    try { await apiClient.delete(`/agents/${id}`); setConfirmDelete(null); fetchData(); }
    catch { /* */ }
  };

  const toggleOrgAssignment = (orgId: string) => {
    setForm((f) => ({
      ...f,
      orgIds: f.orgIds.includes(orgId) ? f.orgIds.filter((x) => x !== orgId) : [...f.orgIds, orgId],
    }));
  };

  if (loading) return <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading\u2026</p>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Agents</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none' }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            Non-human actors \u2014 AI, service accounts, pipelines, bots \u2014 assigned to organizations like people.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Organization:</label>
          <select
            style={{ ...inputStyle, width: 'auto', minWidth: 200, appearance: 'auto' as any, fontSize: 13 }}
            value={selectedOrgId}
            onChange={(e) => applyOrgFilter(e.target.value)}
          >
            <option value="">All organizations</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button onClick={openAdd} style={btnPrimary}>+ Add Agent</button>
        </div>
      </div>

      {/* Active filter chip */}
      {selectedOrgId && (
        <div style={{ marginBottom: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 4px 2px 8px', borderRadius: 999,
            background: '#eff6ff', color: '#1e40af',
            fontSize: 11, fontWeight: 500,
          }}>
            Filter: {orgNameById[selectedOrgId] || selectedOrgId}
            <button onClick={() => applyOrgFilter('')} aria-label="Clear filter" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1e40af', fontSize: 14, lineHeight: 1, padding: '0 4px' }}>&times;</button>
          </span>
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editingId ? 'Edit Agent' : 'Add Agent'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nightly Billing ETL" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Type</label>
              <select style={selectStyle} value={form.agentType} onChange={(e) => setForm({ ...form, agentType: e.target.value })}>
                {agentTypes.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Provider</label>
              <input style={inputStyle} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="e.g. Anthropic, Airflow, Custom" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                {agentStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Description</label>
              <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What the agent does" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Responsible Person (optional)</label>
              <select style={selectStyle} value={form.ownerPersonId} onChange={(e) => setForm({ ...form, ownerPersonId: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Assigned Organizations *</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, border: '1px solid var(--color-border)', borderRadius: 4, padding: 8, background: 'var(--color-bg)', maxHeight: 160, overflowY: 'auto' }}>
                {orgs.map((o) => (
                  <label key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.orgIds.includes(o.id)} onChange={() => toggleOrgAssignment(o.id)} />
                    {o.name}
                  </label>
                ))}
              </div>
              {form.orgIds.length === 0 && <p style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 4 }}>Assign to at least one organization.</p>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: (!form.name.trim() || form.orgIds.length === 0) ? 0.6 : 1 }}
              disabled={!form.name.trim() || form.orgIds.length === 0}
              onClick={handleSave}
            >
              {editingId ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
              {selectedOrgId ? 'No agents assigned to this organization yet.' : 'No agents defined yet.'}
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Provider</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Organizations</th>
                <th style={thStyle}>Responsible</th>
                <th style={{ ...thStyle, width: 120, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const tb = TYPE_BADGES[a.agentType] || TYPE_BADGES.OTHER;
                const sb = STATUS_BADGES[a.status] || STATUS_BADGES.ACTIVE;
                return (
                  <tr key={a.id}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>
                      {a.name}
                      {a.description && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 400 }}>{a.description}</div>}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: tb.bg, color: tb.color }}>
                        {a.agentType.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={tdStyle}>{a.provider || <span style={{ color: 'var(--color-text-muted)' }}>\u2014</span>}</td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: sb.bg, color: sb.color }}>
                        {a.status}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {a.orgIds.map((oid) => orgNameById[oid]).filter(Boolean).join(', ') || <span style={{ color: 'var(--color-text-muted)' }}>\u2014</span>}
                    </td>
                    <td style={tdStyle}>
                      {a.ownerPersonId ? (personNameById[a.ownerPersonId] || <span style={{ color: 'var(--color-text-muted)' }}>(unknown person)</span>) : <span style={{ color: 'var(--color-text-muted)' }}>\u2014</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }} onClick={() => openEdit(a)}>Edit</button>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }} onClick={() => setConfirmDelete(a.id)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 20, maxWidth: 400, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Delete this agent?</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button style={{ ...btnPrimary, background: 'var(--color-error)' }} onClick={() => handleDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
