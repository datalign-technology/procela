import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import ExpandCollapseControls from '../components/ExpandCollapseControls';
import Card from '../components/Card';
import Button from '../components/Button';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import { activateOnKeyStop, clickable } from '../lib/a11y';
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';
import ExportMenu from '../components/ExportMenu';
import ListToolbar from '../components/ListToolbar';
import ConfirmDialog from '../components/ConfirmDialog';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import IconButton from '../components/IconButton';
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

// ── Badge colors (Governance) ──

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

const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

const makeBadge = (colors: { bg: string; color: string }): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 6px', borderRadius: 3,
  fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
  background: colors.bg, color: colors.color,
});

// ── Helpers ──

interface FlatGroupOption { id: string; name: string; type: string; depth: number; label: string; }

function flattenTreeForSelect(nodes: GovernanceGroup[], depth = 0): FlatGroupOption[] {
  const result: FlatGroupOption[] = [];
  for (const node of nodes) {
    const indent = '\u00A0\u00A0'.repeat(depth);
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

// ── Tree Node Component ──

function GroupTreeNode({ node, depth, onDelete, onAddChild, onSelect, selectedId, expanded, toggleExpand, checkedIds, onToggleCheck, canEdit }: {
  node: GovernanceGroup; depth: number;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string, parentType: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  checkedIds: Set<string>;
  onToggleCheck: (id: string) => void;
  // Governance groups are governance:write (admins). Non-admins get a
  // read-only tree: no bulk checkbox, no per-node add/edit/delete.
  canEdit: boolean;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const memberCount = node.members?.length || 0;
  const typeColor = typeBadgeColors[node.type] || typeBadgeColors.COMMUNITY_OF_PRACTICE;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', paddingLeft: 10 + depth * 18,
          borderBottom: '1px solid var(--color-border)',
          borderLeft: `3px solid ${typeColor.color}`,
          background: isSelected ? 'var(--color-primary-light)' : undefined,
          cursor: 'pointer', transition: 'background 0.1s',
          minWidth: 0,
        }}
        {...clickable(() => onSelect(node.id), { label: `Select ${node.name}` })}
        aria-current={isSelected ? 'true' : undefined}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
      >
        <span
          onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpand(node.id); }}
          {...(hasChildren ? { role: 'button', tabIndex: 0, 'aria-label': isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`, 'aria-expanded': isExpanded, onKeyDown: activateOnKeyStop(() => toggleExpand(node.id)) } : {})}
          style={{ width: 14, fontSize: 10, color: 'var(--color-text-muted)', cursor: hasChildren ? 'pointer' : 'default', userSelect: 'none' }}>
          {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : '\u2022'}
        </span>
        {canEdit && <input type="checkbox" checked={checkedIds.has(node.id)} onChange={() => onToggleCheck(node.id)} onClick={(e) => e.stopPropagation()} style={{ cursor: 'pointer', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
            <span style={makeBadge(typeColor)}>{GROUP_TYPE_SHORT[node.type] || node.type}</span>
            <span style={{ ...statusBadgeStyle(node.status), flexShrink: 0 }} title={`Status: ${node.status.replace(/_/g, ' ')}`}>{node.status.replace(/_/g, ' ')}</span>
            {memberCount > 0 && <span style={{ fontSize: 9, color: 'var(--color-text-muted)', background: '#f1f5f9', padding: '0px 5px', borderRadius: 8 }}>{memberCount}</span>}
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            <IconButton size="sm" icon="plus" label="Add child group" variant="primary" onClick={() => onAddChild(node.id, node.type)} />
            <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => onDelete(node.id)} />
          </div>
        )}
      </div>
      {isExpanded && node.children.map((child) => (
        <GroupTreeNode key={child.id} node={child} depth={depth + 1}
          onDelete={onDelete} onAddChild={onAddChild}
          onSelect={onSelect} selectedId={selectedId}
          expanded={expanded} toggleExpand={toggleExpand}
          checkedIds={checkedIds} onToggleCheck={onToggleCheck} canEdit={canEdit} />
      ))}
    </div>
  );
}

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

  // Tree state. Clicking a group navigates to its detail page
  // (/governance-groups/:id) — the list no longer keeps an inline detail pane.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<GroupFormData>(emptyForm);
  const validation = useFormValidation({ name: (v) => !(v as string)?.trim() ? 'Name is required' : null });
  // When adding a child, restrict the type dropdown to valid child types
  const [allowedTypes, setAllowedTypes] = useState<string[] | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const toggleCheck = (id: string) => setCheckedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleCheckAll = () => {
    if (checkedIds.size === flatGroups.length) setCheckedIds(new Set());
    else setCheckedIds(new Set(flatGroups.map((g) => g.id)));
  };

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
    setAllowedTypes(null); // all types allowed for top-level
    setShowForm(true);
  };

  const openAddChild = (parentId: string, parentType: string) => {
    const recommended = validChildren[parentType] || [];
    const defaultType = recommended.length > 0 ? recommended[0] : groupTypes[0];
    setForm({ ...emptyForm, parentId, type: defaultType });
    setAllowedTypes(null); // show all types — recommended ones will be highlighted
    setShowForm(true);
  };

  // Create-only: editing a governance group (name, type, parent, status,
  // description, charter) happens on its detail page.
  const handleSave = async () => {
    if (!validation.validateAll(form) || !form.type) return;
    const payload = {
      ...form,
      ...(activeOrgId ? { orgId: activeOrgId } : {}),
    };
    let res: any;
    try {
      res = await apiClient.post('/governance-groups', payload);
      addToast('success', 'Governance group created');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to save governance group');
      return;
    }
    setShowForm(false); setForm(emptyForm); setAllowedTypes(null);
    fetchGroups();
    // Show governance recommendation warning if returned
    if (res?.warning) {
      addToast('info', res.warning);
    }
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

  const handleCancel = () => { setShowForm(false); setForm(emptyForm); setAllowedTypes(null); validation.clearErrors(); };


  // ── Computed values ──


  // Parent dropdown options: any group EXCEPT the one being edited and its own
  // descendants (which would create a cycle). We deliberately do NOT restrict
  // to the DAMA type hierarchy here — the backend accepts any parent, and the
  // advisory note below nudges toward best practice without blocking, so a
  // team can arrange their own hierarchy (e.g. nest a Council under an Office).
  // Create-only form: any group can be the parent (no self/descendant to
  // exclude, since the form never edits an existing node).
  const treeOptions = flattenTreeForSelect(tree);

  // Determine which types to show in the type dropdown
  const typeOptions = groupTypes; // always show all types
  const parentGroup = form.parentId ? flatGroups.find((g) => g.id === form.parentId) : null;
  const recommendedTypes = parentGroup ? (validChildren[parentGroup.type] || []) : [];

  // Advisory only: flag when the chosen parent isn't a DAMA-recommended parent
  // for this group's type, mirroring the "saved anyway" warning the create
  // endpoint returns. Never blocks the save.
  const labelForType = (t: string) => groupTypeLabels[t] || GROUP_TYPE_LABELS[t] || t;
  const parentPlacementNote = (() => {
    if (!parentGroup || !form.type) return null;
    if ((validChildren[parentGroup.type] || []).includes(form.type)) return null;
    const recommendedParents = findValidParentTypes(validChildren, form.type);
    return recommendedParents.length > 0
      ? `Governance best practices place ${labelForType(form.type)} under ${recommendedParents.map(labelForType).join(' or ')}, not ${labelForType(parentGroup.type)}. You can still save it here.`
      : `${labelForType(form.type)} is normally a top-level body. You can still nest it under ${labelForType(parentGroup.type)} if you want.`;
  })();

  // ── Render ──

  if (loading) return (
    <div>
      <Card shadow="none">
        <SkeletonRows rows={5} columns={4} />
      </Card>
    </div>
  );

  // Add-group form — rendered in the right panel when the tree has nodes, or
  // full-width when the tree is still empty (mirrors the Organizations page).
  const formCard = (
    <Card marginBottom={12}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        {allowedTypes ? 'Add Child Group' : 'Add New Governance Group'}
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
          <select aria-label="Type" style={selectStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, parentId: form.parentId })}>
            {typeOptions.map((t) => {
              const isRecommended = recommendedTypes.length > 0 && recommendedTypes.includes(t);
              const label = groupTypeLabels[t] || GROUP_TYPE_LABELS[t] || t;
              return <option key={t} value={t}>{label}{isRecommended ? ' (recommended)' : ''}</option>;
            })}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Parent Group</label>
          <select aria-label="Parent Group" style={selectStyle} value={form.parentId || ''} onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}>
            <option value="">-- No parent (top-level) --</option>
            {treeOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
          </select>
          {parentPlacementNote && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-warning)' }}>{parentPlacementNote}</div>
          )}
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
          <select aria-label="Status" style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
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
        <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
        <Button variant="primary" disabled={!form.name.trim() || !form.type} onClick={handleSave}>
          Add Group
        </Button>
      </div>
    </Card>
  );

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Governance Groups"
        subtitle={`Manage governance councils, committees, and working groups. ${flatGroups.length} groups total.`}
        actions={
          <ListToolbar
            export={
              flatGroups.length > 0 ? (
                <ExportMenu build={() => ({
                  filenameBase: 'governance-groups',
                  sheetName: 'Governance Groups',
                  headers: ['Name', 'Type', 'Parent', 'Description', 'Members', 'Status'],
                  rows: flatGroups.map((g) => [
                    g.name,
                    GROUP_TYPE_LABELS[g.type] || g.type,
                    flatGroups.find((p) => p.id === g.parentId)?.name || '',
                    g.description,
                    g.members.length,
                    g.status,
                  ]),
                })} />
              ) : undefined
            }
            view={flatGroups.length > 0 ? (
              <IconButton icon="eye" label="Visualize"
                onClick={() => navigate('/governance/visualization')} />
            ) : undefined}
            extra={isAdmin ? (
              <IconButton icon="wand"
                label={
                  flatGroups.length > 0
                    ? `Generate disabled — ${flatGroups.length} group${flatGroups.length === 1 ? '' : 's'} already exist. Delete all to regenerate.`
                    : 'Generate governance template'
                }
                disabled={flatGroups.length > 0}
                onClick={() => setConfirmGenerate(true)} />
            ) : undefined}
            primary={isAdmin ? (
              <IconButton icon="plus" label="Add group" variant="primary" onClick={openAdd} />
            ) : undefined}
          />
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
        onConfirm={async () => {
          const id = confirmDelete;
          setConfirmDelete(null);
          if (id) await handleDelete(id);
        }}
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

      {/* Governance Hierarchy Guidance */}
      {flatGroups.length === 0 ? (
        <div style={{ marginBottom: 12, padding: '14px 16px', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 2 }}>
              Recommended structure: Council {'\u2192'} Office {'\u2192'} Committee {'\u2192'} Stewardship Teams {'\u2192'} Working Groups {'\u2192'} Communities of Practice
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Get started quickly by creating the core governance groups in one click.</div>
          </div>
          {isAdmin && (
          <Button
            variant="primary"
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={async () => {
              if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
              try {
                const councilRes = await apiClient.post<{ success: boolean; data: { id: string } }>('/governance-groups', {
                  name: 'Data Governance Council', type: 'COUNCIL', parentId: null, orgId: activeOrgId, description: 'Top-level governance body providing strategic direction and oversight for data governance.', status: 'ACTIVE',
                });
                const councilId = councilRes.data?.id;
                if (councilId) {
                  await apiClient.post('/governance-groups', {
                    name: 'Data Governance Office', type: 'OFFICE', parentId: councilId, orgId: activeOrgId, description: 'Operational arm responsible for day-to-day data governance execution.', status: 'ACTIVE',
                  });
                  await apiClient.post('/governance-groups', {
                    name: 'Data Governance Committee', type: 'COMMITTEE', parentId: councilId, orgId: activeOrgId, description: 'Cross-functional committee coordinating data governance initiatives.', status: 'ACTIVE',
                  });
                }
                addToast('success', 'Created recommended governance structure');
                fetchGroups();
              } catch {
                addToast('error', 'Failed to create recommended structure');
              }
            }}
          >
            Create Recommended Structure
          </Button>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12, padding: '6px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
          <span style={{ opacity: 0.8 }}>Recommended structure:</span> Council {'\u2192'} Office {'\u2192'} Committee {'\u2192'} Stewardship Teams {'\u2192'} Working Groups {'\u2192'} Communities of Practice
        </div>
      )}

      {/* Summary stats — counts by group type, mirrors the Organizations page
          so the shape of the governance structure reads at a glance. */}
      {flatGroups.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {groupTypes.map((t) => {
            const count = flatGroups.filter((g) => g.type === t).length;
            if (count === 0) return null;
            const c = typeBadgeColors[t] || typeBadgeColors.COMMUNITY_OF_PRACTICE;
            return (
              <div key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: c.bg, color: c.color,
                borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 500,
              }}>
                <span style={{ fontWeight: 700 }}>{count}</span>
                <span>{GROUP_TYPE_LABELS[t] || t}{count === 1 ? '' : 's'}</span>
              </div>
            );
          })}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#ede9fe', color: '#5b21b6',
            borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 500,
            marginLeft: 'auto',
          }}>
            <span style={{ fontWeight: 700 }}>{flatGroups.reduce((a, g) => a + (g.members?.length || 0), 0)}</span>
            <span>Members</span>
          </div>
        </div>
      )}

      {/* Add form full-width when the tree is still empty (right-panel otherwise). */}
      {showForm && tree.length === 0 && formCard}

      <BulkActionBar count={checkedIds.size} onClear={() => setCheckedIds(new Set())}>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete Selected</BulkActionButton>
      </BulkActionBar>

      {/* Full-width group hierarchy — clicking a group opens its detail page
          (/governance-groups/:id), matching the Organizations page. An Add
          form opens in a 340px right panel while adding. */}
      <div style={{ display: 'grid', gridTemplateColumns: (tree.length > 0 && showForm) ? '1fr 340px' : '1fr', gap: 16, alignItems: 'start' }}>
        {/* Left — Tree */}
        <Card padding={0} shadow="none" style={{ alignSelf: 'start' }}>
          {/* Tree toolbar */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)', alignItems: 'center' }}>
            {isAdmin && <input type="checkbox" checked={flatGroups.length > 0 && checkedIds.size === flatGroups.length} onChange={toggleCheckAll} style={{ cursor: 'pointer' }} title="Select all" />}
            <ExpandCollapseControls size={11} onExpandAll={expandAll} onCollapseAll={collapseAll} />
          </div>

          {/* Tree body */}
          <div>
            {tree.length === 0 && !showForm ? (
              <EmptyState
                icon={renderNavIcon('/governance-groups')}
                title="No governance groups defined yet"
                description="Councils, committees, and working groups that carry governance decisions."
                action={isAdmin ? { label: '+ Add Group', onClick: openAdd } : undefined}
              />
            ) : (
              tree.map((node) => (
                <GroupTreeNode key={node.id} node={node} depth={0}
                  onDelete={(id) => setConfirmDelete(id)} onAddChild={openAddChild}
                  onSelect={(id) => navigate(`/governance-groups/${id}`)} selectedId={null}
                  expanded={expanded} toggleExpand={toggleExpand}
                  checkedIds={checkedIds} onToggleCheck={toggleCheck} canEdit={isAdmin} />
              ))
            )}
          </div>
        </Card>

        {/* Right — Add form (only while adding, with a populated tree). */}
        {showForm && tree.length > 0 && (
          <div style={{ alignSelf: 'start' }}>{formCard}</div>
        )}
      </div>
    </div>
  );
}
