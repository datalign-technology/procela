import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import EditableField from '../components/EditableField';
import DetailEditActions from '../components/DetailEditActions';
import OrgPicker from '../components/OrgPicker';
import SkillPicker from '../components/SkillPicker';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { useOrgContext } from '../stores/orgContext';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { errorMessage, errorToast, successToast } from '../lib/errorToast';
import { badgeColor } from '../lib/badgeColors';
import { DAMA_ROLE_LABELS } from '../types';

// ──────────────────────────────────────────────────────────────────────────
// AgentDetailPage — the full record for one agent at /agents/:id. Opens
// read-only; the header Edit button flips the Identity fields + the
// Organizations / Skills pickers into inputs in place (useDetailEditMode +
// EditableField + DetailEditActions), one Save writes them. DAMA roles and
// execution history stay read-only (they're assignments / history, not fields
// on this record). Clicking an agent row on the list navigates here.
// ──────────────────────────────────────────────────────────────────────────

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

interface DamaRoleAssignment {
  id: string;
  agentId: string | null;
  roleType: string;
}

interface AgentExecution {
  id: string;
  agentId: string;
  status: string;
  completedAt: string | null;
  createdAt: string;
}

interface OrgRef { id: string; parentId: string | null; name: string; type: string }
interface PersonRef { id: string; name: string }
interface SkillRef { id: string; name: string }

interface AgentEditable {
  name: string;
  agentType: string;
  provider: string;
  status: 'ACTIVE' | 'PAUSED' | 'RETIRED';
  ownerPersonId: string;
  description: string;
  instructions: string;
  orgIds: string[];
  skillIds: string[];
}

const DEFAULT_AGENT_TYPES = ['AI', 'SERVICE_ACCOUNT', 'PIPELINE', 'BOT', 'OTHER'];
const STATUSES: Array<Agent['status']> = ['ACTIVE', 'PAUSED', 'RETIRED'];

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

