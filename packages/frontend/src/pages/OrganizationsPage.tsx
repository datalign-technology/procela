import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { INDUSTRIES } from '../types';

// ── Types ──

interface OrgNode {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  industry: string;
  description: string;
  headCount: number;
  children: OrgNode[];
}

interface OrgFlat {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  industry: string;
  description: string;
  headCount: number;
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
  padding: '2px 6px', fontSize: 12, color: 'var(--color-text-muted)', borderRadius: 4,
};

const typeBadge = (type: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    company: { bg: '#dbeafe', color: '#1e40af' },
    division: { bg: '#ede9fe', color: '#5b21b6' },
    department: { bg: '#d1f0eb', color: '#0f4f46' },
    team: { bg: '#fef3c7', color: '#92400e' },
    unit: { bg: '#f1f5f9', color: '#64748b' },
  };
  const c = colors[type] || colors.unit;
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 10, fontWeight: 600, textTransform: 'uppercase', background: c.bg, color: c.color,
  };
};

// ── Form ──

interface FormData {
  name: string;
  parentId: string | null;
  type: string;
  industry: string;
  description: string;
}

const emptyForm: FormData = { name: '', parentId: null, type: 'department', industry: '', description: '' };

// ── Tree Node Component ──

function OrgTreeNode({
  node, depth, orgTypes, onEdit, onDelete, onAddChild, expanded, toggleExpand,
}: {
  node: OrgNode; depth: number; orgTypes: string[];
  onEdit: (org: OrgFlat) => void; onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
  expanded: Set<string>; toggleExpand: (id: string) => void;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', paddingLeft: 14 + depth * 24,
          borderBottom: '1px solid var(--color-border)',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
      >
        {/* Expand toggle */}
        <span
          onClick={() => hasChildren && toggleExpand(node.id)}
          style={{
            width: 16, fontSize: 11, color: 'var(--color-text-muted)',
            cursor: hasChildren ? 'pointer' : 'default', userSelect: 'none',
          }}
        >
          {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : '\u2022'}
        </span>

        {/* Info */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>{node.name}</span>
            <span style={typeBadge(node.type)}>{node.type}</span>
          </div>
          {node.description && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>{node.description}</div>
          )}
        </div>

        {/* Industry */}
        {node.industry && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{node.industry}</span>
        )}

        {/* Children count */}
        {hasChildren && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{node.children.length} sub</span>
        )}

        {/* Actions */}
        <button style={{ ...btnIcon, color: 'var(--color-primary)' }} onClick={() => onAddChild(node.id)} title="Add child">+</button>
        <button style={{ ...btnIcon, color: 'var(--color-primary)' }} onClick={() => onEdit(node)} title="Edit">Edit</button>
        {node.id !== '00000000-0000-0000-0000-000000000010' && (
          <button style={{ ...btnIcon, color: 'var(--color-error)' }} onClick={() => onDelete(node.id)} title="Delete">Del</button>
        )}
      </div>

      {/* Children */}
      {isExpanded && node.children.map((child) => (
        <OrgTreeNode
          key={child.id} node={child} depth={depth + 1} orgTypes={orgTypes}
          onEdit={onEdit} onDelete={onDelete} onAddChild={onAddChild}
          expanded={expanded} toggleExpand={toggleExpand}
        />
      ))}
    </div>
  );
}

// ── Main Component ──

