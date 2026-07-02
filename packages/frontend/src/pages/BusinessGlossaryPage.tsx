import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '../api/client';
import { thStyle, tdStyle } from '../lib/tableStyles';
import PageHeader from '../components/PageHeader';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import SortableTh from '../components/SortableTh';
import { SkeletonRows } from '../components/Skeleton';
import { useSortedList } from '../hooks/useSortedList';
// Lazy: only renders when the user opens the connection picker.
const SyncConnectionWizard = lazy(() => import('../components/SyncConnectionWizard'));
import { formatPersonLabel } from '../lib/personLabel';
import { useRefreshOnFocus } from '../hooks/usePolling';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';
import SavedViewsMenu from '../components/SavedViewsMenu';

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
const CATEGORY_ORDER = ['BUSINESS', 'TECHNICAL', 'REGULATORY', 'METRIC', 'GENERAL'];

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

// ── Inline cell edit ──
//
// Mirrors the Systems page pattern: click the cell to edit, blur or Enter
// commits, Escape cancels. Used for the Term, Category, and Status columns.
function InlineCellEdit({
  value, display, onSave, type = 'text', options,
}: {
  value: string;
  display?: React.ReactNode;
  onSave: (v: string) => void;
  type?: 'text' | 'select';
  options?: readonly string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true); }}
        style={{ cursor: 'pointer', borderBottom: '1px dashed var(--color-border)' }}
        title="Click to edit"
      >
        {display ?? (value || '—')}
      </span>
    );
  }

  if (type === 'select' && options) {
    return (
      <select
        autoFocus
        value={draft}
        onChange={(e) => { onSave(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
        onClick={(e) => e.stopPropagation()}
        style={{ fontSize: 'inherit', padding: '2px 4px', border: '1px solid var(--color-primary)', borderRadius: 3 }}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input
      autoFocus
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); setEditing(false); }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { if (draft !== value) onSave(draft); setEditing(false); }
        if (e.key === 'Escape') setEditing(false);
      }}
      style={{ fontSize: 'inherit', padding: '2px 4px', width: '100%', border: '1px solid var(--color-primary)', borderRadius: 3 }}
    />
  );
}

// ── Component ──

type GlossaryColId = 'term' | 'category' | 'status' | 'domain' | 'owner' | 'definition';
const GLOSSARY_COLUMN_DEFS: Array<{ id: GlossaryColId; label: string; defaultVisible: boolean }> = [
  { id: 'term',       label: 'Term',           defaultVisible: true  },
  { id: 'category',   label: 'Category',       defaultVisible: true  },
  { id: 'status',     label: 'Status',         defaultVisible: true  },
  { id: 'domain',     label: 'Primary Domain', defaultVisible: true  },
  { id: 'owner',      label: 'Owner',          defaultVisible: true  },
  { id: 'definition', label: 'Definition',     defaultVisible: true  },
];

