import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import ExpandCollapseControls from '../components/ExpandCollapseControls';
import Card from '../components/Card';
import Button from '../components/Button';
import SecondaryButton from '../components/SecondaryButton';
import Avatar from '../components/Avatar';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import { activateOnKeyStop, clickable } from '../lib/a11y';
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';
import ExportMenu from '../components/ExportMenu';
import ConfirmDialog from '../components/ConfirmDialog';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import { statusBadgeStyle } from '../lib/statusBadge';
import { SkeletonRows } from '../components/Skeleton';
import { useRefreshOnFocus } from '../hooks/usePolling';

// ── Types ──

interface GroupMember {
  personId: string;
  personName: string;
  groupRole: string;
  since: string;
}

interface GovernanceGroup {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  type: string;
  description: string;
  charter: string;
  status: 'ACTIVE' | 'INACTIVE';
  members: GroupMember[];
  children: GovernanceGroup[];
  createdAt: string;
  updatedAt: string;
}

interface GovernanceGroupFlat {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  type: string;
  description: string;
  charter: string;
  status: 'ACTIVE' | 'INACTIVE';
  members: GroupMember[];
  createdAt: string;
  updatedAt: string;
}

const GROUP_TYPE_LABELS: Record<string, string> = {
  COUNCIL: 'Data Governance Council',
  OFFICE: 'Data Governance Office',
  COMMITTEE: 'Data Governance Committee',
  STEWARDSHIP_TEAM: 'Data Stewardship Team',
  WORKING_GROUP: 'Working Group',
  COMMUNITY_OF_PRACTICE: 'Community of Practice',
};

const GROUP_TYPE_SHORT: Record<string, string> = {
  COUNCIL: 'Council',
  OFFICE: 'Office',
  COMMITTEE: 'Committee',
  STEWARDSHIP_TEAM: 'Stewardship',
  WORKING_GROUP: 'Working Group',
  COMMUNITY_OF_PRACTICE: 'CoP',
};

// ── The six-layer governance ladder (DAMA-aligned). Top sets direction, down
// to the daily work. Drives the "Recommended structure" read-out. ──

const LAYER_ORDER = ['COUNCIL', 'OFFICE', 'COMMITTEE', 'STEWARDSHIP_TEAM', 'WORKING_GROUP', 'COMMUNITY_OF_PRACTICE'];
const LAYER_NAME: Record<string, string> = {
  COUNCIL: 'Council',
  OFFICE: 'Office',
  COMMITTEE: 'Committee',
  STEWARDSHIP_TEAM: 'Stewardship teams',
  WORKING_GROUP: 'Working groups',
  COMMUNITY_OF_PRACTICE: 'Communities of practice',
};
const LAYER_HINT: Record<string, string> = {
  COUNCIL: 'Sets direction, approves policy',
  OFFICE: 'Runs the program day to day',
  COMMITTEE: 'Coordinates across functions',
  STEWARDSHIP_TEAM: 'Look after data in each domain',
  WORKING_GROUP: 'Short-term, single-topic',
  COMMUNITY_OF_PRACTICE: 'Share know-how, no decisions',
};

// ── Type badge colours (Governance) ──

const typeBadgeColors: Record<string, { bg: string; color: string }> = {
  COUNCIL: { bg: '#dbeafe', color: '#1e40af' },
  OFFICE: { bg: '#ede9fe', color: '#5b21b6' },
  COMMITTEE: { bg: '#d1f0eb', color: '#0f4f46' },
  STEWARDSHIP_TEAM: { bg: '#fef3c7', color: '#92400e' },
  WORKING_GROUP: { bg: '#e0e7ff', color: '#3730a3' },
  COMMUNITY_OF_PRACTICE: { bg: '#f1f5f9', color: '#64748b' },
};

// ── Styles ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any, width: 'auto' };
const filterSelectStyle: React.CSSProperties = {
  ...selectStyle, height: 34, padding: '0 8px', fontSize: 13, color: 'var(--color-text)',
};
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};
const typeCellBadge = (colors: { bg: string; color: string }): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 13,
  fontSize: 12, fontWeight: 600, background: colors.bg, color: colors.color,
});
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600,
  letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)',
  borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid var(--color-border)', verticalAlign: 'middle' };

// ── Helpers ──

interface FlatGroupOption { id: string; name: string; type: string; depth: number; label: string; }

