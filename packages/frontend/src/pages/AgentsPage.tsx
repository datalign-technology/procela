import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { thStyle, tdStyle } from '../lib/tableStyles';
import PageHeader from '../components/PageHeader';
import TruncatedText from '../components/TruncatedText';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import ExportMenu from '../components/ExportMenu';
import { DAMA_ROLE_LABELS } from '../types';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import SortableTh from '../components/SortableTh';
import { useSortedList } from '../hooks/useSortedList';
import { SkeletonRows } from '../components/Skeleton';
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';
import SkillPicker from '../components/SkillPicker';
import { formatPersonLabel } from '../lib/personLabel';
import { badgeColor } from '../lib/badgeColors';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';
import { useRefreshOnFocus } from '../hooks/usePolling';

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
  skillIds: string[];
  instructions?: string;
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
  skillIds: string[];
  instructions: string;
}

const emptyForm: FormData = {
  name: '', orgIds: [], agentType: 'AI',
  description: '', provider: '',
  status: 'ACTIVE', ownerPersonId: '', skillIds: [],
  instructions: '',
};

// ── Inline styles (matching the rest of the app) ──

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

interface DamaRoleAssignment {
  id: string;
  agentId: string | null;
  agentName: string | null;
  roleType: string;
  scopeType: string;
  scopeId: string;
}

interface AgentExecution {
  id: string;
  agentId: string;
  status: string;
  completedAt: string | null;
  createdAt: string;
}

const STATUS_BADGES: Record<string, { bg: string; color: string }> = {
  ACTIVE:  { bg: '#d1f0eb', color: '#0f4f46' },
  PAUSED:  { bg: '#fef3c7', color: '#92400e' },
  RETIRED: { bg: '#f1f5f9', color: '#64748b' },
};

type AgentColId = 'name' | 'type' | 'provider' | 'status' | 'orgs' | 'responsible';
const AGENT_COLUMN_DEFS: Array<{ id: AgentColId; label: string; defaultVisible: boolean }> = [
  { id: 'name',        label: 'Name',          defaultVisible: true  },
  { id: 'type',        label: 'Type',          defaultVisible: true  },
  { id: 'provider',    label: 'Provider',      defaultVisible: false },
  { id: 'status',      label: 'Status',        defaultVisible: true  },
  { id: 'orgs',        label: 'Organizations', defaultVisible: false },
  { id: 'responsible', label: 'Responsible',   defaultVisible: true  },
];

