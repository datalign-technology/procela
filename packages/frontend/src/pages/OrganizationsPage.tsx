import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { INDUSTRIES } from '../types';
import { exportCsv } from '../lib/exportCsv';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';

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
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12, borderTop: '1px solid var(--color-border)',
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

function OrgTreeNode({ node, depth, onEdit, onDelete, onAddChild, onViewPeople, expanded, toggleExpand, peopleCounts, accessibleOrgIds, allOrgs }: {
  node: OrgNode; depth: number;
  onEdit: (org: OrgFlat) => void; onDelete: (id: string) => void; onAddChild: (parentId: string) => void;
  onViewPeople: (id: string) => void;
  expanded: Set<string>; toggleExpand: (id: string) => void; peopleCounts: Record<string, number>;
  accessibleOrgIds: Set<string>;
  allOrgs: OrgFlat[];
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const count = peopleCounts[node.id] || 0;
  const canEdit = accessibleOrgIds.size === 0 || accessibleOrgIds.has(node.id) || isDescendantOfAccessible(node, accessibleOrgIds, allOrgs);

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', paddingLeft: 10 + depth * 18,
          borderBottom: '1px solid var(--color-border)',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
      >
        <span onClick={() => { if (hasChildren) toggleExpand(node.id); }}
          style={{ width: 14, fontSize: 10, color: 'var(--color-text-muted)', cursor: hasChildren ? 'pointer' : 'default', userSelect: 'none' }}>
          {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : '\u2022'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
            <span style={typeBadge(node.type)}>{node.type}</span>
            {count > 0 && <span style={{ fontSize: 9, color: 'var(--color-text-muted)', background: '#f1f5f9', padding: '0px 5px', borderRadius: 8 }}>{count}</span>}
          </div>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <IconButton size="sm" icon="users" label={count > 0 ? `View ${count} people` : 'View people'} onClick={() => onViewPeople(node.id)} />
          {canEdit && (
            <>
              <IconButton size="sm" icon="plus" label="Add child" variant="primary" onClick={() => onAddChild(node.id)} />
              <IconButton size="sm" icon="edit" label="Edit" onClick={() => onEdit(node)} />
              {node.id !== '00000000-0000-0000-0000-000000000010' && (
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
          onEdit={onEdit} onDelete={onDelete} onAddChild={onAddChild} onViewPeople={onViewPeople}
          expanded={expanded} toggleExpand={toggleExpand} peopleCounts={peopleCounts}
          accessibleOrgIds={accessibleOrgIds} allOrgs={allOrgs} />
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT — Side-by-side: Org tree (left) + People (right)
// ══════════════════════════════════════════════════════════════

export default function OrganizationsPage() {
  const { triggerRefresh, orgs: accessibleOrgs, activeOrgId } = useOrgContext();
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

  // Tree vs. Visualize mode for the right side of the layout.
  const [viewMode, setViewMode] = useState<'tree' | 'visualize'>('tree');

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
  const handleImport = async () => {
    if (!importText.trim()) return;
    try {
      const body: any = { parentId: importParent || null };
      if (importFormat === 'csv') body.csv = importText; else body.organizations = JSON.parse(importText);
      await apiClient.post('/organizations/import', body);
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
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            The organization hierarchy. Click <em>People</em> on a row to manage assignments for that org.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <IconButton
            icon="eye"
            label={viewMode === 'tree' ? 'Visualize hierarchy' : 'Tree view'}
            onClick={() => setViewMode((m) => (m === 'tree' ? 'visualize' : 'tree'))}
          />
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

      {/* ══ MAIN BODY ══ */}
      {viewMode === 'tree' ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

          {/* LEFT: Org Tree */}
          <div style={{ width: 380, flexShrink: 0, background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            {/* Tree toolbar */}
            <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
              <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-primary)' }} onClick={expandAll}>Expand All</button>
              <button style={{ ...btnIcon, fontSize: 11, color: 'var(--color-primary)' }} onClick={() => setExpanded(new Set())}>Collapse All</button>
            </div>

            {/* Tree */}
            <div style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
              {tree.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No organizations yet.</p>
                </div>
              ) : (
                tree.map((node) => (
                  <OrgTreeNode key={node.id} node={node} depth={0}
                    onEdit={openEditOrg} onDelete={handleDeleteOrg} onAddChild={(pid) => openAddOrg(pid)}
                    onViewPeople={(id) => navigate(`/people?orgId=${encodeURIComponent(id)}`)}
                    expanded={expanded} toggleExpand={toggleExpand} peopleCounts={peopleCounts}
                    accessibleOrgIds={accessibleOrgIds} allOrgs={flatOrgs} />
                ))
              )}
            </div>
          </div>

        </div>
      ) : (
        <OrgHierarchyVisualization tree={tree} peopleCounts={peopleCounts} />
      )}

    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Visualization — top-down SVG hierarchy. Lays out each subtree
// using a simple post-order width calculation: a leaf occupies
// one slot, a parent's width is the sum of its children's widths.
// Good enough for prototype-scale orgs (hundreds of nodes); for
// thousands of nodes a proper layout library would kick in.
// ══════════════════════════════════════════════════════════════

interface LayoutNode {
  id: string; name: string; type: string;
  x: number; y: number; width: number;
  children: LayoutNode[];
}

const ORG_TYPE_COLORS: Record<string, string> = {
  company: '#1e40af', division: '#5b21b6', department: '#0f4f46',
  team: '#92400e', unit: '#64748b',
};

function layoutTree(node: OrgNode, depth: number, xOffset: number, slotW: number, levelH: number): LayoutNode {
  if (node.children.length === 0) {
    return {
      id: node.id, name: node.name, type: node.type,
      x: xOffset + slotW / 2, y: depth * levelH + 40, width: slotW,
      children: [],
    };
  }
  let runningX = xOffset;
  const laidOutChildren: LayoutNode[] = [];
  for (const child of node.children) {
    const childLayout = layoutTree(child, depth + 1, runningX, slotW, levelH);
    runningX += childLayout.width;
    laidOutChildren.push(childLayout);
  }
  const subtreeWidth = runningX - xOffset;
  return {
    id: node.id, name: node.name, type: node.type,
    x: xOffset + subtreeWidth / 2, y: depth * levelH + 40, width: subtreeWidth,
    children: laidOutChildren,
  };
}

function flattenLayout(node: LayoutNode, acc: LayoutNode[] = []): LayoutNode[] {
  acc.push(node);
  for (const c of node.children) flattenLayout(c, acc);
  return acc;
}

function OrgHierarchyVisualization({ tree, peopleCounts }: { tree: OrgNode[]; peopleCounts: Record<string, number> }) {
  if (tree.length === 0) {
    return (
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)', padding: 40, textAlign: 'center', color: 'var(--color-text-muted)',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{'\u2302'}</div>
        <div>No organizations to visualize yet.</div>
      </div>
    );
  }

  const SLOT_W = 170;
  const LEVEL_H = 110;
  const BOX_W = 150;
  const BOX_H = 56;

  // Lay each top-level node out side-by-side, then concatenate.
  let xCursor = 20;
  const layouts: LayoutNode[] = [];
  for (const root of tree) {
    const laid = layoutTree(root, 0, xCursor, SLOT_W, LEVEL_H);
    layouts.push(laid);
    xCursor += laid.width;
  }
  const allNodes = layouts.flatMap((l) => flattenLayout(l));
  const svgW = Math.max(xCursor + 40, 600);
  const maxDepth = allNodes.reduce((m, n) => Math.max(m, n.y), 0);
  const svgH = maxDepth + BOX_H + 60;

  // Build edges: each child links to its parent.
  const edges: { from: LayoutNode; to: LayoutNode }[] = [];
  function collectEdges(node: LayoutNode) {
    for (const c of node.children) {
      edges.push({ from: node, to: c });
      collectEdges(c);
    }
  }
  for (const l of layouts) collectEdges(l);

  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)', overflow: 'auto', boxShadow: 'var(--shadow-sm)', padding: 8,
    }}>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        {/* Edges first so they render under nodes */}
        {edges.map((e, i) => {
          const x1 = e.from.x;
          const y1 = e.from.y + BOX_H / 2;
          const x2 = e.to.x;
          const y2 = e.to.y - BOX_H / 2;
          const midY = (y1 + y2) / 2;
          // Orthogonal connector: down -> across -> down.
          const path = `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`;
          return <path key={i} d={path} stroke="#cbd5e1" strokeWidth={1.5} fill="none" />;
        })}
        {/* Nodes */}
        {allNodes.map((n) => {
          const color = ORG_TYPE_COLORS[n.type] || '#64748b';
          const count = peopleCounts[n.id] || 0;
          return (
            <g key={n.id} transform={`translate(${n.x - BOX_W / 2}, ${n.y - BOX_H / 2})`}>
              <rect width={BOX_W} height={BOX_H} rx={6} ry={6}
                fill="#fff" stroke={color} strokeWidth={1.5} />
              <text x={BOX_W / 2} y={20} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0f172a">
                {n.name.length > 20 ? `${n.name.slice(0, 19)}...` : n.name}
              </text>
              <text x={BOX_W / 2} y={36} textAnchor="middle" fontSize={9} fill={color}
                style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                {n.type}
              </text>
              {count > 0 && (
                <g transform={`translate(${BOX_W - 36}, ${BOX_H - 16})`}>
                  <rect width={28} height={12} rx={6} ry={6} fill="#f1f5f9" />
                  <text x={14} y={9} textAnchor="middle" fontSize={9} fill="#475569">{count}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