function flattenTreeForSelect(nodes: GovernanceGroup[], depth = 0): FlatGroupOption[] {
  const result: FlatGroupOption[] = [];
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    result.push({ id: node.id, name: node.name, type: node.type, depth, label: `${indent}${node.name} (${GROUP_TYPE_SHORT[node.type] || node.type})` });
    if (node.children.length > 0) result.push(...flattenTreeForSelect(node.children, depth + 1));
  }
  return result;
}

function collectAllIds(nodes: GovernanceGroup[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    if (node.children.length > 0) ids.push(...collectAllIds(node.children));
  }
  return ids;
}

// Returns which group types can be a valid parent of the given child type
function findValidParentTypes(validChildren: Record<string, string[]>, childType: string): string[] {
  const result: string[] = [];
  for (const [parentType, children] of Object.entries(validChildren)) {
    if (children.includes(childType)) result.push(parentType);
  }
  return result;
}

// The group's chair — the CHAIR member, else the first member (so the column
// is never blank when a group has people but no explicit chair set).
function chairOf(members: GroupMember[]): GroupMember | null {
  if (!members || members.length === 0) return null;
  return members.find((m) => m.groupRole === 'CHAIR') || members[0];
}

// ── Form data ──

interface GroupFormData {
  name: string;
  type: string;
  parentId: string | null;
  description: string;
  charter: string;
  status: string;
}

const emptyForm: GroupFormData = { name: '', type: 'COUNCIL', parentId: null, description: '', charter: '', status: 'ACTIVE' };

// ── Main Component ──

