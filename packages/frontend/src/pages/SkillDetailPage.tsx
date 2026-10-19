import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import EmptyState from '../components/EmptyState';
import EditableField from '../components/EditableField';
import DetailEditActions from '../components/DetailEditActions';
import Avatar from '../components/Avatar';
import TruncatedText from '../components/TruncatedText';
import { renderNavIcon } from '../components/navIcons';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { useOrgContext } from '../stores/orgContext';
import { errorMessage, errorToast, successToast } from '../lib/errorToast';

// ──────────────────────────────────────────────────────────────────────────
// SkillDetailPage — the 360° record for one skill at /skills/:id. A skill's
// intrinsic record is just name + category + description, so the value is the
// usage it anchors: the people and agents who hold it and the process steps
// that require it. Laid out as the two-column master-detail (coverage strip +
// relationship sections + a Facts rail), matching the other detail pages.
// Data is assembled from the existing /people, /agents and /process-catalog
// responses — no new endpoint.
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

// Semantic-badge palette (hex stays paired with its bg, per the design guide).
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
const CATEGORIES = ['DATA_QUALITY', 'METADATA', 'ARCHITECTURE', 'SECURITY', 'INTEGRATION', 'ANALYTICS', 'GOVERNANCE', 'COMMUNICATION'];

interface SkillEditable { name: string; category: string; description: string }

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};
const emptyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' };
const linkStyle: React.CSSProperties = { color: 'var(--color-primary)', textDecoration: 'none' };

function categoryPill(category: string) {
  const c = CATEGORY_BADGES[category] || CATEGORY_BADGES.GOVERNANCE;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 10px', borderRadius: 11, fontSize: 12, fontWeight: 600, background: c.bg, color: c.color }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: c.color }} />
      {formatCategory(category)}
    </span>
  );
}

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
  const { canWrite } = usePermissions();
  const { orgs } = useOrgContext();
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

  const m = useDetailEditMode<SkillEditable>(
    { name: skill?.name ?? '', category: skill?.category ?? 'GOVERNANCE', description: skill?.description ?? '' },
    async (draft) => {
      if (!id) return;
      try {
        await apiClient.put(`/skills/${id}`, draft);
        successToast('Skill updated');
        await fetchAll();
      } catch (err) { errorToast(err, 'Failed to update skill'); throw err; }
    },
  );

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
  const definedInName = orgs.find((o) => o.id === skill.orgId)?.name;

  const coverage = [
    { label: 'People', count: holdersPeople.length },
    { label: 'Agents', count: holdersAgents.length },
    { label: 'Process steps needing it', count: requiringNodes.length },
  ];
  const sectionCardStyle: React.CSSProperties = { marginBottom: 16 };

  return (
    <div>
      <PageHeader
        kicker="Skill"
        title={skill.name}
        copyId={skill.id}
        copyLabel="Copy skill ID"
        subtitle={categoryPill(skill.category)}
        actions={
          <DetailEditActions
            editing={m.isEditing}
            canEdit={canWrite}
            dirty={m.dirty}
            saving={m.saving}
            onEdit={m.enter}
            onCancel={m.cancel}
            onSave={m.save}
            before={<Link to="/skills" style={backLinkStyle}>{'←'} Back to Skills</Link>}
          />
        }
      />

      {/* Coverage strip — who/what covers this skill at a glance. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 16 }}>
        {coverage.map((c) => (
          <Card key={c.label} padding="14px 16px">
            <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)' }}>{c.label}</span>
            <span style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
          </Card>
        ))}
      </div>

      {/* Two-column: relationships (main) + Facts rail (aside). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <main style={{ flex: '999 1 540px', minWidth: 0 }}>

          {/* About — editable description (+ name while editing). */}
          <Card style={sectionCardStyle}>
            <SectionLabel marginBottom={10}>About</SectionLabel>
            {m.isEditing && (
              <div style={{ marginBottom: 14 }}>
                <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="Skill name" />
              </div>
            )}
            <EditableField
              label="Description"
              editing={m.isEditing}
              type="textarea"
              value={m.draft.description}
              onChange={(v) => m.set('description', v)}
              placeholder="What this skill covers"
              emptyText="No description"
            >
              {skill.description ? <span style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{skill.description}</span> : undefined}
            </EditableField>
          </Card>

          {/* People with this skill */}
          <Card padding={0} style={sectionCardStyle}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <SectionLabel marginBottom={0}>People with this skill ({holdersPeople.length})</SectionLabel>
            </div>
            {holdersPeople.length === 0 ? (
              <div style={{ padding: 16, ...emptyStyle }}>No people hold this skill</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {holdersPeople.map((p) => (
                  <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                    <Avatar name={p.name} size="md" />
                    <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <Link to={`/people/${p.id}`} style={{ color: 'var(--color-text)', fontWeight: 600, textDecoration: 'none' }}>{p.name}</Link>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>
                        <TruncatedText text={p.title} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Agents with this skill */}
          <Card style={sectionCardStyle}>
            <SectionLabel marginBottom={8}>Agents with this skill ({holdersAgents.length})</SectionLabel>
            {holdersAgents.length === 0 ? (
              <div style={emptyStyle}>No agent is recorded as able to do this work yet.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {holdersAgents.map((a) => (
                  <li key={a.id}>
                    <Link to={`/agents/${a.id}`} style={{ ...linkStyle, fontWeight: 600 }}>{a.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Process steps that require it */}
          <Card style={sectionCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <SectionLabel marginBottom={0}>Process steps that need it ({requiringNodes.length})</SectionLabel>
              <Link to="/processes" style={{ ...linkStyle, fontSize: 13, fontWeight: 600 }}>Open Process Catalog</Link>
            </div>
            {requiringNodes.length === 0 ? (
              <div style={emptyStyle}>Mark a process step as requiring this skill to see whether enough people and agents can cover it.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {requiringNodes.map((n) => (
                  <li key={n.id} style={{ color: 'var(--color-text)' }}>{n.name}</li>
                ))}
              </ul>
            )}
          </Card>
        </main>

        {/* Facts rail — editable category + read-only context. */}
        <aside style={{ flex: '1 1 300px', minWidth: 0 }}>
          <Card>
            <SectionLabel marginBottom={12}>Facts</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <EditableField
                label="Category"
                editing={m.isEditing}
                value={m.draft.category}
                onChange={(v) => m.set('category', v)}
                type="select"
                options={CATEGORIES.map((c) => ({ value: c, label: formatCategory(c) }))}
              >
                {categoryPill(skill.category)}
              </EditableField>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>Defined in</div>
                <div>{definedInName || <span style={emptyStyle}>—</span>}</div>
              </div>
              <div style={{ paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>Related</div>
                <Link to="/processes" style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>{renderNavIcon('/processes', { size: 14 })} Process Catalog</Link>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
