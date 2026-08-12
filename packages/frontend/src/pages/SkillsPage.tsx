import { useEffect, useState, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import TruncatedText from '../components/TruncatedText';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import ExportMenu from '../components/ExportMenu';
import { ExportPayload } from '../lib/export';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { errorMessage } from '../lib/errorToast';
import { renderNavIcon } from '../components/navIcons';
import { useSortedList } from '../hooks/useSortedList';
import { SkeletonRows } from '../components/Skeleton';
import HelpPopover from '../components/HelpPopover';
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';
import { useFocusTrap } from '../hooks/useFocusTrap';

// ──────────────────────────────────────────────────────────────────────────
// Skills Taxonomy — DAMA-aligned capabilities that agents (and people) can
// possess. Phase 1 of the AI agent automation feature.
// ──────────────────────────────────────────────────────────────────────────

interface Skill {
  id: string;
  orgId: string;
  name: string;
  category: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  name: string;
  category: string;
  description: string;
}

const CATEGORIES = [
  'DATA_QUALITY',
  'METADATA',
  'ARCHITECTURE',
  'SECURITY',
  'INTEGRATION',
  'ANALYTICS',
  'GOVERNANCE',
  'COMMUNICATION',
] as const;

const emptyForm: FormData = {
  name: '',
  category: 'GOVERNANCE',
  description: '',
};

// ── Inline styles (matching the rest of the app) ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

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

function formatCategory(cat: string): string {
  return cat.replace(/_/g, ' ');
}

export default function SkillsPage() {
  const { activeOrgId, orgs } = useOrgContext();
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));
  const { addToast } = useToastStore();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const validation = useFormValidation({ name: (v) => !(v as string)?.trim() ? 'Name is required' : null });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [seeding, setSeeding] = useState(false);
  const confirmDeleteRef = useRef<HTMLDivElement>(null);
  useFocusTrap(confirmDeleteRef, !!confirmDelete);
  useEffect(() => {
    if (!confirmDelete) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setConfirmDelete(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmDelete]);

  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await apiClient.get<{ success: boolean; data: Skill[] }>(
        activeOrgId ? `/skills?orgId=${activeOrgId}` : '/skills',
      );
      setSkills(res.data || []);
    } catch (err) { setLoadError(errorMessage(err, 'Failed to load skills.')); }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = (filterCategory || searchQuery.trim())
    ? skills.filter((s) => {
        if (filterCategory && s.category !== filterCategory) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          if (!s.name.toLowerCase().includes(q) && !(s.description || '').toLowerCase().includes(q)) return false;
        }
        return true;
      })
    : skills;

  // Sort
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    filtered,
    {
      name: (a, b) => a.name.localeCompare(b.name),
      category: (a, b) => a.category.localeCompare(b.category),
      description: (a, b) => a.description.localeCompare(b.description),
    },
    'name',
  );

  // A row is inherited (not editable here) when owned by an org OTHER than
  // the active one. Only selectable rows feed select-all.
  const isInherited = (s: Skill) => !!s.orgId && !!activeOrgId && s.orgId !== activeOrgId;
  const ownerNameFor = (s: Skill) => orgNameById.get(s.orgId) || 'another org';
  const selectableSkills = sorted.filter((s) => !isInherited(s));
  const sel = useRowSelection(selectableSkills, (s) => s.id);

  // ── CRUD ──

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (s: Skill) => {
    setForm({ name: s.name, category: s.category, description: s.description });
    setEditingId(s.id);
    setShowForm(true);
  };

  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); validation.clearErrors(); };

  const handleSave = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!validation.validateAll(form)) return;
    try {
      if (editingId) {
        await apiClient.put(`/skills/${editingId}`, form);
        addToast('success', 'Skill updated');
      } else {
        await apiClient.post('/skills', { ...form, orgId: activeOrgId });
        addToast('success', 'Skill created');
      }
      handleCancel();
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to save skill');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/skills/${id}`);
      addToast('success', 'Skill deleted');
      setConfirmDelete(null);
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to delete skill');
    }
  };

  const handleSeed = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setSeeding(true);
    try {
      const res = await apiClient.post<{ success: boolean; data: Skill[]; message: string }>(
        '/skills/seed',
        { orgId: activeOrgId },
      );
      addToast('info', res.message || 'Standard skills seeded.');
      fetchData();
    } catch { /* */ }
    finally { setSeeding(false); }
  };

  // ── Bulk select ──
  const handleBulkDelete = async () => {
    if (sel.count === 0) return;
    const count = sel.count;
    try {
      await Promise.all(Array.from(sel.selectedIds).map((id) => apiClient.delete(`/skills/${id}`)));
      addToast('success', `Deleted ${count} skill${count === 1 ? '' : 's'}`);
      sel.clear();
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Bulk delete failed');
      fetchData();
    }
  };

  // ── Export ──

  const buildSkillsExport = (): ExportPayload => ({
    filenameBase: 'skills',
    sheetName: 'Skills',
    headers: ['Name', 'Category', 'Description'],
    rows: filtered.map((s) => [s.name, formatCategory(s.category), s.description]),
  });

  if (loadError) return (
    <div>
      <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />
    </div>
  );

  if (loading) return (
    <div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
        <SkeletonRows rows={5} columns={4} />
      </div>
    </div>
  );

  const skillColumns: DataTableColumn<Skill>[] = [
    {
      key: 'name', header: 'Name', sortable: true, cellStyle: { fontWeight: 500 },
      render: (s) => (
        <>
          {s.name}
          {isInherited(s) && (
            <span
              title={`Switch the Working in… scope to ${ownerNameFor(s)} to edit`}
              style={{
                display: 'inline-block', marginLeft: 8, padding: '1px 6px',
                borderRadius: 3, fontSize: 10, fontWeight: 600,
                background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
              }}
            >
              Owned by {ownerNameFor(s)}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'category', header: 'Category', sortable: true,
      render: (s) => {
        const cb = CATEGORY_BADGES[s.category] || CATEGORY_BADGES.GOVERNANCE;
        return (
          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: cb.bg, color: cb.color }}>
            {formatCategory(s.category)}
          </span>
        );
      },
    },
    {
      key: 'description', header: 'Description', sortable: true, cellStyle: { maxWidth: 400 },
      render: (s) => <TruncatedText text={s.description} />,
    },
    {
      key: 'actions', header: 'Actions', align: 'center' as const, width: 120,
      render: (s) => {
        const inherited = isInherited(s);
        const ownerName = ownerNameFor(s);
        return (
          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <IconButton size="sm" icon="edit" label={inherited ? `Switch scope to ${ownerName} to edit` : 'Edit'} onClick={() => openEdit(s)} disabled={inherited} />
            <IconButton size="sm" icon="trash" label={inherited ? `Switch scope to ${ownerName} to delete` : 'Delete'} variant="danger" onClick={() => setConfirmDelete(s.id)} disabled={inherited} />
          </div>
        );
      },
    },
  ];

  return (
    <div>

      {/* Header */}
      <PageHeader
        title="Skills Taxonomy"
        subtitle="Define and manage the skills your data governance team and AI agents need."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={skills.length > 0 || seeding}
              onClick={handleSeed}
              title={skills.length > 0 ? 'Skills already exist for this organization' : 'Seed standard DAMA-aligned skills'}
            >
              {seeding ? 'Seeding...' : 'Seed Standard Skills'}
            </Button>
            {filtered.length > 0 && (
              <ExportMenu build={buildSkillsExport} />
            )}
            <IconButton icon="plus" label="Add Skill" variant="primary" onClick={openAdd} />
          </>
        }
      >
        <HelpPopover id="skills-taxonomy" title="Skills Taxonomy">
          DAMA-aligned capabilities that agents and people can possess. Seed the standard
          taxonomy to get started, then customise to match your organization.
        </HelpPopover>
      </PageHeader>

      {/* Filters (left-aligned, mirrors Data Assets) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          aria-label="Search skills" placeholder="Search skills..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
        />
        <select
          aria-label="Filter by category"
          style={{ ...inputStyle, width: 'auto', minWidth: 130, appearance: 'auto' as any, fontSize: 12, padding: '5px 10px' }}
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{formatCategory(c)}</option>)}
        </select>
        {(filterCategory || searchQuery) && (
          <>
            <Button variant="secondary" size="sm" onClick={() => { setFilterCategory(''); setSearchQuery(''); }}>
              Clear Filters
            </Button>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Showing {filtered.length} of {skills.length}
            </span>
          </>
        )}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editingId ? 'Edit Skill' : 'Add Skill'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus
                aria-label="Name"
                style={{ ...inputStyle, border: validation.fieldError('name') ? inputErrorBorder : inputStyle.border }}
                value={form.name}
                onChange={(e) => { const v = e.target.value; setForm({ ...form, name: v }); if (validation.touched.name) validation.validateField('name', v, form); }}
                onBlur={() => { validation.touch('name'); validation.validateField('name', form.name, form); }}
                placeholder="e.g. Data Profiling" />
              {validation.fieldError('name') && <div style={fieldErrorStyle}>{validation.fieldError('name')}</div>}
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Category</label>
              <select aria-label="Category" style={selectStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{formatCategory(c)}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <textarea
                aria-label="Description"
                style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe what this skill entails"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.name.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      )}

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete selected</BulkActionButton>
      </BulkActionBar>

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Skills?"
        message={`Delete ${sel.count} selected skills? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => {
          setConfirmBulkDelete(false);
          await handleBulkDelete();
        }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
        {sorted.length === 0 ? (
          <EmptyState
            icon={renderNavIcon('/skills')}
            title={filterCategory ? 'No skills in this category yet' : 'No skills defined yet'}
            description="Skills represent DAMA-aligned capabilities that your agents and people can possess. Seed the standard taxonomy or add skills manually."
            action={{ label: '+ Add Skill', onClick: openAdd }}
            secondaryAction={skills.length === 0 ? { label: 'Seed Standard Skills', onClick: handleSeed } : undefined}
          />
        ) : (
          <DataTable
            rows={sorted}
            columns={skillColumns}
            rowKey={(s) => s.id}
            selection={sel}
            isRowDisabled={(s) => isInherited(s)}
            sort={{ sortKey, sortDir, onSort: toggleSort }}
            selectAllLabel="Select all skills"
            emptyMessage="No skills match the current filters."
          />
        )}
      </div>

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={() => setConfirmDelete(null)}>
          <div ref={confirmDeleteRef} role="dialog" aria-modal="true" aria-label="Delete skill" style={{ background: '#fff', borderRadius: 8, padding: 20, maxWidth: 400, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Delete this skill?</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => handleDelete(confirmDelete)}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
