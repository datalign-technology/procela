import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { INDUSTRIES } from '../types';
import ExportMenu from '../components/ExportMenu';
import ConfirmDialog from '../components/ConfirmDialog';
import OrgDeleteCleanupDialog, { CleanupActions } from '../components/OrgDeleteCleanupDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import HelpPopover from '../components/HelpPopover';
import { useToastStore } from '../stores/toastStore';
import SyncConnectionWizard from '../components/SyncConnectionWizard';

// ── Types ──

interface OrgNode {
  id: string; parentId: string | null; name: string; type: string;
  industry: string; description: string; headCount: number; children: OrgNode[];
}
interface OrgFlat {
  id: string; parentId: string | null; name: string; type: string;
  industry: string; description: string; headCount: number;
}
// ── Styles ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const btnIcon: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '2px 6px', fontSize: 11, color: 'var(--color-text-muted)', borderRadius: 4,
};
const typeBadge = (type: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    company: { bg: '#dbeafe', color: '#1e40af' }, division: { bg: '#ede9fe', color: '#5b21b6' },
    department: { bg: '#d1f0eb', color: '#0f4f46' }, team: { bg: '#fef3c7', color: '#92400e' },
    unit: { bg: '#f1f5f9', color: '#64748b' },
  };
  const c = colors[type] || colors.unit;
  return { display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600, textTransform: 'uppercase', background: c.bg, color: c.color };
};

// ── Helpers ──

interface FlatOrgOption { id: string; name: string; type: string; depth: number; label: string; }

function flattenTreeForSelect(nodes: OrgNode[], depth = 0): FlatOrgOption[] {
  const result: FlatOrgOption[] = [];
  for (const node of nodes) {
    const indent = '\u00A0\u00A0'.repeat(depth);
    const typeLabel = node.type.charAt(0).toUpperCase() + node.type.slice(1);
    result.push({ id: node.id, name: node.name, type: node.type, depth, label: `${indent}${node.name} (${typeLabel})` });
    if (node.children.length > 0) result.push(...flattenTreeForSelect(node.children, depth + 1));
  }
  return result;
}

// ── Forms ──

interface OrgFormData { name: string; parentId: string | null; type: string; industry: string; description: string; }
const emptyOrgForm: OrgFormData = { name: '', parentId: null, type: 'department', industry: '', description: '' };

// ── File Picker ──

function FilePicker({ accept, onFileRead, label }: { accept: string; onFileRead: (content: string, fileName: string) => void; label?: string; }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onFileRead(reader.result as string, file.name);
    reader.readAsText(file);
    if (inputRef.current) inputRef.current.value = '';
  };
  return (
    <>
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} style={{ display: 'none' }} />
      <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => inputRef.current?.click()}>{label || 'Browse File'}</button>
    </>
  );
}

// ── Org Tree Node ──

function isDescendantOfAccessible(node: OrgNode, accessibleIds: Set<string>, allOrgs: OrgFlat[]): boolean {
  if (accessibleIds.size === 0) return true; // dev fallback
  // Walk up the parent chain to see if any ancestor is accessible
  let currentParentId = node.parentId;
  while (currentParentId) {
    if (accessibleIds.has(currentParentId)) return true;
    const parent = allOrgs.find((o) => o.id === currentParentId);
    if (!parent) break;
    currentParentId = parent.parentId;
  }
  return false;
}

// Root org is system-protected — never selectable for bulk delete.


