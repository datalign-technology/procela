import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { thStyle, tdStyle } from '../lib/tableStyles';
import PageHeader from '../components/PageHeader';
import TruncatedText from '../components/TruncatedText';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import ExportMenu from '../components/ExportMenu';
import { ExportPayload } from '../lib/export';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import SortableTh from '../components/SortableTh';
import { useSortedList } from '../hooks/useSortedList';
import { SkeletonRows } from '../components/Skeleton';
import HelpPopover from '../components/HelpPopover';
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';

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
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

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
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const validation = useFormValidation({ name: (v) => !v?.trim() ? 'Name is required' : null });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [seeding, setSeeding] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: Skill[] }>(
        activeOrgId ? `/skills?orgId=${activeOrgId}` : '/skills',
      );
      setSkills(res.data || []);
    } catch { /* */ }
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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sorted.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(sorted.map((s) => s.id)));
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/skills/${id}`)));
      addToast('success', `Deleted ${count} skill${count === 1 ? '' : 's'}`);
      setSelectedIds(new Set());
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

  if (loading) return (
    <div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
        <SkeletonRows rows={5} columns={4} />
      </div>
    </div>
  );

  return (
    <div>

      {/* Header */}
      <PageHeader
        title="Skills Taxonomy"
        subtitle="Define and manage the skills your data governance team and AI agents need."
        actions={
          <>
            <button
              style={{
                ...btnSecondary,
                opacity: skills.length > 0 || seeding ? 0.6 : 1,
                cursor: skills.length > 0 || seeding ? 'not-allowed' : 'pointer',
              }}
              disabled={skills.length > 0 || seeding}
              onClick={handleSeed}
              title={skills.length > 0 ? 'Skills already exist for this organization' : 'Seed standard DAMA-aligned skills'}
            >
              {seeding ? 'Seeding...' : 'Seed Standard Skills'}
            </button>
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
          placeholder="Search skills..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
        />
        <select
          style={{ ...inputStyle, width: 'auto', minWidth: 130, appearance: 'auto' as any, fontSize: 12, padding: '5px 10px' }}
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{formatCategory(c)}</option>)}
        </select>
        {(filterCategory || searchQuery) && (
          <>
            <button
              onClick={() => { setFilterCategory(''); setSearchQuery(''); }}
              style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}
            >
              Clear Filters
            </button>
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
                style={{ ...inputStyle, border: validation.fieldError('name') ? inputErrorBorder : inputStyle.border }}
                value={form.name}
                onChange={(e) => { const v = e.target.value; setForm({ ...form, name: v }); if (validation.touched.name) validation.validateField('name', v, form); }}
                onBlur={() => { validation.touch('name'); validation.validateField('name', form.name, form); }}
                placeholder="e.g. Data Profiling" />
              {validation.fieldError('name') && <div style={fieldErrorStyle}>{validation.fieldError('name')}</div>}
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Category</label>
              <select style={selectStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{formatCategory(c)}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <textarea
                style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe what this skill entails"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1, cursor: !form.name.trim() ? 'not-allowed' : 'pointer' }}
              disabled={!form.name.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedIds.size} selected</span>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Delete Selected
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Clear Selection
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Skills?"
        message={`Delete ${selectedIds.size} selected skills? This cannot be undone.`}
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
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th scope="col" style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                  <input type="checkbox"
                    checked={sorted.length > 0 && selectedIds.size === sorted.length}
                    onChange={toggleSelectAll} aria-label="Select all skills" />
                </th>
                <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Name</SortableTh>
                <SortableTh sortKey="category" active={sortKey} dir={sortDir} onClick={toggleSort}>Category</SortableTh>
                <SortableTh sortKey="description" active={sortKey} dir={sortDir} onClick={toggleSort}>Description</SortableTh>
                <th scope="col" style={{ ...thStyle, width: 120, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const cb = CATEGORY_BADGES[s.category] || CATEGORY_BADGES.GOVERNANCE;
                const isSelected = selectedIds.has(s.id);
                // A row is inherited (not editable here) when it's
                // owned by an org OTHER than the active one. The
                // filterByOrgScope backend endpoint rolls ancestor
                // and descendant skills into the visible list; we
                // badge them so a user can tell "why is this in my
                // catalog?" and switch scope to edit.
                const isInherited = !!s.orgId && !!activeOrgId && s.orgId !== activeOrgId;
                const ownerName = isInherited ? (orgNameById.get(s.orgId) || 'another org') : null;
                return (
                  <tr key={s.id} style={{ transition: 'background 0.1s', background: isSelected ? '#f0f9ff' : '' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                    <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(s.id)} disabled={isInherited} />
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>
                      {s.name}
                      {isInherited && (
                        <span
                          title={`Switch the Working in… scope to ${ownerName} to edit`}
                          style={{
                            display: 'inline-block', marginLeft: 8, padding: '1px 6px',
                            borderRadius: 3, fontSize: 10, fontWeight: 600,
                            background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          Owned by {ownerName}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: cb.bg, color: cb.color }}>
                        {formatCategory(s.category)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 400 }}>
                      <TruncatedText text={s.description} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <IconButton size="sm" icon="edit" label={isInherited ? `Switch scope to ${ownerName} to edit` : 'Edit'} onClick={() => openEdit(s)} disabled={isInherited} />
                        <IconButton size="sm" icon="trash" label={isInherited ? `Switch scope to ${ownerName} to delete` : 'Delete'} variant="danger" onClick={() => setConfirmDelete(s.id)} disabled={isInherited} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 20, maxWidth: 400, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Delete this skill?</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button style={{ ...btnPrimary, background: 'var(--color-error)' }} onClick={() => handleDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
