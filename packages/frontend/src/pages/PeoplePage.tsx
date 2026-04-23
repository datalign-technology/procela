import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import { useToastStore } from '../stores/toastStore';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import { errorToast } from '../lib/errorToast';
import SaveIndicator, { type SaveState } from '../components/SaveIndicator';
import { SkeletonRows } from '../components/Skeleton';
import OrgChipInput from '../components/OrgChipInput';
import { OrgPickerModal } from '../components/OrgPicker';
import SortableTh from '../components/SortableTh';
import { useSortedList } from '../hooks/useSortedList';
import SyncConnectionWizard from '../components/SyncConnectionWizard';
import PageTabNav, { ADMIN_TABS } from '../components/PageTabNav';

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
  BUSINESS_DATA_STEWARD: 'Business Data Steward',
  DATA_QUALITY_ANALYST: 'Data Quality Analyst',
  TECHNICAL_DATA_STEWARD: 'Technical Data Steward',
  DATA_CUSTODIAN: 'Data Custodian',
  DATA_ARCHITECT: 'Data Architect',
  DATA_ENGINEER: 'Data Engineer',
  DATABASE_ADMINISTRATOR: 'Database Administrator',
  DATA_STEWARD: 'Data Steward (Legacy)',
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
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--color-border)',
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
  SUPER_ADMIN: 'Super Admin', ORG_ADMIN: 'Org Admin', EDITOR: 'Editor',
  CONTRIBUTOR: 'Contributor', VIEWER: 'Viewer',
};
const roleBadge = (role: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    SUPER_ADMIN: { bg: '#fce7f3', color: '#9d174d' }, ORG_ADMIN: { bg: '#ede9fe', color: '#5b21b6' },
    EDITOR: { bg: '#d1f0eb', color: '#0f4f46' },
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

// ── Org Sidebar Tree ──


function OrgSidebarTree({ nodes, selectedId, onSelect, peopleCounts }: {
  nodes: OrgNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  peopleCounts: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand root nodes on mount
    return new Set(nodes.map((n) => n.id));
  });

  const toggle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderNode = (node: OrgNode, depth: number) => {
    const isSelected = selectedId === node.id;
    const isExpanded = expanded.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const count = peopleCounts[node.id] || 0;
    return (
      <div key={node.id}>
        <div
          onClick={() => onSelect(node.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 6px', paddingLeft: 6 + depth * 14,
            fontSize: 12, borderRadius: 4, cursor: 'pointer',
            fontWeight: isSelected ? 600 : 400,
            background: isSelected ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
            color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
          }}
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
        >
          {hasChildren ? (
            <span
              onClick={(e) => toggle(node.id, e)}
              style={{ width: 14, textAlign: 'center', fontSize: 8, color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0 }}
            >
              {isExpanded ? '\u25BC' : '\u25B6'}
            </span>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {node.name}
          </span>
          {count > 0 && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>{count}</span>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return <div>{nodes.map((n) => renderNode(n, 0))}</div>;
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT — People list + 360 view. Filtered by org via
// the org tree sidebar; `?orgId=` query param preselects the filter
// so deep links from the Organizations page land on the right slice.
// ══════════════════════════════════════════════════════════════

export default function PeoplePage() {
  const { orgs: accessibleOrgs, activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');

  // Org lookup state — we only need the flat list + tree for the "assign
  // to orgs" multi-select in the person form. No tree navigation here.
  const [flatOrgs, setFlatOrgs] = useState<OrgFlat[]>([]);
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);

  // People state
  const [people, setPeople] = useState<Person[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [showPersonForm, setShowPersonForm] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [personForm, setPersonForm] = useState<PersonFormData>(emptyPersonForm);
  const [showPeopleImport, setShowPeopleImport] = useState(false);
  const [showPeopleSync, setShowPeopleSync] = useState(false);
  const [peopleImportText, setPeopleImportText] = useState('');
  const [peopleImportFormat, setPeopleImportFormat] = useState<'csv' | 'json'>('csv');
  // Target org for import — defaults to the active filter so "import into
  // <currently-filtered org>" is a single click, but the user can change it
  // to any org they have access to in the dropdown.
  const [peopleImportOrgId, setPeopleImportOrgId] = useState('');
  const [viewing360, setViewing360] = useState<Person360Data | null>(null);
  // loading360 is only read by the legacy modal (now unreachable); setter
  // is dead. `_setLoading360` retains the tuple shape without the unused
  // warning.
  const [loading360, _setLoading360] = useState(false); void _setLoading360;
  const [saving360, setSaving360] = useState(false);
  const [showDeleteAllPeople, setShowDeleteAllPeople] = useState(false);
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(new Set());
  const [confirmBulkDeletePeople, setConfirmBulkDeletePeople] = useState(false);
  const [confirmDeletePerson, setConfirmDeletePerson] = useState<string | null>(null);
  const [deletePersonImpact, setDeletePersonImpact] = useState<{ ownedProcesses: number; governanceGroups: number; damaRoles: number; domainOwner: number; domainSteward: number } | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignOrgIds, setBulkAssignOrgIds] = useState<Set<string>>(new Set());
  const [personFormSave, setPersonFormSave] = useState<SaveState>('idle');
  const [filterAppRole, setFilterAppRole] = useState('');
  const [filterGovRole, setFilterGovRole] = useState('');

  // Quick-add row state
  const [quickName, setQuickName] = useState('');
  const [quickEmail, setQuickEmail] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);

  const handleQuickAdd = async () => {
    if (!quickName.trim() || !selectedOrgId) return;
    setQuickSaving(true);
    try {
      await apiClient.post('/people', {
        name: quickName.trim(),
        email: quickEmail.trim() || undefined,
        title: quickTitle.trim() || undefined,
        role: 'VIEWER',
        orgIds: [selectedOrgId],
      });
      addToast('success', `${quickName.trim()} added`);
      setQuickName(''); setQuickEmail(''); setQuickTitle('');
      fetchData();
    } catch { /* */ }
    finally { setQuickSaving(false); }
  };

  // Governance data for summary column and 360 editing
  const [allGovernanceGroups, setAllGovernanceGroups] = useState<GovernanceGroupFull[]>([]);
  const [allDamaRoles, setAllDamaRoles] = useState<DamaRoleFull[]>([]);
  const [allDataDomains, setAllDataDomains] = useState<DataDomainFull[]>([]);

  // DAMA role add form state inside 360 modal
  const [showAddDamaRole, setShowAddDamaRole] = useState(false);
  const [newDamaRole, setNewDamaRole] = useState({ roleType: 'CDO', scopeType: 'ORG' as const, scopeId: '' });

  const fetchData = useCallback(async () => {
    try {
      // Scope the org tree to the active "Working In" context so siblings
      // and ancestors are hidden even when the user has broader permissions.
      const orgQuery = activeOrgId ? `?scopeOrgId=${encodeURIComponent(activeOrgId)}` : '';
      const [orgRes, peopleRes, govRes, damaRes, domainRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: OrgFlat[]; tree: OrgNode[]; orgTypes: string[] }>(`/organizations${orgQuery}`),
        apiClient.get<{ success: boolean; data: Person[]; roles: string[] }>('/people'),
        apiClient.get<{ success: boolean; data: GovernanceGroupFull[] }>('/governance-groups'),
        apiClient.get<{ success: boolean; data: DamaRoleFull[] }>('/dama-roles'),
        apiClient.get<{ success: boolean; data: DataDomainFull[] }>('/data-domains'),
      ]);
      const nextFlat = orgRes.data || [];
      setTree(orgRes.tree || []); setFlatOrgs(nextFlat);
      // Clear any stale filter that fell outside the accessible-org scope
      // (e.g. Working-In was changed or an org was deleted).
      setSelectedOrgId((prev) => (prev && nextFlat.some((o) => o.id === prev) ? prev : ''));
      setPeople(peopleRes.data || []); setRoles(peopleRes.roles || []);
      setAllGovernanceGroups(govRes.data || []);
      setAllDamaRoles(damaRes.data || []);
      setAllDataDomains(domainRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Highlight row when arriving from global search
  useEffect(() => {
    if (highlightId) {
      const el = document.getElementById(`row-${highlightId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.animation = 'highlightPulse 2s ease-out';
        setTimeout(() => {
          el.style.animation = '';
          const params = new URLSearchParams(searchParams);
          params.delete('highlight');
          setSearchParams(params, { replace: true });
        }, 2000);
      }
    }
  }, [highlightId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const filteredPeople = people.filter((p) => {
    if (selectedOrgId && !p.orgIds.includes(selectedOrgId)) return false;
    if (filterAppRole && p.role !== filterAppRole) return false;
    if (filterGovRole) {
      const hasRole = allDamaRoles.some((r) => r.personId === p.id && r.roleType === filterGovRole);
      if (!hasRole) return false;
    }
    return true;
  });

  // Sort: comparators keyed by column name; URL persists ?sort=&dir=
  const { sorted: sortedPeople, sortKey, sortDir, toggleSort } = useSortedList(
    filteredPeople,
    {
      name: (a, b) => a.name.localeCompare(b.name),
      email: (a, b) => (a.email || '').localeCompare(b.email || ''),
      role: (a, b) => a.role.localeCompare(b.role),
      title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    },
    'name',
    'asc',
    'p_',
  );

  const orgOptions = flattenTreeForSelect(tree);
  // Reserved for future visibility filtering
  void accessibleOrgs;

  // Keep the filter in sync with the URL so back/forward preserves it and
  // deep-links from the Organizations tree (?orgId=<id>) land pre-filtered.
  const urlOrgId = searchParams.get('orgId') || '';
  useEffect(() => {
    if (urlOrgId !== selectedOrgId) setSelectedOrgId(urlOrgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlOrgId]);

  // `?addToOrg=<id>` comes from the "+ Person" button on the Organizations
  // tree: it's a shortcut to "drop a new person into this org". If the
  // user has bulk-selected people already, we bulk-assign instead —
  // matches the UX recommendation of "if selection exists, offer Assign
  // these N here; otherwise open the Add form pre-scoped".
  const addToOrgParam = searchParams.get('addToOrg') || '';
  useEffect(() => {
    if (!addToOrgParam || !flatOrgs.length) return;
    // Don't re-trigger while the form is already open.
    if (showPersonForm || bulkAssignOpen) return;

    const targetOrg = flatOrgs.find((o) => o.id === addToOrgParam);
    // Strip the param once handled so refresh / back doesn't re-open.
    const clearParam = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('addToOrg');
      setSearchParams(next, { replace: true });
    };

    if (!targetOrg) { clearParam(); return; }

    if (selectedPersonIds.size > 0) {
      // Bulk-assign existing selection to that org instead of creating a new person.
      setBulkAssignOrgIds(new Set([targetOrg.id]));
      setBulkAssignOpen(true);
    } else {
      openAddPerson();
      setPersonForm((f) => ({ ...f, orgIds: [targetOrg.id] }));
    }
    clearParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToOrgParam, flatOrgs]);

  const applyOrgFilter = (id: string) => {
    setSelectedOrgId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('orgId', id); else next.delete('orgId');
    setSearchParams(next, { replace: true });
  };

  // ── People handlers ──
  const openAddPerson = () => { setPersonForm({ ...emptyPersonForm, orgIds: selectedOrgId ? [selectedOrgId] : [] }); setEditingPersonId(null); setShowPersonForm(true); };
  const openEditPerson = (person: Person) => {
    // Edit only allows name/email/title — orgs and role live under Manage.
    // We still seed the full state from the existing record so the
    // PersonFormData type stays uniform; the UI just hides the rest.
    setPersonForm({
      orgIds: person.orgIds || [], name: person.name, email: person.email,
      role: person.role, title: person.title,
      accessibleOrgIds: person.accessibleOrgIds || [],
    });
    setEditingPersonId(person.id);
    setShowPersonForm(true);
  };
  const handleSavePerson = async () => {
    if (!personForm.name.trim()) return;
    setPersonFormSave('saving');
    try {
      if (editingPersonId) {
        // Edit: send only the identity fields. Skipping orgIds / role /
        // accessibleOrgIds means the backend leaves them untouched, so
        // changes made under Manage aren't clobbered.
        await apiClient.put(`/people/${editingPersonId}`, {
          name: personForm.name,
          email: personForm.email,
          title: personForm.title,
        });
      } else {
        // Add still needs orgIds (backend requires non-empty) and role.
        if (personForm.orgIds.length === 0) { setPersonFormSave('idle'); return; }
        await apiClient.post('/people', personForm);
      }
      addToast('success', editingPersonId ? 'Person updated' : 'Person added');
      setPersonFormSave('saved');
      setTimeout(() => {
        setShowPersonForm(false); setEditingPersonId(null); setPersonForm(emptyPersonForm);
        setPersonFormSave('idle');
        fetchData();
      }, 600);
    } catch (err) {
      setPersonFormSave('error');
      errorToast(err, 'Failed to save person');
    }
  };
  const handleDeletePerson = async (id: string) => {
    const person = people.find((p) => p.id === id);
    await apiClient.delete(`/people/${id}`);
    fetchData();
    if (person) {
      addToast('success', `"${person.name}" deleted`, {
        action: {
          label: 'Undo',
          handler: async () => {
            await apiClient.post('/people', {
              name: person.name, email: person.email,
              role: person.role, title: person.title,
              orgIds: person.orgIds,
            });
            addToast('success', `"${person.name}" restored`);
            fetchData();
          },
        },
        duration: 6000,
      });
    } else {
      addToast('success', 'Person deleted');
    }
  };

  // ── Bulk select handlers ──
  const togglePersonSelect = (id: string) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const togglePeopleSelectAll = () => {
    if (selectedPersonIds.size === filteredPeople.length) {
      setSelectedPersonIds(new Set());
    } else {
      setSelectedPersonIds(new Set(filteredPeople.map((p) => p.id)));
    }
  };
  const handleBulkDeletePeople = async () => {
    if (selectedPersonIds.size === 0) return;
    await Promise.all(Array.from(selectedPersonIds).map((id) => apiClient.delete(`/people/${id}`)));
    setSelectedPersonIds(new Set());
    fetchData();
  };

  // Bulk assign N selected people to one or more orgs. We merge (not replace)
  // so existing assignments aren't clobbered — the flow is "add these orgs
  // to everyone selected", which matches the affordance's label.
  const openBulkAssign = () => {
    setBulkAssignOrgIds(new Set());
    setBulkAssignOpen(true);
  };
  const toggleBulkAssignOrg = (orgId: string) => {
    setBulkAssignOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId); else next.add(orgId);
      return next;
    });
  };
  const handleBulkAssign = async () => {
    if (selectedPersonIds.size === 0 || bulkAssignOrgIds.size === 0) return;
    const targetIds = Array.from(selectedPersonIds);
    const addIds = Array.from(bulkAssignOrgIds);
    try {
      await Promise.all(targetIds.map(async (pid) => {
        const p = people.find((x) => x.id === pid);
        if (!p) return;
        const merged = Array.from(new Set([...(p.orgIds || []), ...addIds]));
        await apiClient.put(`/people/${pid}`, { orgIds: merged });
      }));
      addToast('success', `Assigned ${targetIds.length} ${targetIds.length === 1 ? 'person' : 'people'} to ${addIds.length} org${addIds.length === 1 ? '' : 's'}`);
      setBulkAssignOpen(false);
      setBulkAssignOrgIds(new Set());
      fetchData();
    } catch (err) {
      errorToast(err, 'Bulk assignment failed');
    }
  };
  // NOTE: The Person 360 modal used to be the entry point here.
  // It's now the dedicated /people/:id page; the Manage button
  // navigates there. The modal JSX below remains as legacy code but
  // is unreachable because nothing sets `viewing360` anymore. Leave
  // it in place for one release cycle so we can ship the new page
  // without a destructive diff; remove in a follow-up.

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

  // ── Governance Group membership toggle (optimistic) ──
  // Flip the UI state immediately so the checkbox feels instant, then
  // call the API in the background. On failure, revert and toast — the
  // previous state is captured in `snapshot` before mutation.
  const toggleGroupMembership = async (groupId: string, isMember: boolean, role: string = 'MEMBER') => {
    if (!viewing360) return;
    const snapshot = viewing360;
    // Optimistically toggle the group in the currently-viewed 360.
    const nextGroups = isMember
      ? viewing360.governanceGroups.filter((g) => g.groupId !== groupId)
      : [
          ...viewing360.governanceGroups,
          {
            groupId,
            groupName: viewing360.allGroups.find((g) => g.id === groupId)?.name || '',
            groupType: viewing360.allGroups.find((g) => g.id === groupId)?.type || '',
            groupRole: role,
            since: new Date().toISOString(),
          },
        ];
    setViewing360({ ...viewing360, governanceGroups: nextGroups });
    try {
      if (isMember) await apiClient.delete(`/governance-groups/${groupId}/members/${viewing360.person.id}`);
      else await apiClient.post(`/governance-groups/${groupId}/members`, { personId: viewing360.person.id, groupRole: role });
      // Background reconcile with server truth — catches any server-side
      // mutations our optimistic model didn't predict (timestamps, etc.).
      await refresh360();
    } catch (err) {
      setViewing360(snapshot);  // revert
      errorToast(err, 'Failed to update group membership');
    }
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
    } catch (err) { errorToast(err, 'Failed to change group role'); }
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
    } catch (err) { errorToast(err, 'Failed to assign governance role'); }
    finally { setSaving360(false); }
  };

  const removeDamaRole = async (roleId: string) => {
    setSaving360(true);
    try {
      await apiClient.delete(`/dama-roles/${roleId}`);
      await refresh360();
    } catch (err) { errorToast(err, 'Failed to remove governance role'); }
    finally { setSaving360(false); }
  };

  // ── Person identity (org + role) editing inside the Manage modal ──
  // These live here (not in the Edit form) so users edit "who they are"
  // separately from "what access / responsibilities they have".

  const togglePersonOrgAssignment = async (orgId: string) => {
    if (!viewing360) return;
    const current = viewing360.person.orgIds || [];
    const next = current.includes(orgId)
      ? current.filter((id) => id !== orgId)
      : [...current, orgId];
    if (next.length === 0) return; // backend requires at least one assignment
    setSaving360(true);
    try {
      await apiClient.put(`/people/${viewing360.person.id}`, { orgIds: next });
      addToast('success', 'Org assignment updated');
      await refresh360();
      fetchData();
    } catch (err) { errorToast(err, 'Failed to update org assignment'); }
    finally { setSaving360(false); }
  };

  const changePersonRole = async (newRole: string) => {
    if (!viewing360) return;
    setSaving360(true);
    try {
      await apiClient.put(`/people/${viewing360.person.id}`, { role: newRole });
      addToast('success', 'Role updated');
      await refresh360();
      fetchData();
    } catch (err) { errorToast(err, 'Failed to change application role'); }
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
      addToast('success', isCurrentOwner ? 'Domain owner removed' : 'Domain owner assigned');
      await refresh360();
    } catch (err) { errorToast(err, 'Failed to update data domain owner'); }
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
      addToast('success', isSteward ? 'Steward removed' : 'Steward assigned');
      await refresh360();
    } catch (err) { errorToast(err, 'Failed to update steward'); }
    finally { setSaving360(false); }
  };
  const handlePeopleImport = async () => {
    const orgId = peopleImportOrgId || selectedOrgId;
    if (!peopleImportText.trim() || !orgId) return;
    try {
      const body: any = { orgId };
      if (peopleImportFormat === 'csv') body.csv = peopleImportText; else body.people = JSON.parse(peopleImportText);
      const result = await apiClient.post<{ success: boolean; message?: string; skipped?: number }>('/people/import', body);
      if (result.skipped && result.skipped > 0 && result.message) {
        alert(result.message);
      }
      setShowPeopleImport(false); setPeopleImportText(''); setPeopleImportOrgId('');
      fetchData();
    } catch (e) { alert(e instanceof Error ? e.message : 'Import failed'); }
  };

  if (loading) return (
    <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden', padding: 8 }}>
      <SkeletonRows rows={6} columns={5} />
    </div>
  );

  return (
    <div>
      <PageTabNav tabs={ADMIN_TABS} />
      <style>{`@keyframes highlightPulse { 0% { background: #fef3c7; } 100% { background: transparent; } }`}</style>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>People</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            {people.length} people across {flatOrgs.length} organizations. Filter by organization to narrow the list.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        </div>
      </div>

      {/* Side-by-side: Org tree (left) + People list (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Org tree sidebar */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 10, position: 'sticky', top: 12, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, padding: '0 4px' }}>Organizations</div>
          <div
            onClick={() => applyOrgFilter('')}
            style={{
              padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
              fontWeight: !selectedOrgId ? 600 : 400,
              background: !selectedOrgId ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
              color: !selectedOrgId ? 'var(--color-primary)' : 'var(--color-text)',
            }}
            onMouseEnter={(e) => { if (selectedOrgId) e.currentTarget.style.background = 'var(--color-bg)'; }}
            onMouseLeave={(e) => { if (selectedOrgId) e.currentTarget.style.background = 'transparent'; }}
          >
            All ({people.length})
          </div>
          <OrgSidebarTree
            nodes={tree}
            selectedId={selectedOrgId}
            onSelect={applyOrgFilter}
            peopleCounts={Object.fromEntries(
              flatOrgs.map((o) => [o.id, people.filter((p) => p.orgIds.includes(o.id)).length]),
            )}
          />
        </div>

        {/* People list */}
        <div>
          <>
              {/* Active filter / counts header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600 }}>
                      {selectedOrgId ? selectedOrg?.name : 'All people'}
                    </h2>
                    {selectedOrgId && selectedOrg && <span style={typeBadge(selectedOrg.type || '')}>{selectedOrg.type}</span>}
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{filteredPeople.length} {filteredPeople.length === 1 ? 'person' : 'people'}</span>
                    {selectedOrgId && (
                      // Active-filter chip with an x to clear — mirrors the
                      // dropdown at the top so users see at a glance that
                      // they're looking at a subset.
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 4px 2px 8px', borderRadius: 999,
                        background: '#eff6ff', color: '#1e40af',
                        fontSize: 11, fontWeight: 500,
                      }}>
                        Filter: {selectedOrg?.name || selectedOrgId}
                        <button
                          onClick={() => applyOrgFilter('')}
                          aria-label="Clear org filter"
                          title="Clear filter"
                          style={{
                            border: 'none', background: 'transparent', cursor: 'pointer',
                            color: '#1e40af', fontSize: 14, lineHeight: 1, padding: '0 4px',
                          }}
                        >&times;</button>
                      </span>
                    )}
                  </div>
                  {selectedOrgId && selectedOrg?.description && <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{selectedOrg.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {people.length > 0 && (
                    <IconButton icon="trash" label="Delete all people" variant="danger"
                      onClick={() => setShowDeleteAllPeople(true)} />
                  )}
                  {filteredPeople.length > 0 && (
                    <IconButton icon="download" label="Export CSV"
                      onClick={() => exportCsv('people.csv', ['Name', 'Email', 'Role', 'Title'], filteredPeople.map((p) => [
                        p.name, p.email, ROLE_LABELS[p.role] || p.role, p.title,
                      ]))} />
                  )}
                  <IconButton icon="upload" label="Import people"
                    onClick={() => { setPeopleImportOrgId(selectedOrgId); setShowPeopleImport(true); }} />
                  <IconButton icon="link" label="Connect to source" onClick={() => setShowPeopleSync(true)} />
                  <IconButton icon="plus" label="Add person" variant="primary"
                    onClick={openAddPerson} />
                </div>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)' }}>App Role:</label>
                  <select style={{ ...inputStyle, width: 'auto', minWidth: 120, fontSize: 12, padding: '4px 8px' }} value={filterAppRole} onChange={(e) => setFilterAppRole(e.target.value)}>
                    <option value="">All</option>
                    {Object.entries(ROLE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)' }}>Governance Role:</label>
                  <select style={{ ...inputStyle, width: 'auto', minWidth: 160, fontSize: 12, padding: '4px 8px' }} value={filterGovRole} onChange={(e) => setFilterGovRole(e.target.value)}>
                    <option value="">All</option>
                    {Object.entries(DAMA_ROLE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                {(filterAppRole || filterGovRole) && (
                  <button onClick={() => { setFilterAppRole(''); setFilterGovRole(''); }} style={{ fontSize: 11, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    Clear filters
                  </button>
                )}
                {(filterAppRole || filterGovRole) && (
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    Showing {filteredPeople.length} of {people.length}
                  </span>
                )}
              </div>

              <ConfirmDialog
                open={showDeleteAllPeople}
                title="Delete All People?"
                message={`This will permanently delete all ${people.length} people across all organizations. This cannot be undone.`}
                confirmLabel="Delete All"
                requireTypedConfirmation="DELETE"
                onConfirm={async () => {
                  setShowDeleteAllPeople(false);
                  await apiClient.delete('/people/all');
                  setSelectedPersonIds(new Set());
                  fetchData();
                }}
                onCancel={() => setShowDeleteAllPeople(false)}
              />

              <ConfirmDialog
                open={confirmBulkDeletePeople}
                title="Delete Selected People?"
                message={`Delete ${selectedPersonIds.size} selected people? This cannot be undone.`}
                confirmLabel="Delete Selected"
                onConfirm={async () => {
                  setConfirmBulkDeletePeople(false);
                  await handleBulkDeletePeople();
                }}
                onCancel={() => setConfirmBulkDeletePeople(false)}
              />

              <ConfirmDialog
                open={confirmDeletePerson !== null}
                title="Delete Person?"
                message={
                  deletePersonImpact && (deletePersonImpact.ownedProcesses > 0 || deletePersonImpact.governanceGroups > 0 || deletePersonImpact.damaRoles > 0 || deletePersonImpact.domainOwner > 0 || deletePersonImpact.domainSteward > 0)
                    ? `This will permanently remove this person. This person owns ${deletePersonImpact.ownedProcesses} process${deletePersonImpact.ownedProcesses !== 1 ? 'es' : ''}, belongs to ${deletePersonImpact.governanceGroups} governance group${deletePersonImpact.governanceGroups !== 1 ? 's' : ''}, has ${deletePersonImpact.damaRoles} DAMA role${deletePersonImpact.damaRoles !== 1 ? 's' : ''}, and owns ${deletePersonImpact.domainOwner} data domain${deletePersonImpact.domainOwner !== 1 ? 's' : ''}${deletePersonImpact.domainSteward > 0 ? ` (steward of ${deletePersonImpact.domainSteward})` : ''}. This cannot be undone.`
                    : 'This will permanently remove this person. This cannot be undone.'
                }
                confirmLabel="Delete"
                onConfirm={async () => {
                  const id = confirmDeletePerson;
                  setConfirmDeletePerson(null);
                  setDeletePersonImpact(null);
                  if (id) await handleDeletePerson(id);
                }}
                onCancel={() => { setConfirmDeletePerson(null); setDeletePersonImpact(null); }}
              />

              {/* Bulk Action Bar */}
              {selectedPersonIds.size > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
                  background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedPersonIds.size} selected</span>
                  <button
                    onClick={openBulkAssign}
                    style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                  >
                    Assign to org…
                  </button>
                  <button
                    onClick={() => setConfirmBulkDeletePeople(true)}
                    style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                  >
                    Delete Selected
                  </button>
                  <button
                    onClick={() => setSelectedPersonIds(new Set())}
                    style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                  >
                    Clear Selection
                  </button>
                </div>
              )}

              {/* Bulk assign picker modal — shared OrgPicker in a dialog. */}
              <OrgPickerModal
                open={bulkAssignOpen}
                title={`Assign ${selectedPersonIds.size} ${selectedPersonIds.size === 1 ? 'person' : 'people'} to organizations`}
                description="Selected orgs are added to every selected person. Existing assignments are preserved."
                confirmLabel={`Assign to ${bulkAssignOrgIds.size} org${bulkAssignOrgIds.size === 1 ? '' : 's'}`}
                orgs={flatOrgs}
                selectedIds={bulkAssignOrgIds}
                onToggle={toggleBulkAssignOrg}
                scopeOrgId={activeOrgId || null}
                onConfirm={handleBulkAssign}
                onCancel={() => setBulkAssignOpen(false)}
              />

              {/* Add/Edit Person Form */}
              {showPersonForm && (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 10, boxShadow: 'var(--shadow-sm)' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{editingPersonId ? 'Edit Person' : 'Add Person'}</h3>
                  <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                    {editingPersonId
                      ? 'Edit identity fields here. Org assignments and application role live under Manage.'
                      : 'Create the person and assign them to an org. Refine details and governance roles via Manage afterwards.'}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Name *</label>
                      <input autoFocus style={inputStyle} value={personForm.name} onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })} placeholder="Full name" />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Email</label>
                      <input style={inputStyle} value={personForm.email} onChange={(e) => setPersonForm({ ...personForm, email: e.target.value })} placeholder="email@example.com" />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Title</label>
                      <input style={inputStyle} value={personForm.title} onChange={(e) => setPersonForm({ ...personForm, title: e.target.value })} placeholder="e.g. Director of Operations" />
                    </div>
                    {/* The Add form keeps an Assigned Organization picker so
                        the new person lands in at least one org and is
                        immediately visible. Edit doesn't show this — those
                        live under Manage now. */}
                    {!editingPersonId && (
                      <>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Assign to Organizations *</label>
                          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                            Type to search — matches show their breadcrumb so same-named orgs are distinguishable.
                          </div>
                          <OrgChipInput
                            orgs={flatOrgs}
                            selectedIds={personForm.orgIds}
                            onChange={(next) => setPersonForm({ ...personForm, orgIds: next })}
                            scopeOrgId={activeOrgId || null}
                            autoFocus
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 3 }}>Application Role</label>
                          <select style={{ ...inputStyle, appearance: 'auto' as any }} value={personForm.role} onChange={(e) => setPersonForm({ ...personForm, role: e.target.value })}>
                            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                          </select>
                          <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 2 }}>Controls platform permissions. Governance roles are assigned separately.</div>
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <SaveIndicator state={personFormSave} />
                    <button style={btnSecondary} onClick={() => { setShowPersonForm(false); setEditingPersonId(null); setPersonFormSave('idle'); }}>Cancel</button>
                    {(() => {
                      // Add requires both a name and at least one org;
                      // Edit only requires a non-empty name (orgs/role
                      // are managed separately).
                      const invalid = !personForm.name.trim() || (!editingPersonId && personForm.orgIds.length === 0) || personFormSave === 'saving';
                      return (
                        <button style={{ ...btnPrimary, opacity: invalid ? 0.6 : 1 }} disabled={invalid} onClick={handleSavePerson}>
                          {editingPersonId ? 'Save' : 'Add'}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Import People Panel */}
              {showPeopleImport && (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 10, boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600 }}>Import People</h3>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Paste CSV or JSON, or browse a file. Format is auto-detected.</span>
                    </div>
                    <button onClick={() => { setShowPeopleImport(false); setPeopleImportText(''); setPeopleImportOrgId(''); }} style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--color-text-muted)' }}>&times;</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <label style={{ fontSize: 11, fontWeight: 500 }}>Organization *</label>
                    <select
                      style={{ ...inputStyle, width: 'auto', minWidth: 200, appearance: 'auto' as any, fontSize: 12 }}
                      value={peopleImportOrgId}
                      onChange={(e) => setPeopleImportOrgId(e.target.value)}
                    >
                      <option value="">-- Select --</option>
                      {orgOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                    </select>
                    <FilePicker accept=".csv,.json,.txt" onFileRead={(content, fn) => { setPeopleImportText(content); if (fn.endsWith('.json')) setPeopleImportFormat('json'); else setPeopleImportFormat('csv'); }} />
                  </div>
                  <textarea style={{ ...inputStyle, minHeight: 70, fontFamily: 'var(--font-mono)', fontSize: 11 }} value={peopleImportText} onChange={(e) => setPeopleImportText(e.target.value)}
                    placeholder={'Name,Email,Role,Title\nJane Smith,jane@co.com,EDITOR,Director of Operations'} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flex: 1 }}>CSV columns: Name (required), Email, Role, Title</span>
                    <button
                      style={{ ...btnPrimary, opacity: (!peopleImportText.trim() || !peopleImportOrgId) ? 0.6 : 1 }}
                      disabled={!peopleImportText.trim() || !peopleImportOrgId}
                      onClick={handlePeopleImport}
                    >Import</button>
                  </div>
                </div>
              )}

              {/* People Table */}
              <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                {filteredPeople.length === 0 && !selectedOrgId ? (
                  <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Select an organization on the left to see and add people.</p>
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg)' }}>
                        <th style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                          <input type="checkbox"
                            checked={filteredPeople.length > 0 && selectedPersonIds.size === filteredPeople.length}
                            onChange={togglePeopleSelectAll} />
                        </th>
                        <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Name</SortableTh>
                        <SortableTh sortKey="email" active={sortKey} dir={sortDir} onClick={toggleSort}>Email</SortableTh>
                        <SortableTh sortKey="role" active={sortKey} dir={sortDir} onClick={toggleSort}>App Role</SortableTh>
                        <th style={thStyle}>Governance</th>
                        <SortableTh sortKey="title" active={sortKey} dir={sortDir} onClick={toggleSort}>Title</SortableTh>
                        <th style={{ ...thStyle, width: 70, textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Quick-add row — always visible at the top when an org is selected */}
                      {selectedOrgId && (
                        <tr style={{ background: '#f0f9ff' }}>
                          <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}></td>
                          <td style={tdStyle}>
                            <input
                              value={quickName}
                              onChange={(e) => setQuickName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAdd(); }}
                              placeholder="Name *"
                              style={{ fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 3, padding: '3px 6px', width: '100%' }}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              value={quickEmail}
                              onChange={(e) => setQuickEmail(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAdd(); }}
                              placeholder="Email"
                              style={{ fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 3, padding: '3px 6px', width: '100%' }}
                            />
                          </td>
                          <td style={{ ...tdStyle, fontSize: 11, color: 'var(--color-text-muted)' }}>Viewer</td>
                          <td style={tdStyle}></td>
                          <td style={tdStyle}>
                            <input
                              value={quickTitle}
                              onChange={(e) => setQuickTitle(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAdd(); }}
                              placeholder="Title"
                              style={{ fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 3, padding: '3px 6px', width: '100%' }}
                            />
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <button
                              onClick={handleQuickAdd}
                              disabled={!quickName.trim() || quickSaving}
                              style={{
                                fontSize: 11, padding: '3px 10px', background: quickName.trim() ? 'var(--color-primary)' : '#e5e7eb',
                                color: quickName.trim() ? '#fff' : '#9ca3af', border: 'none', borderRadius: 3,
                                cursor: quickName.trim() ? 'pointer' : 'default',
                              }}
                            >
                              {quickSaving ? '...' : 'Add'}
                            </button>
                          </td>
                        </tr>
                      )}
                      {sortedPeople.map((person) => {
                        const gs = govSummary[person.id];
                        const govText = gs
                          ? [gs.groups > 0 && `${gs.groups} group${gs.groups > 1 ? 's' : ''}`, gs.roles > 0 && `${gs.roles} role${gs.roles > 1 ? 's' : ''}`, gs.domains > 0 && `${gs.domains} domain${gs.domains > 1 ? 's' : ''}`].filter(Boolean).join(', ')
                          : null;
                        const isSelected = selectedPersonIds.has(person.id);
                        return (
                        <tr key={person.id} id={`row-${person.id}`} style={{ transition: 'background 0.1s', background: isSelected ? '#f0f9ff' : '' }}
                          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                          <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                            <input type="checkbox" checked={isSelected} onChange={() => togglePersonSelect(person.id)} />
                          </td>
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
                            <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                              <IconButton size="sm" icon="settings" label="Manage" variant="primary" onClick={() => navigate(`/people/${person.id}`)} />
                              <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEditPerson(person)} />
                              <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={async () => {
                                try {
                                  const res = await apiClient.get<{ success: boolean; data: { ownedProcesses: number; governanceGroups: number; damaRoles: number; domainOwner: number; domainSteward: number } }>(`/people/${person.id}/impact`);
                                  setDeletePersonImpact(res.data || null);
                                } catch { setDeletePersonImpact(null); }
                                setConfirmDeletePerson(person.id);
                              }} />
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
          </>
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
                    <div style={{ fontSize: 11, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 2 }}>Manage Person</div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{viewing360.person.name}</h2>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {viewing360.person.email && <span>{viewing360.person.email}</span>}
                      {viewing360.person.title && <span>{viewing360.person.email ? ' \u2022 ' : ''}{viewing360.person.title}</span>}
                    </div>
                  </div>
                  <button onClick={() => setViewing360(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)', padding: '0 4px' }}>x</button>
                </div>

                {/* ── ASSIGNED ORGANIZATIONS (editable, tree) ── */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Assigned Organizations ({(viewing360.person.orgIds || []).length})
                  </h3>
                  <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    Toggle membership across the org hierarchy. The person must remain assigned to at least one org.
                  </p>
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: 1,
                    border: '1px solid var(--color-border)', borderRadius: 4,
                    background: 'var(--color-surface)',
                    maxHeight: 280, overflowY: 'auto',
                  }}>
                    {orgOptions.map((opt) => {
                      const personOrgIds = viewing360.person.orgIds || [];
                      const checked = personOrgIds.includes(opt.id);
                      const isOnlyAssignment = checked && personOrgIds.length === 1;
                      return (
                        <label
                          key={opt.id}
                          title={isOnlyAssignment ? 'Cannot unassign the last org' : undefined}
                          style={{
                            fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
                            cursor: saving360 || isOnlyAssignment ? 'default' : 'pointer',
                            padding: '4px 8px',
                            paddingLeft: 8 + opt.depth * 18,
                            borderBottom: '1px solid var(--color-border)',
                            background: checked ? '#eff6ff' : undefined,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={saving360 || isOnlyAssignment}
                            onChange={() => togglePersonOrgAssignment(opt.id)}
                            style={{ accentColor: 'var(--color-primary)', flexShrink: 0 }}
                          />
                          <span style={{ whiteSpace: 'nowrap', fontWeight: checked ? 500 : 400 }}>{opt.name}</span>
                          <span style={typeBadge(opt.type)}>{opt.type}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* ── APPLICATION ACCESS (editable) ── */}
                <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Application Access</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Platform role:</label>
                    <select
                      value={viewing360.person.role}
                      onChange={(e) => changePersonRole(e.target.value)}
                      disabled={saving360}
                      style={{ ...inputStyle, width: 'auto', appearance: 'auto' as any, fontSize: 12, padding: '4px 8px' }}
                    >
                      {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                    </select>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Controls what this person can do in the application</span>
                  </div>
                </div>

                {/* ── GOVERNANCE RESPONSIBILITIES ── */}
                <div style={{ marginBottom: 8, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Governance Responsibilities</h3>
                  <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 10 }}>Governance roles, governance group memberships, and data domain assignments</p>
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
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Governance Roles ({viewing360.damaRoles.length})</h3>
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
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <label style={{ fontSize: 10, fontWeight: 500, display: 'block', marginBottom: 2 }}>Organization</label>
                        <select
                          style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 3, background: 'var(--color-surface)', width: '100%', appearance: 'auto' as any }}
                          value={newDamaRole.scopeId}
                          onChange={(e) => setNewDamaRole({ ...newDamaRole, scopeId: e.target.value })}
                        >
                          <option value="">-- Select organization --</option>
                          {flatOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
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
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No governance roles assigned</p>
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
                {/* Footer Close — explicit affordance for keyboard / mobile
                    users who may not discover the header X or backdrop click. */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                  <button
                    onClick={() => setViewing360(null)}
                    style={{
                      padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
                      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                      fontSize: 13, fontWeight: 500, cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
      <SyncConnectionWizard open={showPeopleSync} onClose={() => setShowPeopleSync(false)} targetEntity="people" orgId={activeOrgId || ''} onCreated={fetchData} />
    </div>
  );
}
