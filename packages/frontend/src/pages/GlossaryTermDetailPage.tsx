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
  domainName: string | null;
  ownerName: string | null;
}

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
  const [term, setTerm] = useState<GlossaryTerm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTerm = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: GlossaryTerm }>(`/business-glossary/${id}`);
      setTerm(res.data);
    } catch (err) {
      setError(errorMessage(err, 'Could not load glossary term'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchTerm(); }, [fetchTerm]);
  useBreadcrumbLeaf(term?.term);

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
  const extras: Array<[string, string]> = [
    ['Context', t.context],
    ['Example values', t.exampleValues],
    ['Business rules', t.businessRules],
    ['Source of truth', t.sourceOfTruth],
  ].filter(([, v]) => v && v.trim()) as Array<[string, string]>;

  return (
    <div>
      <PageHeader
        kicker="Glossary term"
        title={t.term}
        copyId={t.id}
        copyLabel="Copy term ID"
        subtitle={<span style={badge(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span>}
        actions={<Link to="/business-glossary" style={backLinkStyle}>{'←'} Back to Glossary</Link>}
      />

      {/* Classification */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={10}>Classification</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <Field label="Category"><span style={badge(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span></Field>
          <Field label="Status"><span style={badge(STATUS_COLORS[t.status] || STATUS_COLORS.DRAFT)}>{t.status}</span></Field>
          <Field label="Primary domain">{t.domainName || <span style={emptyStyle}>None</span>}</Field>
          <Field label="Owner">{t.ownerName || <span style={emptyStyle}>Unassigned</span>}</Field>
        </div>
      </Card>

      {/* Definition */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Definition</SectionLabel>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
          {t.definition || <span style={emptyStyle}>No definition</span>}
        </div>
      </Card>

      {/* Synonyms */}
      <Card marginBottom={16}>
        <SectionLabel marginBottom={8}>Synonyms ({(t.synonyms || []).length})</SectionLabel>
        {(t.synonyms || []).length === 0 ? <div style={emptyStyle}>No synonyms</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {t.synonyms.map((s) => <span key={s} style={chipStyle}>{s}</span>)}
          </div>
        )}
      </Card>

      {/* Additional detail (only non-empty fields) */}
      {extras.length > 0 && (
        <Card>
          <SectionLabel marginBottom={10}>Detail</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {extras.map(([label, value]) => (
              <Field key={label} label={label}>
                <span style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>{value}</span>
              </Field>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
