import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { INDUSTRIES } from '../types';
import { exportCsv } from '../lib/exportCsv';
import ConfirmDialog from '../components/ConfirmDialog';

// ── Types ──

interface OrgNode {
  id: string; parentId: string | null; name: string; type: string;
  industry: string; description: string; headCount: number; children: OrgNode[];
}
interface OrgFlat {
  id: string; parentId: string | null; name: string; type: string;
  industry: string; description: string; headCount: number;
}
interface Person {
  id: string; orgIds: string[]; name: string; email: string; role: string; title: string; accessibleOrgIds: string[];
}
interface Person360Data {
  person: Person;
  orgAssignments: { id: string; name: string; type: string }[];
  damaRoles: { id: string; roleType: string; scopeType: string; scopeId: string; scopeName: string; since: string }[];
  governanceGroups: { groupId: string; groupName: string; groupType: string; groupRole: string; since: string }[];
  ownedProcessNodes: { id: string; name: string; level: string; status: string }[];
  dataAssets: { id: string; name: string; governanceTier: string; relation: string }[];
  allGroups: { id: string; name: string; type: string }[];
  allDomains: { id: string; name: string; ownerId: string | null; stewardIds: string[] }[];
  allDamaRoleTypes: string[];
}

interface GovernanceGroupFull {
  id: string; name: string; type: string;
  members: { personId: string; groupRole: string; since: string }[];
}

interface DataDomainFull {
  id: string; name: string; ownerId: string | null; stewardIds: string[];
}

interface DamaRoleFull {
  id: string; personId: string; roleType: string; scopeType: string; scopeId: string; since: string;
}

const DAMA_ROLE_LABELS: Record<string, string> = {
  CDO: 'Chief Data Officer',
  DATA_GOVERNANCE_LEAD: 'Data Governance Lead',
  DATA_OWNER: 'Data Owner',
  DATA_STEWARD: 'Data Steward',
  DATA_CUSTODIAN: 'Data Custodian',
  DATA_ARCHITECT: 'Data Architect',
  DATA_QUALITY_ANALYST: 'Data Quality Analyst',
};

const GROUP_TYPE_LABELS: Record<string, string> = {
  COUNCIL: 'Council', OFFICE: 'Office', COMMITTEE: 'Committee',
  STEWARDSHIP_TEAM: 'Stewardship Team', WORKING_GROUP: 'Working Group',
  COMMUNITY_OF_PRACTICE: 'Community of Practice',
};

const GROUP_ROLES = ['CHAIR', 'VICE_CHAIR', 'MEMBER', 'SECRETARY', 'ADVISOR'] as const;

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
  return { display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: c.bg, color: c.color };
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

interface PersonFormData { orgIds: string[]; name: string; email: string; role: string; title: string; accessibleOrgIds: string[]; }
const emptyPersonForm: PersonFormData = { orgIds: [], name: '', email: '', role: 'VIEWER', title: '', accessibleOrgIds: [] };

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

