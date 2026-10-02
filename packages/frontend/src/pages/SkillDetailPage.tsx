import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { errorMessage } from '../lib/errorToast';

// ──────────────────────────────────────────────────────────────────────────
// SkillDetailPage — the full record for one skill at /skills/:id. The Skills
// list had no detail affordance at all; this gives a skill the same shareable,
// breadcrumbed detail page as the other entities. A skill's intrinsic record
// is just name + category + description, so the value here is the usage it
// anchors — the people and agents who hold it, and the process activities that
// require it — assembled from the existing /people, /agents and
// /process-catalog data (no new endpoint).
// ──────────────────────────────────────────────────────────────────────────

interface Skill { id: string; orgId: string; name: string; category: string; description: string }
interface PersonRef { id: string; name: string; title?: string; skillIds?: string[] }
interface AgentRef { id: string; name: string; skillIds?: string[] }
interface ProcessNode {
  id: string;
  name: string;
  level?: string | null;
  requiredSkillIds?: string[];
  children?: ProcessNode[];
}

const CATEGORY_BADGES: Record<string, { bg: string; color: string }> = {
  DATA_QUALITY:  { bg: '#d1fae5', color: '#065f46' },
  METADATA:      { bg: '#dbeafe', color: '#1e40af' },
  ARCHITECTURE:  { bg: '#ede9fe', color: '#5b21b6' },
  SECURITY:      { bg: '#fce7f3', color: '#9d174d' },
  INTEGRATION:   { bg: '#fef3c7', color: '#92400e' },
  ANALYTICS:     { bg: '#cffafe', color: '#155e75' },
  GOVERNANCE:    { bg: '#e0e7ff', color: '#3730a3' },
  COMMUNICATION: { bg: '#f1f5f9', color: '#64748b' },
};
const formatCategory = (c: string) => c.replace(/_/g, ' ');

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};
const chipLinkStyle: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--color-primary)', textDecoration: 'none',
};
const chipStyle: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--color-text)',
};
const emptyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' };

// Walk the catalog tree, collecting nodes whose requiredSkillIds include the skill.
function collectRequiringNodes(nodes: ProcessNode[], skillId: string, out: ProcessNode[]) {
  for (const n of nodes) {
    if ((n.requiredSkillIds || []).includes(skillId)) out.push(n);
    if (n.children && n.children.length) collectRequiringNodes(n.children, skillId, out);
  }
}

export default function SkillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [agents, setAgents] = useState<AgentRef[]>([]);
  const [tree, setTree] = useState<ProcessNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [skillRes, peopleRes, agentRes, catalogRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Skill }>(`/skills/${id}`),
        apiClient.get<{ success: boolean; data: PersonRef[] }>('/people'),
        apiClient.get<{ success: boolean; data: AgentRef[] }>('/agents'),
        apiClient.get<{ success: boolean; tree: ProcessNode[] }>('/process-catalog'),
      ]);
      setSkill(skillRes.data);
      setPeople(peopleRes.data || []);
      setAgents(agentRes.data || []);
      setTree(catalogRes.tree || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load skill'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useBreadcrumbLeaf(skill?.name);

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Skill" title="Loading…" actions={<Link to="/skills" style={backLinkStyle}>{'←'} Back to Skills</Link>} />
        <Card><SkeletonRows rows={3} columns={3} /></Card>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <EmptyState
        title="Couldn't load this skill"
        description={error || 'The skill may have been deleted.'}
        action={{ label: 'Back to Skills', onClick: () => navigate('/skills') }}
      />
    );
  }

  const holdersPeople = people.filter((p) => (p.skillIds || []).includes(skill.id));
  const holdersAgents = agents.filter((a) => (a.skillIds || []).includes(skill.id));
  const requiringNodes: ProcessNode[] = [];
  collectRequiringNodes(tree, skill.id, requiringNodes);
  const cb = CATEGORY_BADGES[skill.category] || CATEGORY_BADGES.GOVERNANCE;

  return (
    <div>
      <PageHeader
        kicker="Skill"
        title={skill.name}
        copyId={skill.id}
        copyLabel="Copy skill ID"
        subtitle={<span>{formatCategory(skill.category)}</span>}
        actions={<Link to="/skills" style={backLinkStyle}>{'←'} Back to Skills</Link>}
      />

      {/* Identity */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={10}>Identity</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</div>
            <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: cb.bg, color: cb.color }}>{formatCategory(skill.category)}</span>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{skill.description || <span style={emptyStyle}>No description</span>}</div>
        </div>
      </Card>

      {/* People who hold this skill */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Held by people ({holdersPeople.length})</SectionLabel>
        {holdersPeople.length === 0 ? <div style={emptyStyle}>No people hold this skill</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {holdersPeople.map((p) => <Link key={p.id} to={`/people/${p.id}`} style={chipLinkStyle} title={p.title || undefined}>{p.name}</Link>)}
          </div>
        )}
      </Card>

      {/* Agents who hold this skill */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Held by agents ({holdersAgents.length})</SectionLabel>
        {holdersAgents.length === 0 ? <div style={emptyStyle}>No agents hold this skill</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {holdersAgents.map((a) => <Link key={a.id} to={`/agents/${a.id}`} style={chipLinkStyle}>{a.name}</Link>)}
          </div>
        )}
      </Card>

      {/* Activities that require this skill */}
      <Card>
        <SectionLabel marginBottom={8}>Required by activities ({requiringNodes.length})</SectionLabel>
        {requiringNodes.length === 0 ? <div style={emptyStyle}>No process activities require this skill</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {requiringNodes.map((n) => <span key={n.id} style={chipStyle}>{n.name}</span>)}
          </div>
        )}
      </Card>
    </div>
  );
}
