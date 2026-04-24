import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import PageTabNav, { CATALOG_TABS } from '../components/PageTabNav';

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

interface GlossarySummary {
  total: number;
  approved: number;
  draft: number;
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
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

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

const termCardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '16px 20px',
  marginBottom: 8,
};

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

function badgeStyle(colors: { bg: string; color: string }): React.CSSProperties {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.color, whiteSpace: 'nowrap',
  };
}

const pillStyle: React.CSSProperties = {
  display: 'inline-block', padding: '1px 8px', borderRadius: 12,
  fontSize: 11, fontWeight: 500, background: '#f1f5f9', color: '#475569',
  marginRight: 4, marginBottom: 2,
};

// ── Component ──

export default function BusinessGlossaryPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [summary, setSummary] = useState<GlossarySummary>({ total: 0, approved: 0, draft: 0 });
  const [people, setPeople] = useState<Person[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TermForm>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDomain, setFilterDomain] = useState('');
  const [activeLetter, setActiveLetter] = useState('');
  const [groupByCategory, setGroupByCategory] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [termsRes, summaryRes, pplRes, domRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GlossaryTerm[] }>(`/business-glossary${query}`),
        apiClient.get<{ success: boolean; data: GlossarySummary }>(`/business-glossary/summary${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: Domain[] }>(`/data-domains${query}`),
      ]);
      setTerms(termsRes.data || []);
      setSummary(summaryRes.data || { total: 0, approved: 0, draft: 0 });
      setPeople(pplRes.data || []);
      setDomains(domRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Letters with terms ──
  const lettersWithTerms = useMemo(() => {
    const set = new Set<string>();
    terms.forEach((t) => {
      const first = t.term.charAt(0).toUpperCase();
      if (/[A-Z]/.test(first)) set.add(first);
    });
    return set;
  }, [terms]);

  // ── Filtered terms ──
  const filteredTerms = useMemo(() => {
    let result = terms;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) =>
        t.term.toLowerCase().includes(q) ||
        t.definition.toLowerCase().includes(q) ||
        (t.synonyms || []).some((s) => s.toLowerCase().includes(q)) ||
        (t.context || '').toLowerCase().includes(q)
      );
    }
    if (filterStatus) result = result.filter((t) => t.status === filterStatus);
    if (filterCategory) result = result.filter((t) => t.category === filterCategory);
    if (filterDomain) result = result.filter((t) => t.domainId === filterDomain);
    if (activeLetter) result = result.filter((t) => t.term.charAt(0).toUpperCase() === activeLetter);
    return result.sort((a, b) => a.term.localeCompare(b.term));
  }, [terms, searchQuery, filterStatus, filterCategory, filterDomain, activeLetter]);

  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    if (selectedIds.size === terms.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(terms.map((i) => i.id)));
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => apiClient.delete(`/business-glossary/${id}`)));
    addToast('success', `Deleted ${ids.length} term${ids.length === 1 ? '' : 's'}`);
    setSelectedIds(new Set());
    fetchData();
  };

  // ── CRUD ──

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; } setForm(emptyForm); setEditingId(null); setShowForm(true); };
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
      const synonymsArray = form.synonyms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
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
        addToast('success', 'Term created');
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
      if (expandedId === id) setExpandedId(null);
      fetchData();
    } catch (err: any) { addToast('error', err?.response?.data?.error || 'Failed to delete term'); }
  };

  const [generatedTerms, setGeneratedTerms] = useState<Array<{ term: string; definition: string; category: string; selected: boolean }>>([]);
  const [showGeneratePreview, setShowGeneratePreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [detectedIndustry, setDetectedIndustry] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setGenerating(true);
    try {
      const res = await apiClient.post<{ success: boolean; terms: Array<{ term: string; definition: string; category: string }>; industry: string | null }>('/business-glossary/seed', { orgId: activeOrgId, preview: true });
      const terms = (res.terms || []).map((t) => ({ ...t, selected: true }));
      if (terms.length === 0) {
        addToast('info', 'All standard terms already exist. Nothing to add.');
        return;
      }
      setGeneratedTerms(terms);
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
      addToast('success', `Created ${selected.length} glossary term${selected.length !== 1 ? 's' : ''}`);
      setShowGeneratePreview(false);
      setGeneratedTerms([]);
      fetchData();
    } catch (err: any) { addToast('error', err?.response?.data?.error || 'Failed to create terms'); }
  };

  return (
    <div>
      <PageTabNav tabs={CATALOG_TABS} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Business Glossary</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Agreed-upon definitions for key business terms across the organization.
          </p>
        </div>
        {canWrite && <IconButton icon="settings" label={generating ? 'Generating...' : 'Generate Industry Terms'} disabled={generating} onClick={handleGenerate} />}
        {canWrite && <IconButton icon="plus" label="Add term" variant="primary" onClick={openAdd} />}
      </div>

      {/* Inline stats */}
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        {summary.total} terms &middot; {summary.approved} approved &middot; {summary.draft} draft
      </div>

      <ConfirmDialog open={confirmDelete !== null} title="Delete Term?"
        message="This will permanently delete this glossary term." confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)} />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selectedIds.size} term${selectedIds.size === 1 ? '' : 's'}?`}
        message="This cannot be undone."
        confirmLabel={`Delete ${selectedIds.size}`}
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Search bar */}
      <div style={{ marginBottom: 12 }}>
        <input
          style={{ ...inputStyle, fontSize: 15, padding: '10px 14px' }}
          placeholder="Search terms, definitions, synonyms..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <select style={{ ...selectStyle, width: 'auto', minWidth: 130 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={{ ...selectStyle, width: 'auto', minWidth: 130 }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={{ ...selectStyle, width: 'auto', minWidth: 130 }} value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)}>
          <option value="">All Domains</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* Select all + Bulk action bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={terms.length > 0 && selectedIds.size === terms.length} onChange={toggleSelectAll} />
          Select all ({terms.length})
        </label>
      </div>
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedIds.size} selected</span>
          <button onClick={() => setConfirmBulkDelete(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            Delete Selected
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            Clear Selection
          </button>
        </div>
      )}

      {/* Alphabetical index */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          style={{
            padding: '4px 8px', fontSize: 12, fontWeight: activeLetter === '' ? 700 : 500,
            border: 'none', borderRadius: 4, cursor: 'pointer',
            background: activeLetter === '' ? 'var(--color-primary)' : 'transparent',
            color: activeLetter === '' ? '#fff' : 'var(--color-text-muted)',
          }}
          onClick={() => setActiveLetter('')}
        >
          All
        </button>
        {ALPHABET.map((letter) => {
          const hasTerm = lettersWithTerms.has(letter);
          const isActive = activeLetter === letter;
          return (
            <button
              key={letter}
              style={{
                padding: '4px 8px', fontSize: 12, fontWeight: isActive ? 700 : hasTerm ? 600 : 400,
                border: 'none', borderRadius: 4, cursor: hasTerm ? 'pointer' : 'default',
                background: isActive ? 'var(--color-primary)' : 'transparent',
                color: isActive ? '#fff' : hasTerm ? 'var(--color-text)' : 'var(--color-text-muted)',
                opacity: hasTerm || isActive ? 1 : 0.4,
              }}
              onClick={() => { if (hasTerm) setActiveLetter(isActive ? '' : letter); }}
            >
              {letter}
            </button>
          );
        })}
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setGroupByCategory(true)}
          style={{
            padding: '4px 12px', fontSize: 11, fontWeight: groupByCategory ? 600 : 500,
            background: groupByCategory ? 'var(--color-primary)' : 'var(--color-surface)',
            color: groupByCategory ? '#fff' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer',
          }}
        >
          Group by Category
        </button>
        <button
          onClick={() => setGroupByCategory(false)}
          style={{
            padding: '4px 12px', fontSize: 11, fontWeight: !groupByCategory ? 600 : 500,
            background: !groupByCategory ? 'var(--color-primary)' : 'var(--color-surface)',
            color: !groupByCategory ? '#fff' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer',
          }}
        >
          Alphabetical
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingId ? 'Edit Term' : 'Add New Term'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Term *</label>
              <input autoFocus style={inputStyle} value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} placeholder="e.g. Customer Lifetime Value" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Definition *</label>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} placeholder="Plain-language definition..." />
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
              <textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }} value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} placeholder="Business context or usage notes..." />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Synonyms (comma-separated)</label>
              <input style={inputStyle} value={form.synonyms} onChange={(e) => setForm({ ...form, synonyms: e.target.value })} placeholder="e.g. CLV, LTV, Lifetime Revenue" />
            </div>
            <div>
              <label style={labelStyle}>Example Values</label>
              <input style={inputStyle} value={form.exampleValues} onChange={(e) => setForm({ ...form, exampleValues: e.target.value })} placeholder="e.g. $12,500" />
            </div>
            <div>
              <label style={labelStyle}>Source of Truth</label>
              <input style={inputStyle} value={form.sourceOfTruth} onChange={(e) => setForm({ ...form, sourceOfTruth: e.target.value })} placeholder="e.g. Salesforce CRM" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Business Rules</label>
              <textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }} value={form.businessRules} onChange={(e) => setForm({ ...form, businessRules: e.target.value })} placeholder="Rules or constraints governing this term..." />
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
                {detectedIndustry
                  ? `${generatedTerms.length} terms available for ${detectedIndustry}. Select which to add.`
                  : `${generatedTerms.length} standard governance terms available.`}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setGeneratedTerms((prev) => prev.map((t) => ({ ...t, selected: true })))} style={{ fontSize: 11, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}>Select All</button>
              <button onClick={() => setGeneratedTerms((prev) => prev.map((t) => ({ ...t, selected: false })))} style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Deselect All</button>
            </div>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4 }}>
            {generatedTerms.map((t, i) => (
              <div key={t.term} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                borderBottom: i < generatedTerms.length - 1 ? '1px solid var(--color-border)' : 'none',
                background: t.selected ? '#f0f9ff' : 'transparent',
              }}>
                <input type="checkbox" checked={t.selected} onChange={() => setGeneratedTerms((prev) => prev.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))} style={{ marginTop: 3, cursor: 'pointer' }} />
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {generatedTerms.filter((t) => t.selected).length} of {generatedTerms.length} selected
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnSecondary} onClick={() => { setShowGeneratePreview(false); setGeneratedTerms([]); }}>Cancel</button>
              <button
                style={{ ...btnPrimary, opacity: generatedTerms.filter((t) => t.selected).length === 0 ? 0.6 : 1 }}
                disabled={generatedTerms.filter((t) => t.selected).length === 0}
                onClick={handleApplyGenerated}
              >
                Add {generatedTerms.filter((t) => t.selected).length} Term{generatedTerms.filter((t) => t.selected).length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Terms list */}
      {loading ? (
        <SkeletonRows rows={5} columns={4} />
      ) : terms.length === 0 && !showForm ? (
        <EmptyState icon={'📖'} title="No glossary terms yet"
          description="The business glossary is a shared dictionary of agreed-upon terms. Define terms so everyone speaks the same language."
          action={canWrite ? { label: '+ Add Term', onClick: openAdd } : undefined}
          secondaryAction={canWrite ? { label: 'Generate Industry Terms', onClick: handleGenerate, variant: 'secondary' } : undefined} />
      ) : (
        <>
          {filteredTerms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)', fontSize: 13 }}>
              No terms match your current filters.
            </div>
          ) : groupByCategory ? (
            (() => {
              const CATEGORY_ORDER = ['BUSINESS', 'TECHNICAL', 'REGULATORY', 'METRIC', 'GENERAL'];
              const CATEGORY_DESCRIPTIONS: Record<string, string> = {
                BUSINESS: 'Core business concepts and entities used across the organization.',
                TECHNICAL: 'Technical terms, systems, and infrastructure concepts.',
                REGULATORY: 'Compliance, privacy, and regulatory terms.',
                METRIC: 'Key performance indicators and measurements.',
                GENERAL: 'General governance and data management terms.',
              };
              const grouped: Record<string, GlossaryTerm[]> = {};
              for (const t of filteredTerms) {
                const cat = t.category || 'GENERAL';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(t);
              }
              return CATEGORY_ORDER.filter((cat) => grouped[cat]?.length > 0).map((cat) => (
                <div key={cat} style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={badgeStyle(CATEGORY_COLORS[cat] || CATEGORY_COLORS.GENERAL)}>{cat}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {CATEGORY_DESCRIPTIONS[cat] || ''} ({grouped[cat].length} term{grouped[cat].length !== 1 ? 's' : ''})
                    </span>
                  </div>
                  {grouped[cat].map((t) => {
                    const isExpanded = expandedId === t.id;
                    return (
                      <div key={t.id} style={{ ...termCardStyle, position: 'relative' }}>
                        <div style={{ position: 'absolute', top: 12, left: 12 }}>
                          <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginLeft: 28 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t.term}</span>
                              <span style={badgeStyle(STATUS_COLORS[t.status] || STATUS_COLORS.DRAFT)}>{t.status}</span>
                            </div>
                            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55, margin: 0, marginBottom: 8 }}>{t.definition}</p>
                            {t.synonyms && t.synonyms.length > 0 && (
                              <div style={{ marginBottom: 6 }}>{t.synonyms.map((syn, i) => <span key={i} style={pillStyle}>{syn}</span>)}</div>
                            )}
                            {(t.context || t.businessRules || t.sourceOfTruth) && (
                              <button style={{ fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 4 }}
                                onClick={() => setExpandedId(isExpanded ? null : t.id)}>
                                {isExpanded ? 'Hide details' : 'Show details'}
                              </button>
                            )}
                            {isExpanded && (
                              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                                {t.context && <div style={{ marginBottom: 6 }}><span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Context: </span>{t.context}</div>}
                                {t.businessRules && <div style={{ marginBottom: 6 }}><span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Business Rules: </span>{t.businessRules}</div>}
                                {t.exampleValues && <div style={{ marginBottom: 6 }}><span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Examples: </span>{t.exampleValues}</div>}
                                {t.sourceOfTruth && <div><span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Source of Truth: </span>{t.sourceOfTruth}</div>}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0, marginLeft: 16 }}>
                            {t.domainName && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t.domainName}</span>}
                            {t.ownerName && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t.ownerName}</span>}
                            <div style={{ display: 'flex', gap: 4 }}>
                              {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(t)} />}
                              {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(t.id)} />}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ));
            })()
          ) : (
            filteredTerms.map((t) => {
              const isExpanded = expandedId === t.id;
              return (
                <div key={t.id} style={{ ...termCardStyle, position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 12, left: 12 }}>
                    <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginLeft: 28 }}>
                    {/* Left side */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t.term}</span>
                        <span style={badgeStyle(STATUS_COLORS[t.status] || STATUS_COLORS.DRAFT)}>{t.status}</span>
                        <span style={badgeStyle(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55, margin: 0, marginBottom: 8 }}>
                        {t.definition}
                      </p>
                      {t.synonyms && t.synonyms.length > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          {t.synonyms.map((syn, i) => (
                            <span key={i} style={pillStyle}>{syn}</span>
                          ))}
                        </div>
                      )}

                      {/* Expandable details */}
                      {(t.context || t.businessRules || t.sourceOfTruth) && (
                        <button
                          style={{ fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 4 }}
                          onClick={() => setExpandedId(isExpanded ? null : t.id)}
                        >
                          {isExpanded ? 'Hide details' : 'Show details'}
                        </button>
                      )}
                      {isExpanded && (
                        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                          {t.context && (
                            <div style={{ marginBottom: 6 }}>
                              <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Context: </span>{t.context}
                            </div>
                          )}
                          {t.businessRules && (
                            <div style={{ marginBottom: 6 }}>
                              <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Business Rules: </span>{t.businessRules}
                            </div>
                          )}
                          {t.sourceOfTruth && (
                            <div style={{ marginBottom: 6 }}>
                              <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>Source of Truth: </span>{t.sourceOfTruth}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right side */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginLeft: 20, flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'right' }}>
                        {t.domainName && <div>{t.domainName}</div>}
                        {t.ownerName && <div>{t.ownerName}</div>}
                        {!t.domainName && !t.ownerName && <div style={{ fontStyle: 'italic' }}>Unassigned</div>}
                      </div>
                      {canWrite && (
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(t)} />
                          <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(t.id)} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
