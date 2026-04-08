import { useEffect, useState, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
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

interface Person {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;
  title: string;
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

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--color-border)',
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

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', ORG_ADMIN: 'Org Admin', PROCESS_OWNER: 'Process Owner',
  DATA_STEWARD: 'Data Steward', CONTRIBUTOR: 'Contributor', VIEWER: 'Viewer',
};

const roleBadge = (role: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    SUPER_ADMIN: { bg: '#fce7f3', color: '#9d174d' }, ORG_ADMIN: { bg: '#ede9fe', color: '#5b21b6' },
    PROCESS_OWNER: { bg: '#d1f0eb', color: '#0f4f46' }, DATA_STEWARD: { bg: '#dbeafe', color: '#1e40af' },
    CONTRIBUTOR: { bg: '#fef3c7', color: '#92400e' }, VIEWER: { bg: '#f1f5f9', color: '#64748b' },
  };
  const c = colors[role] || colors.VIEWER;
  return { display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: c.bg, color: c.color };
};

// ── Helpers ──

interface FlatOrgOption {
  id: string;
  name: string;
  type: string;
  depth: number;
  label: string; // indented display label
}

function flattenTreeForSelect(nodes: OrgNode[], depth: number = 0): FlatOrgOption[] {
  const result: FlatOrgOption[] = [];
  for (const node of nodes) {
    const indent = '\u00A0\u00A0'.repeat(depth);
    const typeLabel = node.type.charAt(0).toUpperCase() + node.type.slice(1);
    result.push({
      id: node.id,
      name: node.name,
      type: node.type,
      depth,
      label: `${indent}${node.name} (${typeLabel})`,
    });
    if (node.children.length > 0) {
      result.push(...flattenTreeForSelect(node.children, depth + 1));
    }
  }
  return result;
}

// ── Tab styles ──

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 20px', fontSize: 14, fontWeight: active ? 600 : 400, cursor: 'pointer',
  border: 'none', background: 'none',
  color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
  borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
});

// ── Org Form ──

interface OrgFormData {
  name: string; parentId: string | null; type: string; industry: string; description: string;
}
const emptyOrgForm: OrgFormData = { name: '', parentId: null, type: 'department', industry: '', description: '' };

// ── Person Form ──

interface PersonFormData {
  orgId: string; name: string; email: string; role: string; title: string;
}
const emptyPersonForm: PersonFormData = { orgId: '', name: '', email: '', role: 'VIEWER', title: '' };

// ── File Picker ──

function FilePicker({ accept, onFileRead, label }: {
  accept: string; onFileRead: (content: string, fileName: string) => void; label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onFileRead(reader.result as string, file.name);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <>
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} style={{ display: 'none' }} />
      <button style={{ ...btnSecondary, padding: '6px 12px', fontSize: 12 }} onClick={() => inputRef.current?.click()}>
        {label || 'Browse File'}
      </button>
    </>
  );
}

// ── Org Tree Node ──

function OrgTreeNode({
  node, depth, orgTypes, onEdit, onDelete, onAddChild, onSelectOrg, selectedOrgId, expanded, toggleExpand, peopleCounts,
}: {
  node: OrgNode; depth: number; orgTypes: string[];
  onEdit: (org: OrgFlat) => void; onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onSelectOrg: (id: string) => void; selectedOrgId: string;
  expanded: Set<string>; toggleExpand: (id: string) => void;
  peopleCounts: Record<string, number>;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedOrgId === node.id;
  const count = peopleCounts[node.id] || 0;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', paddingLeft: 14 + depth * 24,
          borderBottom: '1px solid var(--color-border)',
          background: isSelected ? 'var(--color-primary-light)' : undefined,
          cursor: 'pointer', transition: 'background 0.1s',
        }}
        onClick={() => onSelectOrg(node.id)}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
      >
        <span
          onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpand(node.id); }}
          style={{ width: 16, fontSize: 11, color: 'var(--color-text-muted)', cursor: hasChildren ? 'pointer' : 'default', userSelect: 'none' }}
        >
          {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : '\u2022'}
        </span>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>{node.name}</span>
            <span style={typeBadge(node.type)}>{node.type}</span>
            {count > 0 && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: '#f1f5f9', padding: '1px 6px', borderRadius: 10 }}>
                {count} {count === 1 ? 'person' : 'people'}
              </span>
            )}
          </div>
          {node.description && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>{node.description}</div>
          )}
        </div>

        {node.industry && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{node.industry}</span>}

        <button style={{ ...btnIcon, color: 'var(--color-primary)' }} onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }} title="Add child org">+</button>
        <button style={{ ...btnIcon, color: 'var(--color-primary)' }} onClick={(e) => { e.stopPropagation(); onEdit(node); }} title="Edit">Edit</button>
        {node.id !== '00000000-0000-0000-0000-000000000010' && (
          <button style={{ ...btnIcon, color: 'var(--color-error)' }} onClick={(e) => { e.stopPropagation(); onDelete(node.id); }} title="Delete">Del</button>
        )}
      </div>

      {isExpanded && node.children.map((child) => (
        <OrgTreeNode key={child.id} node={child} depth={depth + 1} orgTypes={orgTypes}
          onEdit={onEdit} onDelete={onDelete} onAddChild={onAddChild}
          onSelectOrg={onSelectOrg} selectedOrgId={selectedOrgId}
          expanded={expanded} toggleExpand={toggleExpand} peopleCounts={peopleCounts} />
      ))}
    </div>
  );
}