export default function OrganizationsPage() {
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [flatOrgs, setFlatOrgs] = useState<OrgFlat[]>([]);
  const [orgTypes, setOrgTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['00000000-0000-0000-0000-000000000010']));
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importParent, setImportParent] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: OrgFlat[]; tree: OrgNode[]; orgTypes: string[] }>('/organizations');
      setTree(res.tree || []);
      setFlatOrgs(res.data || []);
      setOrgTypes(res.orgTypes || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const expandAll = () => setExpanded(new Set(flatOrgs.map((o) => o.id)));

  const openAdd = (parentId: string | null = null) => {
    setForm({ ...emptyForm, parentId });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (org: OrgFlat) => {
    setForm({ name: org.name, parentId: org.parentId, type: org.type, industry: org.industry, description: org.description });
    setEditingId(org.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingId) {
      await apiClient.put(`/organizations/${editingId}`, form);
    } else {
      await apiClient.post('/organizations', form);
    }
    setShowForm(false); setEditingId(null); setForm(emptyForm); fetchData();
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/organizations/${id}`);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Cannot delete');
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    try {
      const body: any = { parentId: importParent || null };
      if (importFormat === 'csv') {
        body.csv = importText;
      } else {
        body.organizations = JSON.parse(importText);
      }
      await apiClient.post('/organizations/import', body);
      setShowImport(false); setImportText(''); fetchData();
      expandAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Import failed');
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Organizations</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Define your organizational hierarchy — companies, divisions, departments, and teams.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowImport(true)} style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            Import Structure
          </button>
          <button onClick={() => openAdd(null)} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            + Add Organization
          </button>
        </div>
      </div>

      {/* Import Panel */}
      {showImport && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Import Organization Structure</h3>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" checked={importFormat === 'csv'} onChange={() => setImportFormat('csv')} /> CSV
            </label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" checked={importFormat === 'json'} onChange={() => setImportFormat('json')} /> JSON
            </label>
            <div style={{ flex: 1 }}>
              <select style={{ ...inputStyle, appearance: 'auto' as any, width: 'auto', minWidth: 200 }} value={importParent} onChange={(e) => setImportParent(e.target.value)}>
                <option value="">Import as top-level</option>
                {flatOrgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
          </div>

          {importFormat === 'csv' ? (
            <div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                CSV columns: <strong>Name</strong> (required), Parent, Type (company/division/department/team/unit), Industry, Description
              </p>
              <textarea
                style={{ ...inputStyle, minHeight: 150, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={`Name,Parent,Type,Industry,Description\nAcme Corporation,,company,Manufacturing,Parent company\nOperations,Acme Corporation,division,,Operations division\nProduction,Operations,department,,Manufacturing production\nQuality Assurance,Operations,department,,QA and testing\nFinance,Acme Corporation,division,,Financial services\nAccounting,Finance,department,,General accounting\nAudit,Finance,department,,Internal audit`}
              />
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                JSON array of objects with: <strong>name</strong> (required), parentName, type, industry, description
              </p>
              <textarea
                style={{ ...inputStyle, minHeight: 150, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={`[\n  { "name": "Acme Corporation", "type": "company", "industry": "Manufacturing" },\n  { "name": "Operations", "parentName": "Acme Corporation", "type": "division" },\n  { "name": "Production", "parentName": "Operations", "type": "department" }\n]`}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowImport(false); setImportText(''); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !importText.trim() ? 0.6 : 1 }} disabled={!importText.trim()} onClick={handleImport}>
              Import
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Organization' : 'Add Organization'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Organization name" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {orgTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Parent Organization</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={form.parentId || ''} onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}>
                <option value="">-- No parent (top-level) --</option>
                {flatOrgs.filter((o) => o.id !== editingId).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Industry</label>
              <select style={{ ...inputStyle, appearance: 'auto' as any }} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
                <option value="">-- Select industry --</option>
                {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1 }} disabled={!form.name.trim()} onClick={handleSave}>
              {editingId ? 'Save Changes' : 'Add Organization'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      {flatOrgs.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{flatOrgs.length}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Orgs</div>
          </div>
          {(['company', 'division', 'department', 'team'] as const).map((t) => (
            <div key={t} style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{flatOrgs.filter((o) => o.type === t).length}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t.charAt(0).toUpperCase() + t.slice(1)}s</div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      {flatOrgs.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={expandAll}>Expand All</button>
          <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={() => setExpanded(new Set())}>Collapse All</button>
        </div>
      )}

      {/* Tree */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : tree.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>No organizations defined yet.</p>
            <button onClick={() => openAdd(null)} style={btnPrimary}>+ Add Your First Organization</button>
          </div>
        ) : (
          tree.map((node) => (
            <OrgTreeNode
              key={node.id} node={node} depth={0} orgTypes={orgTypes}
              onEdit={openEdit} onDelete={handleDelete} onAddChild={(pid) => openAdd(pid)}
              expanded={expanded} toggleExpand={toggleExpand}
            />
          ))
        )}
      </div>
    </div>
  );
}
