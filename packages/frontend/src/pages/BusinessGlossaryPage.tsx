import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';

// ── Types ──

interface GlossaryTerm {
  id: string;
  orgId: string;
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
  createdAt: string;
  updatedAt: string;
}

interface Person { id: string; name: string; }
interface Domain { id: string; name: string; }

interface TermForm {
  term: string;
  definition: string;
  category: string;
  status: string;
  context: string;
  synonyms: string;
  exampleValues: string;
  businessRules: string;
  sourceOfTruth: string;
  domainId: string;
  ownerAssignmentId: string;
}

const emptyForm: TermForm = {
  term: '', definition: '', category: 'GENERAL', status: 'DRAFT',
  context: '', synonyms: '', exampleValues: '', businessRules: '',
  sourceOfTruth: '', domainId: '', ownerAssignmentId: '',
};

const CATEGORIES = ['BUSINESS', 'TECHNICAL', 'REGULATORY', 'METRIC', 'GENERAL'] as const;
const STATUSES = ['DRAFT', 'PROPOSED', 'APPROVED', 'DEPRECATED'] as const;

// ── Styles ──

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
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 };

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  DRAFT:      { bg: '#f3f4f6', color: '#6b7280' },
  PROPOSED:   { bg: '#dbeafe', color: '#1e40af' },
  APPROVED:   { bg: '#d1fae5', color: '#065f46' },
  DEPRECATED: { bg: '#fee2e2', color: '#991b1b' },
};

const CATEGORY_ORDER = ['BUSINESS', 'TECHNICAL', 'REGULATORY', 'METRIC', 'GENERAL'];

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  BUSINESS:   { bg: '#dbeafe', color: '#1e40af' },
  TECHNICAL:  { bg: '#ede9fe', color: '#5b21b6' },
  REGULATORY: { bg: '#fee2e2', color: '#991b1b' },
  METRIC:     { bg: '#fef3c7', color: '#92400e' },
  GENERAL:    { bg: '#f1f5f9', color: '#64748b' },
};

function badgeStyle(colors: { bg: string; color: string }): React.CSSProperties {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.color, whiteSpace: 'nowrap',
  };
}

function statusDot(status: string): React.CSSProperties {
  const c = STATUS_COLORS[status] || STATUS_COLORS.DRAFT;
  return { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 };
}

// ── Component ──

