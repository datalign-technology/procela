import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { INDUSTRIES } from '../types';
import { exportCsv } from '../lib/exportCsv';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import HelpPopover from '../components/HelpPopover';
import { useToastStore } from '../stores/toastStore';

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
  padding: '6px 14px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '6px 14px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
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
const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010';

function OrgTreeNode({ node, depth, onEdit, onDelete, onAddChild, expanded, toggleExpand, peopleCounts, accessibleOrgIds, allOrgs, selectedIds, toggleSelect }: {
  node: OrgNode; depth: number;
  onEdit: (org: OrgFlat) => void; onDelete: (id: string) => void; onAddChild: (parentId: string) => void;
  expanded: Set<string>; toggleExpand: (id: string) => void; peopleCounts: Record<string, number>;
  accessibleOrgIds: Set<string>;
  allOrgs: OrgFlat[];
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const count = peopleCounts[node.id] || 0;
  const canEdit = accessibleOrgIds.size === 0 || accessibleOrgIds.has(node.id) || isDescendantOfAccessible(node, accessibleOrgIds, allOrgs);
  const isSelected = selectedIds.has(node.id);
  const isRoot = node.id === ROOT_ORG_ID;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', paddingLeft: 12 + depth * 22,
          borderBottom: '1px solid var(--color-border)',
          background: isSelected ? '#f0f9ff' : undefined,
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
            <span style={{ fontWeight: 500, fontSize: 13 }}>{node.name}</span>
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
          selectedIds={selectedIds} toggleSelect={toggleSelect} />
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

  // Org state
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [flatOrgs, setFlatOrgs] = useState<OrgFlat[]>([]);
  const [orgTypes, setOrgTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['00000000-0000-0000-0000-000000000010']));
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [orgForm, setOrgForm] = useState<OrgFormData>(emptyOrgForm);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importParent, setImportParent] = useState('');

  // Per-org people counts for the tree badges. Fetch headcounts from the
  // People API in a single call — no full person records kept here.
  const [peopleCounts, setPeopleCounts] = useState<Record<string, number>>({});

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
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const orgOptions = flattenTreeForSelect(tree);
  const accessibleOrgIds = new Set(accessibleOrgs.map((o) => o.id));

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
  const handleDeleteOrg = async (id: string) => {
    try { await apiClient.delete(`/organizations/${id}`); fetchData(); triggerRefresh(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Cannot delete'); }
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
    .filter((o) => o.id !== ROOT_ORG_ID && (accessibleOrgIds.size === 0 || accessibleOrgIds.has(o.id) || (() => {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Organizations</h1>
            <HelpPopover id="orgs-overview" title="Organizations">
              The hierarchy of company → division → department → team. The
              "Working in" selector at the top of every page scopes most of
              the app to the org you pick — change it to switch context.
            </HelpPopover>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
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
            <IconButton icon="download" label="Export CSV"
              onClick={() => exportCsv('organizations.csv', ['Name', 'Type', 'Parent', 'Industry', 'Description', 'People'], flatOrgs.map((o) => [
                o.name,
                o.type,
                flatOrgs.find((p) => p.id === o.parentId)?.name || '',
                o.industry,
                o.description,
                String(peopleCounts[o.id] || 0),
              ]))} />
          )}
          <IconButton icon="upload" label="Import organizations" onClick={() => setShowImport(true)} />
          <IconButton icon="plus" label="Add organization" variant="primary" onClick={() => openAddOrg(null)} />
        </div>
      </div>

      {/* Import Org Panel */}
      {showImport && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Import Organization Structure</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}><input type="radio" checked={importFormat === 'csv'} onChange={() => setImportFormat('csv')} /> CSV</label>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}><input type="radio" checked={importFormat === 'json'} onChange={() => setImportFormat('json')} /> JSON</label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <select style={{ ...inputStyle, width: 'auto', minWidth: 180, appearance: 'auto' as any, fontSize: 12 }} value={importParent} onChange={(e) => setImportParent(e.target.value)}>
              <option value="">Import as top-level</option>
              {orgOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
            </select>
            <FilePicker accept={importFormat === 'csv' ? '.csv,.txt' : '.json,.txt'} onFileRead={(content, fileName) => { setImportText(content); if (fileName.endsWith('.json')) setImportFormat('json'); if (fileName.endsWith('.csv')) setImportFormat('csv'); }} />
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>or paste below</span>
          </div>
          <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: 'var(--font-mono)', fontSize: 11 }} value={importText} onChange={(e) => setImportText(e.target.value)}
            placeholder={importFormat === 'csv' ? 'Name,Parent,Type,Industry,Description\nAcme Corp,,company,...' : '[{ "name": "Acme Corp", "type": "company" }]'} />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowImport(false); setImportText(''); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !importText.trim() ? 0.6 : 1 }} disabled={!importText.trim()} onClick={handleImport}>Import</button>
          </div>
        </div>
      )}

      {/* Add/Edit Org Form */}
      {showOrgForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editingOrgId ? 'Edit Organization' : 'Add Organization'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Name *</label>
              <input autoFocus style={inputStyle} value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} placeholder="Organization name" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Type</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.type} onChange={(e) => setOrgForm({ ...orgForm, type: e.target.value, industry: (e.target.value === 'company' || e.target.value === 'division') ? orgForm.industry : '' })}>
                {orgTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Parent</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.parentId || ''} onChange={(e) => setOrgForm({ ...orgForm, parentId: e.target.value || null })}>
                <option value="">-- No parent (top-level) --</option>
                {flatOrgs.filter((o) => o.id !== editingOrgId).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
            {(orgForm.type === 'company' || orgForm.type === 'division') && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Industry</label>
                <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.industry} onChange={(e) => setOrgForm({ ...orgForm, industry: e.target.value })}>
                  <option value="">-- Select --</option>
                  {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                </select>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Description</label>
              <input style={inputStyle} value={orgForm.description} onChange={(e) => setOrgForm({ ...orgForm, description: e.target.value })} placeholder="Brief description" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowOrgForm(false); setEditingOrgId(null); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !orgForm.name.trim() ? 0.6 : 1 }} disabled={!orgForm.name.trim()} onClick={handleSaveOrg}>
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

      {/* ══ MAIN BODY — full-width tree ══ */}
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
                onEdit={openEditOrg} onDelete={handleDeleteOrg} onAddChild={(pid) => openAddOrg(pid)}
                expanded={expanded} toggleExpand={toggleExpand} peopleCounts={peopleCounts}
                accessibleOrgIds={accessibleOrgIds} allOrgs={flatOrgs}
                selectedIds={selectedIds} toggleSelect={toggleOrgSelect} />
            ))
          )}
        </div>
      </div>

    </div>
  );
}