// ── Main Component ──

export default function OrganizationsPage() {
  const { triggerRefresh } = useOrgContext();
  const [activeTab, setActiveTab] = useState<'structure' | 'people'>('structure');

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

  // People state
  const [people, setPeople] = useState<Person[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [showPersonForm, setShowPersonForm] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [personForm, setPersonForm] = useState<PersonFormData>(emptyPersonForm);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [showPeopleImport, setShowPeopleImport] = useState(false);
  const [peopleImportText, setPeopleImportText] = useState('');
  const [peopleImportFormat, setPeopleImportFormat] = useState<'csv' | 'json'>('csv');
  const [peopleImportOrgId, setPeopleImportOrgId] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [orgRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: OrgFlat[]; tree: OrgNode[]; orgTypes: string[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: Person[]; roles: string[] }>('/people'),
      ]);
      setTree(orgRes.tree || []);
      setFlatOrgs(orgRes.data || []);
      setOrgTypes(orgRes.orgTypes || []);
      setPeople(peopleRes.data || []);
      setRoles(peopleRes.roles || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // People count per org
  const peopleCounts: Record<string, number> = {};
  for (const p of people) {
    peopleCounts[p.orgId] = (peopleCounts[p.orgId] || 0) + 1;
  }

  const filteredPeople = selectedOrgId ? people.filter((p) => p.orgId === selectedOrgId) : people;
  const orgOptions = flattenTreeForSelect(tree);
  const selectedOrgName = selectedOrgId ? flatOrgs.find((o) => o.id === selectedOrgId)?.name || '' : '';

  // ── Org handlers ──

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const expandAll = () => setExpanded(new Set(flatOrgs.map((o) => o.id)));

  const openAddOrg = (parentId: string | null = null) => {
    setOrgForm({ ...emptyOrgForm, parentId }); setEditingOrgId(null); setShowOrgForm(true);
  };
  const openEditOrg = (org: OrgFlat) => {
    setOrgForm({ name: org.name, parentId: org.parentId, type: org.type, industry: org.industry, description: org.description });
    setEditingOrgId(org.id); setShowOrgForm(true);
  };
  const handleSaveOrg = async () => {
    if (!orgForm.name.trim()) return;
    if (editingOrgId) { await apiClient.put(`/organizations/${editingOrgId}`, orgForm); }
    else { await apiClient.post('/organizations', orgForm); }
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
      if (importFormat === 'csv') { body.csv = importText; } else { body.organizations = JSON.parse(importText); }
      await apiClient.post('/organizations/import', body);
      setShowImport(false); setImportText(''); fetchData(); expandAll(); triggerRefresh();
    } catch (e) { alert(e instanceof Error ? e.message : 'Import failed'); }
  };

  // ── People handlers ──

  const openAddPerson = () => {
    setPersonForm({ ...emptyPersonForm, orgId: selectedOrgId || (flatOrgs.length > 0 ? flatOrgs[0].id : '') });
    setEditingPersonId(null); setShowPersonForm(true);
  };
  const openEditPerson = (person: Person) => {
    setPersonForm({ orgId: person.orgId, name: person.name, email: person.email, role: person.role, title: person.title });
    setEditingPersonId(person.id); setShowPersonForm(true);
  };
  const handleSavePerson = async () => {
    if (!personForm.name.trim() || !personForm.orgId) return;
    if (editingPersonId) { await apiClient.put(`/people/${editingPersonId}`, personForm); }
    else { await apiClient.post('/people', personForm); }
    setShowPersonForm(false); setEditingPersonId(null); setPersonForm(emptyPersonForm); fetchData();
  };
  const handleDeletePerson = async (id: string) => {
    await apiClient.delete(`/people/${id}`); fetchData();
  };

  const handleSelectOrg = (id: string) => {
    setSelectedOrgId(id === selectedOrgId ? '' : id);
    if (activeTab === 'structure') setActiveTab('people');
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>Organizations</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Manage your organizational hierarchy and the people within it.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {activeTab === 'structure' && (
            <>
              <button onClick={() => setShowImport(true)} style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                Import Structure
              </button>
              <button onClick={() => openAddOrg(null)} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                + Add Organization
              </button>
            </>
          )}
          {activeTab === 'people' && (
            <>
              <button onClick={() => { setPeopleImportOrgId(selectedOrgId || (flatOrgs.length > 0 ? flatOrgs[0].id : '')); setShowPeopleImport(true); }} style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                Import People
              </button>
              <button onClick={openAddPerson} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                + Add Person
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
        <button style={tabStyle(activeTab === 'structure')} onClick={() => setActiveTab('structure')}>
          Structure ({flatOrgs.length})
        </button>
        <button style={tabStyle(activeTab === 'people')} onClick={() => setActiveTab('people')}>
          People ({people.length})
          {selectedOrgId && <span style={{ fontSize: 11, marginLeft: 4 }}>— {selectedOrgName}</span>}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{flatOrgs.length}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Organizations</div>
        </div>
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{people.length}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>People</div>
        </div>
        {(['company', 'division', 'department', 'team'] as const).map((t) => {
          const count = flatOrgs.filter((o) => o.type === t).length;
          if (count === 0) return null;
          return (
            <div key={t} style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{count}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t.charAt(0).toUpperCase() + t.slice(1)}s</div>
            </div>
          );
        })}
      </div>

      {/* ═══ STRUCTURE TAB ═══ */}
      {activeTab === 'structure' && (
        <>
          {/* Import Panel */}
          {showImport && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
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
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <FilePicker
                  accept={importFormat === 'csv' ? '.csv,.txt' : '.json,.txt'}
                  onFileRead={(content, fileName) => {
                    setImportText(content);
                    if (fileName.endsWith('.json') && importFormat !== 'json') setImportFormat('json');
                    if (fileName.endsWith('.csv') && importFormat !== 'csv') setImportFormat('csv');
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>or paste data below</span>
              </div>
              <textarea
                style={{ ...inputStyle, minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={importFormat === 'csv'
                  ? `Name,Parent,Type,Industry,Description\nAcme Corporation,,company,Manufacturing,Parent company\nOperations,Acme Corporation,division,,Operations division`
                  : `[\n  { "name": "Acme Corp", "type": "company" },\n  { "name": "Operations", "parentName": "Acme Corp", "type": "division" }\n]`}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button style={btnSecondary} onClick={() => { setShowImport(false); setImportText(''); }}>Cancel</button>
                <button style={{ ...btnPrimary, opacity: !importText.trim() ? 0.6 : 1 }} disabled={!importText.trim()} onClick={handleImport}>Import</button>
              </div>
            </div>
          )}

          {/* Add/Edit Org Form */}
          {showOrgForm && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingOrgId ? 'Edit Organization' : 'Add Organization'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
                  <input autoFocus style={inputStyle} value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} placeholder="Organization name" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type</label>
                  <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.type} onChange={(e) => setOrgForm({ ...orgForm, type: e.target.value, industry: e.target.value === 'company' ? orgForm.industry : '' })}>
                    {orgTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Parent</label>
                  <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.parentId || ''} onChange={(e) => setOrgForm({ ...orgForm, parentId: e.target.value || null })}>
                    <option value="">-- No parent (top-level) --</option>
                    {flatOrgs.filter((o) => o.id !== editingOrgId).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                </div>
                {orgForm.type === 'company' && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Industry</label>
                    <select style={{ ...inputStyle, appearance: 'auto' as any }} value={orgForm.industry} onChange={(e) => setOrgForm({ ...orgForm, industry: e.target.value })}>
                      <option value="">-- Select --</option>
                      {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
                  <input style={inputStyle} value={orgForm.description} onChange={(e) => setOrgForm({ ...orgForm, description: e.target.value })} placeholder="Brief description" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button style={btnSecondary} onClick={() => { setShowOrgForm(false); setEditingOrgId(null); }}>Cancel</button>
                <button style={{ ...btnPrimary, opacity: !orgForm.name.trim() ? 0.6 : 1 }} disabled={!orgForm.name.trim()} onClick={handleSaveOrg}>
                  {editingOrgId ? 'Save Changes' : 'Add Organization'}
                </button>
              </div>
            </div>
          )}

          {/* Toolbar */}
          {flatOrgs.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={expandAll}>Expand All</button>
              <button style={{ ...btnIcon, fontSize: 12, color: 'var(--color-primary)' }} onClick={() => setExpanded(new Set())}>Collapse All</button>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                Click an organization to view its people
              </span>
            </div>
          )}

          {/* Tree */}
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            {loading ? (
              <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
            ) : tree.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                <p style={{ color: 'var(--color-text-muted)' }}>No organizations defined yet. Use the + Add Organization button above to get started.</p>
              </div>
            ) : (
              tree.map((node) => (
                <OrgTreeNode key={node.id} node={node} depth={0} orgTypes={orgTypes}
                  onEdit={openEditOrg} onDelete={handleDeleteOrg} onAddChild={(pid) => openAddOrg(pid)}
                  onSelectOrg={handleSelectOrg} selectedOrgId={selectedOrgId}
                  expanded={expanded} toggleExpand={toggleExpand} peopleCounts={peopleCounts} />
              ))
            )}
          </div>
        </>
      )}

      {/* ═══ PEOPLE TAB ═══ */}
      {activeTab === 'people' && (
        <>
          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <label style={{ fontSize: 12, fontWeight: 500 }}>Filter by org:</label>
            <select style={{ ...inputStyle, width: 'auto', minWidth: 280, appearance: 'auto' as any }} value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}>
              <option value="">All Organizations ({people.length})</option>
              {orgOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label} — {peopleCounts[opt.id] || 0} people</option>
              ))}
            </select>
            {selectedOrgId && (
              <button style={{ ...btnIcon, color: 'var(--color-primary)', fontSize: 12 }} onClick={() => setSelectedOrgId('')}>Clear filter</button>
            )}
          </div>

          {/* Import People Panel */}
          {showPeopleImport && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Import People</h3>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Organization Level *</label>
                <select style={{ ...inputStyle, appearance: 'auto' as any, width: '100%' }} value={peopleImportOrgId} onChange={(e) => setPeopleImportOrgId(e.target.value)}>
                  <option value="">-- Select organization level --</option>
                  {orgOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                </select>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  All imported people will be assigned to this organization level.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="radio" checked={peopleImportFormat === 'csv'} onChange={() => setPeopleImportFormat('csv')} /> CSV
                </label>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="radio" checked={peopleImportFormat === 'json'} onChange={() => setPeopleImportFormat('json')} /> JSON
                </label>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <FilePicker
                  accept={peopleImportFormat === 'csv' ? '.csv,.txt' : '.json,.txt'}
                  onFileRead={(content, fileName) => {
                    setPeopleImportText(content);
                    if (fileName.endsWith('.json') && peopleImportFormat !== 'json') setPeopleImportFormat('json');
                    if (fileName.endsWith('.csv') && peopleImportFormat !== 'csv') setPeopleImportFormat('csv');
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>or paste data below</span>
              </div>

              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                {peopleImportFormat === 'csv'
                  ? <>CSV columns: <strong>Name</strong> (required), Email, Role, Title</>
                  : <>JSON array with: <strong>name</strong> (required), email, role, title</>
                }
              </p>
              <textarea
                style={{ ...inputStyle, minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                value={peopleImportText}
                onChange={(e) => setPeopleImportText(e.target.value)}
                placeholder={peopleImportFormat === 'csv'
                  ? `Name,Email,Role,Title\nJane Smith,jane@company.com,PROCESS_OWNER,Director of Operations\nBob Jones,bob@company.com,DATA_STEWARD,Data Analyst`
                  : `[\n  { "name": "Jane Smith", "email": "jane@company.com", "role": "PROCESS_OWNER", "title": "Director" }\n]`}
              />

              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button style={btnSecondary} onClick={() => { setShowPeopleImport(false); setPeopleImportText(''); }}>Cancel</button>
                <button
                  style={{ ...btnPrimary, opacity: !peopleImportText.trim() || !peopleImportOrgId ? 0.6 : 1 }}
                  disabled={!peopleImportText.trim() || !peopleImportOrgId}
                  onClick={async () => {
                    try {
                      const body: any = { orgId: peopleImportOrgId };
                      if (peopleImportFormat === 'csv') { body.csv = peopleImportText; }
                      else { body.people = JSON.parse(peopleImportText); }
                      await apiClient.post('/people/import', body);
                      setShowPeopleImport(false); setPeopleImportText('');
                      setSelectedOrgId(peopleImportOrgId);
                      fetchData();
                    } catch (e) {
                      alert(e instanceof Error ? e.message : 'Import failed');
                    }
                  }}
                >
                  Import
                </button>
              </div>
            </div>
          )}

          {/* Add/Edit Person Form */}
          {showPersonForm && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingPersonId ? 'Edit Person' : 'Add Person'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
                  <input autoFocus style={inputStyle} value={personForm.name} onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })} placeholder="Full name" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Email</label>
                  <input style={inputStyle} value={personForm.email} onChange={(e) => setPersonForm({ ...personForm, email: e.target.value })} placeholder="email@example.com" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Organization Level *</label>
                  <select style={{ ...inputStyle, appearance: 'auto' as any }} value={personForm.orgId} onChange={(e) => setPersonForm({ ...personForm, orgId: e.target.value })}>
                    <option value="">-- Select an organization level --</option>
                    {orgOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                  </select>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Person will be assigned to this specific level in the org hierarchy.
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Role</label>
                  <select style={{ ...inputStyle, appearance: 'auto' as any }} value={personForm.role} onChange={(e) => setPersonForm({ ...personForm, role: e.target.value })}>
                    {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Title</label>
                  <input style={inputStyle} value={personForm.title} onChange={(e) => setPersonForm({ ...personForm, title: e.target.value })} placeholder="e.g. Director of Operations" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button style={btnSecondary} onClick={() => { setShowPersonForm(false); setEditingPersonId(null); }}>Cancel</button>
                <button style={{ ...btnPrimary, opacity: !personForm.name.trim() || !personForm.orgId ? 0.6 : 1 }} disabled={!personForm.name.trim() || !personForm.orgId} onClick={handleSavePerson}>
                  {editingPersonId ? 'Save Changes' : 'Add Person'}
                </button>
              </div>
            </div>
          )}

          {/* People Table */}
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            {loading ? (
              <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
            ) : filteredPeople.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                <p style={{ color: 'var(--color-text-muted)' }}>
                  {selectedOrgId ? 'No people in this organization.' : 'No people defined yet.'} Use the + Add Person button above.
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Email</th>
                    {!selectedOrgId && <th style={thStyle}>Organization</th>}
                    <th style={thStyle}>Role</th>
                    <th style={thStyle}>Title</th>
                    <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPeople.map((person) => (
                    <tr key={person.id} style={{ transition: 'background 0.1s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{person.name}</td>
                      <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{person.email || '--'}</td>
                      {!selectedOrgId && <td style={tdStyle}>{flatOrgs.find((o) => o.id === person.orgId)?.name || '--'}</td>}
                      <td style={tdStyle}><span style={roleBadge(person.role)}>{ROLE_LABELS[person.role] || person.role}</span></td>
                      <td style={tdStyle}>{person.title || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }} onClick={() => openEditPerson(person)}>Edit</button>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }} onClick={() => handleDeletePerson(person.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