function OrgTreeNode({ node, depth, onEdit, onDelete, onAddChild, expanded, toggleExpand, peopleCounts, accessibleOrgIds, allOrgs, selectedIds, toggleSelect, onSelect, activeDetailId }: {
  node: OrgNode; depth: number;
  onEdit: (org: OrgFlat) => void; onDelete: (id: string) => void; onAddChild: (parentId: string) => void;
  expanded: Set<string>; toggleExpand: (id: string) => void; peopleCounts: Record<string, number>;
  accessibleOrgIds: Set<string>;
  allOrgs: OrgFlat[];
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  onSelect: (id: string) => void;
  activeDetailId: string | null;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const count = peopleCounts[node.id] || 0;
  const canEdit = accessibleOrgIds.size === 0 || accessibleOrgIds.has(node.id) || isDescendantOfAccessible(node, accessibleOrgIds, allOrgs);
  const isSelected = selectedIds.has(node.id);
  const isRoot = false;
  const isActive = activeDetailId === node.id;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', paddingLeft: 12 + depth * 22,
          borderBottom: '1px solid var(--color-border)',
          background: isActive ? '#dbeafe' : isSelected ? '#f0f9ff' : undefined,
          transition: 'background 0.1s',
          minWidth: 0,
        }}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
      >
        {/* Selection checkbox — hidden for protected root org */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleSelect(node.id)}
          disabled={isRoot || !canEdit}
          title={isRoot ? 'Cannot select the root organization' : !canEdit ? 'Read-only' : 'Select for bulk delete'}
          style={{ flexShrink: 0, width: 14, height: 14, cursor: isRoot || !canEdit ? 'not-allowed' : 'pointer', opacity: isRoot ? 0 : 1 }}
        />
        <span onClick={() => { if (hasChildren) toggleExpand(node.id); }}
          style={{ width: 14, fontSize: 10, color: 'var(--color-text-muted)', cursor: hasChildren ? 'pointer' : 'default', userSelect: 'none', flexShrink: 0 }}>
          {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : '\u2022'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span onClick={(e) => { e.stopPropagation(); onSelect(node.id); }} style={{ fontWeight: 500, fontSize: 13, cursor: 'pointer', color: isActive ? 'var(--color-primary)' : undefined }}>{node.name}</span>
            <span style={typeBadge(node.type)}>{node.type}</span>
            {node.industry && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: '#f8fafc', padding: '1px 6px', borderRadius: 3, border: '1px solid #e2e8f0' }}>
                {node.industry}
              </span>
            )}
            {count > 0 && (
              <span style={{ fontSize: 10, color: '#5b21b6', background: '#ede9fe', padding: '1px 7px', borderRadius: 8, fontWeight: 500 }}>
                {count} {count === 1 ? 'person' : 'people'}
              </span>
            )}
            {hasChildren && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                {node.children.length} child{node.children.length === 1 ? '' : 'ren'}
              </span>
            )}
          </div>
          {node.description && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.description}
            </div>
          )}
        </div>
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <>
              <IconButton size="sm" icon="plus" label="Add child" variant="primary" onClick={() => onAddChild(node.id)} />
              <IconButton size="sm" icon="edit" label="Edit" onClick={() => onEdit(node)} />
              {!isRoot && (
                <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => onDelete(node.id)} />
              )}
            </>
          )}
        </div>
        {!canEdit && (
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>read-only</span>
        )}
      </div>
      {isExpanded && node.children.map((child) => (
        <OrgTreeNode key={child.id} node={child} depth={depth + 1}
          onEdit={onEdit} onDelete={onDelete} onAddChild={onAddChild}
          expanded={expanded} toggleExpand={toggleExpand} peopleCounts={peopleCounts}
          accessibleOrgIds={accessibleOrgIds} allOrgs={allOrgs}
          selectedIds={selectedIds} toggleSelect={toggleSelect}
          onSelect={onSelect} activeDetailId={activeDetailId} />
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT — Side-by-side: Org tree (left) + People (right)
// ══════════════════════════════════════════════════════════════

export default function OrganizationsPage() {
  const { triggerRefresh, orgs: accessibleOrgs, activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Org state
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [orgStatusMode, setOrgStatusMode] = useState<'simple' | 'advanced'>('simple');
  const [flatOrgs, setFlatOrgs] = useState<OrgFlat[]>([]);
  const [orgTypes, setOrgTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['00000000-0000-0000-0000-000000000010']));
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [orgForm, setOrgForm] = useState<OrgFormData>(emptyOrgForm);
  const [showImport, setShowImport] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importParent, setImportParent] = useState('');

  // Per-org people counts for the tree badges. Fetch headcounts from the
  // People API in a single call — no full person records kept here.
  const [peopleCounts, setPeopleCounts] = useState<Record<string, number>>({});

  const [detailOrgId, setDetailOrgId] = useState<string | null>(null);

  // Bulk select state for the tree.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // Scope the org tree to the active "Working In" context so siblings
      // and ancestors are hidden even when the user has broader permissions.
      const orgQuery = activeOrgId ? `?scopeOrgId=${encodeURIComponent(activeOrgId)}` : '';
      const [orgRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: OrgFlat[]; tree: OrgNode[]; orgTypes: string[] }>(`/organizations${orgQuery}`),
        apiClient.get<{ success: boolean; data: Array<{ id: string; orgIds: string[] }> }>('/people'),
      ]);
      const nextFlat = orgRes.data || [];
      setTree(orgRes.tree || []); setFlatOrgs(nextFlat); setOrgTypes(orgRes.orgTypes || []);
      const counts: Record<string, number> = {};
      for (const p of peopleRes.data || []) {
        for (const oid of p.orgIds || []) counts[oid] = (counts[oid] || 0) + 1;
      }
      setPeopleCounts(counts);
      // Fetch org's status mode
      if (activeOrgId) {
        try {
          const orgRes = await apiClient.get<{ success: boolean; data: { statusMode?: string } }>(`/organizations/${activeOrgId}`);
          setOrgStatusMode((orgRes.data?.statusMode as 'simple' | 'advanced') || 'simple');
        } catch { /* */ }
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-open the import panel when navigated with ?import=1 (e.g. from the
  // OnboardingWizard's "skip and import" link). Strips the param after opening
  // so a refresh doesn't keep re-opening it.
  useEffect(() => {
    if (searchParams.get('import') === '1') {
      setShowImport(true);
      const next = new URLSearchParams(searchParams);
      next.delete('import');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const orgOptions = flattenTreeForSelect(tree);
  const accessibleOrgIds = new Set(accessibleOrgs.map((o) => o.id));
  const detailOrg = detailOrgId ? flatOrgs.find((o) => o.id === detailOrgId) || null : null;

  // ── Org handlers ──
  const toggleExpand = (id: string) => setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const expandAll = () => setExpanded(new Set(flatOrgs.map((o) => o.id)));

  const openAddOrg = (parentId: string | null = null) => { setOrgForm({ ...emptyOrgForm, parentId }); setEditingOrgId(null); setShowOrgForm(true); };
  const openEditOrg = (org: OrgFlat) => { setOrgForm({ name: org.name, parentId: org.parentId, type: org.type, industry: org.industry, description: org.description }); setEditingOrgId(org.id); setShowOrgForm(true); };
  const handleSaveOrg = async () => {
    if (!orgForm.name.trim()) return;
    if (editingOrgId) await apiClient.put(`/organizations/${editingOrgId}`, orgForm);
    else await apiClient.post('/organizations', orgForm);
    setShowOrgForm(false); setEditingOrgId(null); setOrgForm(emptyOrgForm); fetchData(); triggerRefresh();
  };
  const [confirmDeleteOrg, setConfirmDeleteOrg] = useState<string | null>(null);
  const [deleteOrgImpact, setDeleteOrgImpact] = useState<Record<string, number> | null>(null);
  const [deleteOrgBusy, setDeleteOrgBusy] = useState(false);

  const promptDeleteOrg = async (id: string) => {
    try {
      const res = await apiClient.get<{ success: boolean; data: Record<string, number> }>(`/organizations/${id}/impact`);
      setDeleteOrgImpact(res.data || null);
    } catch { setDeleteOrgImpact(null); }
    setConfirmDeleteOrg(id);
  };

  // Compute the org and all its descendants — used to lock the move-target
  // picker so a category can't be re-homed inside the subtree being deleted.
  const subtreeIdsFor = useCallback((rootId: string): Set<string> => {
    const ids = new Set<string>([rootId]);
    const walk = (pid: string) => {
      for (const o of flatOrgs) {
        if (o.parentId === pid && !ids.has(o.id)) {
          ids.add(o.id);
          walk(o.id);
        }
      }
    };
    walk(rootId);
    return ids;
  }, [flatOrgs]);

  const handleDeleteOrg = async (id: string, actions?: CleanupActions) => {
    setDeleteOrgBusy(true);
    try {
      await apiClient.delete(`/organizations/${id}`, actions ? { actions } : undefined);
      // Build a brief summary toast from the chosen actions, if any.
      const moves = actions ? Object.values(actions).filter((a) => a?.type === 'move').length : 0;
      const orphans = actions ? Object.values(actions).filter((a) => a?.type === 'orphan').length : 0;
      const parts: string[] = ['Organization deleted'];
      if (moves > 0) parts.push(`${moves} categor${moves === 1 ? 'y' : 'ies'} moved`);
      if (orphans > 0) parts.push(`${orphans} categor${orphans === 1 ? 'y' : 'ies'} orphaned`);
      addToast('success', parts.join(' · '));
      setConfirmDeleteOrg(null);
      setDeleteOrgImpact(null);
      fetchData();
      triggerRefresh();
    } catch (e: any) {
      addToast('error', e?.response?.data?.error || e?.message || 'Cannot delete');
    } finally {
      setDeleteOrgBusy(false);
    }
  };

  // ── Bulk select handlers ──
  const toggleOrgSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Selectable orgs = everything in the user's edit scope, minus the root.
  const selectableOrgIds = flatOrgs
    .filter((o) => (accessibleOrgIds.size === 0 || accessibleOrgIds.has(o.id) || (() => {
      let pid = o.parentId;
      while (pid) { if (accessibleOrgIds.has(pid)) return true; pid = flatOrgs.find((p) => p.id === pid)?.parentId || null; }
      return false;
    })()))
    .map((o) => o.id);
  const toggleSelectAllOrgs = () => {
    if (selectedIds.size === selectableOrgIds.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(selectableOrgIds));
  };
  const handleBulkDeleteOrgs = async () => {
    if (selectedIds.size === 0) return;
    // Snapshot the records we're about to delete so we can offer Undo.
    const toDelete = flatOrgs.filter((o) => selectedIds.has(o.id));
    const ids = toDelete.map((o) => o.id);
    let failures = 0;
    for (const id of ids) {
      try { await apiClient.delete(`/organizations/${id}`); }
      catch { failures++; }
    }
    setSelectedIds(new Set());
    fetchData();
    triggerRefresh();
    const count = ids.length - failures;
    if (count > 0) {
      addToast('success', `Deleted ${count} organization${count === 1 ? '' : 's'}`, {
        action: {
          label: 'Undo',
          // Recreate each deleted record. Parents first so children can
          // reattach via `parentId`. We don't rebuild sub-trees that
          // were also selected — the user can re-select to include them.
          handler: async () => {
            const sortedByDepth = [...toDelete].sort((a, b) => {
              // company < division < department < team < unit (rough proxy for depth)
              const rank = (t: string) => ['company', 'division', 'department', 'team', 'unit'].indexOf(t);
              return rank(a.type) - rank(b.type);
            });
            for (const o of sortedByDepth) {
              await apiClient.post('/organizations', {
                name: o.name, parentId: o.parentId, type: o.type,
                industry: o.industry, description: o.description,
              }).catch(() => {});
            }
            fetchData();
            triggerRefresh();
            addToast('success', 'Restored.');
          },
        },
      });
    }
    if (failures > 0) addToast('info', `${failures} org${failures === 1 ? '' : 's'} were already removed by cascade.`);
  };
  const handleImport = async () => {
    if (!importText.trim()) return;
    try {
      const body: any = { parentId: importParent || null };
      if (importFormat === 'csv') body.csv = importText; else body.organizations = JSON.parse(importText);
      const result = await apiClient.post<{ success: boolean; message?: string; skipped?: number }>('/organizations/import', body);
      if (result.skipped && result.skipped > 0 && result.message) {
        alert(result.message);
      }
      setShowImport(false); setImportText(''); fetchData(); expandAll(); triggerRefresh();
    } catch (e) { alert(e instanceof Error ? e.message : 'Import failed'); }
  };

  if (loading) return <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Organizations</h1>
            <HelpPopover id="orgs-overview" title="Organizations">
              The hierarchy of company → division → department → team. The
              "Working in" selector at the top of every page scopes most of
              the app to the org you pick — change it to switch context.
            </HelpPopover>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            The organization hierarchy. Manage people on the <a href="/people" style={{ color: 'var(--color-primary)' }}>People</a> page.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {flatOrgs.length > 0 && (
            <IconButton
              icon="eye"
              label="Visualize hierarchy"
              onClick={() => navigate('/organizations/visualization')}
            />
          )}
          {flatOrgs.length > 0 && (
            <ExportMenu build={() => ({
              filenameBase: 'organizations',
              sheetName: 'Organizations',
              headers: ['Name', 'Type', 'Parent', 'Industry', 'Description', 'People'],
              rows: flatOrgs.map((o) => [
                o.name,
                o.type,
                flatOrgs.find((p) => p.id === o.parentId)?.name || '',
                o.industry,
                o.description,
                peopleCounts[o.id] || 0,
              ]),
            })} />
          )}
          <IconButton icon="upload" label="Import organizations" onClick={() => setShowImport(true)} />
          <IconButton icon="link" label="Connect to source" onClick={() => setShowSync(true)} />
          <IconButton icon="plus" label="Add organization" variant="primary" onClick={() => openAddOrg(null)} />
        </div>
      </div>

      {/* Import Org Panel */}
      {showImport && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>Import Organizations</h3>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Paste CSV or JSON, or browse a file. Format is auto-detected.</span>
            </div>
            <button onClick={() => { setShowImport(false); setImportText(''); }} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--color-text-muted)' }}>&times;</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <select style={{ ...inputStyle, width: 'auto', minWidth: 180, appearance: 'auto' as any, fontSize: 12 }} value={importParent} onChange={(e) => setImportParent(e.target.value)}>
              <option value="">Import as top-level</option>
              {orgOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
            </select>
            <FilePicker accept=".csv,.json,.txt" onFileRead={(content, fileName) => { setImportText(content); if (fileName.endsWith('.json')) setImportFormat('json'); else setImportFormat('csv'); }} />
          </div>
          <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: 'var(--font-mono)', fontSize: 11 }} value={importText} onChange={(e) => setImportText(e.target.value)}
            placeholder={'Name,Parent,Type,Industry,Description\nAcme Corp,,company,Manufacturing,Parent company'} />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flex: 1 }}>CSV columns: Name, Parent, Type, Industry, Description</span>
            <button style={btnSecondary} onClick={() => { setShowImport(false); setImportText(''); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !importText.trim() ? 0.6 : 1, cursor: !importText.trim() ? 'not-allowed' : 'pointer' }} disabled={!importText.trim()} onClick={handleImport}>Import</button>
          </div>
        </div>
      )}

      {/* Add/Edit Org Form — shown in detail panel when master-detail is active, or full-width when tree is empty */}
      {showOrgForm && tree.length === 0 && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editingOrgId ? 'Edit Organization' : 'Add Organization'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus style={inputStyle} value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} placeholder="Organization name" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.type} onChange={(e) => setOrgForm({ ...orgForm, type: e.target.value, industry: (e.target.value === 'company' || e.target.value === 'division') ? orgForm.industry : '' })}>
                {orgTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Parent</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.parentId || ''} onChange={(e) => setOrgForm({ ...orgForm, parentId: e.target.value || null })}>
                <option value="">-- No parent (top-level) --</option>
                {flatOrgs.filter((o) => o.id !== editingOrgId).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
            {(orgForm.type === 'company' || orgForm.type === 'division') && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Industry</label>
                <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.industry} onChange={(e) => setOrgForm({ ...orgForm, industry: e.target.value })}>
                  <option value="">-- Select --</option>
                  {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                </select>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input style={inputStyle} value={orgForm.description} onChange={(e) => setOrgForm({ ...orgForm, description: e.target.value })} placeholder="Brief description" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowOrgForm(false); setEditingOrgId(null); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !orgForm.name.trim() ? 0.6 : 1, cursor: !orgForm.name.trim() ? 'not-allowed' : 'pointer' }} disabled={!orgForm.name.trim()} onClick={handleSaveOrg}>
              {editingOrgId ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Summary stats — counts by org type + total people, mirrors the
          legend pattern from the Process Catalog page. Helps the user
          see the shape of their org at a glance instead of having to
          scan the tree. */}
      {flatOrgs.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {orgTypes.map((t) => {
            const count = flatOrgs.filter((o) => o.type === t).length;
            if (count === 0) return null;
            const tb = typeBadge(t);
            return (
              <div key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: tb.background, color: tb.color,
                borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 500,
              }}>
                <span style={{ fontWeight: 700 }}>{count}</span>
                <span>{t.charAt(0).toUpperCase() + t.slice(1)}{count === 1 ? '' : 's'}</span>
              </div>
            );
          })}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#ede9fe', color: '#5b21b6',
            borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 500,
            marginLeft: 'auto',
          }}>
            <span style={{ fontWeight: 700 }}>{Object.values(peopleCounts).reduce((a, b) => a + b, 0)}</span>
            <span>People assigned</span>
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
          <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>
            Note: deleting a parent removes its descendants too.
          </span>
        </div>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Organizations?"
        message={`Delete ${selectedIds.size} selected organizations and any descendants? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDeleteOrgs(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      <OrgDeleteCleanupDialog
        open={confirmDeleteOrg !== null}
        orgName={(() => {
          const o = flatOrgs.find((x) => x.id === confirmDeleteOrg);
          return o?.name || 'this organization';
        })()}
        impact={deleteOrgImpact}
        accessibleOrgs={accessibleOrgs.map((o) => ({ id: o.id, name: o.name, type: (o as any).type || 'org' }))}
        excludedTargetIds={confirmDeleteOrg ? subtreeIdsFor(confirmDeleteOrg) : new Set()}
        busy={deleteOrgBusy}
        onConfirm={async (actions) => {
          if (confirmDeleteOrg) await handleDeleteOrg(confirmDeleteOrg, actions);
        }}
        onCancel={() => { setConfirmDeleteOrg(null); setDeleteOrgImpact(null); }}
      />

      {/* ══ MAIN BODY — master-detail: tree (left) + detail panel (right) ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: tree.length > 0 ? '1fr 360px' : '1fr', gap: 16, alignItems: 'start' }}>
        {/* Left: Org Tree */}
        <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
        {/* Tree toolbar — select-all, expand/collapse */}
        <div style={{ display: 'flex', gap: 12, padding: '8px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)', alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <input
              type="checkbox"
              checked={selectableOrgIds.length > 0 && selectedIds.size === selectableOrgIds.length}
              onChange={toggleSelectAllOrgs}
              disabled={selectableOrgIds.length === 0}
            />
            Select all
          </label>
          <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-primary)' }} onClick={expandAll}>Expand All</button>
          <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-primary)' }} onClick={() => setExpanded(new Set())}>Collapse All</button>
        </div>

        {/* Status Mode toggle — org-level setting */}
        {activeOrgId && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', flexWrap: 'wrap',
            background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)',
            fontSize: 11,
          }}>
            <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>Lifecycle:</span>
            <span style={{ fontWeight: 600, fontSize: 11 }}>
              {orgStatusMode === 'advanced' ? 'Advanced' : 'Simple'}
            </span>
            <button
              onClick={async () => {
                const newMode = orgStatusMode === 'advanced' ? 'simple' : 'advanced';
                const confirm = window.confirm(
                  newMode === 'simple'
                    ? 'Switch to Simple mode (3 statuses)? Items currently in Proposed, Under Review, or Approved will be moved to Draft.'
                    : 'Switch to Advanced mode (6 statuses)? This adds Proposed, Under Review, and Approved steps between Draft and Active.',
                );
                if (!confirm) return;
                try {
                  const res = await apiClient.post<{ success: boolean; message?: string; migrated?: number }>(`/organizations/${activeOrgId}/status-mode`, { mode: newMode });
                  setOrgStatusMode(newMode);
                  if (res.message) alert(res.message);
                } catch { /* */ }
              }}
              style={{
                marginLeft: 'auto', padding: '2px 10px', fontSize: 10, fontWeight: 500,
                background: 'transparent', border: '1px solid var(--color-border)',
                borderRadius: 4, cursor: 'pointer', color: 'var(--color-primary)',
              }}
            >
              Switch to {orgStatusMode === 'advanced' ? 'Simple' : 'Advanced'}
            </button>
          </div>
        )}

        {/* Tree — uses full page width. No inner scroll container:
            the page itself scrolls, which avoids the double-scrollbar
            issue that `overflowY: auto` creates (it also implicitly
            sets overflow-x to auto, triggering a spurious horizontal
            scrollbar on any tiny width overshoot). */}
        <div>
          {tree.length === 0 ? (
            <EmptyState
              icon={'\u2616'}
              title="No organizations yet"
              description="Define your company, its divisions, and sub-teams. Most of Procela is scoped to the org you select at the top of the page, so this is the first thing to set up."
              action={{ label: '+ Add Organization', onClick: () => openAddOrg(null) }}
              secondaryAction={{ label: 'Import from CSV', onClick: () => setShowImport(true) }}
            />
          ) : (
            tree.map((node) => (
              <OrgTreeNode key={node.id} node={node} depth={0}
                onEdit={openEditOrg} onDelete={promptDeleteOrg} onAddChild={(pid) => openAddOrg(pid)}
                expanded={expanded} toggleExpand={toggleExpand} peopleCounts={peopleCounts}
                accessibleOrgIds={accessibleOrgIds} allOrgs={flatOrgs}
                selectedIds={selectedIds} toggleSelect={toggleOrgSelect}
                onSelect={setDetailOrgId} activeDetailId={detailOrgId} />
            ))
          )}
        </div>
        </div>

        {/* Right: Detail Panel */}
        {tree.length > 0 && (
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', position: 'sticky', top: 16 }}>
            {showOrgForm ? (
              <div style={{ padding: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editingOrgId ? 'Edit Organization' : 'Add Organization'}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
                    <input autoFocus style={inputStyle} value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} placeholder="Organization name" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type</label>
                    <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.type} onChange={(e) => setOrgForm({ ...orgForm, type: e.target.value, industry: (e.target.value === 'company' || e.target.value === 'division') ? orgForm.industry : '' })}>
                      {orgTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Parent</label>
                    <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.parentId || ''} onChange={(e) => setOrgForm({ ...orgForm, parentId: e.target.value || null })}>
                      <option value="">-- No parent (top-level) --</option>
                      {flatOrgs.filter((o) => o.id !== editingOrgId).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                    </select>
                  </div>
                  {(orgForm.type === 'company' || orgForm.type === 'division') && (
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Industry</label>
                      <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.industry} onChange={(e) => setOrgForm({ ...orgForm, industry: e.target.value })}>
                        <option value="">-- Select --</option>
                        {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
                    <input style={inputStyle} value={orgForm.description} onChange={(e) => setOrgForm({ ...orgForm, description: e.target.value })} placeholder="Brief description" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
                  <button style={btnSecondary} onClick={() => { setShowOrgForm(false); setEditingOrgId(null); }}>Cancel</button>
                  <button style={{ ...btnPrimary, opacity: !orgForm.name.trim() ? 0.6 : 1, cursor: !orgForm.name.trim() ? 'not-allowed' : 'pointer' }} disabled={!orgForm.name.trim()} onClick={handleSaveOrg}>
                    {editingOrgId ? 'Save' : 'Add'}
                  </button>
                </div>
              </div>
            ) : detailOrg ? (
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={typeBadge(detailOrg.type)}>{detailOrg.type}</span>
                      {detailOrg.industry && <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: '#f8fafc', padding: '1px 6px', borderRadius: 3, border: '1px solid #e2e8f0' }}>{detailOrg.industry}</span>}
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{detailOrg.name}</h3>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <IconButton size="sm" icon="plus" label="Add child" variant="primary" onClick={() => openAddOrg(detailOrg.id)} />
                    <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEditOrg(detailOrg)} />
                    <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => promptDeleteOrg(detailOrg.id)} />
                  </div>
                </div>
                {detailOrg.description && (
                  <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>{detailOrg.description}</p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {detailOrg.parentId && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Parent</span>
                      <span style={{ fontWeight: 500, cursor: 'pointer', color: 'var(--color-primary)' }}
                        onClick={() => setDetailOrgId(detailOrg.parentId)}>
                        {flatOrgs.find((o) => o.id === detailOrg.parentId)?.name || '--'}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>People</span>
                    <span style={{ fontWeight: 600, color: '#5b21b6' }}>{peopleCounts[detailOrg.id] || 0}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Children</span>
                    <span style={{ fontWeight: 500 }}>{flatOrgs.filter((o) => o.parentId === detailOrg.id).length}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Click an organization name to see its details here.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <SyncConnectionWizard open={showSync} onClose={() => setShowSync(false)} targetEntity="organizations" orgId={activeOrgId || ''} onCreated={() => { fetchData(); triggerRefresh(); }} />
    </div>
  );
}