export default function AgentsPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const agentCols = useColumnPicker<AgentColId>('procela.agents.visibleCols.v1', AGENT_COLUMN_DEFS);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [orgs, setOrgs] = useState<OrganizationRef[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [agentTypes, setAgentTypes] = useState<string[]>(['AI', 'SERVICE_ACCOUNT', 'PIPELINE', 'BOT', 'OTHER']);
  const [agentStatuses, setAgentStatuses] = useState<string[]>(['ACTIVE', 'PAUSED', 'RETIRED']);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const validation = useFormValidation({ name: (v) => !v?.trim() ? 'Name is required' : null });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importOrgId, setImportOrgId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [agentRoles, setAgentRoles] = useState<DamaRoleAssignment[]>([]);
  const [agentExecutions, setAgentExecutions] = useState<AgentExecution[]>([]);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  const selectedOrgId = searchParams.get('orgId') || '';
  const applyOrgFilter = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('orgId', id); else next.delete('orgId');
    setSearchParams(next, { replace: true });
  };

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [agentRes, orgRes, peopleRes, rolesRes, execsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Agent[]; agentTypes: string[]; agentStatuses: string[] }>('/agents'),
        apiClient.get<{ success: boolean; data: OrganizationRef[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: DamaRoleAssignment[] }>(`/dama-roles${query}`),
        apiClient.get<{ success: boolean; data: AgentExecution[] }>(`/agent-executions${query}`),
      ]);
      setAgents(agentRes.data || []);
      if (agentRes.agentTypes) setAgentTypes(agentRes.agentTypes);
      if (agentRes.agentStatuses) setAgentStatuses(agentRes.agentStatuses);
      setOrgs(orgRes.data || []);
      setPeople(peopleRes.data || []);
      setAgentRoles((rolesRes.data || []).filter((r) => r.agentId));
      setAgentExecutions(execsRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useRefreshOnFocus(fetchData);

  const orgNameById: Record<string, string> = {};
  for (const o of orgs) orgNameById[o.id] = o.name;
  const personNameById: Record<string, string> = {};
  for (const p of people) personNameById[p.id] = p.name;

  const filtered = (selectedOrgId || searchQuery.trim())
    ? agents.filter((a) => {
        if (selectedOrgId && !a.orgIds.includes(selectedOrgId)) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          if (!a.name.toLowerCase().includes(q) && !(a.description || '').toLowerCase().includes(q)) return false;
        }
        return true;
      })
    : agents;

  const openAdd = () => {
    // Pre-select an org if the page's filter has one, otherwise leave empty
    // and let the user pick from the form's checkbox list. The form's own
    // "Assigned Organizations" picker is the real assignment control; we do
    // NOT require a header active-org here (the previous guard tripped users
    // who'd already picked an org in the form's checkbox list).
    const visibleIds = new Set(orgs.map((o) => o.id));
    const seed = selectedOrgId && visibleIds.has(selectedOrgId) ? [selectedOrgId] : [];
    setForm({ ...emptyForm, orgIds: seed });
    setEditingId(null);
    setShowForm(true);
  };
  const openEdit = (a: Agent) => {
    // Pre-fill only with orgs the current user can see. Anything else —
    // typically a deleted org id left on a legacy agent record, or a
    // bogus seed value — would be invisible in the checkbox list but
    // still ride along on save and trip the backend's "Organization X
    // not found" guard. Drop those here, and tell the user.
    const visibleIds = new Set(orgs.map((o) => o.id));
    const valid = (a.orgIds || []).filter((id) => visibleIds.has(id));
    const droppedCount = (a.orgIds || []).length - valid.length;
    if (droppedCount > 0) {
      addToast('info', `${droppedCount} previously-assigned organization${droppedCount === 1 ? '' : 's'} no longer exist${droppedCount === 1 ? 's' : ''} and ${droppedCount === 1 ? 'has' : 'have'} been cleared. Pick the current org(s) and save to repair this agent.`);
    }
    setForm({
      name: a.name, orgIds: valid, agentType: a.agentType,
      description: a.description, provider: a.provider,
      status: a.status, ownerPersonId: a.ownerPersonId,
      skillIds: a.skillIds || [],
      instructions: a.instructions || '',
    });
    setEditingId(a.id);
    setShowForm(true);
  };
  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); validation.clearErrors(); };
  const handleSave = async () => {
    // The form's own "Assigned Organizations" picker (form.orgIds) is the
    // assignment of record — both for create and edit. We do not require a
    // header active-org: the user has already ticked their orgs in the form,
    // and the disabled-button state + this orgIds-non-empty check are the
    // real guards. (A previous activeOrgId guard fired a confusing "Select an
    // organization from the header first" toast even when the user had
    // already picked one in the form.)
    if (!validation.validateAll(form) || form.orgIds.length === 0) return;
    // Defensive: strip any org ids that aren't in the live /organizations
    // response. Without this, a stale id that slipped past openEdit (e.g.
    // because orgs reloaded after the form opened) would hit the backend's
    // strict org-lookup and surface as a confusing "Organization X not
    // found." Better to drop here and tell the user.
    const visibleIds = new Set(orgs.map((o) => o.id));
    const cleanOrgIds = form.orgIds.filter((id) => visibleIds.has(id));
    if (cleanOrgIds.length === 0) {
      addToast('error', 'None of the selected organizations are visible to you. Pick at least one from the checkbox list.');
      return;
    }
    const payload = { ...form, orgIds: cleanOrgIds };
    try {
      if (editingId) await apiClient.put(`/agents/${editingId}`, payload);
      else await apiClient.post('/agents', payload);
      addToast('success', editingId ? 'Agent updated' : 'Agent created');
      handleCancel();
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to save agent');
    }
  };
  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/agents/${id}`);
      addToast('success', 'Agent deleted');
      setConfirmDelete(null);
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to delete agent');
    }
  };

  const toggleOrgAssignment = (orgId: string) => {
    setForm((f) => ({
      ...f,
      orgIds: f.orgIds.includes(orgId) ? f.orgIds.filter((x) => x !== orgId) : [...f.orgIds, orgId],
    }));
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
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((a) => a.id)));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/agents/${id}`)));
      addToast('success', `Deleted ${count} agent${count === 1 ? '' : 's'}`);
      setSelectedIds(new Set());
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Bulk delete failed');
      fetchData();
    }
  };

  // ── Import handlers ──
  const handleImport = async () => {
    // The import dialog has its own org dropdown (importOrgId); the check
    // below ("Select an organization and provide data to import") is the
    // real guard — we don't also require the header active-org.
    const orgId = importOrgId || selectedOrgId;
    if (!importText.trim() || !orgId) { addToast('error', 'Select an organization and provide data to import.'); return; }
    try {
      const body: any = { orgId };
      if (importFormat === 'csv') body.csv = importText; else body.agents = JSON.parse(importText);
      await apiClient.post('/agents/import', body);
      addToast('success', 'Agents imported');
      setShowImport(false); setImportText(''); setImportOrgId('');
      fetchData();
    } catch (e) { addToast('error', e instanceof Error ? e.message : 'Import failed'); }
  };
  // Sort — URL-persisted via ?sort=&dir=.
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    filtered,
    {
      name: (a, b) => a.name.localeCompare(b.name),
      type: (a, b) => a.agentType.localeCompare(b.agentType),
      provider: (a, b) => (a.provider || '').localeCompare(b.provider || ''),
      status: (a, b) => a.status.localeCompare(b.status),
    },
    'name',
  );

  const handleFileRead = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(reader.result as string);
      if (file.name.endsWith('.json')) setImportFormat('json');
      if (file.name.endsWith('.csv')) setImportFormat('csv');
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (loading) return (
    <div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
        <SkeletonRows rows={5} columns={4} />
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Agents"
        subtitle="Non-human actors — AI, service accounts, pipelines, bots — assigned to organizations like people."
        actions={
          <>
            <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Organization:</label>
            <select
              style={{ ...inputStyle, width: 'auto', minWidth: 200, appearance: 'auto' as any, fontSize: 13 }}
              value={selectedOrgId}
              onChange={(e) => applyOrgFilter(e.target.value)}
            >
              <option value="">All organizations</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {filtered.length > 0 && (
              <ExportMenu build={() => ({
                filenameBase: 'agents',
                sheetName: 'Agents',
                headers: ['Name', 'Type', 'Provider', 'Status', 'Organizations', 'Responsible', 'Description'],
                rows: filtered.map((a) => [
                  a.name,
                  a.agentType,
                  a.provider,
                  a.status,
                  a.orgIds.map((oid) => orgNameById[oid]).filter(Boolean).join('; '),
                  personNameById[a.ownerPersonId] || '',
                  a.description,
                ]),
              })} />
            )}
            <IconButton icon="upload" label="Import agents"
              onClick={() => { setImportOrgId(selectedOrgId); setShowImport(true); }} />
            <ColumnPicker state={agentCols} />
            <IconButton icon="plus" label="Add agent" variant="primary" onClick={openAdd} />
          </>
        }
      />

      {/* Import Panel */}
      {showImport && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Import Agents</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}><input type="radio" checked={importFormat === 'csv'} onChange={() => setImportFormat('csv')} /> CSV</label>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}><input type="radio" checked={importFormat === 'json'} onChange={() => setImportFormat('json')} /> JSON</label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 11, fontWeight: 500 }}>Assign to organization *</label>
            <select
              style={{ ...inputStyle, width: 'auto', minWidth: 220, appearance: 'auto' as any, fontSize: 12 }}
              value={importOrgId}
              onChange={(e) => setImportOrgId(e.target.value)}
            >
              <option value="">-- Select an organization --</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input ref={fileInputRef} type="file" accept={importFormat === 'csv' ? '.csv,.txt' : '.json,.txt'} onChange={handleFileRead} style={{ display: 'none' }} />
            <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => fileInputRef.current?.click()}>Browse File</button>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>or paste below. Columns: Name (required), Type, Provider, Description</span>
          </div>
          <textarea
            style={{ ...inputStyle, width: '100%', minHeight: 100, fontFamily: 'var(--font-mono)', fontSize: 11 }}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={importFormat === 'csv'
              ? 'Name,Type,Provider,Description\nNightly Billing ETL,PIPELINE,Airflow,Loads billing data nightly'
              : '[{ "name": "Nightly Billing ETL", "agentType": "PIPELINE", "provider": "Airflow" }]'}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowImport(false); setImportText(''); setImportOrgId(''); }}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !importText.trim() || !(importOrgId || selectedOrgId) ? 0.6 : 1, cursor: !importText.trim() || !(importOrgId || selectedOrgId) ? 'not-allowed' : 'pointer' }}
              disabled={!importText.trim() || !(importOrgId || selectedOrgId)}
              onClick={handleImport}
            >Import</button>
          </div>
        </div>
      )}

      {/* Filters (left-aligned, mirrors Data Assets) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search agents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
        />
        <select
          value={selectedOrgId}
          onChange={(e) => applyOrgFilter(e.target.value)}
          style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 'auto', minWidth: 160, appearance: 'auto' as any }}
        >
          <option value="">All Organizations</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {(selectedOrgId || searchQuery) && (
          <>
            <button
              onClick={() => { applyOrgFilter(''); setSearchQuery(''); }}
              style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}
            >
              Clear Filters
            </button>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Showing {filtered.length} of {agents.length}
            </span>
          </>
        )}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editingId ? 'Edit Agent' : 'Add Agent'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus
                style={{ ...inputStyle, border: validation.fieldError('name') ? inputErrorBorder : inputStyle.border }}
                value={form.name}
                onChange={(e) => { const v = e.target.value; setForm({ ...form, name: v }); if (validation.touched.name) validation.validateField('name', v, form); }}
                onBlur={() => { validation.touch('name'); validation.validateField('name', form.name, form); }}
                placeholder="e.g. Nightly Billing ETL" />
              {validation.fieldError('name') && <div style={fieldErrorStyle}>{validation.fieldError('name')}</div>}
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type</label>
              <select style={selectStyle} value={form.agentType} onChange={(e) => setForm({ ...form, agentType: e.target.value })}>
                {agentTypes.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Provider</label>
              <input style={inputStyle} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="e.g. Anthropic, Airflow, Custom" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                {agentStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What the agent does" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Instructions</label>
              <textarea
                style={{ ...inputStyle, minHeight: 90, fontFamily: 'inherit', resize: 'vertical' }}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                placeholder="The operating brief used when this agent performs a governance activity. e.g. 'You are a data quality analyst. Assess completeness, accuracy, timeliness, and consistency. Flag any asset below Gold tier supporting a critical process.'"
              />
              <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Becomes the agent's system prompt when it runs an activity. Leave blank to use general data-governance best practice.
              </p>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Responsible Person (optional)</label>
              <select style={selectStyle} value={form.ownerPersonId} onChange={(e) => setForm({ ...form, ownerPersonId: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Assigned Organizations *</label>
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
            <div style={{ gridColumn: '1 / -1' }}>
              <SkillPicker
                orgId={activeOrgId || undefined}
                selectedSkillIds={form.skillIds}
                onChange={(skillIds) => setForm({ ...form, skillIds })}
                maxHeight={180}
                label="Skills"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: (!form.name.trim() || form.orgIds.length === 0) ? 0.6 : 1, cursor: (!form.name.trim() || form.orgIds.length === 0) ? 'not-allowed' : 'pointer' }}
              disabled={!form.name.trim() || form.orgIds.length === 0}
              onClick={handleSave}
            >
              {editingId ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      )}

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

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Agents?"
        message={`Delete ${selectedIds.size} selected agents? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => {
          setConfirmBulkDelete(false);
          await handleBulkDelete();
        }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={renderNavIcon('/agents')}
            title={selectedOrgId ? 'No agents in this organization yet' : 'No agents defined yet'}
            description="Agents are non-human actors — AI models, service accounts, pipelines, bots — that participate in your org alongside people."
            action={{ label: '+ Add Agent', onClick: openAdd }}
            secondaryAction={{ label: 'Import from CSV', onClick: () => { setImportOrgId(selectedOrgId); setShowImport(true); } }}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th scope="col" style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                  <input type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll} aria-label="Select all agents" />
                </th>
                {agentCols.isVisible('name') && <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Name</SortableTh>}
                {agentCols.isVisible('type') && <SortableTh sortKey="type" active={sortKey} dir={sortDir} onClick={toggleSort}>Type</SortableTh>}
                {agentCols.isVisible('provider') && <SortableTh sortKey="provider" active={sortKey} dir={sortDir} onClick={toggleSort}>Provider</SortableTh>}
                {agentCols.isVisible('status') && <SortableTh sortKey="status" active={sortKey} dir={sortDir} onClick={toggleSort}>Status</SortableTh>}
                {agentCols.isVisible('orgs') && <th scope="col" style={thStyle}>Organizations</th>}
                {agentCols.isVisible('responsible') && <th scope="col" style={thStyle}>Responsible</th>}
                <th scope="col" style={{ ...thStyle, width: 120, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const tb = badgeColor('agentType', a.agentType);
                const sb = STATUS_BADGES[a.status] || STATUS_BADGES.ACTIVE;
                const isSelected = selectedIds.has(a.id);
                const roles = agentRoles.filter((r) => r.agentId === a.id);
                const execs = agentExecutions.filter((e) => e.agentId === a.id);
                const isExpanded = expandedAgentId === a.id;
                return (
                  <React.Fragment key={a.id}>
                    <tr style={{ transition: 'background 0.1s', background: isSelected ? '#f0f9ff' : '' }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                      <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(a.id)} />
                      </td>
                      {agentCols.isVisible('name') && (
                        <td style={{ ...tdStyle, fontWeight: 500 }}>
                          <span
                            onClick={() => setExpandedAgentId(isExpanded ? null : a.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            {a.name}
                          </span>
                          {a.description && (
                            <TruncatedText
                              text={a.description}
                              style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 400 }}
                            />
                          )}
                          {(roles.length > 0 || execs.length > 0) && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                              {roles.length > 0 && (
                                <StatusBadge variant="agent">
                                  {roles.length} role{roles.length !== 1 ? 's' : ''}
                                </StatusBadge>
                              )}
                              {execs.length > 0 && (
                                <StatusBadge variant="success">
                                  {execs.length} execution{execs.length !== 1 ? 's' : ''}
                                </StatusBadge>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                      {agentCols.isVisible('type') && (
                        <td style={tdStyle}>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: tb.bg, color: tb.color }}>
                            {a.agentType.replace('_', ' ')}
                          </span>
                        </td>
                      )}
                      {agentCols.isVisible('provider') && (
                        <td style={tdStyle}>{a.provider || <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}</td>
                      )}
                      {agentCols.isVisible('status') && (
                        <td style={tdStyle}>
                          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: sb.bg, color: sb.color }}>
                            {a.status}
                          </span>
                        </td>
                      )}
                      {agentCols.isVisible('orgs') && (
                        <td style={tdStyle}>
                          {a.orgIds.map((oid) => orgNameById[oid]).filter(Boolean).join(', ') || <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                        </td>
                      )}
                      {agentCols.isVisible('responsible') && (
                        <td style={tdStyle}>
                          {a.ownerPersonId ? (personNameById[a.ownerPersonId] || <span style={{ color: 'var(--color-text-muted)' }}>(unknown person)</span>) : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                        </td>
                      )}
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(a)} />
                          <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(a.id)} />
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0, borderTop: 'none' }}>
                          <div style={{ padding: '12px 16px 12px 48px', background: '#fafbfc', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                              {/* DAMA Roles */}
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                                  Assigned DAMA Roles
                                </div>
                                {roles.length === 0 ? (
                                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No roles assigned</div>
                                ) : (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {roles.map((r) => (
                                      <StatusBadge key={r.id} variant="agent" size="md">
                                        {DAMA_ROLE_LABELS[r.roleType] || r.roleType}
                                      </StatusBadge>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* Execution History */}
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                                  Execution History ({execs.length})
                                </div>
                                {execs.length === 0 ? (
                                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No executions yet</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {execs.slice(0, 5).map((ex) => (
                                      <div key={ex.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                                        <StatusBadge variant={ex.status === 'SUCCESS' ? 'success' : ex.status === 'FAILED' ? 'danger' : 'warning'}>
                                          {ex.status}
                                        </StatusBadge>
                                        <span style={{ color: 'var(--color-text-muted)' }}>
                                          {ex.completedAt ? new Date(ex.completedAt).toLocaleString() : 'Pending'}
                                        </span>
                                      </div>
                                    ))}
                                    {execs.length > 5 && <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>...and {execs.length - 5} more</div>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