export default function GovernanceGroupsPage() {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const { isAdmin } = usePermissions();
  const { addToast } = useToastStore();

  // Data state
  const [flatGroups, setFlatGroups] = useState<GovernanceGroupFlat[]>([]);
  const [tree, setTree] = useState<GovernanceGroup[]>([]);
  const [groupTypes, setGroupTypes] = useState<string[]>([]);
  const [groupTypeLabels, setGroupTypeLabels] = useState<Record<string, string>>({});
  const [validChildren, setValidChildren] = useState<Record<string, string[]>>({});
  const [, setGroupRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Tree expand/collapse. The tree loads fully expanded so nested groups (e.g.
  // the Stewardship Team under the Council) are visible straight away, rather
  // than looking missing behind a collapsed parent.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const didInitExpand = useRef(false);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Per-row "⋯" actions menu + the header overflow menu (generate template).
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  useEffect(() => {
    if (!rowMenuId && !headerMenuOpen) return;
    const close = () => { setRowMenuId(null); setHeaderMenuOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId, headerMenuOpen]);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<GroupFormData>(emptyForm);
  const validation = useFormValidation({ name: (v) => !(v as string)?.trim() ? 'Name is required' : null });
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const toggleCheck = (id: string) => setCheckedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── Data fetching ──

  const fetchGroups = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{
        success: boolean;
        data: GovernanceGroupFlat[];
        tree: GovernanceGroup[];
        groupTypes: string[];
        groupTypeLabels: Record<string, string>;
        validChildren: Record<string, string[]>;
        groupRoles: string[];
      }>(`/governance-groups${query}`);
      setFlatGroups(res.data || []);
      setTree(res.tree || []);
      setGroupTypes(res.groupTypes || []);
      setGroupTypeLabels(res.groupTypeLabels || {});
      setValidChildren(res.validChildren || {});
      setGroupRoles(res.groupRoles || []);
    } catch { /* */ }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useRefreshOnFocus(fetchGroups);

  // Expand the whole tree the first time it arrives (once per org switch), so
  // children are visible by default without clobbering a user's later collapse.
  useEffect(() => { didInitExpand.current = false; }, [activeOrgId]);
  useEffect(() => {
    if (!didInitExpand.current && tree.length > 0) {
      setExpanded(new Set(collectAllIds(tree)));
      didInitExpand.current = true;
    }
  }, [tree]);

  // ── Tree handlers ──

  const toggleExpand = (id: string) => setExpanded((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const expandAll = () => setExpanded(new Set(collectAllIds(tree)));
  const collapseAll = () => setExpanded(new Set());

  // ── Form handlers ──

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm);
    setShowForm(true);
  };

  const openAddChild = (parentId: string, parentType: string) => {
    const recommended = validChildren[parentType] || [];
    const defaultType = recommended.length > 0 ? recommended[0] : groupTypes[0];
    setForm({ ...emptyForm, parentId, type: defaultType });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!validation.validateAll(form) || !form.type) return;
    const payload = { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) };
    let res: any;
    try {
      res = await apiClient.post('/governance-groups', payload);
      addToast('success', 'Governance group created');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to save governance group');
      return;
    }
    setShowForm(false); setForm(emptyForm);
    fetchGroups();
    if (res?.warning) addToast('info', res.warning);
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/governance-groups/${id}`);
      addToast('success', 'Governance group deleted');
      fetchGroups();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to delete governance group');
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(checkedIds);
    try {
      await Promise.all(ids.map((id) => apiClient.delete(`/governance-groups/${id}`)));
      addToast('success', `Deleted ${ids.length} governance group${ids.length === 1 ? '' : 's'}`);
      setCheckedIds(new Set());
      fetchGroups();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Bulk delete failed');
      fetchGroups();
    }
  };

  const handleCancel = () => { setShowForm(false); setForm(emptyForm); validation.clearErrors(); };

  // ── Computed values ──

  const treeOptions = flattenTreeForSelect(tree);
  const typeOptions = groupTypes;
  const parentGroup = form.parentId ? flatGroups.find((g) => g.id === form.parentId) : null;
  const recommendedTypes = parentGroup ? (validChildren[parentGroup.type] || []) : [];
  const labelForType = (t: string) => groupTypeLabels[t] || GROUP_TYPE_LABELS[t] || t;
  const parentPlacementNote = (() => {
    if (!parentGroup || !form.type) return null;
    if ((validChildren[parentGroup.type] || []).includes(form.type)) return null;
    const recommendedParents = findValidParentTypes(validChildren, form.type);
    return recommendedParents.length > 0
      ? `Governance best practices place ${labelForType(form.type)} under ${recommendedParents.map(labelForType).join(' or ')}, not ${labelForType(parentGroup.type)}. You can still save it here.`
      : `${labelForType(form.type)} is normally a top-level body. You can still nest it under ${labelForType(parentGroup.type)} if you want.`;
  })();

  // Ladder: how many groups exist at each of the six layers.
  const layerCount = (t: string) => flatGroups.filter((g) => g.type === t).length;
  const layersPresent = LAYER_ORDER.filter((t) => layerCount(t) > 0).length;

  // Summary line.
  const memberTotal = flatGroups.reduce((a, g) => a + (g.members?.length || 0), 0);
  const activeTotal = flatGroups.filter((g) => g.status === 'ACTIVE').length;

  // ── Filtering → flattened, indented rows ──
  const filterActive = !!(search.trim() || typeFilter || statusFilter);
  const nodeMatches = (n: GovernanceGroup): boolean => {
    const q = search.trim().toLowerCase();
    const matchQ = !q
      || n.name.toLowerCase().includes(q)
      || (n.description || '').toLowerCase().includes(q)
      || (n.members || []).some((m) => m.personName.toLowerCase().includes(q));
    const matchType = !typeFilter || n.type === typeFilter;
    const matchStatus = !statusFilter || n.status === statusFilter;
    return matchQ && matchType && matchStatus;
  };
  const subtreeKept = (n: GovernanceGroup): boolean => nodeMatches(n) || n.children.some(subtreeKept);

  interface FlatRow { node: GovernanceGroup; depth: number; hasKids: boolean; }
  const flattenVisible = (nodes: GovernanceGroup[], depth: number): FlatRow[] => {
    const out: FlatRow[] = [];
    for (const n of nodes) {
      if (filterActive && !subtreeKept(n)) continue;
      const visibleKids = filterActive ? n.children.filter(subtreeKept) : n.children;
      out.push({ node: n, depth, hasKids: visibleKids.length > 0 });
      const showKids = visibleKids.length > 0 && (filterActive || expanded.has(n.id));
      if (showKids) out.push(...flattenVisible(n.children, depth + 1));
    }
    return out;
  };
  const flatRows = flattenVisible(tree, 0);
  const visibleIds = flatRows.map((r) => r.node.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.has(id));
  const toggleCheckAll = () => {
    if (allChecked) { setCheckedIds(new Set()); return; }
    setCheckedIds(new Set(visibleIds));
  };

  // ── Render ──

  if (loading) return (
    <div>
      <Card shadow="none"><SkeletonRows rows={5} columns={5} /></Card>
    </div>
  );

  const formCard = (
    <Card marginBottom={12}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        {form.parentId ? 'Add sub-group' : 'Add governance group'}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
          <input autoFocus
            aria-label="Name"
            style={{ ...inputStyle, border: validation.fieldError('name') ? inputErrorBorder : inputStyle.border }}
            value={form.name}
            onChange={(e) => { const v = e.target.value; setForm({ ...form, name: v }); if (validation.touched.name) validation.validateField('name', v, form); }}
            onBlur={() => { validation.touch('name'); validation.validateField('name', form.name, form); }}
            placeholder="e.g. Data Governance Council" />
          {validation.fieldError('name') && <div style={fieldErrorStyle}>{validation.fieldError('name')}</div>}
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type *</label>
          <select aria-label="Type" style={{ ...selectStyle, width: '100%' }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, parentId: form.parentId })}>
            {typeOptions.map((t) => {
              const isRecommended = recommendedTypes.length > 0 && recommendedTypes.includes(t);
              const label = groupTypeLabels[t] || GROUP_TYPE_LABELS[t] || t;
              return <option key={t} value={t}>{label}{isRecommended ? ' (recommended)' : ''}</option>;
            })}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Parent group</label>
          <select aria-label="Parent Group" style={{ ...selectStyle, width: '100%' }} value={form.parentId || ''} onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}>
            <option value="">-- No parent (top-level) --</option>
            {treeOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
          </select>
          {parentPlacementNote && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-warning)' }}>{parentPlacementNote}</div>
          )}
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
          <select aria-label="Status" style={{ ...selectStyle, width: '100%' }} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
          <input aria-label="Description" style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description of this group's purpose" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
        <SecondaryButton size="md" onClick={handleCancel}>Cancel</SecondaryButton>
        <Button variant="primary" disabled={!form.name.trim() || !form.type} onClick={handleSave}>Add group</Button>
      </div>
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Governance Groups"
        subtitle={`The councils, committees and teams that run data governance. Groups ${flatGroups.length} · Members ${memberTotal} · Active ${activeTotal}`}
        actions={
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <SecondaryButton size="md" onClick={() => navigate('/governance/visualization')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {renderNavIcon('/governance/visualization', { size: 15 })} Org chart
            </SecondaryButton>
            {flatGroups.length > 0 && (
              <ExportMenu build={() => ({
                filenameBase: 'governance-groups',
                sheetName: 'Governance Groups',
                headers: ['Name', 'Type', 'Chair', 'Parent', 'Description', 'Members', 'Status'],
                rows: flatGroups.map((g) => [
                  g.name,
                  GROUP_TYPE_LABELS[g.type] || g.type,
                  chairOf(g.members)?.personName || '',
                  flatGroups.find((p) => p.id === g.parentId)?.name || '',
                  g.description,
                  g.members.length,
                  g.status,
                ]),
              })} />
            )}
            {isAdmin && (
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <button
                  type="button" aria-label="More page actions" aria-haspopup="menu" aria-expanded={headerMenuOpen}
                  onClick={(e) => { e.stopPropagation(); setHeaderMenuOpen((v) => !v); }}
                  style={{ width: 38, height: 38, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                >⋯</button>
                {headerMenuOpen && (
                  <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 42, right: 0, zIndex: 30, minWidth: 240, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                    <button
                      type="button" role="menuitem"
                      disabled={flatGroups.length > 0}
                      title={flatGroups.length > 0 ? `Only available with no groups yet — you have ${flatGroups.length}. Delete all to regenerate.` : undefined}
                      onClick={() => { setHeaderMenuOpen(false); setConfirmGenerate(true); }}
                      style={{ ...menuItemStyle, color: flatGroups.length > 0 ? 'var(--color-text-muted)' : 'var(--color-text)', cursor: flatGroups.length > 0 ? 'not-allowed' : 'pointer' }}
                    >Generate recommended structure</button>
                  </div>
                )}
              </span>
            )}
            {isAdmin && <Button variant="primary" onClick={openAdd}>+ Add group</Button>}
          </div>
        }
      />

      <ConfirmDialog
        open={confirmGenerate}
        title="Generate Governance Structure?"
        message="This will create a standard DAMA-aligned governance structure: Council, Office, Committee, Stewardship Teams, and Working Group. You can customize the structure after creation."
        confirmLabel="Generate"
        variant="primary"
        onConfirm={async () => {
          setConfirmGenerate(false);
          try {
            await apiClient.post('/governance-groups/generate-template', { orgId: activeOrgId || undefined });
            addToast('success', 'Governance structure generated');
            fetchGroups();
          } catch { addToast('error', 'Failed to generate governance structure'); }
        }}
        onCancel={() => setConfirmGenerate(false)}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Governance Group?"
        message="This will permanently delete this governance group and its children. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${checkedIds.size} Governance Group${checkedIds.size === 1 ? '' : 's'}?`}
        message="This will permanently delete the selected governance groups and re-parent any children. This cannot be undone."
        confirmLabel={`Delete ${checkedIds.size}`}
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Recommended-structure ladder — which of the six governance layers are
          in place, top (direction) to bottom (daily work). */}
      <Card padding={0} marginBottom={16}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 16px 0' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Recommended structure</h2>
          <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            Top to bottom: who sets direction, down to who does the daily work. You have {layersPresent} of 6 layers.
          </span>
        </div>
        <ol style={{ listStyle: 'none', margin: 0, padding: '12px 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {LAYER_ORDER.map((t, i) => {
            const n = layerCount(t);
            const filled = n > 0;
            return (
              <li key={t} style={{
                border: `1px ${filled ? 'solid' : 'dashed'} var(--color-border)`,
                background: filled ? 'var(--color-surface)' : 'var(--color-bg)',
                borderRadius: 'var(--radius-md)', padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: 4, minHeight: 84, boxSizing: 'border-box',
              }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: filled ? 'var(--color-success)' : 'var(--color-text-muted)' }}>{filled ? `Groups ${n}` : 'Not set up'}</span>
                </span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{LAYER_NAME[t]}</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{LAYER_HINT[t]}</span>
              </li>
            );
          })}
        </ol>
      </Card>

      <BulkActionBar count={checkedIds.size} onClear={() => setCheckedIds(new Set())}>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete selected</BulkActionButton>
      </BulkActionBar>

      {/* Groups table (left) + add form (right, while adding with groups present). */}
      <div style={{ display: 'grid', gridTemplateColumns: (tree.length > 0 && showForm) ? '1fr 340px' : '1fr', gap: 16, alignItems: 'start' }}>
        <Card padding={0} shadow="none" style={{ overflow: 'hidden', alignSelf: 'start' }}>
          {/* Toolbar: search + Type/Status filters (left), expand/collapse (right). */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ flex: '1 1 220px', minWidth: 180, display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', background: 'var(--color-surface)' }}>
              <span aria-hidden="true" style={{ fontSize: 13 }}>&#128269;</span>
              <input
                type="search" aria-label="Search groups" placeholder="Search groups or members"
                value={search} onChange={(e) => setSearch(e.target.value)}
                style={{ border: 0, outline: 'none', flex: 1, font: 'inherit', fontSize: 13, color: 'var(--color-text)', background: 'transparent', minWidth: 0 }}
              />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              Type
              <select aria-label="Filter by type" style={filterSelectStyle} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All</option>
                {groupTypes.map((t) => <option key={t} value={t}>{GROUP_TYPE_LABELS[t] || t}</option>)}
              </select>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              Status
              <select aria-label="Filter by status" style={filterSelectStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <span style={{ marginLeft: 'auto' }}>
              <ExpandCollapseControls size={12} onExpandAll={expandAll} onCollapseAll={collapseAll} />
            </span>
          </div>

          {/* Body */}
          {tree.length === 0 ? (
            <EmptyState
              icon={renderNavIcon('/governance-groups')}
              title="No governance groups defined yet"
              description="Councils, committees, and working groups that carry governance decisions."
              action={isAdmin ? { label: '+ Add group', onClick: openAdd } : undefined}
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr>
                    {isAdmin && (
                      <th style={{ ...thStyle, width: 44, paddingLeft: 16 }}>
                        <input type="checkbox" aria-label="Select all groups" checked={allChecked} onChange={toggleCheckAll} style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', cursor: 'pointer' }} />
                      </th>
                    )}
                    <th style={thStyle}>Group</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Chair</th>
                    <th style={thStyle}>Members</th>
                    <th style={thStyle}>Status</th>
                    <th style={{ ...thStyle, textAlign: 'right', paddingRight: 16 }}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {flatRows.length === 0 ? (
                    <tr><td colSpan={isAdmin ? 7 : 6} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>No groups match your search.</td></tr>
                  ) : flatRows.map(({ node, depth, hasKids }) => {
                    const checked = checkedIds.has(node.id);
                    const isExpanded = filterActive || expanded.has(node.id);
                    const chair = chairOf(node.members);
                    const typeColor = typeBadgeColors[node.type] || typeBadgeColors.COMMUNITY_OF_PRACTICE;
                    const memberCount = node.members?.length || 0;
                    const goDetail = () => navigate(`/governance-groups/${node.id}`);
                    return (
                      <tr
                        key={node.id}
                        onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="button"]')) return; goDetail(); }}
                        style={{ background: checked ? 'var(--color-primary-light)' : undefined, cursor: 'pointer', transition: 'background 0.1s' }}
                        onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = 'var(--color-bg)'; }}
                        onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = ''; }}
                      >
                        {isAdmin && (
                          <td style={{ ...tdStyle, paddingLeft: 16 }}>
                            <input type="checkbox" aria-label={`Select ${node.name}`} checked={checked} onChange={() => toggleCheck(node.id)} onClick={(e) => e.stopPropagation()} style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', cursor: 'pointer' }} />
                          </td>
                        )}
                        <td style={tdStyle}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: depth * 22 }}>
                            {hasKids ? (
                              <button
                                type="button" onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
                                aria-expanded={isExpanded} aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                                onKeyDown={activateOnKeyStop(() => toggleExpand(node.id))}
                                style={{ width: 24, height: 24, border: 0, background: 'transparent', borderRadius: 6, color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                              >
                                <span aria-hidden="true" style={{ display: 'inline-block', transform: `rotate(${isExpanded ? 90 : 0}deg)`, transition: 'transform 0.12s', fontSize: 11 }}>&#9654;</span>
                              </button>
                            ) : (
                              <span aria-hidden="true" style={{ width: 24, display: 'inline-flex', justifyContent: 'center', color: 'var(--color-text-muted)', flexShrink: 0, fontSize: 11 }}>&#8226;</span>
                            )}
                            <span style={{ minWidth: 0 }}>
                              <button {...clickable(goDetail, { label: `Open ${node.name}` })} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', display: 'block' }}>{node.name}</button>
                              {node.description && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420, marginTop: 2 }}>{node.description}</span>}
                            </span>
                          </span>
                        </td>
                        <td style={tdStyle}><span style={typeCellBadge(typeColor)}>{GROUP_TYPE_SHORT[node.type] || node.type}</span></td>
                        <td style={tdStyle}>
                          {chair ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                              <Avatar name={chair.personName} size="sm" />
                              <span style={{ fontSize: 13 }}>{chair.personName}</span>
                            </span>
                          ) : (
                            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No chair</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{memberCount}</td>
                        <td style={tdStyle}><span style={statusBadgeStyle(node.status)} title={`Status: ${node.status}`}>{node.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right', paddingRight: 16, whiteSpace: 'nowrap' }}>
                          {isAdmin && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <SecondaryButton onClick={() => openAddChild(node.id, node.type)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>+ Sub-group</SecondaryButton>
                              <span style={{ position: 'relative', display: 'inline-flex' }}>
                                <button
                                  type="button" aria-label={`More actions for ${node.name}`} aria-haspopup="menu" aria-expanded={rowMenuId === node.id}
                                  onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === node.id ? null : node.id); }}
                                  style={{ width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8, color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                                >⋯</button>
                                {rowMenuId === node.id && (
                                  <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 170, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                                    <button type="button" role="menuitem" onClick={() => { setRowMenuId(null); goDetail(); }} style={menuItemStyle}>Open</button>
                                    <button type="button" role="menuitem" onClick={() => { setRowMenuId(null); openAddChild(node.id, node.type); }} style={menuItemStyle}>Add sub-group</button>
                                    <button type="button" role="menuitem" onClick={() => { setRowMenuId(null); setConfirmDelete(node.id); }} style={{ ...menuItemStyle, color: 'var(--color-error)' }}>Delete</button>
                                  </div>
                                )}
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tree.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', fontSize: 12.5, color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
              <span>Groups {flatGroups.length} · Members {memberTotal}</span>
              <span>Indented groups report to the group above them.</span>
            </div>
          )}
        </Card>

        {showForm && (tree.length === 0 ? null : <div style={{ alignSelf: 'start' }}>{formCard}</div>)}
      </div>

      {/* Full-width add form when the tree is still empty. */}
      {showForm && tree.length === 0 && <div style={{ marginTop: 16, maxWidth: 480 }}>{formCard}</div>}
    </div>
  );
}
