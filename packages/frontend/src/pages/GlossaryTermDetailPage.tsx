import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import EmptyState from '../components/EmptyState';
import EditableField from '../components/EditableField';
import DetailEditActions from '../components/DetailEditActions';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { useOrgContext } from '../stores/orgContext';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { errorMessage, errorToast, successToast } from '../lib/errorToast';

// ──────────────────────────────────────────────────────────────────────────
// GlossaryTermDetailPage — the full record for one business-glossary term at
// /business-glossary/:id. On the list, clicking a term used to open the edit
// form; now it opens this read view (edit stays on the row's pencil), matching
// the detail-page family (Person / Agent / Skill detail).
// ──────────────────────────────────────────────────────────────────────────

interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
  category: string;
  status: string;
  context: string;
  synonyms: string[];
  exampleValues: string;
  businessRules: string;
  sourceOfTruth: string;
  domainId: string | null;
  domainName: string | null;
  ownerAssignmentId: string | null;
  ownerName: string | null;
}
interface DomainRef { id: string; name: string }
interface PersonRef { id: string; name: string }

interface TermEditable {
  term: string;
  definition: string;
  category: string;
  status: string;
  context: string;
  synonyms: string;          // comma-separated in the draft; array on the record
  exampleValues: string;
  businessRules: string;
  sourceOfTruth: string;
  domainId: string;
  ownerAssignmentId: string;
}

const CATEGORIES = ['BUSINESS', 'TECHNICAL', 'REGULATORY', 'METRIC', 'GENERAL'];
const STATUSES = ['DRAFT', 'PROPOSED', 'APPROVED', 'DEPRECATED'];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  DRAFT:      { bg: '#f3f4f6', color: '#6b7280' },
  PROPOSED:   { bg: '#dbeafe', color: '#1e40af' },
  APPROVED:   { bg: '#d1fae5', color: '#065f46' },
  DEPRECATED: { bg: '#fee2e2', color: '#991b1b' },
};
const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  BUSINESS:   { bg: '#dbeafe', color: '#1e40af' },
  TECHNICAL:  { bg: '#ede9fe', color: '#5b21b6' },
  REGULATORY: { bg: '#fee2e2', color: '#991b1b' },
  METRIC:     { bg: '#fef3c7', color: '#92400e' },
  GENERAL:    { bg: '#f1f5f9', color: '#64748b' },
};
const badge = (c: { bg: string; color: string }): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
  background: c.bg, color: c.color, whiteSpace: 'nowrap',
});

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};
const chipStyle: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--color-text)',
};
const emptyStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

