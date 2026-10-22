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
import { relativeTime, absoluteTime } from '../lib/relativeTime';
import { SkeletonRows } from '../components/Skeleton';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { usePermissions } from '../hooks/usePermissions';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
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
  linkedAssetIds?: string[];
  linkedAssets?: AssetRef[];
  updatedAt?: string;
}
interface DomainRef { id: string; name: string }
interface TermRef { id: string; term: string; synonyms?: string[] }
interface PersonRef { id: string; name: string }
interface AssetRef { id: string; name: string }

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

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};

// Status as a rounded pill with a leading colour dot + title-case text.
function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.DRAFT;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: c.bg, color: c.color }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: c.color }} />{status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

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
  const { addToast } = useToastStore();
  const [term, setTerm] = useState<GlossaryTerm | null>(null);
  const [domains, setDomains] = useState<DomainRef[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [allTerms, setAllTerms] = useState<TermRef[]>([]);
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const fetchTerm = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [res, domRes, peopleRes, termsRes, assetsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GlossaryTerm }>(`/business-glossary/${id}`),
        apiClient.get<{ success: boolean; data: DomainRef[] }>(`/data-domains${query}`),
        apiClient.get<{ success: boolean; data: PersonRef[] }>('/people'),
        apiClient.get<{ success: boolean; data: TermRef[] }>(`/business-glossary${query}`),
        apiClient.get<{ success: boolean; data: AssetRef[] }>(`/data-assets${query}`),
      ]);
      setTerm(res.data);
      setDomains(domRes.data || []);
      setPeople(peopleRes.data || []);
      setAllTerms(termsRes.data || []);
      setAssets(assetsRes.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load glossary term'));
    } finally {
      setLoading(false);
    }
  }, [id, activeOrgId]);

  const handleDelete = async () => {
    if (!id) return;
    try {
      await apiClient.delete(`/business-glossary/${id}`);
      addToast('success', 'Term deleted');
      navigate('/business-glossary');
    } catch (err) { errorToast(err, 'Failed to delete term'); }
  };
  const setStatus = async (status: string) => {
    if (!id) return;
    try {
      await apiClient.put(`/business-glossary/${id}`, { status });
      addToast('success', `Status set to ${status.charAt(0) + status.slice(1).toLowerCase()}`);
      fetchTerm();
    } catch (err) { errorToast(err, 'Failed to update status'); }
  };
  // Link / unlink a data asset — persist the whole id set through the same PUT
  // the editor uses, then refresh so the resolved names come back.
  const saveLinkedAssets = async (ids: string[]) => {
    if (!id) return;
    try {
      await apiClient.put(`/business-glossary/${id}`, { linkedAssetIds: ids });
      await fetchTerm();
    } catch (err) { errorToast(err, 'Failed to update linked assets'); }
  };
  const linkAsset = (assetId: string) => {
    if (!term || !assetId) return;
    const cur = term.linkedAssetIds || [];
    if (cur.includes(assetId)) return;
    saveLinkedAssets([...cur, assetId]);
  };
  const unlinkAsset = (assetId: string) => {
    if (!term) return;
    saveLinkedAssets((term.linkedAssetIds || []).filter((x) => x !== assetId));
  };

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
  // "Related terms" — a lightweight suggestion from terms that share a
  // meaningful word with this one (there's no explicit relationship in the
  // model yet). Advisory only, hence the "confirm in Edit" note on the rail.
  const nameWords = new Set(t.term.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const relatedTerms = nameWords.size === 0 ? [] : allTerms
    .filter((o) => o.id !== t.id && o.term.toLowerCase().split(/\s+/).some((w) => nameWords.has(w)))
    .slice(0, 3);
  // Linked data assets (resolved names come back from the detail endpoint);
  // the picker offers assets not already linked.
  const linkedAssets = t.linkedAssets || [];
  const linkedAssetIdSet = new Set(t.linkedAssetIds || []);
  const unlinkedAssets = assets.filter((a) => !linkedAssetIdSet.has(a.id));

  return (
    <div>
      <PageHeader
        kicker={`Glossary term · ${t.category.charAt(0) + t.category.slice(1).toLowerCase()}`}
        title={t.term}
        copyId={t.id}
        copyLabel="Copy term ID"
        meta={<StatusPill status={t.status} />}
        actions={
          <>
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
            {!editing && canWrite && (
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }} style={{ width: 40, height: 40, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
                {menuOpen && (
                  <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 44, right: 0, zIndex: 30, minWidth: 180, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                    {t.status !== 'DEPRECATED' && (
                      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setStatus('DEPRECATED'); }} style={menuItemStyle}>Deprecate</button>
                    )}
                    <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 2px' }} />
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); handleDelete(); }} style={{ ...menuItemStyle, color: 'var(--color-error)' }}>Delete</button>
                  </div>
                )}
              </span>
            )}
          </>
        }
      />

      {editing ? (
        <>
          {/* Classification */}
          <Card marginBottom={16}>
            <SectionLabel marginBottom={10}>Classification</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <EditableField label="Term" editing value={m.draft.term} onChange={(v) => m.set('term', v)} placeholder="Term" />
              <EditableField label="Category" editing value={m.draft.category} onChange={(v) => m.set('category', v)} type="select" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
              <EditableField label="Status" editing value={m.draft.status} onChange={(v) => m.set('status', v)} type="select" options={STATUSES.map((s) => ({ value: s, label: s }))} />
              <EditableField label="Primary domain" editing value={m.draft.domainId} onChange={(v) => m.set('domainId', v)} type="select" options={[{ value: '', label: 'None' }, ...domains.map((d) => ({ value: d.id, label: d.name }))]} />
              <EditableField label="Owner" editing value={m.draft.ownerAssignmentId} onChange={(v) => m.set('ownerAssignmentId', v)} type="select" options={[{ value: '', label: 'Unassigned' }, ...people.map((p) => ({ value: p.id, label: p.name }))]} />
            </div>
          </Card>

          {/* Definition */}
          <Card marginBottom={16}>
            <SectionLabel marginBottom={8}>Definition</SectionLabel>
            <textarea
              aria-label="Definition"
              value={m.draft.definition}
              onChange={(e) => m.set('definition', e.target.value)}
              rows={4}
              placeholder="What this term means"
              style={{ ...synInputStyle, resize: 'vertical', font: 'inherit' }}
            />
          </Card>

          {/* Synonyms */}
          <Card marginBottom={16}>
            <SectionLabel marginBottom={8}>Synonyms ({draftSynonyms.length})</SectionLabel>
            <input
              aria-label="Synonyms"
              value={m.draft.synonyms}
              onChange={(e) => m.set('synonyms', e.target.value)}
              placeholder="Comma-separated synonyms"
              style={synInputStyle}
            />
          </Card>

          {/* Additional detail */}
          <Card>
            <SectionLabel marginBottom={10}>Detail</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <EditableField label="Context" editing type="textarea" value={m.draft.context} onChange={(v) => m.set('context', v)} placeholder="Where/how this term is used" />
              <EditableField label="Example values" editing type="textarea" value={m.draft.exampleValues} onChange={(v) => m.set('exampleValues', v)} />
              <EditableField label="Business rules" editing type="textarea" value={m.draft.businessRules} onChange={(v) => m.set('businessRules', v)} />
              <EditableField label="Source of truth" editing type="textarea" value={m.draft.sourceOfTruth} onChange={(v) => m.set('sourceOfTruth', v)} placeholder="System/owner of record" />
            </div>
          </Card>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* ── Main: the term as a reader meets it ───────────────────────── */}
          <div style={{ flex: '999 1 520px', minWidth: 0 }}>
            {/* Definition leads, large; synonyms read inline as "Also called" */}
            <Card padding={24} marginBottom={16}>
              <SectionLabel marginBottom={8}>Definition</SectionLabel>
              {t.definition
                ? <p style={{ fontSize: 19, lineHeight: 1.45, color: 'var(--color-text)', margin: 0, maxWidth: 760 }}>{t.definition}</p>
                : <div style={emptyStyle}>No definition yet — add one in Edit.</div>}
              {(t.synonyms || []).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Also called</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {t.synonyms.map((s) => <span key={s} style={chipStyle}>{s}</span>)}
                  </div>
                </div>
              )}
            </Card>

            {/* The four detail fields collapse into one "How to use it" list */}
            {extras.length > 0 && (
              <Card padding={24} marginBottom={16}>
                <SectionLabel marginBottom={12}>How to use it</SectionLabel>
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(140px, 180px) 1fr', columnGap: 20 }}>
                  {extras.map(([label, value], i) => (
                    <div key={label} style={{ display: 'contents' }}>
                      <dt style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}>{label}</dt>
                      <dd style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}

            {/* Linked data assets (board D8) — the catalog assets this term
                defines or applies to. Link/unlink persists via the same PUT. */}
            <Card padding={24}>
              <SectionLabel marginBottom={linkedAssets.length ? 12 : 8}>Linked data assets ({linkedAssets.length})</SectionLabel>
              {linkedAssets.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {linkedAssets.map((a) => (
                    <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', borderRadius: 999, fontSize: 13, fontWeight: 500, background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                      <Link to={`/data-assets/${a.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{a.name}</Link>
                      {canWrite && <button type="button" aria-label={`Unlink ${a.name}`} onClick={() => unlinkAsset(a.id)} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'inherit', padding: '0 2px', fontSize: 15, lineHeight: 1 }}>&times;</button>}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={emptyStyle}>No data assets linked yet.{canWrite ? ' Link the assets this term defines or applies to.' : ''}</div>
              )}
              {canWrite && unlinkedAssets.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <select
                    aria-label="Link to assets"
                    value=""
                    onChange={(e) => { if (e.target.value) linkAsset(e.target.value); }}
                    style={{ fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 10px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
                    <option value="">+ Link to assets…</option>
                    {unlinkedAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
            </Card>
          </div>

          {/* ── Facts rail ─────────────────────────────────────────────────── */}
          <aside style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card>
              <SectionLabel marginBottom={12}>Facts</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Owner">
                  {t.ownerName
                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={t.ownerName} size="sm" />{t.ownerName}</span>
                    : <span style={emptyStyle}>Unassigned</span>}
                </Field>
                <Field label="Category">
                  <span style={badge(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span>
                </Field>
                <Field label="Status"><StatusPill status={t.status} /></Field>
                <Field label="Primary domain">
                  {t.domainId
                    ? <Link to={`/data-domains?highlight=${t.domainId}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{t.domainName}</Link>
                    : <span style={emptyStyle}>Enterprise-wide</span>}
                </Field>
                {t.updatedAt && (
                  <Field label="Updated"><span title={absoluteTime(t.updatedAt)}>{relativeTime(t.updatedAt)}</span></Field>
                )}
              </div>
            </Card>

            {relatedTerms.length > 0 && (
              <Card>
                <SectionLabel marginBottom={10}>Related terms</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {relatedTerms.map((r) => (
                    <Link key={r.id} to={`/business-glossary/${r.id}`} style={{ fontSize: 13, color: 'var(--color-primary)', textDecoration: 'none' }}>{r.term}</Link>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10, fontStyle: 'italic' }}>Suggested from shared words; confirm in Edit.</div>
              </Card>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