export default function BusinessGlossaryPage() {
  const { activeOrgId, activeOrgName } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TermForm>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  // Generate
  const [generatedTerms, setGeneratedTerms] = useState<Array<{ term: string; definition: string; category: string; selected: boolean }>>([]);
  const [showGeneratePreview, setShowGeneratePreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [detectedIndustry, setDetectedIndustry] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [termsRes, pplRes, domRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GlossaryTerm[] }>(`/business-glossary${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: Domain[] }>(`/data-domains${query}`),
      ]);
      setTerms(termsRes.data || []);
      setPeople(pplRes.data || []);
      setDomains(domRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filtered & grouped terms ──
  const filteredTerms = useMemo(() => {
    let result = terms;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) =>
        t.term.toLowerCase().includes(q) ||
        t.definition.toLowerCase().includes(q) ||
        (t.synonyms || []).some((s) => s.toLowerCase().includes(q))
      );
    }
    if (filterStatus) result = result.filter((t) => t.status === filterStatus);
    if (filterCategory) result = result.filter((t) => t.category === filterCategory);
    return result.sort((a, b) => a.term.localeCompare(b.term));
  }, [terms, searchQuery, filterStatus, filterCategory]);

  const groupedTerms = useMemo(() => {
    const grouped: Record<string, GlossaryTerm[]> = {};
    for (const t of filteredTerms) {
      const cat = t.category || 'GENERAL';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    }
    return grouped;
  }, [filteredTerms]);

  const selectedTerm = selectedTermId ? terms.find((t) => t.id === selectedTermId) || null : null;

  // Auto-select first term when list changes and nothing is selected
  useEffect(() => {
    if (!selectedTermId && filteredTerms.length > 0) {
      setSelectedTermId(filteredTerms[0].id);
    } else if (selectedTermId && !filteredTerms.find((t) => t.id === selectedTermId) && filteredTerms.length > 0) {
      setSelectedTermId(filteredTerms[0].id);
    }
  }, [filteredTerms, selectedTermId]);

  // ── CRUD ──
  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm); setEditingId(null); setShowForm(true);
  };
  const openEdit = (t: GlossaryTerm) => {
    setForm({
      term: t.term, definition: t.definition, category: t.category, status: t.status,
      context: t.context || '', synonyms: (t.synonyms || []).join(', '),
      exampleValues: t.exampleValues || '', businessRules: t.businessRules || '',
      sourceOfTruth: t.sourceOfTruth || '', domainId: t.domainId || '',
      ownerAssignmentId: t.ownerAssignmentId || '',
    });
    setEditingId(t.id); setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const handleSave = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!form.term.trim() || !form.definition.trim()) return;
    try {
      const synonymsArray = form.synonyms.split(',').map((s) => s.trim()).filter(Boolean);
      const payload = {
        term: form.term, definition: form.definition, category: form.category,
        status: form.status, context: form.context || null,
        synonyms: synonymsArray, exampleValues: form.exampleValues || null,
        businessRules: form.businessRules || null, sourceOfTruth: form.sourceOfTruth || null,
        domainId: form.domainId || null, ownerAssignmentId: form.ownerAssignmentId || null,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      };
      if (editingId) {
        await apiClient.put(`/business-glossary/${editingId}`, payload);
        addToast('success', 'Term updated');
      } else {
        await apiClient.post('/business-glossary', payload);
        addToast('success', 'Term added');
      }
      closeForm(); fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Failed to save term');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/business-glossary/${id}`);
      addToast('success', 'Term deleted');
      if (selectedTermId === id) setSelectedTermId(null);
      fetchData();
    } catch (err: any) { addToast('error', err?.response?.data?.error || 'Failed to delete term'); }
  };

  const handleGenerate = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setGenerating(true);
    try {
      const res = await apiClient.post<{ success: boolean; terms: Array<{ term: string; definition: string; category: string }>; industry: string | null }>('/business-glossary/seed', { orgId: activeOrgId, preview: true });
      const t = (res.terms || []).map((x) => ({ ...x, selected: true }));
      if (t.length === 0) { addToast('info', 'All standard terms already exist.'); return; }
      setGeneratedTerms(t);
      setDetectedIndustry(res.industry || null);
      setShowGeneratePreview(true);
    } catch (err: any) { addToast('error', err?.response?.data?.error || 'Failed to generate terms'); }
    finally { setGenerating(false); }
  };

  const handleApplyGenerated = async () => {
    const selected = generatedTerms.filter((t) => t.selected).map((t) => t.term);
    if (selected.length === 0) { setShowGeneratePreview(false); return; }
    try {
      await apiClient.post('/business-glossary/seed', { orgId: activeOrgId, selectedTerms: selected });
      addToast('success', `Added ${selected.length} glossary term${selected.length !== 1 ? 's' : ''}`);
      setShowGeneratePreview(false); setGeneratedTerms([]); fetchData();
    } catch (err: any) { addToast('error', err?.response?.data?.error || 'Failed to create terms'); }
  };

  const handleExportHtml = () => {
    const orgName = activeOrgName || 'Organization';
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cats = CATEGORY_ORDER.filter((c) => groupedTerms[c]?.length > 0);
    const termsHtml = cats.map((cat) => {
      const catTerms = groupedTerms[cat].sort((a, b) => a.term.localeCompare(b.term));
      const rows = catTerms.map((t) => `<tr><td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:600;vertical-align:top;width:22%">${esc(t.term)}</td><td style="padding:10px 14px;border:1px solid #e5e7eb;vertical-align:top">${esc(t.definition)}${t.synonyms?.length ? `<br><span style="color:#6b7280;font-size:12px">Synonyms: ${t.synonyms.map(esc).join(', ')}</span>` : ''}</td><td style="padding:10px 14px;border:1px solid #e5e7eb;vertical-align:top;width:10%;text-align:center"><span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:600;background:${STATUS_COLORS[t.status]?.bg || '#f1f5f9'};color:${STATUS_COLORS[t.status]?.color || '#64748b'}">${esc(t.status)}</span></td></tr>`).join('');
      return `<h2 style="margin:28px 0 12px;font-size:18px;color:#1e40af;border-bottom:2px solid #dbeafe;padding-bottom:6px">${esc(cat.charAt(0) + cat.slice(1).toLowerCase())} Terms</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="background:#f8fafc"><th style="padding:10px 14px;border:1px solid #e5e7eb;text-align:left;font-size:12px;text-transform:uppercase;color:#64748b">Term</th><th style="padding:10px 14px;border:1px solid #e5e7eb;text-align:left;font-size:12px;text-transform:uppercase;color:#64748b">Definition</th><th style="padding:10px 14px;border:1px solid #e5e7eb;text-align:center;font-size:12px;text-transform:uppercase;color:#64748b">Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Business Glossary — ${esc(orgName)}</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:32px 24px;color:#1e293b}</style></head><body><h1 style="border-bottom:3px solid #1e40af;padding-bottom:12px">Business Glossary</h1><p style="color:#64748b">${esc(orgName)} · ${esc(now)} · ${filteredTerms.length} terms</p>${termsHtml}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `glossary-${orgName.toLowerCase().replace(/\s+/g, '-')}.html`; a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Glossary exported as HTML');
  };

  // ── Render ──

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Business Glossary</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Agreed-upon definitions for key business terms across the organization.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {terms.length > 0 && <IconButton icon="download" label="Export HTML" onClick={handleExportHtml} />}
          {canWrite && terms.length === 0 && (
            <IconButton icon="settings" label={generating ? 'Generating...' : 'Generate Industry Terms'} disabled={generating} onClick={handleGenerate} />
          )}
          {canWrite && <IconButton icon="plus" label="Add term" variant="primary" onClick={openAdd} />}
        </div>
      </div>

      <ConfirmDialog open={confirmDelete !== null} title="Delete Term?"
        message="This will permanently delete this glossary term." confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)} />

      {/* Add/Edit Form (overlay) */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingId ? 'Edit Term' : 'Add New Term'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Term *</label>
              <input autoFocus style={inputStyle} value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} placeholder="e.g. Customer Lifetime Value" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Definition *</label>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} placeholder="Plain-language definition..." />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select style={selectStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Context</label>
              <input style={inputStyle} value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} placeholder="Business context or usage notes..." />
            </div>
            <div>
              <label style={labelStyle}>Synonyms (comma-separated)</label>
              <input style={inputStyle} value={form.synonyms} onChange={(e) => setForm({ ...form, synonyms: e.target.value })} placeholder="e.g. CLV, LTV" />
            </div>
            <div>
              <label style={labelStyle}>Source of Truth</label>
              <input style={inputStyle} value={form.sourceOfTruth} onChange={(e) => setForm({ ...form, sourceOfTruth: e.target.value })} placeholder="e.g. Salesforce CRM" />
            </div>
            <div>
              <label style={labelStyle}>Domain</label>
              <select style={selectStyle} value={form.domainId} onChange={(e) => setForm({ ...form, domainId: e.target.value })}>
                <option value="">-- No Domain --</option>
                {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Owner</label>
              <select style={selectStyle} value={form.ownerAssignmentId} onChange={(e) => setForm({ ...form, ownerAssignmentId: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Business Rules</label>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.businessRules} onChange={(e) => setForm({ ...form, businessRules: e.target.value })} placeholder="Rules or constraints..." />
            </div>
            <div>
              <label style={labelStyle}>Example Values</label>
              <input style={inputStyle} value={form.exampleValues} onChange={(e) => setForm({ ...form, exampleValues: e.target.value })} placeholder="e.g. $12,500" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={closeForm}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: (!form.term.trim() || !form.definition.trim()) ? 0.6 : 1 }}
              disabled={!form.term.trim() || !form.definition.trim()} onClick={handleSave}>
              {editingId ? 'Save Changes' : 'Add Term'}
            </button>
          </div>
        </div>
      )}

      {/* Generate Preview */}
      {showGeneratePreview && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>Generate Industry Terms</h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {detectedIndustry ? `${generatedTerms.length} terms for ${detectedIndustry}.` : `${generatedTerms.length} standard terms available.`} Select which to add.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setGeneratedTerms((p) => p.map((t) => ({ ...t, selected: true })))} style={{ fontSize: 11, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}>All</button>
              <button onClick={() => setGeneratedTerms((p) => p.map((t) => ({ ...t, selected: false })))} style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>
            </div>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4 }}>
            {generatedTerms.map((t, i) => (
              <div key={t.term} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderBottom: i < generatedTerms.length - 1 ? '1px solid var(--color-border)' : 'none', background: t.selected ? '#f0f9ff' : 'transparent' }}>
                <input type="checkbox" checked={t.selected} onChange={() => setGeneratedTerms((p) => p.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))} style={{ marginTop: 3, cursor: 'pointer' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t.term}</span>
                    <span style={badgeStyle(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{t.definition}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button style={btnSecondary} onClick={() => { setShowGeneratePreview(false); setGeneratedTerms([]); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: generatedTerms.filter((t) => t.selected).length === 0 ? 0.6 : 1 }}
              disabled={generatedTerms.filter((t) => t.selected).length === 0} onClick={handleApplyGenerated}>
              Add {generatedTerms.filter((t) => t.selected).length} Terms
            </button>
          </div>
        </div>
      )}

      {/* Main content: dictionary two-column layout */}
      {loading ? (
        <SkeletonRows rows={5} columns={4} />
      ) : terms.length === 0 && !showForm ? (
        <EmptyState icon={'📖'} title="No glossary terms yet"
          description="The business glossary is a shared dictionary of agreed-upon terms. Define terms so everyone speaks the same language."
          action={canWrite ? { label: 'Add Term', onClick: openAdd } : undefined}
          secondaryAction={canWrite ? { label: 'Generate Industry Terms', onClick: handleGenerate, variant: 'secondary' } : undefined} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Left: Term index */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'sticky', top: 12, maxHeight: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
            {/* Search + filters */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
              <input
                style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', marginBottom: 8 }}
                placeholder="Search terms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <select style={{ ...selectStyle, fontSize: 11, padding: '3px 6px', flex: 1 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select style={{ ...selectStyle, fontSize: 11, padding: '3px 6px', flex: 1 }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                  <option value="">All Categories</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Term list grouped by category */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredTerms.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>No terms match your filters.</div>
              ) : (
                CATEGORY_ORDER.filter((cat) => groupedTerms[cat]?.length > 0).map((cat) => (
                  <div key={cat}>
                    <div style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: CATEGORY_COLORS[cat]?.color || '#64748b', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 1 }}>
                      {cat} ({groupedTerms[cat].length})
                    </div>
                    {groupedTerms[cat].map((t) => {
                      const isActive = selectedTermId === t.id;
                      return (
                        <div
                          key={t.id}
                          onClick={() => { setSelectedTermId(t.id); setShowForm(false); }}
                          style={{
                            padding: '8px 12px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: isActive ? '#dbeafe' : 'transparent',
                            borderBottom: '1px solid var(--color-border)',
                            borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg)'; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                        >
                          <span style={statusDot(t.status)} title={t.status} />
                          <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.term}</span>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer count */}
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-muted)', background: 'var(--color-bg)' }}>
              {filteredTerms.length} of {terms.length} terms
            </div>
          </div>

          {/* Right: Term detail */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', minHeight: 400 }}>
            {selectedTerm ? (
              <div style={{ padding: '24px 28px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{selectedTerm.term}</h2>
                      <span style={badgeStyle(STATUS_COLORS[selectedTerm.status] || STATUS_COLORS.DRAFT)}>{selectedTerm.status}</span>
                      <span style={badgeStyle(CATEGORY_COLORS[selectedTerm.category] || CATEGORY_COLORS.GENERAL)}>{selectedTerm.category}</span>
                    </div>
                    {selectedTerm.domainName && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Domain: {selectedTerm.domainName}</div>}
                    {selectedTerm.ownerName && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Owner: {selectedTerm.ownerName}</div>}
                  </div>
                  {canWrite && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(selectedTerm)} />
                      <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(selectedTerm.id)} />
                    </div>
                  )}
                </div>

                {/* Definition */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Definition</div>
                  <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-text)', margin: 0 }}>{selectedTerm.definition}</p>
                </div>

                {/* Synonyms */}
                {selectedTerm.synonyms && selectedTerm.synonyms.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Synonyms</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {selectedTerm.synonyms.map((syn, i) => (
                        <span key={i} style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500, background: '#f1f5f9', color: '#475569' }}>{syn}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Metadata grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                  {selectedTerm.context && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Context</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{selectedTerm.context}</div>
                    </div>
                  )}
                  {selectedTerm.sourceOfTruth && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Source of Truth</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{selectedTerm.sourceOfTruth}</div>
                    </div>
                  )}
                  {selectedTerm.exampleValues && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Example Values</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{selectedTerm.exampleValues}</div>
                    </div>
                  )}
                </div>

                {/* Business Rules */}
                {selectedTerm.businessRules && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Business Rules</div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, padding: 12, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                      {selectedTerm.businessRules}
                    </div>
                  </div>
                )}

                {/* Timestamps */}
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                  Created {new Date(selectedTerm.createdAt).toLocaleDateString()} · Updated {new Date(selectedTerm.updatedAt).toLocaleDateString()}
                </div>
              </div>
            ) : (
              <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Select a term from the list to view its definition and details.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
