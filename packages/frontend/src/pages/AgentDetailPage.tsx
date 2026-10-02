import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { errorMessage } from '../lib/errorToast';
import { badgeColor } from '../lib/badgeColors';
import { DAMA_ROLE_LABELS } from '../types';

// ──────────────────────────────────────────────────────────────────────────
// AgentDetailPage — the full record for one agent at /agents/:id. Promotes
// the inline-expansion detail (governance roles + execution history) from the
// Agents list into a shareable, breadcrumbed page, matching the detail-page
// family (Person detail, Governance Group detail): a PageHeader that leads,
// a "Back to Agents" action, and Card sections. Clicking an agent row on the
// list navigates here.
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

interface OrgRef { id: string; name: string; type: string }
interface PersonRef { id: string; name: string }
interface SkillRef { id: string; name: string }

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--color-text)',
};
const emptyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' };

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [orgs, setOrgs] = useState<OrgRef[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [skills, setSkills] = useState<SkillRef[]>([]);
  const [roles, setRoles] = useState<DamaRoleAssignment[]>([]);
  const [execs, setExecs] = useState<AgentExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
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
  const ownerName = people.find((p) => p.id === a.ownerPersonId)?.name;
  const orgNames = (a.orgIds || []).map((oid) => orgs.find((o) => o.id === oid)?.name).filter(Boolean) as string[];
  const skillNames = (a.skillIds || []).map((sid) => skills.find((s) => s.id === sid)?.name).filter(Boolean) as string[];
  const typeBadge = badgeColor('agentType', a.agentType);

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
        actions={<Link to="/agents" style={backLinkStyle}>{'←'} Back to Agents</Link>}
      />

      {/* Identity */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={10}>Identity</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <Field label="Type">
            <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: typeBadge.bg, color: typeBadge.color }}>
              {a.agentType.replace('_', ' ')}
            </span>
          </Field>
          <Field label="Status"><StatusBadge variant={a.status === 'ACTIVE' ? 'success' : a.status === 'PAUSED' ? 'warning' : 'neutral'}>{a.status}</StatusBadge></Field>
          <Field label="Provider">{a.provider || <span style={emptyStyle}>Not set</span>}</Field>
          <Field label="Responsible person">{ownerName || <span style={emptyStyle}>Unassigned</span>}</Field>
        </div>
        {a.description && (
          <div style={{ marginTop: 14 }}>
            <Field label="Description"><span style={{ color: 'var(--color-text-secondary)' }}>{a.description}</span></Field>
          </div>
        )}
        {a.instructions && (
          <div style={{ marginTop: 14 }}>
            <Field label="Instructions"><span style={{ whiteSpace: 'pre-wrap', color: 'var(--color-text-secondary)' }}>{a.instructions}</span></Field>
          </div>
        )}
      </Card>

      {/* Organizations */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Organizations ({orgNames.length})</SectionLabel>
        {orgNames.length === 0 ? <div style={emptyStyle}>No organizations assigned</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {orgNames.map((n) => <span key={n} style={chipStyle}>{n}</span>)}
          </div>
        )}
      </Card>

      {/* Skills */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Skills ({skillNames.length})</SectionLabel>
        {skillNames.length === 0 ? <div style={emptyStyle}>No skills assigned</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {skillNames.map((n) => <span key={n} style={chipStyle}>{n}</span>)}
          </div>
        )}
      </Card>

      {/* Governance (DAMA) roles */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Assigned DAMA roles ({roles.length})</SectionLabel>
        {roles.length === 0 ? <div style={emptyStyle}>No roles assigned</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {roles.map((r) => <StatusBadge key={r.id} variant="agent" size="md">{DAMA_ROLE_LABELS[r.roleType] || r.roleType}</StatusBadge>)}
          </div>
        )}
      </Card>

      {/* Execution history */}
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