function OrgTreeNode({ node, depth, onEdit, onDelete, onAddChild, onSelectOrg, selectedOrgId, expanded, toggleExpand, peopleCounts }: {
  node: OrgNode; depth: number;
  onEdit: (org: OrgFlat) => void; onDelete: (id: string) => void; onAddChild: (parentId: string) => void;
  onSelectOrg: (id: string) => void; selectedOrgId: string;
  expanded: Set<string>; toggleExpand: (id: string) => void; peopleCounts: Record<string, number>;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedOrgId === node.id;
  const count = peopleCounts[node.id] || 0;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', paddingLeft: 10 + depth * 18,
          borderBottom: '1px solid var(--color-border)',
          background: isSelected ? 'var(--color-primary-light)' : undefined,
          cursor: 'pointer', transition: 'background 0.1s',
        }}
        onClick={() => onSelectOrg(node.id)}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
      >
        <span onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpand(node.id); }}
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
        <button style={{ ...btnIcon, color: 'var(--color-primary)', fontSize: 13 }} onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }} title="Add child">+</button>
        <button style={{ ...btnIcon, color: 'var(--color-primary)' }} onClick={(e) => { e.stopPropagation(); onEdit(node); }} title="Edit">Edit</button>
        {node.id !== '00000000-0000-0000-0000-000000000010' && (
          <button style={{ ...btnIcon, color: 'var(--color-error)' }} onClick={(e) => { e.stopPropagation(); onDelete(node.id); }} title="Delete">Del</button>
        )}
      </div>
      {isExpanded && node.children.map((child) => (
        <OrgTreeNode key={child.id} node={child} depth={depth + 1}
          onEdit={onEdit} onDelete={onDelete} onAddChild={onAddChild}
          onSelectOrg={onSelectOrg} selectedOrgId={selectedOrgId}
          expanded={expanded} toggleExpand={toggleExpand} peopleCounts={peopleCounts} />
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT — Side-by-side: Org tree (left) + People (right)
// ══════════════════════════════════════════════════════════════

export default function OrganizationsPage() {
  const { triggerRefresh } = useOrgContext();

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
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [showPersonForm, setShowPersonForm] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [personForm, setPersonForm] = useState<PersonFormData>(emptyPersonForm);
  const [showPeopleImport, setShowPeopleImport] = useState(false);
  const [peopleImportText, setPeopleImportText] = useState('');
  const [peopleImportFormat, setPeopleImportFormat] = useState<'csv' | 'json'>('csv');
  const [viewing360, setViewing360] = useState<Person360Data | null>(null);
  const [loading360, setLoading360] = useState(false);
  const [saving360, setSaving360] = useState(false);
  const [showDeleteAllPeople, setShowDeleteAllPeople] = useState(false);

  // Governance data for summary column and 360 editing
  const [allGovernanceGroups, setAllGovernanceGroups] = useState<GovernanceGroupFull[]>([]);
  const [allDamaRoles, setAllDamaRoles] = useState<DamaRoleFull[]>([]);
  const [allDataDomains, setAllDataDomains] = useState<DataDomainFull[]>([]);

  // DAMA role add form state inside 360 modal
  const [showAddDamaRole, setShowAddDamaRole] = useState(false);
  const [newDamaRole, setNewDamaRole] = useState({ roleType: 'CDO', scopeType: 'ORG' as 'ORG' | 'DOMAIN', scopeId: '' });

  const fetchData = useCallback(async () => {
    try {
      const [orgRes, peopleRes, govRes, damaRes, domainRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: OrgFlat[]; tree: OrgNode[]; orgTypes: string[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: Person[]; roles: string[] }>('/people'),
        apiClient.get<{ success: boolean; data: GovernanceGroupFull[] }>('/governance-groups'),
        apiClient.get<{ success: boolean; data: DamaRoleFull[] }>('/dama-roles'),
        apiClient.get<{ success: boolean; data: DataDomainFull[] }>('/data-domains'),
      ]);
      setTree(orgRes.tree || []); setFlatOrgs(orgRes.data || []); setOrgTypes(orgRes.orgTypes || []);
      setPeople(peopleRes.data || []); setRoles(peopleRes.roles || []);
      setAllGovernanceGroups(govRes.data || []);
      setAllDamaRoles(damaRes.data || []);
      setAllDataDomains(domainRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const peopleCounts: Record<string, number> = {};
  for (const p of people) {
    for (const oid of p.orgIds) peopleCounts[oid] = (peopleCounts[oid] || 0) + 1;
  }

  // Governance summary counts per person (computed client-side)
  const govSummary: Record<string, { groups: number; roles: number; domains: number }> = {};
  for (const p of people) {
    const groupCount = allGovernanceGroups.filter((g) => g.members?.some((m) => m.personId === p.id)).length;
    const roleCount = allDamaRoles.filter((r) => r.personId === p.id).length;
    const domainCount = allDataDomains.filter((d) => d.ownerId === p.id || d.stewardIds?.includes(p.id)).length;
    if (groupCount || roleCount || domainCount) {
      govSummary[p.id] = { groups: groupCount, roles: roleCount, domains: domainCount };
    }
  }

  const selectedOrg = flatOrgs.find((o) => o.id === selectedOrgId);
  const filteredPeople = selectedOrgId ? people.filter((p) => p.orgIds.includes(selectedOrgId)) : [];
  const orgOptions = flattenTreeForSelect(tree);

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
    try { await apiClient.delete(`/organizations/${id}`); if (selectedOrgId === id) setSelectedOrgId(''); fetchData(); triggerRefresh(); }
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

  // ── People handlers ──
  const openAddPerson = () => { setPersonForm({ ...emptyPersonForm, orgIds: selectedOrgId ? [selectedOrgId] : [] }); setEditingPersonId(null); setShowPersonForm(true); };
  const openEditPerson = (person: Person) => { setPersonForm({ orgIds: person.orgIds || [], name: person.name, email: person.email, role: person.role, title: person.title, accessibleOrgIds: person.accessibleOrgIds || [] }); setEditingPersonId(person.id); setShowPersonForm(true); };
  const handleSavePerson = async () => {
    if (!personForm.name.trim() || personForm.orgIds.length === 0) return;
    if (editingPersonId) await apiClient.put(`/people/${editingPersonId}`, personForm);
    else await apiClient.post('/people', personForm);
    setShowPersonForm(false); setEditingPersonId(null); setPersonForm(emptyPersonForm); fetchData();
  };
  const handleDeletePerson = async (id: string) => { await apiClient.delete(`/people/${id}`); fetchData(); };
  const openPerson360 = async (id: string) => {
    setLoading360(true);
    setShowAddDamaRole(false);
    setNewDamaRole({ roleType: 'CDO', scopeType: 'ORG', scopeId: '' });
    try {
      const res = await apiClient.get<{ success: boolean; data: Person360Data }>(`/people/${id}/360`);
      setViewing360(res.data || null);
    } catch { /* */ }
    finally { setLoading360(false); }
  };

  // Re-fetch 360 data for current person (after edits)
  const refresh360 = async () => {
    if (!viewing360) return;
    try {
      const res = await apiClient.get<{ success: boolean; data: Person360Data }>(`/people/${viewing360.person.id}/360`);
      setViewing360(res.data || null);
    } catch { /* */ }
    // Also refresh governance data for summary column
    try {
      const [govRes, damaRes, domainRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovernanceGroupFull[] }>('/governance-groups'),
        apiClient.get<{ success: boolean; data: DamaRoleFull[] }>('/dama-roles'),
        apiClient.get<{ success: boolean; data: DataDomainFull[] }>('/data-domains'),
      ]);
      setAllGovernanceGroups(govRes.data || []);
      setAllDamaRoles(damaRes.data || []);
      setAllDataDomains(domainRes.data || []);
    } catch { /* */ }
  };

  // ── Governance Group membership toggle ──
  const toggleGroupMembership = async (groupId: string, isMember: boolean, role: string = 'MEMBER') => {
    if (!viewing360) return;
    setSaving360(true);
    try {
      if (isMember) {
        // Remove membership
        await apiClient.delete(`/governance-groups/${groupId}/members/${viewing360.person.id}`);
      } else {
        // Add membership
        await apiClient.post(`/governance-groups/${groupId}/members`, {
          personId: viewing360.person.id, groupRole: role,
        });
      }
      await refresh360();
    } catch { /* */ }
    finally { setSaving360(false); }
  };

  // ── Governance Group role change ──
  const changeGroupRole = async (groupId: string, newRole: string) => {
    if (!viewing360) return;
    setSaving360(true);
    try {
      // Remove then re-add with new role
      await apiClient.delete(`/governance-groups/${groupId}/members/${viewing360.person.id}`);
      await apiClient.post(`/governance-groups/${groupId}/members`, {
        personId: viewing360.person.id, groupRole: newRole,
      });
      await refresh360();
    } catch { /* */ }
    finally { setSaving360(false); }
  };

  // ── DAMA Role add/remove ──
  const addDamaRole = async () => {
    if (!viewing360 || !newDamaRole.roleType || !newDamaRole.scopeId) return;
    setSaving360(true);
    try {
      await apiClient.post('/dama-roles', {
        personId: viewing360.person.id,
        roleType: newDamaRole.roleType,
        scopeType: newDamaRole.scopeType,
        scopeId: newDamaRole.scopeId,
      });
      setShowAddDamaRole(false);
      setNewDamaRole({ roleType: 'CDO', scopeType: 'ORG', scopeId: '' });
      await refresh360();
    } catch { /* */ }
    finally { setSaving360(false); }
  };

  const removeDamaRole = async (roleId: string) => {
    setSaving360(true);
    try {
      await apiClient.delete(`/dama-roles/${roleId}`);
      await refresh360();
    } catch { /* */ }
    finally { setSaving360(false); }
  };

  // ── Data Domain owner/steward toggle ──
  const toggleDomainOwner = async (domainId: string, isCurrentOwner: boolean) => {
    if (!viewing360) return;
    setSaving360(true);
    try {
      await apiClient.put(`/data-domains/${domainId}`, {
        ownerId: isCurrentOwner ? null : viewing360.person.id,
      });
      await refresh360();
    } catch { /* */ }
    finally { setSaving360(false); }
  };

  const toggleDomainSteward = async (domainId: string, isSteward: boolean, currentStewardIds: string[]) => {
    if (!viewing360) return;
    setSaving360(true);
    try {
      const newStewardIds = isSteward
        ? currentStewardIds.filter((id) => id !== viewing360.person.id)
        : [...currentStewardIds, viewing360.person.id];
      await apiClient.put(`/data-domains/${domainId}`, { stewardIds: newStewardIds });
      await refresh360();
    } catch { /* */ }
    finally { setSaving360(false); }
  };
  const handlePeopleImport = async () => {
    if (!peopleImportText.trim() || !selectedOrgId) return;
    try {
      const body: any = { orgId: selectedOrgId };
      if (peopleImportFormat === 'csv') body.csv = peopleImportText; else body.people = JSON.parse(peopleImportText);
      await apiClient.post('/people/import', body);
      setShowPeopleImport(false); setPeopleImportText(''); fetchData();
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
            Select an organization to manage its people. {flatOrgs.length} orgs, {people.length} people.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowImport(true)} style={btnSecondary}>Import Orgs</button>
          <button onClick={() => openAddOrg(null)} style={btnPrimary}>+ Add Org</button>
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

      {/* ══ SIDE-BY-SIDE LAYOUT ══ */}
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
                  onSelectOrg={(id) => setSelectedOrgId(id === selectedOrgId ? '' : id)} selectedOrgId={selectedOrgId}
                  expanded={expanded} toggleExpand={toggleExpand} peopleCounts={peopleCounts} />
              ))
            )}
          </div>
        </div>

        {/* RIGHT: People Panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedOrgId ? (
            <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '3rem 2rem', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{'\u2190'}</div>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Select an organization from the tree to view and manage its people.</p>
            </div>
          ) : (
            <>
              {/* Selected org header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600 }}>{selectedOrg?.name}</h2>
                    <span style={typeBadge(selectedOrg?.type || '')}>{selectedOrg?.type}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{filteredPeople.length} {filteredPeople.length === 1 ? 'person' : 'people'}</span>
                  </div>
                  {selectedOrg?.description && <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{selectedOrg.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {people.length > 0 && (
                    <button
                      onClick={() => setShowDeleteAllPeople(true)}
                      style={{ ...btnSecondary, color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
                    >
                      Delete All People
                    </button>
                  )}
                  {filteredPeople.length > 0 && (
                    <button
                      onClick={() => exportCsv('people.csv', ['Name', 'Email', 'Role', 'Title'], filteredPeople.map((p) => [
                        p.name, p.email, ROLE_LABELS[p.role] || p.role, p.title,
                      ]))}
                      style={btnSecondary}
                    >
                      Export CSV
                    </button>
                  )}
                  <button onClick={() => setShowPeopleImport(true)} style={btnSecondary}>Import People</button>
                  <button onClick={openAddPerson} style={btnPrimary}>+ Add Person</button>
                </div>
              </div>

              <ConfirmDialog
                open={showDeleteAllPeople}
                title="Delete All People?"
                message={`This will permanently delete all ${people.length} people across all organizations. This cannot be undone.`}
                confirmLabel="Delete All"
                onConfirm={async () => {
                  setShowDeleteAllPeople(false);
                  await apiClient.delete('/people/all');
                  fetchData();
                }}
                onCancel={() => setShowDeleteAllPeople(false)}
              />

              {/* Add/Edit Person Form */}
              {showPersonForm && (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 10, boxShadow: 'var(--shadow-sm)' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{editingPersonId ? 'Edit Person' : 'Add Person'}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Name *</label>
                      <input autoFocus style={inputStyle} value={personForm.name} onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })} placeholder="Full name" />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Email</label>
                      <input style={inputStyle} value={personForm.email} onChange={(e) => setPersonForm({ ...personForm, email: e.target.value })} placeholder="email@example.com" />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Assigned Organizations *</label>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                        Select all org levels this person belongs to. They will appear in each org's people list.
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', padding: '6px 0' }}>
                        {orgOptions.map((opt) => {
                          const checked = personForm.orgIds.includes(opt.id);
                          return (
                            <label key={opt.id} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', paddingLeft: opt.depth * 16 }}>
                              <input type="checkbox" checked={checked}
                                onChange={() => setPersonForm({
                                  ...personForm,
                                  orgIds: checked ? personForm.orgIds.filter((id) => id !== opt.id) : [...personForm.orgIds, opt.id],
                                })}
                                style={{ accentColor: 'var(--color-primary)', flexShrink: 0 }}
                              />
                              <span style={{ whiteSpace: 'nowrap' }}>{opt.name}</span>
                              <span style={{ fontSize: 9, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>({opt.type.charAt(0).toUpperCase() + opt.type.slice(1)})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Role</label>
                      <select style={{ ...inputStyle, appearance: 'auto' as any }} value={personForm.role} onChange={(e) => setPersonForm({ ...personForm, role: e.target.value })}>
                        {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                      </select>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Title</label>
                      <input style={inputStyle} value={personForm.title} onChange={(e) => setPersonForm({ ...personForm, title: e.target.value })} placeholder="e.g. Director of Operations" />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Additional Org Access</label>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                        Grant access to additional organizations beyond what their role and assignment provide. Only company and division levels shown.
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {orgOptions.filter((o) => o.type === 'company' || o.type === 'division').map((opt) => {
                          const isGranted = personForm.accessibleOrgIds.includes(opt.id);
                          const isAssigned = personForm.orgIds.includes(opt.id);
                          return (
                            <label key={opt.id} style={{
                              fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, cursor: isAssigned ? 'default' : 'pointer',
                              opacity: isAssigned ? 0.5 : 1,
                            }}>
                              <input type="checkbox" checked={isGranted || isAssigned} disabled={isAssigned}
                                onChange={() => {
                                  if (isAssigned) return;
                                  setPersonForm({
                                    ...personForm,
                                    accessibleOrgIds: isGranted
                                      ? personForm.accessibleOrgIds.filter((id) => id !== opt.id)
                                      : [...personForm.accessibleOrgIds, opt.id],
                                  });
                                }}
                                style={{ accentColor: 'var(--color-primary)' }}
                              />
                              {opt.name}
                              {isAssigned && <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>(assigned)</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
                    <button style={btnSecondary} onClick={() => { setShowPersonForm(false); setEditingPersonId(null); }}>Cancel</button>
                    <button style={{ ...btnPrimary, opacity: !personForm.name.trim() || personForm.orgIds.length === 0 ? 0.6 : 1 }} disabled={!personForm.name.trim() || personForm.orgIds.length === 0} onClick={handleSavePerson}>
                      {editingPersonId ? 'Save' : 'Add'}
                    </button>
                  </div>
                </div>
              )}

              {/* Import People Panel */}
              {showPeopleImport && (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 10, boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600 }}>Import People into {selectedOrg?.name}</h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}><input type="radio" checked={peopleImportFormat === 'csv'} onChange={() => setPeopleImportFormat('csv')} /> CSV</label>
                      <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}><input type="radio" checked={peopleImportFormat === 'json'} onChange={() => setPeopleImportFormat('json')} /> JSON</label>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                    <FilePicker accept={peopleImportFormat === 'csv' ? '.csv,.txt' : '.json,.txt'} onFileRead={(content, fn) => { setPeopleImportText(content); if (fn.endsWith('.json')) setPeopleImportFormat('json'); if (fn.endsWith('.csv')) setPeopleImportFormat('csv'); }} />
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>or paste below. Columns: Name (required), Email, Role, Title</span>
                  </div>
                  <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: 'var(--font-mono)', fontSize: 11 }} value={peopleImportText} onChange={(e) => setPeopleImportText(e.target.value)}
                    placeholder={peopleImportFormat === 'csv' ? 'Name,Email,Role,Title\nJane Smith,jane@co.com,PROCESS_OWNER,Director' : '[{ "name": "Jane Smith", "role": "PROCESS_OWNER" }]'} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                    <button style={btnSecondary} onClick={() => { setShowPeopleImport(false); setPeopleImportText(''); }}>Cancel</button>
                    <button style={{ ...btnPrimary, opacity: !peopleImportText.trim() ? 0.6 : 1 }} disabled={!peopleImportText.trim()} onClick={handlePeopleImport}>Import</button>
                  </div>
                </div>
              )}

              {/* People Table */}
              <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                {filteredPeople.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No people in this organization. Use + Add Person or Import People above.</p>
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg)' }}>
                        <th style={thStyle}>Name</th>
                        <th style={thStyle}>Email</th>
                        <th style={thStyle}>Role</th>
                        <th style={thStyle}>Governance</th>
                        <th style={thStyle}>Title</th>
                        <th style={{ ...thStyle, width: 70, textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPeople.map((person) => {
                        const gs = govSummary[person.id];
                        const govText = gs
                          ? [gs.groups > 0 && `${gs.groups} group${gs.groups > 1 ? 's' : ''}`, gs.roles > 0 && `${gs.roles} role${gs.roles > 1 ? 's' : ''}`, gs.domains > 0 && `${gs.domains} domain${gs.domains > 1 ? 's' : ''}`].filter(Boolean).join(', ')
                          : null;
                        return (
                        <tr key={person.id} style={{ transition: 'background 0.1s' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                          <td style={{ ...tdStyle, fontWeight: 500 }}>{person.name}</td>
                          <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{person.email || '--'}</td>
                          <td style={tdStyle}><span style={roleBadge(person.role)}>{ROLE_LABELS[person.role] || person.role}</span></td>
                          <td style={tdStyle}>
                            {govText ? (
                              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', background: 'var(--color-bg)', padding: '2px 8px', borderRadius: 4 }}>{govText}</span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>--</span>
                            )}
                          </td>
                          <td style={tdStyle}>{person.title || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <button style={{ ...btnIcon, color: 'var(--color-text-secondary)' }} onClick={() => openPerson360(person.id)}>View</button>
                            <button style={{ ...btnIcon, color: 'var(--color-primary)' }} onClick={() => openEditPerson(person)}>Edit</button>
                            <button style={{ ...btnIcon, color: 'var(--color-error)' }} onClick={() => handleDeletePerson(person.id)}>Del</button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Person 360 View Modal */}
      {(viewing360 || loading360) && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => { if (!loading360) setViewing360(null); }}>
          <div style={{
            background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
            padding: 24, maxWidth: 800, width: '90vw', maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }} onClick={(e) => e.stopPropagation()}>
            {loading360 ? (
              <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem' }}>Loading...</p>
            ) : viewing360 ? (
              <>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{viewing360.person.name}</h2>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {viewing360.person.email && <span>{viewing360.person.email}</span>}
                      {viewing360.person.title && <span>{viewing360.person.email ? ' \u2022 ' : ''}{viewing360.person.title}</span>}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <span style={roleBadge(viewing360.person.role)}>{ROLE_LABELS[viewing360.person.role] || viewing360.person.role}</span>
                    </div>
                  </div>
                  <button onClick={() => setViewing360(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)', padding: '0 4px' }}>x</button>
                </div>

                {/* Organizations */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Organizations ({viewing360.orgAssignments.length})</h3>
                  {viewing360.orgAssignments.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No organization assignments</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {viewing360.orgAssignments.map((org) => (
                        <div key={org.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '6px 12px' }}>
                          <span style={{ fontSize: 12, fontWeight: 500 }}>{org.name}</span>
                          <span style={typeBadge(org.type)}>{org.type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Governance Groups — Editable */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Governance Groups ({viewing360.governanceGroups.length} of {viewing360.allGroups.length})
                  </h3>
                  {viewing360.allGroups.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No governance groups defined yet</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {viewing360.allGroups.map((group) => {
                        const membership = viewing360.governanceGroups.find((g) => g.groupId === group.id);
                        const isMember = !!membership;
                        return (
                          <div key={group.id} style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox" checked={isMember} disabled={saving360}
                              style={{ accentColor: 'var(--color-primary)', flexShrink: 0 }}
                              onChange={() => toggleGroupMembership(group.id, isMember)}
                            />
                            <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{group.name}</span>
                            <span style={{
                              display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                              textTransform: 'uppercase',
                              background: group.type === 'COUNCIL' ? '#fce7f3' : group.type === 'OFFICE' ? '#ede9fe' : '#f1f5f9',
                              color: group.type === 'COUNCIL' ? '#9d174d' : group.type === 'OFFICE' ? '#5b21b6' : '#64748b',
                            }}>{GROUP_TYPE_LABELS[group.type] || group.type}</span>
                            {isMember && (
                              <select
                                value={membership.groupRole} disabled={saving360}
                                style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--color-border)', borderRadius: 3, background: 'var(--color-surface)', appearance: 'auto' as any }}
                                onChange={(e) => changeGroupRole(group.id, e.target.value)}
                              >
                                {GROUP_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* DAMA Roles — Editable */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>DAMA Roles ({viewing360.damaRoles.length})</h3>
                    <button
                      style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11 }}
                      onClick={() => { setShowAddDamaRole(!showAddDamaRole); setNewDamaRole({ roleType: viewing360.allDamaRoleTypes[0] || 'CDO', scopeType: 'ORG', scopeId: '' }); }}
                    >
                      {showAddDamaRole ? 'Cancel' : '+ Add Role'}
                    </button>
                  </div>
                  {showAddDamaRole && (
                    <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 500, display: 'block', marginBottom: 2 }}>Role Type</label>
                        <select
                          style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 3, background: 'var(--color-surface)', appearance: 'auto' as any }}
                          value={newDamaRole.roleType}
                          onChange={(e) => setNewDamaRole({ ...newDamaRole, roleType: e.target.value })}
                        >
                          {(viewing360.allDamaRoleTypes || []).map((rt) => (
                            <option key={rt} value={rt}>{DAMA_ROLE_LABELS[rt] || rt}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 500, display: 'block', marginBottom: 2 }}>Scope Type</label>
                        <select
                          style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 3, background: 'var(--color-surface)', appearance: 'auto' as any }}
                          value={newDamaRole.scopeType}
                          onChange={(e) => setNewDamaRole({ ...newDamaRole, scopeType: e.target.value as 'ORG' | 'DOMAIN', scopeId: '' })}
                        >
                          <option value="ORG">Organization</option>
                          <option value="DOMAIN">Data Domain</option>
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <label style={{ fontSize: 10, fontWeight: 500, display: 'block', marginBottom: 2 }}>
                          {newDamaRole.scopeType === 'ORG' ? 'Organization' : 'Data Domain'}
                        </label>
                        <select
                          style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 3, background: 'var(--color-surface)', width: '100%', appearance: 'auto' as any }}
                          value={newDamaRole.scopeId}
                          onChange={(e) => setNewDamaRole({ ...newDamaRole, scopeId: e.target.value })}
                        >
                          <option value="">-- Select --</option>
                          {newDamaRole.scopeType === 'ORG'
                            ? flatOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)
                            : (viewing360.allDomains || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)
                          }
                        </select>
                      </div>
                      <button
                        style={{ ...btnPrimary, padding: '4px 12px', fontSize: 11, opacity: !newDamaRole.scopeId ? 0.5 : 1 }}
                        disabled={!newDamaRole.scopeId || saving360}
                        onClick={addDamaRole}
                      >
                        Add
                      </button>
                    </div>
                  )}
                  {viewing360.damaRoles.length === 0 && !showAddDamaRole ? (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No DAMA roles assigned</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {viewing360.damaRoles.map((r) => (
                        <div key={r.id} style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                              background: '#dbeafe', color: '#1e40af', marginRight: 8,
                            }}>{DAMA_ROLE_LABELS[r.roleType] || r.roleType.replace(/_/g, ' ')}</span>
                            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{r.scopeType}: {r.scopeName}</span>
                          </div>
                          <button
                            style={{ ...btnIcon, color: 'var(--color-error)', fontSize: 11 }}
                            disabled={saving360}
                            onClick={() => removeDamaRole(r.id)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Data Domains — Editable */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Data Domains ({(viewing360.allDomains || []).filter((d) => d.ownerId === viewing360.person.id || d.stewardIds?.includes(viewing360.person.id)).length} of {(viewing360.allDomains || []).length})
                  </h3>
                  {(viewing360.allDomains || []).length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No data domains defined yet</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(viewing360.allDomains || []).map((domain) => {
                        const isOwner = domain.ownerId === viewing360.person.id;
                        const isSteward = domain.stewardIds?.includes(viewing360.person.id) || false;
                        return (
                          <div key={domain.id} style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{domain.name}</span>
                            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                              <input
                                type="checkbox" checked={isOwner} disabled={saving360}
                                style={{ accentColor: '#0f4f46' }}
                                onChange={() => toggleDomainOwner(domain.id, isOwner)}
                              />
                              Owner
                            </label>
                            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                              <input
                                type="checkbox" checked={isSteward} disabled={saving360}
                                style={{ accentColor: '#1e40af' }}
                                onChange={() => toggleDomainSteward(domain.id, isSteward, domain.stewardIds || [])}
                              />
                              Steward
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Owned Processes (read-only) */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Owned Processes ({viewing360.ownedProcessNodes.length})</h3>
                  {viewing360.ownedProcessNodes.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Does not own any process nodes</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {viewing360.ownedProcessNodes.map((n) => (
                        <div key={n.id} style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12 }}>{n.name}</span>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: '#ede9fe', color: '#5b21b6',
                          }}>{n.level}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Owned/Stewarded Data Assets (read-only) */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data Assets ({viewing360.dataAssets.length})</h3>
                  {viewing360.dataAssets.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No data assets owned or stewarded</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {viewing360.dataAssets.map((a) => (
                        <div key={a.id} style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12 }}>{a.name}</span>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                              background: a.relation === 'owner' ? '#d1f0eb' : '#dbeafe',
                              color: a.relation === 'owner' ? '#0f4f46' : '#1e40af',
                            }}>{a.relation}</span>
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{a.governanceTier}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