export default function BusinessGlossaryPage() {
  const { activeOrgId, activeOrgName } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  const glossaryCols = useColumnPicker<GlossaryColId>('procela.businessGlossary.visibleCols.v1', GLOSSARY_COLUMN_DEFS);
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TermForm>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Bulk selection
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdates, setBulkUpdates] = useState<{ status: string; category: string; ownerPersonId: string; domainId: string }>({ status: '', category: '', ownerPersonId: '', domainId: '' });
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [applyingBulk, setApplyingBulk] = useState(false);
  const toggleBulkSelect = (id: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearBulkSelection = () => {
    setBulkSelectedIds(new Set());
    setBulkUpdates({ status: '', category: '', ownerPersonId: '', domainId: '' });
  };

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  // Generate
  const [generatedTerms, setGeneratedTerms] = useState<Array<{ term: string; definition: string; category: string; selected: boolean }>>([]);
  const [showGeneratePreview, setShowGeneratePreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [detectedIndustry, setDetectedIndustry] = useState<string | null>(null);

  // Import + Connect-to-Source
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [showSync, setShowSync] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    if (!importText.trim()) return;
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    try {
      const body: { orgId: string; csv?: string; terms?: unknown[] } = { orgId: activeOrgId };
      if (importFormat === 'csv') body.csv = importText;
      else body.terms = JSON.parse(importText);
      const res = await apiClient.post<{ success: boolean; data: GlossaryTerm[]; skipped?: number; message?: string }>('/business-glossary/import', body);
      addToast(res.skipped && res.skipped > 0 ? 'info' : 'success', res.message || `Imported ${res.data?.length || 0} terms`);
      setShowImport(false);
      setImportText('');
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Import failed');
    }
  };

  const handleFileRead = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(reader.result as string);
      if (file.name.endsWith('.json')) setImportFormat('json');
      if (file.name.endsWith('.csv')) setImportFormat('csv');
    };
    reader.readAsText(file);
  };

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
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load glossary');
    }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useRefreshOnFocus(fetchData);

  // ── Filtered list ──
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
    return result;
  }, [terms, searchQuery, filterStatus, filterCategory]);

  const { sorted, sortKey, sortDir, toggleSort } = useSortedList<GlossaryTerm>(
    filteredTerms,
    {
      term: (a, b) => a.term.localeCompare(b.term),
      category: (a, b) => a.category.localeCompare(b.category),
      status: (a, b) => a.status.localeCompare(b.status),
      domain: (a, b) => (a.domainName || '').localeCompare(b.domainName || ''),
      owner: (a, b) => (a.ownerName || '').localeCompare(b.ownerName || ''),
    },
    'term',
  );

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
      addToast('error', err?.message || err?.response?.data?.error || 'Failed to save term');
    }
  };

  // Inline single-field update used by the table cells. Mirrors the
  // Systems page pattern: PUT only the changed field, refresh.
  const inlineSaveField = async (id: string, field: string, value: string) => {
    try {
      await apiClient.put(`/business-glossary/${id}`, { [field]: value });
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || err?.response?.data?.error || `Failed to update ${field}`);
    }
  };

  const handleBulkApply = async () => {
    const ids = Array.from(bulkSelectedIds);
    if (ids.length === 0) return;
    const updates: Record<string, string | null> = {};
    if (bulkUpdates.status) updates.status = bulkUpdates.status;
    if (bulkUpdates.category) updates.category = bulkUpdates.category;
    if (bulkUpdates.ownerPersonId) updates.ownerPersonId = bulkUpdates.ownerPersonId === '__unassign__' ? null : bulkUpdates.ownerPersonId;
    if (bulkUpdates.domainId) updates.domainId = bulkUpdates.domainId === '__unassign__' ? null : bulkUpdates.domainId;
    if (Object.keys(updates).length === 0) {
      addToast('error', 'Pick at least one field to change.');
      return;
    }
    setApplyingBulk(true);
    try {
      const res = await apiClient.patch<{ success: boolean; updated: number; skipped: string[] }>('/business-glossary/bulk', { ids, updates });
      addToast('success', `Updated ${res.updated} term${res.updated !== 1 ? 's' : ''}${res.skipped?.length ? ` (skipped ${res.skipped.length})` : ''}`);
      clearBulkSelection();
      fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Bulk update failed');
    } finally {
      setApplyingBulk(false);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(bulkSelectedIds);
    if (ids.length === 0) return;
    setApplyingBulk(true);
    try {
      const res = await apiClient.post<{ success: boolean; deleted: number }>('/business-glossary/bulk-delete', { ids });
      addToast('success', `Deleted ${res.deleted} term${res.deleted !== 1 ? 's' : ''}`);
      clearBulkSelection();
      fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Bulk delete failed');
    } finally {
      setApplyingBulk(false);
      setConfirmBulkDelete(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/business-glossary/${id}`);
      addToast('success', 'Term deleted');
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
    const grouped: Record<string, GlossaryTerm[]> = {};
    for (const t of filteredTerms) {
      const cat = t.category || 'GENERAL';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    }
    const cats = CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0);
    const termsHtml = cats.map((cat) => {
      const catTerms = grouped[cat].sort((a, b) => a.term.localeCompare(b.term));
      const rows = catTerms.map((t) => `<tr><td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:600;vertical-align:top;width:22%">${esc(t.term)}</td><td style="padding:10px 14px;border:1px solid #e5e7eb;vertical-align:top">${esc(t.definition)}${t.synonyms?.length ? `<br><span style="color:#6b7280;font-size:12px">Synonyms: ${t.synonyms.map(esc).join(', ')}</span>` : ''}</td><td style="padding:10px 14px;border:1px solid #e5e7eb;vertical-align:top;width:10%;text-align:center"><span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:600;background:${STATUS_COLORS[t.status]?.bg || '#f1f5f9'};color:${STATUS_COLORS[t.status]?.color || '#64748b'}">${esc(t.status)}</span></td></tr>`).join('');
      return `<h2 style="margin:28px 0 12px;font-size:18px;color:#1e40af;border-bottom:2px solid #dbeafe;padding-bottom:6px">${esc(cat.charAt(0) + cat.slice(1).toLowerCase())} Terms</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="background:#f8fafc"><th scope="col" style="padding:10px 14px;border:1px solid #e5e7eb;text-align:left;font-size:12px;text-transform:uppercase;color:#64748b">Term</th><th scope="col" style="padding:10px 14px;border:1px solid #e5e7eb;text-align:left;font-size:12px;text-transform:uppercase;color:#64748b">Definition</th><th scope="col" style="padding:10px 14px;border:1px solid #e5e7eb;text-align:center;font-size:12px;text-transform:uppercase;color:#64748b">Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Business Glossary — ${esc(orgName)}</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:32px 24px;color:#1e293b}</style></head><body><h1 style="border-bottom:3px solid #1e40af;padding-bottom:12px">Business Glossary</h1><p style="color:#64748b">${esc(orgName)} · ${esc(now)} · ${filteredTerms.length} terms</p>${termsHtml}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `glossary-${orgName.toLowerCase().replace(/\s+/g, '-')}.html`; a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Glossary exported as HTML');
  };

  const allVisibleSelected = sorted.length > 0 && sorted.every((t) => bulkSelectedIds.has(t.id));
  const someVisibleSelected = !allVisibleSelected && sorted.some((t) => bulkSelectedIds.has(t.id));
  const toggleSelectAllVisible = () => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) sorted.forEach((t) => next.delete(t.id));
      else sorted.forEach((t) => next.add(t.id));
      return next;
    });
  };

  // ── Render ──

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Business Glossary"
        subtitle="Agreed-upon definitions for key business terms across the organization."
        meta={terms.length > 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{terms.length} terms</span>
            <span style={{ color: 'var(--color-border)' }}>&middot;</span>
            <span>{terms.filter((t) => t.status === 'APPROVED').length} approved</span>
            <span style={{ color: 'var(--color-border)' }}>&middot;</span>
            <span>{terms.filter((t) => t.status === 'DRAFT').length} draft</span>
            <span style={{ color: 'var(--color-border)' }}>&middot;</span>
            <span>{new Set(terms.map((t) => t.category).filter(Boolean)).size} categories</span>
          </div>
        ) : undefined}
        actions={
          <>
            {canWrite && terms.length === 0 && (
              <IconButton icon="wand" label={generating ? 'Generating...' : 'Generate Industry Terms'} disabled={generating} onClick={handleGenerate} />
            )}
            {terms.length > 0 && <IconButton icon="download" label="Export HTML" onClick={handleExportHtml} />}
            {canWrite && <IconButton icon="upload" label="Import terms" onClick={() => setShowImport(true)} />}
            {canWrite && <IconButton icon="link" label="Connect to source" onClick={() => setShowSync(true)} />}
            <SavedViewsMenu
              pageKey="business-glossary"
              currentFilters={{ searchQuery, filterStatus, filterCategory }}
              onApply={(f) => {
                setSearchQuery((f.searchQuery as string) || '');
                setFilterStatus((f.filterStatus as string) || '');
                setFilterCategory((f.filterCategory as string) || '');
              }}
            />
            <ColumnPicker state={glossaryCols} />
            {canWrite && <IconButton icon="plus" label="Add term" variant="primary" onClick={openAdd} />}
          </>
        }
      />

      <ConfirmDialog open={confirmDelete !== null} title="Delete Term?"
        message="This will permanently delete this glossary term." confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)} />

      <ConfirmDialog open={confirmBulkDelete}
        title={`Delete ${bulkSelectedIds.size} term${bulkSelectedIds.size !== 1 ? 's' : ''}?`}
        message={`This will permanently delete the ${bulkSelectedIds.size} selected glossary term${bulkSelectedIds.size !== 1 ? 's' : ''}. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)} />

      {/* Import Panel */}
      {showImport && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>Import Glossary Terms</h3>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Paste CSV or JSON, or browse a file. Format is auto-detected.
              </span>
            </div>
            <button onClick={() => { setShowImport(false); setImportText(''); }} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--color-text-muted)' }}>&times;</button>
          </div>
          {!activeOrgId && (
            <div style={{ background: '#fef3c7', padding: '8px 12px', borderRadius: 4, fontSize: 12, color: '#92400e', marginBottom: 10 }}>
              Select an organization from the "Working in" dropdown before importing.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input ref={fileInputRef} type="file" accept=".csv,.json,.txt" onChange={handleFileRead} style={{ display: 'none' }} />
            <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => fileInputRef.current?.click()}>Browse File</button>
          </div>
          <textarea
            style={{ ...inputStyle, width: '100%', minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 11 }}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'Term,Definition,Category,Status\nCustomer Lifetime Value,Total expected revenue from a customer over the relationship,METRIC,DRAFT'}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flex: 1 }}>
              CSV columns: Term (required), Definition, Category, Status, Synonyms (; or | separated), Context, Source of Truth
            </span>
            <button style={btnSecondary} onClick={() => { setShowImport(false); setImportText(''); }}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !importText.trim() || !activeOrgId ? 0.6 : 1, cursor: !importText.trim() || !activeOrgId ? 'not-allowed' : 'pointer' }}
              disabled={!importText.trim() || !activeOrgId}
              onClick={handleImport}
            >
              Import
            </button>
          </div>
        </div>
      )}

      {showSync && (
        <Suspense fallback={null}>
          <SyncConnectionWizard
            open={showSync}
            onClose={() => setShowSync(false)}
            targetEntity="business-glossary"
            orgId={activeOrgId || ''}
            onCreated={fetchData}
          />
        </Suspense>
      )}

      {/* Two-column layout: Categories sidebar + content */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Categories Sidebar */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 10,
          position: 'sticky',
          top: 12,
          maxHeight: 'calc(100vh - 180px)',
          overflowY: 'auto',
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, padding: '0 4px' }}>
            Categories
          </div>
          <div
            onClick={() => setFilterCategory('')}
            style={{
              padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
              fontWeight: !filterCategory ? 600 : 400,
              background: !filterCategory ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
              color: !filterCategory ? 'var(--color-primary)' : 'var(--color-text)',
            }}
            onMouseEnter={(e) => { if (filterCategory) e.currentTarget.style.background = 'var(--color-bg)'; }}
            onMouseLeave={(e) => { if (filterCategory) e.currentTarget.style.background = 'transparent'; }}
          >
            All Terms ({terms.length})
          </div>
          {CATEGORY_ORDER.map((cat) => {
            const count = terms.filter((t) => t.category === cat).length;
            if (count === 0) return null;
            const isActive = filterCategory === cat;
            const colors = CATEGORY_COLORS[cat];
            return (
              <div
                key={cat}
                onClick={() => setFilterCategory(isActive ? '' : cat)}
                style={{
                  padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: colors?.color || '#64748b' }} />
                  {cat}
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '0 5px', borderRadius: 8, fontWeight: 500 }}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* Content area */}
        <div>
          {/* Filters (left-aligned, mirrors Data Assets) */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 200 }}>
              <input
                type="text"
                placeholder="Search terms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && searchQuery) setSearchQuery(''); }}
                style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 28px 5px 10px', fontSize: 12, background: 'var(--color-surface)', width: '100%', boxSizing: 'border-box' }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  title="Clear search (Esc)"
                  style={{
                    position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1,
                    padding: '2px 6px', borderRadius: 3,
                  }}
                >
                  &times;
                </button>
              )}
            </div>
            <select style={{ ...selectStyle, width: 'auto', minWidth: 130 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()} ({terms.filter((t) => t.status === s).length})</option>)}
            </select>
            {(filterStatus || searchQuery || filterCategory) && (
              <button
                onClick={() => { setFilterStatus(''); setSearchQuery(''); setFilterCategory(''); }}
                style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}
              >
                Clear Filters
              </button>
            )}
            {(filterStatus || searchQuery || filterCategory) && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Showing {filteredTerms.length} of {terms.length}
              </span>
            )}
          </div>

          {/* Add/Edit Form */}
          {showForm && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingId ? 'Edit Term' : 'Add New Term'}</h3>
              {(() => {
                const trimmed = form.term.trim().toLowerCase();
                const isDuplicate = !!trimmed && terms.some((t) => t.id !== editingId && t.term.trim().toLowerCase() === trimmed);
                return (
                  <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Term *</label>
                      <input
                        autoFocus
                        style={{ ...inputStyle, borderColor: isDuplicate ? '#fca5a5' : (inputStyle.border as string)?.includes('var') ? undefined : undefined }}
                        value={form.term}
                        onChange={(e) => setForm({ ...form, term: e.target.value })}
                        placeholder="e.g. Customer Lifetime Value"
                      />
                      {isDuplicate && (
                        <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>
                          A term with this name already exists in this organization.
                        </div>
                      )}
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
                  <label style={labelStyle}>Primary Domain</label>
                  <select style={selectStyle} value={form.domainId} onChange={(e) => setForm({ ...form, domainId: e.target.value })}>
                    <option value="">-- No Domain --</option>
                    {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Owner</label>
                  <select style={selectStyle} value={form.ownerAssignmentId} onChange={(e) => setForm({ ...form, ownerAssignmentId: e.target.value })}>
                    <option value="">-- Unassigned --</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
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
                    <button
                      style={{ ...btnPrimary, opacity: (!form.term.trim() || !form.definition.trim() || isDuplicate) ? 0.6 : 1, cursor: (!form.term.trim() || !form.definition.trim() || isDuplicate) ? 'not-allowed' : 'pointer' }}
                      disabled={!form.term.trim() || !form.definition.trim() || isDuplicate}
                      onClick={handleSave}
                    >
                      {editingId ? 'Save Changes' : 'Add Term'}
                    </button>
                  </div>
                </>
                );
              })()}
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

          {/* Bulk Action Bar */}
          {bulkSelectedIds.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 12,
              background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{bulkSelectedIds.size} selected</span>
              <span style={{ color: '#93c5fd' }}>|</span>
              <select style={{ ...inputStyle, fontSize: 12, padding: '4px 8px', width: 'auto' }} value={bulkUpdates.status} onChange={(e) => setBulkUpdates({ ...bulkUpdates, status: e.target.value })}>
                <option value="">Status…</option>
                {STATUSES.map((s) => <option key={s} value={s}>Set {s}</option>)}
              </select>
              <select style={{ ...inputStyle, fontSize: 12, padding: '4px 8px', width: 'auto' }} value={bulkUpdates.category} onChange={(e) => setBulkUpdates({ ...bulkUpdates, category: e.target.value })}>
                <option value="">Category…</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>Set {c}</option>)}
              </select>
              <select style={{ ...inputStyle, fontSize: 12, padding: '4px 8px', width: 'auto' }} value={bulkUpdates.ownerPersonId} onChange={(e) => setBulkUpdates({ ...bulkUpdates, ownerPersonId: e.target.value })}>
                <option value="">Owner…</option>
                <option value="__unassign__">Clear owner</option>
                {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
              </select>
              <select style={{ ...inputStyle, fontSize: 12, padding: '4px 8px', width: 'auto' }} value={bulkUpdates.domainId} onChange={(e) => setBulkUpdates({ ...bulkUpdates, domainId: e.target.value })}>
                <option value="">Primary Domain…</option>
                <option value="__unassign__">Clear domain</option>
                {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button
                onClick={handleBulkApply}
                disabled={applyingBulk}
                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: applyingBulk ? 'not-allowed' : 'pointer', opacity: applyingBulk ? 0.6 : 1 }}
              >
                {applyingBulk ? 'Applying…' : 'Apply'}
              </button>
              <span style={{ color: '#93c5fd' }}>|</span>
              <button
                onClick={() => setConfirmBulkDelete(true)}
                disabled={applyingBulk}
                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
              >
                Delete Selected
              </button>
              <button
                onClick={clearBulkSelection}
                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
              >
                Clear Selection
              </button>
            </div>
          )}

          {/* Table */}
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            {loading ? (
              <SkeletonRows rows={5} columns={6} />
            ) : loadError && terms.length === 0 ? (
              <EmptyState icon={<AlertTriangle size={36} strokeWidth={1.8} />} title="Couldn't load glossary"
                description={loadError}
                action={{ label: 'Retry', onClick: () => { setLoading(true); fetchData(); } }} />
            ) : terms.length === 0 && !showForm ? (
              <EmptyState icon={renderNavIcon('/business-glossary')} title="No glossary terms yet"
                description="The business glossary is a shared dictionary of agreed-upon terms. Define terms so everyone speaks the same language."
                action={canWrite ? { label: '+ Add Term', onClick: openAdd } : undefined}
                secondaryAction={canWrite ? { label: 'Generate Industry Terms', onClick: handleGenerate, variant: 'secondary' } : undefined} />
            ) : sorted.length === 0 ? (
              <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                No terms match your filters.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    <th scope="col" style={{ ...thStyle, width: 40, textAlign: 'center' }}>
                      {canWrite && (
                        <input
                          type="checkbox"
                          aria-label="Select all visible terms"
                          checked={allVisibleSelected}
                          ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                          onChange={toggleSelectAllVisible}
                        />
                      )}
                    </th>
                    {glossaryCols.isVisible('term') && <SortableTh sortKey="term" active={sortKey} dir={sortDir} onClick={toggleSort}>Term</SortableTh>}
                    {glossaryCols.isVisible('category') && <SortableTh sortKey="category" active={sortKey} dir={sortDir} onClick={toggleSort}>Category</SortableTh>}
                    {glossaryCols.isVisible('status') && <SortableTh sortKey="status" active={sortKey} dir={sortDir} onClick={toggleSort}>Status</SortableTh>}
                    {glossaryCols.isVisible('domain') && <SortableTh sortKey="domain" active={sortKey} dir={sortDir} onClick={toggleSort}>Primary Domain</SortableTh>}
                    {glossaryCols.isVisible('owner') && <SortableTh sortKey="owner" active={sortKey} dir={sortDir} onClick={toggleSort}>Owner</SortableTh>}
                    {glossaryCols.isVisible('definition') && <th scope="col" style={thStyle}>Definition</th>}
                    <th scope="col" style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => {
                    const isSelected = bulkSelectedIds.has(t.id);
                    return (
                      <tr key={t.id} style={{ transition: 'background 0.1s', background: isSelected ? '#f0f9ff' : '' }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                        <td style={{ ...tdStyle, textAlign: 'center', width: 40 }}>
                          {canWrite && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleBulkSelect(t.id)}
                              aria-label={`Select ${t.term}`}
                            />
                          )}
                        </td>
                        {glossaryCols.isVisible('term') && (
                          <td style={{ ...tdStyle, fontWeight: 500 }}>
                            {/* Click opens the edit form so the term gets a
                             *  proper modal with definition / classification /
                             *  related-terms - the inline editor only let users
                             *  change the headword, missing the rest. Viewers
                             *  get a plain label since they can't edit. */}
                            {canWrite ? (
                              <button
                                type="button"
                                onClick={() => openEdit(t)}
                                title="Click to edit term"
                                style={{
                                  background: 'none', border: 'none', padding: 0,
                                  color: 'var(--color-primary)', cursor: 'pointer',
                                  font: 'inherit', fontWeight: 500, textAlign: 'left',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                              >
                                {t.term}
                              </button>
                            ) : (
                              t.term
                            )}
                          </td>
                        )}
                        {glossaryCols.isVisible('category') && (
                          <td style={tdStyle}>
                            {canWrite ? (
                              <InlineCellEdit
                                value={t.category}
                                display={<span style={badgeStyle(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span>}
                                type="select"
                                options={CATEGORIES}
                                onSave={(v) => inlineSaveField(t.id, 'category', v)}
                              />
                            ) : (
                              <span style={badgeStyle(CATEGORY_COLORS[t.category] || CATEGORY_COLORS.GENERAL)}>{t.category}</span>
                            )}
                          </td>
                        )}
                        {glossaryCols.isVisible('status') && (
                          <td style={tdStyle}>
                            {canWrite ? (
                              <InlineCellEdit
                                value={t.status}
                                display={<span style={badgeStyle(STATUS_COLORS[t.status] || STATUS_COLORS.DRAFT)}>{t.status}</span>}
                                type="select"
                                options={STATUSES}
                                onSave={(v) => inlineSaveField(t.id, 'status', v)}
                              />
                            ) : (
                              <span style={badgeStyle(STATUS_COLORS[t.status] || STATUS_COLORS.DRAFT)}>{t.status}</span>
                            )}
                          </td>
                        )}
                        {glossaryCols.isVisible('domain') && (
                          <td style={{ ...tdStyle, color: t.domainName ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                            {t.domainName || '—'}
                          </td>
                        )}
                        {glossaryCols.isVisible('owner') && (
                          <td style={{ ...tdStyle, color: t.ownerName ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                            {t.ownerName || '—'}
                          </td>
                        )}
                        {glossaryCols.isVisible('definition') && (
                          <td style={{ ...tdStyle, color: t.definition ? 'var(--color-text-secondary)' : 'var(--color-text-muted)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.definition}>
                            {t.definition || '—'}
                          </td>
                        )}
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(t)} />}
                            {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(t.id)} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