const chipStyle: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--color-text)',
};
const emptyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' };

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = usePermissions();
  const { activeOrgId } = useOrgContext();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [orgs, setOrgs] = useState<OrgRef[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [skills, setSkills] = useState<SkillRef[]>([]);
  const [roles, setRoles] = useState<DamaRoleAssignment[]>([]);
  const [execs, setExecs] = useState<AgentExecution[]>([]);
  const [agentTypes] = useState<string[]>(DEFAULT_AGENT_TYPES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [agentRes, orgRes, peopleRes, skillRes, rolesRes, execRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Agent }>(`/agents/${id}`),
        apiClient.get<{ success: boolean; data: OrgRef[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: PersonRef[] }>('/people'),
        apiClient.get<{ success: boolean; data: SkillRef[] }>('/skills'),
        apiClient.get<{ success: boolean; data: DamaRoleAssignment[] }>('/dama-roles'),
        apiClient.get<{ success: boolean; data: AgentExecution[] }>('/agent-executions'),
      ]);
      setAgent(agentRes.data);
      setOrgs(orgRes.data || []);
      setPeople(peopleRes.data || []);
      setSkills(skillRes.data || []);
      setRoles((rolesRes.data || []).filter((r) => r.agentId === id));
      setExecs((execRes.data || []).filter((e) => e.agentId === id));
    } catch (err) {
      setError(errorMessage(err, 'Could not load agent'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useBreadcrumbLeaf(agent?.name);

  const m = useDetailEditMode<AgentEditable>(
    {
      name: agent?.name ?? '',
      agentType: agent?.agentType ?? 'AI',
      provider: agent?.provider ?? '',
      status: agent?.status ?? 'PAUSED',
      ownerPersonId: agent?.ownerPersonId ?? '',
      description: agent?.description ?? '',
      instructions: agent?.instructions ?? '',
      orgIds: agent?.orgIds ?? [],
      skillIds: agent?.skillIds ?? [],
    },
    async (draft) => {
      if (!id) return;
      if (draft.orgIds.length === 0) {
        errorToast(new Error('Assign at least one organization'), 'An agent needs at least one organization');
        throw new Error('no-orgs');
      }
      try {
        const resp = await apiClient.put<{ success: boolean; cascade?: { autoPaused?: boolean } | null }>(`/agents/${id}`, draft);
        if (resp?.cascade?.autoPaused) {
          successToast('Agent updated — auto-paused (no responsible person while active)');
        } else {
          successToast('Agent updated');
        }
        await fetchAll();
      } catch (err) { errorToast(err, 'Failed to update agent'); throw err; }
    },
  );

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Agent" title="Loading…" actions={<Link to="/agents" style={backLinkStyle}>{'←'} Back to Agents</Link>} />
        <Card><SkeletonRows rows={4} columns={3} /></Card>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <EmptyState
        title="Couldn't load this agent"
        description={error || 'The agent may have been deleted.'}
        action={{ label: 'Back to Agents', onClick: () => navigate('/agents') }}
      />
    );
  }

  const a = agent;
  const editing = m.isEditing;
  const ownerName = people.find((p) => p.id === a.ownerPersonId)?.name;
  const shownOrgIds = editing ? m.draft.orgIds : (a.orgIds || []);
  const shownSkillIds = editing ? m.draft.skillIds : (a.skillIds || []);
  const orgNames = shownOrgIds.map((oid) => orgs.find((o) => o.id === oid)?.name).filter(Boolean) as string[];
  const skillNames = shownSkillIds.map((sid) => skills.find((s) => s.id === sid)?.name).filter(Boolean) as string[];
  const typeBadge = badgeColor('agentType', a.agentType);
  const typeOptions = Array.from(new Set([...agentTypes, a.agentType])).map((t) => ({ value: t, label: t.replace('_', ' ') }));
  const peopleOptions = [{ value: '', label: '— Unassigned —' }, ...people.map((p) => ({ value: p.id, label: p.name }))];
  const roleNames = roles.map((r) => DAMA_ROLE_LABELS[r.roleType] || r.roleType);
  // Most recent run, for the Facts rail "Last run".
  const lastRun = execs.slice().sort((x, y) => (y.completedAt || y.createdAt).localeCompare(x.completedAt || x.createdAt))[0];
  const lastRunLabel = lastRun ? new Date(lastRun.completedAt || lastRun.createdAt).toLocaleDateString() : 'Never';

  // Governance setup — an agent should be as accountable as a person:
  // someone responsible, assigned to an org, a defined DAMA role, and recorded
  // skills. The role is assigned on the Governance Roles page; the rest are
  // editable here, so an incomplete item jumps into edit mode.
  const setupItems = [
    { key: 'owner', label: 'Responsible person', done: !!a.ownerPersonId, detail: ownerName || 'Nobody is accountable for this agent', action: 'edit' as const },
    { key: 'org', label: 'Organization', done: (a.orgIds || []).length > 0, detail: orgNames.join(', ') || 'Not assigned to an organization', action: 'edit' as const },
    { key: 'role', label: 'Governance role', done: roles.length > 0, detail: roleNames.join(', ') || 'The DAMA role this agent performs — without one, its permitted work is undefined', action: 'role' as const },
    { key: 'skills', label: 'Skills', done: (a.skillIds || []).length > 0, detail: skillNames.join(', ') || 'What the agent is capable of — used to match it to process steps', action: 'edit' as const },
  ];
  const setupDone = setupItems.filter((i) => i.done).length;

  const railLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 };

  return (
    <div>
      <PageHeader
        kicker="Agent"
        title={a.name}
        copyId={a.id}
        copyLabel="Copy agent ID"
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: typeBadge.bg, color: typeBadge.color }}>{a.agentType.replace('_', ' ')}</span>
            <StatusBadge variant={a.status === 'ACTIVE' ? 'success' : a.status === 'PAUSED' ? 'warning' : 'neutral'}>{a.status}</StatusBadge>
            {roles.length === 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 10px', borderRadius: 11, fontSize: 12, fontWeight: 600, background: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--color-warning)' }} />No governance role
              </span>
            )}
          </span>
        }
        actions={
          <DetailEditActions
            editing={editing}
            canEdit={canWrite}
            dirty={m.dirty}
            saving={m.saving}
            onEdit={m.enter}
            onCancel={m.cancel}
            onSave={m.save}
            before={<Link to="/agents" style={backLinkStyle}>{'←'} Back to Agents</Link>}
          />
        }
      />

      {/* Two-column: setup + work (main) + Facts rail (aside). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <main style={{ flex: '999 1 540px', minWidth: 0 }}>

          {/* Governance setup checklist */}
          <Card padding={0} marginBottom={16}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <SectionLabel marginBottom={0}>Governance setup</SectionLabel>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{setupDone} of 4 done</span>
              </div>
              <p style={{ margin: '6px 0 10px', fontSize: 13, color: 'var(--color-text-muted)' }}>An agent should be as accountable as a person: someone responsible, an organization, a defined role, and recorded skills.</p>
              <div role="progressbar" aria-label="Setup progress" aria-valuenow={setupDone * 25} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
                <div style={{ width: `${setupDone * 25}%`, height: '100%', background: 'var(--color-primary)' }} />
              </div>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {setupItems.map((item, i) => (
                <li key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < setupItems.length - 1 ? '1px solid var(--color-border)' : 'none', flexWrap: 'wrap' }}>
                  {item.done ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2" strokeDasharray="3 3" aria-hidden="true"><circle cx="12" cy="12" r="9" /></svg>
                  )}
                  <span style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <strong style={{ fontWeight: 600 }}>{item.label}</strong>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)' }}>{item.detail}</span>
                  </span>
                  {!item.done && canWrite && !editing && (
                    item.action === 'role'
                      ? <Link to="/dama-roles" style={{ height: 32, padding: '0 12px', display: 'inline-flex', alignItems: 'center', borderRadius: 8, background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Assign role</Link>
                      : <button type="button" onClick={m.enter} style={{ height: 32, padding: '0 12px', border: 0, borderRadius: 8, background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{item.key === 'skills' ? 'Add skills' : 'Set up'}</button>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {/* About */}
          <Card marginBottom={16}>
            <SectionLabel marginBottom={10}>About</SectionLabel>
            {editing && (
              <div style={{ marginBottom: 14 }}>
                <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="Agent name" />
              </div>
            )}
            <EditableField label="Description" editing={editing} type="textarea" value={m.draft.description} onChange={(v) => m.set('description', v)} placeholder="What this agent does" emptyText="No description">
              {a.description ? <span style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{a.description}</span> : undefined}
            </EditableField>
          </Card>

          {/* Organizations */}
          <Card marginBottom={16}>
            <SectionLabel marginBottom={8}>Organizations ({orgNames.length})</SectionLabel>
            {editing ? (
              <OrgPicker
                orgs={orgs}
                selectedIds={new Set(m.draft.orgIds)}
                onToggle={(oid) => m.set('orgIds', m.draft.orgIds.includes(oid) ? m.draft.orgIds.filter((x) => x !== oid) : [...m.draft.orgIds, oid])}
                scopeOrgId={activeOrgId || null}
                initialScope="subtree"
                isDisabled={(oid) => m.draft.orgIds.length === 1 && m.draft.orgIds[0] === oid}
                maxHeight={240}
                aria-label="Search organizations"
                placeholder="Search organizations (press / to focus)"
              />
            ) : orgNames.length === 0 ? <div style={emptyStyle}>No organizations assigned</div> : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {orgNames.map((n) => <span key={n} style={chipStyle}>{n}</span>)}
              </div>
            )}
          </Card>

          {/* Skills */}
          <Card marginBottom={16}>
            <SectionLabel marginBottom={8}>Skills ({skillNames.length})</SectionLabel>
            {editing ? (
              <SkillPicker
                orgId={activeOrgId || undefined}
                selectedSkillIds={m.draft.skillIds}
                onChange={(ids) => m.set('skillIds', ids)}
                label=""
              />
            ) : skillNames.length === 0 ? <div style={emptyStyle}>No skills assigned</div> : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {skillNames.map((n) => <span key={n} style={chipStyle}>{n}</span>)}
              </div>
            )}
          </Card>

          {/* Operating instructions */}
          <Card marginBottom={16}>
            <SectionLabel marginBottom={8}>Operating instructions</SectionLabel>
            <EditableField label="" editing={editing} type="textarea" value={m.draft.instructions} onChange={(v) => m.set('instructions', v)} placeholder="What this agent is meant to do and not do" emptyText="None written. Instructions tell reviewers what this agent is meant to do and not do.">
              {a.instructions ? <span style={{ whiteSpace: 'pre-wrap', color: 'var(--color-text-secondary)' }}>{a.instructions}</span> : undefined}
            </EditableField>
          </Card>

          {/* Run history */}
          <Card>
            <SectionLabel marginBottom={8}>Run history ({execs.length})</SectionLabel>
            {execs.length === 0 ? (
              <div style={{ padding: '20px 16px', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>No runs recorded yet</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Runs appear here when this agent performs a process activity. Each run's output waits for a person to approve it before it is used.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {execs.slice(0, 20).map((ex) => (
                  <div key={ex.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                    <StatusBadge variant={ex.status === 'SUCCESS' ? 'success' : ex.status === 'FAILED' ? 'danger' : 'warning'}>{ex.status}</StatusBadge>
                    <span style={{ color: 'var(--color-text-muted)' }}>{ex.completedAt ? new Date(ex.completedAt).toLocaleString() : 'Pending'}</span>
                  </div>
                ))}
                {execs.length > 20 && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>…and {execs.length - 20} more</div>}
              </div>
            )}
          </Card>
        </main>

        {/* Facts rail — inline-editable identity + read-only context. */}
        <aside style={{ flex: '1 1 300px', minWidth: 0 }}>
          <Card>
            <SectionLabel marginBottom={12}>Facts</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <EditableField label="Type" editing={editing} value={m.draft.agentType} onChange={(v) => m.set('agentType', v)} type="select" options={typeOptions}>
                <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: typeBadge.bg, color: typeBadge.color }}>{a.agentType.replace('_', ' ')}</span>
              </EditableField>
              <EditableField label="Status" editing={editing} value={m.draft.status} onChange={(v) => m.set('status', v as Agent['status'])} type="select" options={STATUSES.map((s) => ({ value: s, label: s }))}>
                <StatusBadge variant={a.status === 'ACTIVE' ? 'success' : a.status === 'PAUSED' ? 'warning' : 'neutral'}>{a.status}</StatusBadge>
              </EditableField>
              <EditableField label="Provider" editing={editing} value={m.draft.provider} onChange={(v) => m.set('provider', v)} placeholder="e.g. Anthropic" emptyText="Not set" />
              <EditableField label="Responsible" editing={editing} value={m.draft.ownerPersonId} onChange={(v) => m.set('ownerPersonId', v)} type="select" options={peopleOptions}>
                {a.ownerPersonId && ownerName
                  ? <Link to={`/people/${a.ownerPersonId}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{ownerName}</Link>
                  : <span style={emptyStyle}>Unassigned</span>}
              </EditableField>
              {/* Read-only context */}
              <div>
                <div style={railLabel}>Role</div>
                {roleNames.length > 0
                  ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{roles.map((r) => <StatusBadge key={r.id} variant="agent" size="md">{DAMA_ROLE_LABELS[r.roleType] || r.roleType}</StatusBadge>)}</div>
                  : <Link to="/dama-roles" style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}>Assign role</Link>}
              </div>
              <div>
                <div style={railLabel}>Last run</div>
                <div style={{ color: lastRun ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{lastRunLabel}</div>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
