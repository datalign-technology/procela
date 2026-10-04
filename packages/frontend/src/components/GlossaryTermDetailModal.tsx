import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import Modal from './Modal';
import EditableField from './EditableField';
import DetailEditActions from './DetailEditActions';
import SectionLabel from './SectionLabel';
import { useScrollLock } from '../hooks/useScrollLock';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { useOrgContext } from '../stores/orgContext';
import { errorToast, successToast } from '../lib/errorToast';

// ──────────────────────────────────────────────────────────────────────────
// GlossaryTermDetailModal — the detail view for one business-glossary term,
// opened on row-click from the Business Glossary list. Opens read-only and
// flips the SAME layout into editable inputs on Edit (view→Edit→Save), the
// Data Assets / Systems detail-modal pattern. Replaces the former
// /business-glossary/:id detail page.
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

interface Props {
  termId: string;
  onClose: () => void;
  canWrite?: boolean;
  /** Called after a successful save so the list behind can refresh. */
  onSaved?: () => void;
}

export default function GlossaryTermDetailModal({ termId, onClose, canWrite = false, onSaved }: Props) {
  useScrollLock(!!termId);
  const { activeOrgId } = useOrgContext();
  const [term, setTerm] = useState<GlossaryTerm | null>(null);
  const [domains, setDomains] = useState<DomainRef[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTerm = useCallback(async () => {
    setError(null);
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [res, domRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GlossaryTerm }>(`/business-glossary/${termId}`),
        apiClient.get<{ success: boolean; data: DomainRef[] }>(`/data-domains${query}`),
        apiClient.get<{ success: boolean; data: PersonRef[] }>('/people'),
      ]);
      setTerm(res.data);
      setDomains(domRes.data || []);
      setPeople(peopleRes.data || []);
    } catch {
      setError('Could not load glossary term');
    } finally {
      setLoading(false);
    }
  }, [termId, activeOrgId]);

  useEffect(() => { fetchTerm(); }, [fetchTerm]);

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
      try {
        await apiClient.put(`/business-glossary/${termId}`, {
          ...draft,
          synonyms: draft.synonyms.split(',').map((s) => s.trim()).filter(Boolean),
          domainId: draft.domainId || null,
          ownerAssignmentId: draft.ownerAssignmentId || null,
        });
        successToast('Glossary term updated');
        await fetchTerm();
        onSaved?.();
      } catch (err) { errorToast(err, 'Failed to update term'); throw err; }
    },
  );

  const t = term;
  const editing = m.isEditing;
  const synInputStyle: React.CSSProperties = {
    fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4,
    padding: '5px 8px', width: '100%', background: 'var(--color-surface)',
    color: 'var(--color-text)', boxSizing: 'border-box',
  };
  const draftSynonyms = m.draft.synonyms.split(',').map((s) => s.trim()).filter(Boolean);
  const extras: Array<[string, string]> = t
    ? ([
        ['Context', t.context],
        ['Example values', t.exampleValues],
        ['Business rules', t.businessRules],
        ['Source of truth', t.sourceOfTruth],
      ].filter(([, v]) => v && v.trim()) as Array<[string, string]>)
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      kicker="GLOSSARY TERM"
      title={t?.term || 'Loading…'}
      subtitle={t ? <span style={badge(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span> : undefined}
      ariaLabel={t ? `Glossary term: ${t.term}` : 'Glossary term'}
      actions={t ? (
        <DetailEditActions
          editing={editing}
          canEdit={canWrite}
          dirty={m.dirty}
          saving={m.saving}
          onEdit={m.enter}
          onCancel={m.cancel}
          onSave={m.save}
        />
      ) : undefined}
    >
      {loading && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>Loading…</div>
      )}
      {error && !loading && (
        <div style={{ fontSize: 13, color: '#b91c1c', padding: '12px 0' }}>{error}</div>
      )}
      {!loading && !error && t && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Classification */}
          <div>
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
          </div>

          {/* Definition */}
          <div>
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
          </div>

          {/* Synonyms */}
          <div>
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
          </div>

          {/* Additional detail */}
          <div>
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
          </div>
        </div>
      )}
    </Modal>
  );
}
