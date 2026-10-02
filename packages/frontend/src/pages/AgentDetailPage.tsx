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

  return (
    <div>
      <PageHeader
        kicker="Agent"
        title={a.name}
        copyId={a.id}
        copyLabel="Copy agent ID"
        subtitle={
          <>
            <span>{a.agentType.replace('_', ' ')}</span>
            {a.provider && <span> {'•'} {a.provider}</span>}
          </>
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

      {/* Identity */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={10}>Identity</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {editing && (
            <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="Agent name" />
          )}
          <EditableField label="Type" editing={editing} value={m.draft.agentType} onChange={(v) => m.set('agentType', v)} type="select" options={typeOptions}>
            <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: typeBadge.bg, color: typeBadge.color }}>
              {a.agentType.replace('_', ' ')}
            </span>
          </EditableField>
          <EditableField label="Status" editing={editing} value={m.draft.status} onChange={(v) => m.set('status', v as Agent['status'])} type="select" options={STATUSES.map((s) => ({ value: s, label: s }))}>
            <StatusBadge variant={a.status === 'ACTIVE' ? 'success' : a.status === 'PAUSED' ? 'warning' : 'neutral'}>{a.status}</StatusBadge>
          </EditableField>
          <EditableField label="Provider" editing={editing} value={m.draft.provider} onChange={(v) => m.set('provider', v)} placeholder="e.g. Anthropic" emptyText="Not set" />
          <EditableField
            label="Responsible person"
            editing={editing}
            value={m.draft.ownerPersonId}
            onChange={(v) => m.set('ownerPersonId', v)}
            type="select"
            options={peopleOptions}
          >
            {ownerName || <span style={emptyStyle}>Unassigned</span>}
          </EditableField>
        </div>
        {(editing || a.description) && (
          <div style={{ marginTop: 14 }}>
            <EditableField label="Description" editing={editing} type="textarea" value={m.draft.description} onChange={(v) => m.set('description', v)} placeholder="What this agent does" emptyText="No description">
              {a.description ? <span style={{ color: 'var(--color-text-secondary)' }}>{a.description}</span> : undefined}
            </EditableField>
          </div>
        )}
        {(editing || a.instructions) && (
          <div style={{ marginTop: 14 }}>
            <EditableField label="Instructions" editing={editing} type="textarea" value={m.draft.instructions} onChange={(v) => m.set('instructions', v)} placeholder="System / operating instructions" emptyText="None">
              {a.instructions ? <span style={{ whiteSpace: 'pre-wrap', color: 'var(--color-text-secondary)' }}>{a.instructions}</span> : undefined}
            </EditableField>
          </div>
        )}
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

      {/* Governance (DAMA) roles — read-only assignments */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Assigned DAMA roles ({roles.length})</SectionLabel>
        {roles.length === 0 ? <div style={emptyStyle}>No roles assigned</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {roles.map((r) => <StatusBadge key={r.id} variant="agent" size="md">{DAMA_ROLE_LABELS[r.roleType] || r.roleType}</StatusBadge>)}
          </div>
        )}
      </Card>

      {/* Execution history — read-only */}
      <Card>
        <SectionLabel marginBottom={8}>Execution history ({execs.length})</SectionLabel>
        {execs.length === 0 ? <div style={emptyStyle}>No executions yet</div> : (
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
    </div>
  );
}