export default function GlossaryTermDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = usePermissions();
  const { activeOrgId } = useOrgContext();
  const [term, setTerm] = useState<GlossaryTerm | null>(null);
  const [domains, setDomains] = useState<DomainRef[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTerm = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [res, domRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GlossaryTerm }>(`/business-glossary/${id}`),
        apiClient.get<{ success: boolean; data: DomainRef[] }>(`/data-domains${query}`),
        apiClient.get<{ success: boolean; data: PersonRef[] }>('/people'),
      ]);
      setTerm(res.data);
      setDomains(domRes.data || []);
      setPeople(peopleRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load glossary term'));
    } finally {
      setLoading(false);
    }
  }, [id, activeOrgId]);

  useEffect(() => { fetchTerm(); }, [fetchTerm]);
  useBreadcrumbLeaf(term?.term);

  const m = useDetailEditMode<TermEditable>(
    {
      term: term?.term ?? '',
      definition: term?.definition ?? '',
      category: term?.category ?? 'GENERAL',
      status: term?.status ?? 'DRAFT',
      context: term?.context ?? '',
      synonyms: (term?.synonyms ?? []).join(', '),
      exampleValues: term?.exampleValues ?? '',
      businessRules: term?.businessRules ?? '',
      sourceOfTruth: term?.sourceOfTruth ?? '',
      domainId: term?.domainId ?? '',
      ownerAssignmentId: term?.ownerAssignmentId ?? '',
    },
    async (draft) => {
      if (!id) return;
      try {
        await apiClient.put(`/business-glossary/${id}`, {
          ...draft,
          synonyms: draft.synonyms.split(',').map((s) => s.trim()).filter(Boolean),
          domainId: draft.domainId || null,
          ownerAssignmentId: draft.ownerAssignmentId || null,
        });
        successToast('Glossary term updated');
        await fetchTerm();
      } catch (err) { errorToast(err, 'Failed to update term'); throw err; }
    },
  );

  if (loading) {
    return (
      <div>
        <PageHeader kicker="Glossary term" title="Loading…" actions={<Link to="/business-glossary" style={backLinkStyle}>{'←'} Back to Glossary</Link>} />
        <Card><SkeletonRows rows={3} columns={2} /></Card>
      </div>
    );
  }

  if (error || !term) {
    return (
      <EmptyState
        title="Couldn't load this term"
        description={error || 'The term may have been deleted.'}
        action={{ label: 'Back to Glossary', onClick: () => navigate('/business-glossary') }}
      />
    );
  }

  const t = term;
  const editing = m.isEditing;
  const extras: Array<[string, string]> = [
    ['Context', t.context],
    ['Example values', t.exampleValues],
    ['Business rules', t.businessRules],
    ['Source of truth', t.sourceOfTruth],
  ].filter(([, v]) => v && v.trim()) as Array<[string, string]>;
  const synInputStyle: React.CSSProperties = {
    fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4,
    padding: '5px 8px', width: '100%', background: 'var(--color-surface)',
    color: 'var(--color-text)', boxSizing: 'border-box',
  };
  const draftSynonyms = m.draft.synonyms.split(',').map((s) => s.trim()).filter(Boolean);

  return (
    <div>
      <PageHeader
        kicker="Glossary term"
        title={t.term}
        copyId={t.id}
        copyLabel="Copy term ID"
        subtitle={<span style={badge(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span>}
        actions={
          <DetailEditActions
            editing={editing}
            canEdit={canWrite}
            dirty={m.dirty}
            saving={m.saving}
            onEdit={m.enter}
            onCancel={m.cancel}
            onSave={m.save}
            before={<Link to="/business-glossary" style={backLinkStyle}>{'←'} Back to Glossary</Link>}
          />
        }
      />

      {/* Classification */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={10}>Classification</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {editing && (
            <EditableField label="Term" editing value={m.draft.term} onChange={(v) => m.set('term', v)} placeholder="Term" />
          )}
          <EditableField label="Category" editing={editing} value={m.draft.category} onChange={(v) => m.set('category', v)} type="select" options={CATEGORIES.map((c) => ({ value: c, label: c }))}>
            <span style={badge(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span>
          </EditableField>
          <EditableField label="Status" editing={editing} value={m.draft.status} onChange={(v) => m.set('status', v)} type="select" options={STATUSES.map((s) => ({ value: s, label: s }))}>
            <span style={badge(STATUS_COLORS[t.status] || STATUS_COLORS.DRAFT)}>{t.status}</span>
          </EditableField>
          <EditableField label="Primary domain" editing={editing} value={m.draft.domainId} onChange={(v) => m.set('domainId', v)} type="select" options={[{ value: '', label: 'None' }, ...domains.map((d) => ({ value: d.id, label: d.name }))]}>
            {t.domainName || <span style={emptyStyle}>None</span>}
          </EditableField>
          <EditableField label="Owner" editing={editing} value={m.draft.ownerAssignmentId} onChange={(v) => m.set('ownerAssignmentId', v)} type="select" options={[{ value: '', label: 'Unassigned' }, ...people.map((p) => ({ value: p.id, label: p.name }))]}>
            {t.ownerName || <span style={emptyStyle}>Unassigned</span>}
          </EditableField>
        </div>
      </Card>

      {/* Definition */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Definition</SectionLabel>
        {editing ? (
          <textarea
            aria-label="Definition"
            value={m.draft.definition}
            onChange={(e) => m.set('definition', e.target.value)}
            rows={4}
            placeholder="What this term means"
            style={{ ...synInputStyle, resize: 'vertical', font: 'inherit' }}
          />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
            {t.definition || <span style={emptyStyle}>No definition</span>}
          </div>
        )}
      </Card>

      {/* Synonyms */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Synonyms ({(editing ? draftSynonyms : (t.synonyms || [])).length})</SectionLabel>
        {editing ? (
          <input
            aria-label="Synonyms"
            value={m.draft.synonyms}
            onChange={(e) => m.set('synonyms', e.target.value)}
            placeholder="Comma-separated synonyms"
            style={synInputStyle}
          />
        ) : (t.synonyms || []).length === 0 ? <div style={emptyStyle}>No synonyms</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {t.synonyms.map((s) => <span key={s} style={chipStyle}>{s}</span>)}
          </div>
        )}
      </Card>

      {/* Additional detail */}
      <Card>
        <SectionLabel marginBottom={10}>Detail</SectionLabel>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <EditableField label="Context" editing type="textarea" value={m.draft.context} onChange={(v) => m.set('context', v)} placeholder="Where/how this term is used" />
            <EditableField label="Example values" editing type="textarea" value={m.draft.exampleValues} onChange={(v) => m.set('exampleValues', v)} />
            <EditableField label="Business rules" editing type="textarea" value={m.draft.businessRules} onChange={(v) => m.set('businessRules', v)} />
            <EditableField label="Source of truth" editing type="textarea" value={m.draft.sourceOfTruth} onChange={(v) => m.set('sourceOfTruth', v)} placeholder="System/owner of record" />
          </div>
        ) : extras.length === 0 ? <div style={emptyStyle}>No additional detail</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {extras.map(([label, value]) => (
              <Field key={label} label={label}>
                <span style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>{value}</span>
              </Field>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
