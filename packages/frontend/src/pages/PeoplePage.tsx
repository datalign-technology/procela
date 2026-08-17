import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { thStyle, tdStyle } from '../lib/tableStyles';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import Spinner from '../components/Spinner';
import Button from '../components/Button';
import FieldStack from '../components/FieldStack';
import SkillGapBadge from '../components/SkillGapBadge';
import { useOrgContext } from '../stores/orgContext';
import ExportMenu from '../components/ExportMenu';
import SavedViewsMenu from '../components/SavedViewsMenu';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { renderNavIcon } from '../components/navIcons';
import { useToastStore } from '../stores/toastStore';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import Avatar from '../components/Avatar';
import { errorToast, errorMessage } from '../lib/errorToast';
import { clickable, activateOnKeyStop } from '../lib/a11y';
import SaveIndicator, { type SaveState } from '../components/SaveIndicator';
import { SkeletonRows } from '../components/Skeleton';
import HelpPopover from '../components/HelpPopover';
import OrgChipInput from '../components/OrgChipInput';
import { OrgPickerModal } from '../components/OrgPicker';
import SortableTh from '../components/SortableTh';
import { useSortedList } from '../hooks/useSortedList';
import { useRowSelection } from '../hooks/useRowSelection';
import { usePagination } from '../hooks/usePagination';
import Pager from '../components/Pager';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
// Lazy: only renders when the user opens the connection picker.
const SyncConnectionWizard = lazy(() => import('../components/SyncConnectionWizard'));

// ── Types ──

interface OrgNode {
  id: string; parentId: string | null; name: string; type: string;
  industry: string; description: string; headCount: number; children: OrgNode[];
}
interface OrgFlat {
  id: string; parentId: string | null; name: string; type: string;
  industry: string; description: string; headCount: number;
}

// Build a "Parent > Child > Grandchild" path string for the
// People export's Org column. Walks parentId up to the root and
// joins the names with " > " — the import endpoint splits on the
// same separator. Returns empty string when the org isn't in the
// caller's visible set (which keeps the column blank rather than
// emitting half a path).
function buildOrgPath(orgId: string, orgs: OrgFlat[]): string {
  if (!orgId) return '';
  const parts: string[] = [];
  let cur: OrgFlat | undefined = orgs.find((o) => o.id === orgId);
  if (!cur) return '';
  // Cap the walk at 16 hops so a corrupt parentId loop can't hang
  // the export.
  for (let i = 0; i < 16 && cur; i++) {
    parts.unshift(cur.name);
    cur = cur.parentId ? orgs.find((o) => o.id === cur!.parentId) : undefined;
  }
  return parts.join(' > ');
}

interface Person {
  id: string; orgIds: string[]; name: string; email: string; role: string; title: string; accessibleOrgIds: string[];
  syncConnectionId?: string | null; syncStatus?: string | null;
  /** Skill catalog ids attached to this person. Drives the
   *  Skill filter dropdown's match logic; the column we render is
   *  derived from the backend's /skills/coverage call, not this
   *  field directly. */
  skillIds?: string[];
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



// ── Styles ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
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

interface PersonFormData { orgIds: string[]; name: string; email: string; role: string; title: string; }
const emptyPersonForm: PersonFormData = { orgIds: [], name: '', email: '', role: 'VIEWER', title: '' };

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
      <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>{label || 'Browse File'}</Button>
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

  const toggle = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
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
          {...clickable(() => onSelect(node.id), { label: `Select organization ${node.name}` })}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 6px', paddingLeft: 6 + depth * 14,
            fontSize: 12, borderRadius: 4, cursor: 'pointer',
            fontWeight: isSelected ? 600 : 400,
            background: isSelected ? 'var(--color-primary-light)' : 'transparent',
            color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
          }}
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
        >
          {hasChildren ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
              aria-expanded={isExpanded}
              onClick={(e) => toggle(node.id, e)}
              onKeyDown={activateOnKeyStop(() => toggle(node.id))}
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
  const [loadError, setLoadError] = useState<string | null>(null);

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
  const [previewPersonId, setPreviewPersonId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<Person360Data | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmBulkDeletePeople, setConfirmBulkDeletePeople] = useState(false);
  const [confirmDeletePerson, setConfirmDeletePerson] = useState<string | null>(null);
  const [deletePersonImpact, setDeletePersonImpact] = useState<{ ownedProcesses: number; governanceGroups: number; damaRoles: number; domainOwner: number; domainSteward: number; activeAgents: number } | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignOrgIds, setBulkAssignOrgIds] = useState<Set<string>>(new Set());
  const [bulkAssignMode, setBulkAssignMode] = useState<'add' | 'move'>('move');
  const [bulkRoleOpen, setBulkRoleOpen] = useState(false);
  const [bulkRoleValue, setBulkRoleValue] = useState('');
  const [personFormSave, setPersonFormSave] = useState<SaveState>('idle');
  const [filterAppRole, setFilterAppRole] = useState('');
  const [filterGovRole, setFilterGovRole] = useState('');
  // Skill filter — picks a single skill id. Each person row must hold
  // it to pass. Useful when staffing a new initiative ("who knows
  // Data Cataloging?") — the value-loop counterpart to the Person
  // detail page's SkillPicker, where the data goes IN.
  const [filterSkillId, setFilterSkillId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Quick-add row state
  const [quickName, setQuickName] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);

  const handleQuickAdd = async () => {
    if (!quickName.trim() || !selectedOrgId) return;
    setQuickSaving(true);
    try {
      await apiClient.post('/people', {
        name: quickName.trim(),
        title: quickTitle.trim() || undefined,
        role: 'VIEWER',
        orgIds: [selectedOrgId],
      });
      addToast('success', `${quickName.trim()} added`);
      setQuickName(''); setQuickTitle('');
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to add person');
    }
    finally { setQuickSaving(false); }
  };

  // Governance data for summary column and 360 editing
  const [allGovernanceGroups, setAllGovernanceGroups] = useState<GovernanceGroupFull[]>([]);
  const [allDamaRoles, setAllDamaRoles] = useState<DamaRoleFull[]>([]);
  const [allDataDomains, setAllDataDomains] = useState<DataDomainFull[]>([]);
  // Skill catalog drives the "filter by skill" dropdown. Coverage
  // drives the per-person "Skill gaps" column. Both are scoped to
  // the selected org so the values are meaningful even when the
  // person is in multiple orgs.
  const [allSkills, setAllSkills] = useState<Array<{ id: string; name: string; category: string }>>([]);
  const [skillCoverageByPerson, setSkillCoverageByPerson] = useState<Record<string, { unqualifiedCount: number; sample: string[] }>>({});

  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      // Scope the org tree to the active "Working In" context so siblings
      // and ancestors are hidden even when the user has broader permissions.
      const orgQuery = activeOrgId ? `?scopeOrgId=${encodeURIComponent(activeOrgId)}` : '';
      const skillQuery = activeOrgId ? `?orgId=${encodeURIComponent(activeOrgId)}` : '';
      const [orgRes, peopleRes, govRes, damaRes, domainRes, skillsRes, coverageRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: OrgFlat[]; tree: OrgNode[]; orgTypes: string[] }>(`/organizations${orgQuery}`),
        apiClient.get<{ success: boolean; data: Person[]; roles: string[] }>('/people'),
        apiClient.get<{ success: boolean; data: GovernanceGroupFull[] }>('/governance-groups'),
        apiClient.get<{ success: boolean; data: DamaRoleFull[] }>('/dama-roles'),
        apiClient.get<{ success: boolean; data: DataDomainFull[] }>('/data-domains'),
        apiClient.get<{ success: boolean; data: Array<{ id: string; name: string; category: string }> }>(`/skills${skillQuery}`).catch(() => ({ data: [] })),
        activeOrgId
          ? apiClient.get<{ success: boolean; data: { byPerson: Record<string, { unqualifiedCount: number; sample: string[] }> } }>(`/skills/coverage?orgId=${encodeURIComponent(activeOrgId)}`).catch(() => ({ data: { byPerson: {} } }))
          : Promise.resolve({ data: { byPerson: {} } }),
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
      setAllSkills(skillsRes.data || []);
      setSkillCoverageByPerson(coverageRes.data?.byPerson || {});
    } catch (err) { setLoadError(errorMessage(err, 'Failed to load people.')); }
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
    if (filterSkillId) {
      const has = (p.skillIds || []).includes(filterSkillId);
      if (!has) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (
        !p.name.toLowerCase().includes(q) &&
        !(p.email || '').toLowerCase().includes(q) &&
        !(p.title || '').toLowerCase().includes(q)
      ) return false;
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

  // Row selection for bulk actions, over the currently filtered+sorted list.
  const sel = useRowSelection(sortedPeople, (p) => p.id);

  // Cap how many rows render for a large roster; sort / filter / select-all
  // above still operate over the whole filtered list.
  const peoplePage = usePagination(sortedPeople, 15);
  const pagedPeople = peoplePage.pageItems;

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

    if (sel.count > 0) {
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

  useEffect(() => {
    if (!previewPersonId) { setPreviewData(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    apiClient.get<{ success: boolean; data: Person360Data }>(`/people/${previewPersonId}/360`)
      .then((res) => { if (!cancelled) setPreviewData(res.data || null); })
      .catch(() => { if (!cancelled) setPreviewData(null); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [previewPersonId]);

  const applyOrgFilter = (id: string) => {
    setSelectedOrgId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('orgId', id); else next.delete('orgId');
    setSearchParams(next, { replace: true });
  };

  // ── People handlers ──
  const openAddPerson = () => { setPersonForm({ ...emptyPersonForm, orgIds: selectedOrgId ? [selectedOrgId] : [] }); setEditingPersonId(null); setShowPersonForm(true); };

  // Deep-link create intent: /people?new=1 (from the Setup Hub) opens the
  // add form, then strips the param so refresh/back doesn't re-open it.
  useEffect(() => {
    if (searchParams.get('new') !== '1' || showPersonForm) return;
    openAddPerson();
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const openEditPerson = (person: Person) => {
    // Edit only allows name/email/title — orgs and role live under Manage.
    // We still seed the full state from the existing record so the
    // PersonFormData type stays uniform; the UI just hides the rest.
    setPersonForm({
      orgIds: person.orgIds || [], name: person.name, email: person.email,
      role: person.role, title: person.title,
    });
    setEditingPersonId(person.id);
    setShowPersonForm(true);
  };
  const handleSavePerson = async () => {
    if (!personForm.name.trim()) return;
    setPersonFormSave('saving');
    try {
      if (editingPersonId) {
        // Edit: send only the identity fields. Skipping orgIds / role
        // means the backend leaves them untouched, so changes made under
        // Manage aren't clobbered.
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
    let cascade: { pausedAgents?: Array<{ agentId: string; agentName: string }> } | undefined;
    try {
      // Delete responses come back two shapes: 204 (no body) when there
      // was nothing to cascade, or 200 with { cascade: { pausedAgents } }
      // when active agents were auto-paused. The client returns null on
      // 204 — treat undefined/null as "no cascade".
      const resp = await apiClient.delete<{ success: boolean; cascade?: typeof cascade } | null>(
        `/people/${id}`,
      );
      cascade = resp?.cascade;
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to delete person');
      return;
    }
    fetchData();
    if (cascade?.pausedAgents && cascade.pausedAgents.length > 0) {
      // Cascade toast wins over the "deleted" toast — the auto-pause is
      // the surprise, not the delete. Keep the message short; the
      // governance-issues queue carries the detail.
      const n = cascade.pausedAgents.length;
      addToast(
        'info',
        `Person deleted. ${n} active agent${n === 1 ? ' was' : 's were'} auto-paused (no responsible person).`,
        { duration: 8000 },
      );
    } else if (person) {
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
  const handleBulkDeletePeople = async () => {
    if (sel.count === 0) return;
    await Promise.all(Array.from(sel.selectedIds).map((id) => apiClient.delete(`/people/${id}`)));
    sel.clear();
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
    if (sel.count === 0 || bulkAssignOrgIds.size === 0) return;
    const targetIds = Array.from(sel.selectedIds);
    const newOrgIds = Array.from(bulkAssignOrgIds);
    try {
      await Promise.all(targetIds.map(async (pid) => {
        const p = people.find((x) => x.id === pid);
        if (!p) return;
        const orgIds = bulkAssignMode === 'move'
          ? newOrgIds
          : Array.from(new Set([...(p.orgIds || []), ...newOrgIds]));
        await apiClient.put(`/people/${pid}`, { orgIds });
      }));
      const verb = bulkAssignMode === 'move' ? 'Moved' : 'Assigned';
      addToast('success', `${verb} ${targetIds.length} ${targetIds.length === 1 ? 'person' : 'people'} to ${newOrgIds.length} org${newOrgIds.length === 1 ? '' : 's'}`);
      setBulkAssignOpen(false);
      setBulkAssignOrgIds(new Set());
      sel.clear();
      fetchData();
    } catch (err) {
      errorToast(err, 'Bulk assignment failed');
    }
  };
  const handleBulkRoleAssign = async () => {
    if (sel.count === 0 || !bulkRoleValue) return;
    const targetIds = Array.from(sel.selectedIds);
    try {
      await Promise.all(targetIds.map((pid) => apiClient.put(`/people/${pid}`, { role: bulkRoleValue })));
      addToast('success', `Set ${targetIds.length} ${targetIds.length === 1 ? 'person' : 'people'} to ${ROLE_LABELS[bulkRoleValue] || bulkRoleValue}`);
      setBulkRoleOpen(false);
      setBulkRoleValue('');
      sel.clear();
      fetchData();
    } catch (err) {
      errorToast(err, 'Bulk role assignment failed');
    }
  };
  const handlePeopleImport = async () => {
    const orgId = peopleImportOrgId || selectedOrgId || activeOrgId;
    if (!peopleImportText.trim() || !orgId) return;
    try {
      const body: { orgId: string; csv?: string; people?: unknown } = { orgId };
      if (peopleImportFormat === 'csv') body.csv = peopleImportText; else body.people = JSON.parse(peopleImportText);
      const result = await apiClient.post<{ success: boolean; message?: string; skipped?: number; skippedEmails?: string[]; warnings?: string[]; data?: unknown[] }>('/people/import', body);
      const count = result.data?.length || 0;
      const skipped = result.skipped || 0;
      const skippedEmails = result.skippedEmails || [];
      const warnings = result.warnings || [];

      if (skipped > 0 && count === 0) {
        addToast('info', `All ${skipped} ${skipped === 1 ? 'person already exists' : 'people already exist'} in Procela: ${skippedEmails.join(', ')}`);
      } else if (skipped > 0) {
        addToast('info', `${skipped} ${skipped === 1 ? 'person' : 'people'} already existed and ${skipped === 1 ? 'was' : 'were'} skipped: ${skippedEmails.join(', ')}`);
        addToast('success', `Imported ${count} new ${count === 1 ? 'person' : 'people'}`);
      } else {
        addToast('success', `Imported ${count} ${count === 1 ? 'person' : 'people'}`);
      }
      // Per-row Org column resolution warnings: when a row's Org
      // value didn't match an org (typo, renamed org, ambiguous
      // single name) the backend resolved it to the dialog's
      // default. Surface the count and the first warning so the
      // user can notice and fix the CSV.
      if (warnings.length > 0) {
        const preview = warnings.slice(0, 2).join(' · ');
        const more = warnings.length > 2 ? ` (+${warnings.length - 2} more)` : '';
        addToast('info', `${warnings.length} row${warnings.length === 1 ? '' : 's'} fell back to the default org: ${preview}${more}`);
      }
      setShowPeopleImport(false); setPeopleImportText(''); setPeopleImportOrgId('');
      fetchData();
    } catch (e) {
      errorToast(e, 'Import failed');
    }
  };

  if (loadError) return (
    <Card padding={8} shadow="none" style={{ overflow: 'hidden' }}>
      <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />
    </Card>
  );

  if (loading) return (
    <Card padding={8} shadow="none" style={{ overflow: 'hidden' }}>
      <SkeletonRows rows={6} columnWidths={activeOrgId ? [32, null, null, null, null, null, 70] : [32, null, null, null, null, 70]} />
    </Card>
  );

  // Toolbar — lives in the page header (right-aligned, level with the title)
  // like Business Glossary and the other list pages, rather than dropping
  // onto the list's count row below the header.
  const peopleToolbar = (
    <>
      <SavedViewsMenu
        pageKey="people"
        currentFilters={{ selectedOrgId, filterAppRole, filterGovRole, searchQuery }}
        onApply={(f) => {
          setSelectedOrgId((f.selectedOrgId as string) || '');
          setFilterAppRole((f.filterAppRole as string) || '');
          setFilterGovRole((f.filterGovRole as string) || '');
          setSearchQuery((f.searchQuery as string) || '');
        }}
      />
      {filteredPeople.length > 0 && (
        <ExportMenu build={() => ({
          filenameBase: 'people',
          sheetName: 'People',
          // The Org column carries the full path (Parent > Child >
          // Grandchild) so a single-file enterprise-wide export can
          // round-trip without losing which org each person belongs to.
          // The import endpoint resolves it per row and falls back to the
          // dialog's org if the column is missing or the path doesn't match.
          headers: ['Name', 'Email', 'Role', 'Title', 'Org'],
          rows: filteredPeople.map((p) => [
            p.name, p.email, ROLE_LABELS[p.role] || p.role, p.title,
            buildOrgPath(p.orgIds[0] || '', flatOrgs),
          ]),
        })} />
      )}
      <IconButton icon="upload" label="Import people"
        onClick={() => { setPeopleImportOrgId(selectedOrgId || activeOrgId || ''); setShowPeopleImport(true); }} />
      <IconButton icon="link" label="Connect to source" onClick={() => setShowPeopleSync(true)} />
      <IconButton icon="plus" label="Add person" variant="primary"
        onClick={openAddPerson} />
    </>
  );

  return (
    <div>
      <style>{`@keyframes highlightPulse { 0% { background: #fef3c7; } 100% { background: transparent; } }`}</style>
      {/* Header */}
      <PageHeader
        title="People"
        subtitle={`${people.length} people across ${flatOrgs.length} organizations. Filter by organization to narrow the list.`}
        actions={peopleToolbar}
      >
        <HelpPopover id="people-overview" title="People">
          Everyone in your directory, grouped by the organization they
          belong to. People are assigned as owners and stewards across
          processes, systems, and data assets, and hold governance roles.
          Pick an organization on the left to narrow the list.
        </HelpPopover>
      </PageHeader>

      {/* Side-by-side: Org tree (left) + People list (center) + Preview (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: previewPersonId ? '260px 1fr 340px' : '260px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Org tree sidebar */}
        <Card padding={10} shadow="none" style={{ position: 'sticky', top: 12, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, padding: '0 4px' }}>Organizations</div>
          <div
            onClick={() => applyOrgFilter('')}
            style={{
              padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
              fontWeight: !selectedOrgId ? 600 : 400,
              background: !selectedOrgId ? 'var(--color-primary-light)' : 'transparent',
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
        </Card>

        {/* People list */}
        <div>
          <>
              {/* Active filter / counts header. The toolbar moved up into the
                  page header (see peopleToolbar); this row is just the
                  scope label + count for the current org filter. */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600 }}>
                    {selectedOrgId ? selectedOrg?.name : 'All people'}
                  </h2>
                  {selectedOrgId && selectedOrg && <span style={typeBadge(selectedOrg.type || '')}>{selectedOrg.type}</span>}
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{filteredPeople.length} {filteredPeople.length === 1 ? 'person' : 'people'}</span>
                </div>
                {selectedOrgId && selectedOrg?.description && <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{selectedOrg.description}</p>}
              </div>

              {/* Filters (left-aligned, mirrors Data Assets) */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  aria-label="Search people" placeholder="Search people..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
                />
                <select
                  aria-label="Filter by app role"
                  style={{ ...inputStyle, width: 'auto', minWidth: 130, appearance: 'auto' as any, fontSize: 12, padding: '5px 10px' }}
                  value={filterAppRole}
                  onChange={(e) => setFilterAppRole(e.target.value)}
                >
                  <option value="">All App Roles</option>
                  {Object.entries(ROLE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by governance role"
                  style={{ ...inputStyle, width: 'auto', minWidth: 160, appearance: 'auto' as any, fontSize: 12, padding: '5px 10px' }}
                  value={filterGovRole}
                  onChange={(e) => setFilterGovRole(e.target.value)}
                >
                  <option value="">All Governance Roles</option>
                  {Object.entries(DAMA_ROLE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                {/* Skill filter — only useful when an org is selected
                    (skills are org-scoped). Hidden in cross-org views
                    to avoid implying the value would aggregate. */}
                {selectedOrgId && allSkills.length > 0 && (
                  <select
                    style={{ ...inputStyle, width: 'auto', minWidth: 160, appearance: 'auto' as any, fontSize: 12, padding: '5px 10px' }}
                    value={filterSkillId}
                    onChange={(e) => setFilterSkillId(e.target.value)}
                    aria-label="Filter by skill"
                  >
                    <option value="">All Skills</option>
                    {allSkills.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
                {(filterAppRole || filterGovRole || filterSkillId || searchQuery || selectedOrgId) && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { setFilterAppRole(''); setFilterGovRole(''); setFilterSkillId(''); setSearchQuery(''); applyOrgFilter(''); }}
                    >
                      Clear Filters
                    </Button>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      Showing {filteredPeople.length} of {people.length}
                    </span>
                  </>
                )}
              </div>

              <ConfirmDialog
                open={confirmBulkDeletePeople}
                title="Delete Selected People?"
                message={`Delete ${sel.count} selected people? This cannot be undone.`}
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
                  deletePersonImpact && (deletePersonImpact.ownedProcesses > 0 || deletePersonImpact.governanceGroups > 0 || deletePersonImpact.damaRoles > 0 || deletePersonImpact.domainOwner > 0 || deletePersonImpact.domainSteward > 0 || deletePersonImpact.activeAgents > 0)
                    ? `This will permanently remove this person. This person owns ${deletePersonImpact.ownedProcesses} process${deletePersonImpact.ownedProcesses !== 1 ? 'es' : ''}, belongs to ${deletePersonImpact.governanceGroups} governance group${deletePersonImpact.governanceGroups !== 1 ? 's' : ''}, has ${deletePersonImpact.damaRoles} DAMA role${deletePersonImpact.damaRoles !== 1 ? 's' : ''}, and owns ${deletePersonImpact.domainOwner} data domain${deletePersonImpact.domainOwner !== 1 ? 's' : ''}${deletePersonImpact.domainSteward > 0 ? ` (steward of ${deletePersonImpact.domainSteward})` : ''}.${deletePersonImpact.activeAgents > 0 ? ` ${deletePersonImpact.activeAgents} active agent${deletePersonImpact.activeAgents === 1 ? '' : 's'} will be auto-paused and a governance issue opened for each.` : ''} This cannot be undone.`
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

              <BulkActionBar count={sel.count} onClear={sel.clear}>
                <BulkActionButton variant="primary" onClick={() => { setBulkAssignMode('move'); openBulkAssign(); }}>Move to org…</BulkActionButton>
                <BulkActionButton onClick={() => { setBulkAssignMode('add'); openBulkAssign(); }}>Add to org…</BulkActionButton>
                <BulkActionButton onClick={() => setBulkRoleOpen(true)}>Set app role…</BulkActionButton>
                <BulkActionButton variant="danger" onClick={() => setConfirmBulkDeletePeople(true)}>Delete selected</BulkActionButton>
              </BulkActionBar>

              {/* Bulk assign picker modal — shared OrgPicker in a dialog. */}
              <OrgPickerModal
                open={bulkAssignOpen}
                title={`${bulkAssignMode === 'move' ? 'Move' : 'Assign'} ${sel.count} ${sel.count === 1 ? 'person' : 'people'} to organizations`}
                description={bulkAssignMode === 'move'
                  ? 'Selected people will be removed from their current org(s) and moved to the selected org(s).'
                  : 'Selected org(s) will be added. Existing assignments are preserved.'}
                confirmLabel={`${bulkAssignMode === 'move' ? 'Move' : 'Assign'} to ${bulkAssignOrgIds.size} org${bulkAssignOrgIds.size === 1 ? '' : 's'}`}
                orgs={flatOrgs}
                selectedIds={bulkAssignOrgIds}
                onToggle={toggleBulkAssignOrg}
                scopeOrgId={activeOrgId || null}
                onConfirm={handleBulkAssign}
                onCancel={() => { setBulkAssignOpen(false); setBulkAssignOrgIds(new Set()); }}
              />

              {/* Bulk Role Assignment Dialog */}
              <ConfirmDialog
                open={bulkRoleOpen}
                title={`Set app role for ${sel.count} ${sel.count === 1 ? 'person' : 'people'}`}
                message=""
                confirmLabel={bulkRoleValue ? `Set to ${ROLE_LABELS[bulkRoleValue] || bulkRoleValue}` : 'Select a role'}
                variant="primary"
                onConfirm={handleBulkRoleAssign}
                onCancel={() => { setBulkRoleOpen(false); setBulkRoleValue(''); }}
              >
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                    This will change the application role for all selected people. It does not affect governance (DAMA) roles.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(ROLE_LABELS).map(([key, label]) => (
                      <label key={key} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        background: bulkRoleValue === key ? '#eff6ff' : 'var(--color-bg)',
                        border: `1px solid ${bulkRoleValue === key ? '#93c5fd' : 'var(--color-border)'}`,
                        borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      }}>
                        <input type="radio" name="bulkRole" checked={bulkRoleValue === key} onChange={() => setBulkRoleValue(key)} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </ConfirmDialog>

              {/* Add/Edit Person Form */}
              {showPersonForm && (
                <Card marginBottom={10}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{editingPersonId ? 'Edit Person' : 'Add Person'}</h3>
                  <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                    {editingPersonId
                      ? 'Edit identity fields here. Org assignments and application role live under Manage.'
                      : 'Create the person and assign them to an org. Refine details and governance roles via Manage afterwards.'}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
                      <input autoFocus aria-label="Name" style={inputStyle} value={personForm.name} onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })} placeholder="Full name" />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Email</label>
                      <input aria-label="Email" style={inputStyle} value={personForm.email} onChange={(e) => setPersonForm({ ...personForm, email: e.target.value })} placeholder="email@example.com" />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Title</label>
                      <input aria-label="Title" style={inputStyle} value={personForm.title} onChange={(e) => setPersonForm({ ...personForm, title: e.target.value })} placeholder="e.g. Director of Operations" />
                    </div>
                    {/* The Add form keeps an Assigned Organization picker so
                        the new person lands in at least one org and is
                        immediately visible. Edit doesn't show this — those
                        live under Manage now. */}
                    {!editingPersonId && (
                      <>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Assign to Organizations *</label>
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
                          <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Application Role</label>
                          <select aria-label="Application Role" style={{ ...inputStyle, appearance: 'auto' as any }} value={personForm.role} onChange={(e) => setPersonForm({ ...personForm, role: e.target.value })}>
                            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                          </select>
                          <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 2 }}>Controls platform permissions. Governance roles are assigned separately.</div>
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <SaveIndicator state={personFormSave} />
                    <Button variant="secondary" onClick={() => { setShowPersonForm(false); setEditingPersonId(null); setPersonFormSave('idle'); }}>Cancel</Button>
                    {(() => {
                      // Add requires both a name and at least one org;
                      // Edit only requires a non-empty name (orgs/role
                      // are managed separately).
                      const invalid = !personForm.name.trim() || (!editingPersonId && personForm.orgIds.length === 0) || personFormSave === 'saving';
                      return (
                        <Button variant="primary" disabled={invalid} onClick={handleSavePerson}>
                          {editingPersonId ? 'Save' : 'Add'}
                        </Button>
                      );
                    })()}
                  </div>
                </Card>
              )}

              {/* Import People Panel */}
              {showPeopleImport && (
                <Card marginBottom={10}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600 }}>Import People</h3>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Paste CSV or JSON, or browse a file. Format is auto-detected.</span>
                    </div>
                    <button type="button" onClick={() => { setShowPeopleImport(false); setPeopleImportText(''); setPeopleImportOrgId(''); }} aria-label="Close import dialog" style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--color-text-muted)' }}><span aria-hidden="true">&times;</span></button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <label style={{ fontSize: 11, fontWeight: 500 }}>Default org *</label>
                    <select
                      aria-label="Default org"
                      style={{ ...inputStyle, width: 'auto', minWidth: 200, appearance: 'auto' as any, fontSize: 12 }}
                      value={peopleImportOrgId}
                      onChange={(e) => setPeopleImportOrgId(e.target.value)}
                    >
                      <option value="">-- Select --</option>
                      {orgOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                    </select>
                    <FilePicker accept=".csv,.json,.txt" onFileRead={(content, fn) => { setPeopleImportText(content); if (fn.endsWith('.json')) setPeopleImportFormat('json'); else setPeopleImportFormat('csv'); }} />
                  </div>
                  <textarea aria-label="People to import (CSV or JSON)" style={{ ...inputStyle, minHeight: 80, fontFamily: 'var(--font-mono)', fontSize: 11 }} value={peopleImportText} onChange={(e) => setPeopleImportText(e.target.value)}
                    placeholder={'Name,Email,Role,Title,Org\nJane Smith,jane@co.com,EDITOR,Director of Operations,Tidewater Utilities > Tidewater Electric'} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flex: 1 }}>Columns: Name (required), Email, Role, Title, Org. Rows with an Org column land in that org (full path "Parent &gt; Child" or unique name); rows without it use the Default org above.</span>
                    <Button variant="secondary" onClick={() => { setShowPeopleImport(false); setPeopleImportText(''); setPeopleImportOrgId(''); }}>Cancel</Button>
                    <Button
                      variant="primary"
                      disabled={!peopleImportText.trim() || !peopleImportOrgId}
                      onClick={handlePeopleImport}
                    >Import</Button>
                  </div>
                </Card>
              )}

              {/* People Table. Numbered pagination (25/page) keeps the list a
                  fixed height with a single page scrollbar; the Pager footer
                  jumps between pages. */}
              <Card padding={0} shadow="none" style={{ overflow: 'hidden' }}>
                {filteredPeople.length === 0 && !selectedOrgId ? (
                  <EmptyState
                    icon={renderNavIcon('/organizations')}
                    title="Pick an organization"
                    description="Select an organization on the left to see who's in it and add new people."
                  />
                ) : filteredPeople.length === 0 ? (
                  <EmptyState
                    icon={renderNavIcon('/people')}
                    title="No people in this organization yet"
                    description="Add the first person — their email, role, and any DAMA accountabilities. They'll be available across Procela as an owner, steward, or custodian."
                    action={{ label: '+ Add Person', onClick: openAddPerson }}
                    secondaryAction={{ label: 'Import from CSV', onClick: () => { setPeopleImportOrgId(selectedOrgId || activeOrgId || ''); setShowPeopleImport(true); } }}
                  />
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg)' }}>
                        <th scope="col" style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                          <input type="checkbox"
                            ref={(el) => { if (el) el.indeterminate = sel.someSelected; }}
                            checked={sel.allSelected}
                            onChange={sel.toggleAll} />
                        </th>
                        <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Name</SortableTh>
                        <SortableTh sortKey="role" active={sortKey} dir={sortDir} onClick={toggleSort}>App Role</SortableTh>
                        <th scope="col" style={thStyle}>Governance</th>
                        <SortableTh sortKey="title" active={sortKey} dir={sortDir} onClick={toggleSort}>Title</SortableTh>
                        {selectedOrgId && (
                          <th scope="col" style={{ ...thStyle, width: 110 }} title="Process activities this person is responsible for that require a skill they don't hold.">Skill gaps</th>
                        )}
                        <th scope="col" style={{ ...thStyle, width: 70, textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Quick-add row — always visible at the top when an org is selected */}
                      {selectedOrgId && (
                        <tr style={{ background: '#f0f9ff' }}>
                          <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}></td>
                          <td style={tdStyle}>
                            <input
                              aria-label="New person name"
                              value={quickName}
                              onChange={(e) => setQuickName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAdd(); }}
                              placeholder="Name *"
                              style={{ fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 3, padding: '3px 6px', width: '100%' }}
                            />
                          </td>
                          <td style={{ ...tdStyle, fontSize: 11, color: 'var(--color-text-muted)' }}>Viewer</td>
                          <td style={tdStyle}></td>
                          <td style={tdStyle}>
                            <input
                              aria-label="New person title"
                              value={quickTitle}
                              onChange={(e) => setQuickTitle(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAdd(); }}
                              placeholder="Title"
                              style={{ fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 3, padding: '3px 6px', width: '100%' }}
                            />
                          </td>
                          <td style={tdStyle}></td>{/* Skill gaps column */}
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
                      {pagedPeople.map((person) => {
                        const gs = govSummary[person.id];
                        const govText = gs
                          ? [gs.groups > 0 && `${gs.groups} group${gs.groups > 1 ? 's' : ''}`, gs.roles > 0 && `${gs.roles} role${gs.roles > 1 ? 's' : ''}`, gs.domains > 0 && `${gs.domains} domain${gs.domains > 1 ? 's' : ''}`].filter(Boolean).join(', ')
                          : null;
                        const isSelected = sel.isSelected(person.id);
                        return (
                        <tr key={person.id} id={`row-${person.id}`} style={{ transition: 'background 0.1s', background: isSelected ? 'var(--color-primary-light)' : '' }}
                          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                          <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                            <input type="checkbox" checked={isSelected} onChange={() => sel.toggle(person.id)} />
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 500 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Avatar name={person.name} />
                              <span
                                onClick={() => setPreviewPersonId(previewPersonId === person.id ? null : person.id)}
                                style={{ cursor: 'pointer', color: previewPersonId === person.id ? 'var(--color-primary)' : undefined }}
                              >
                                {person.name}
                              </span>
                              {person.syncStatus === 'MISSING_FROM_SOURCE' && (
                                <span title="No longer found in the connected data source" style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: '#fef3c7', color: '#92400e' }}>NOT IN SOURCE</span>
                              )}
                            </div>
                          </td>
                          <td style={tdStyle}><span style={roleBadge(person.role)}>{ROLE_LABELS[person.role] || person.role}</span></td>
                          <td style={tdStyle}>
                            {govText ? (
                              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', background: 'var(--color-bg)', padding: '2px 8px', borderRadius: 4 }}>{govText}</span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>--</span>
                            )}
                          </td>
                          <td style={tdStyle}>{person.title || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}</td>
                          {selectedOrgId && (
                            <td style={tdStyle}>
                              <SkillGapBadge gap={skillCoverageByPerson[person.id]} />
                            </td>
                          )}
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                              <IconButton size="sm" icon="settings" label="Manage" variant="primary" onClick={() => navigate(`/people/${person.id}`)} />
                              <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEditPerson(person)} />
                              <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={async () => {
                                try {
                                  const res = await apiClient.get<{ success: boolean; data: { ownedProcesses: number; governanceGroups: number; damaRoles: number; domainOwner: number; domainSteward: number; activeAgents: number } }>(`/people/${person.id}/impact`);
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
                <Pager pagination={peoplePage} noun={['person', 'people']} />
              </Card>
          </>
        </div>

        {/* Person Preview Sidebar */}
        {previewPersonId && (
          <Card padding={0} shadow="none" style={{ position: 'sticky', top: 12, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
            {previewLoading ? (
              <Spinner center label="Loading…" />
            ) : previewData ? (
              <div style={{ padding: 16 }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{previewData.person.name}</h3>
                    {previewData.person.title && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{previewData.person.title}</div>}
                    {previewData.person.email && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{previewData.person.email}</div>}
                  </div>
                  <button type="button" onClick={() => setPreviewPersonId(null)} aria-label="Close person preview" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--color-text-muted)', padding: '0 4px' }}><span aria-hidden="true">&times;</span></button>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <span style={roleBadge(previewData.person.role)}>{ROLE_LABELS[previewData.person.role] || previewData.person.role}</span>
                </div>

                {/* Preview sections + CTA share one section-level rhythm
                   (--space-section) via FieldStack, so the gaps stay
                   uniform no matter which sections this person has. */}
                <FieldStack gap="section">
                {/* Organizations */}
                {previewData.orgAssignments.length > 0 && (
                  <div>
                    <SectionLabel marginBottom={6}>Organizations</SectionLabel>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {previewData.orgAssignments.map((o) => (
                        <span key={o.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>{o.name}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Governance Roles */}
                {previewData.damaRoles.length > 0 && (
                  <div>
                    <SectionLabel marginBottom={6}>Governance Roles</SectionLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {previewData.damaRoles.map((r) => (
                        <div key={r.id} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 500 }}>{DAMA_ROLE_LABELS[r.roleType] || r.roleType}</span>
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{r.scopeName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Governance Groups */}
                {previewData.governanceGroups.length > 0 && (
                  <div>
                    <SectionLabel marginBottom={6}>Groups</SectionLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {previewData.governanceGroups.map((g) => (
                        <div key={g.groupId} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 500 }}>{g.groupName}</span>
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{g.groupRole.replace(/_/g, ' ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Owned Processes */}
                {previewData.ownedProcessNodes.length > 0 && (
                  <div>
                    <SectionLabel marginBottom={6}>Owned Processes</SectionLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {previewData.ownedProcessNodes.slice(0, 8).map((p) => (
                        <div key={p.id} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
                          <span>{p.name}</span>
                          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{p.level}</span>
                        </div>
                      ))}
                      {previewData.ownedProcessNodes.length > 8 && (
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>+{previewData.ownedProcessNodes.length - 8} more</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Data Assets */}
                {previewData.dataAssets.length > 0 && (
                  <div>
                    <SectionLabel marginBottom={6}>Data Assets</SectionLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {previewData.dataAssets.slice(0, 6).map((a) => (
                        <div key={a.id} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
                          <span>{a.name}</span>
                          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{a.relation}</span>
                        </div>
                      ))}
                      {previewData.dataAssets.length > 6 && (
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>+{previewData.dataAssets.length - 6} more</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Full detail link */}
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => navigate(`/people/${previewPersonId}`)}
                >
                  Open Full Detail
                </Button>
                </FieldStack>
              </div>
            ) : (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>Person not found.</div>
            )}
          </Card>
        )}
      </div>

      {showPeopleSync && (
        <Suspense fallback={null}>
          <SyncConnectionWizard open={showPeopleSync} onClose={() => setShowPeopleSync(false)} targetEntity="people" orgId={activeOrgId || ''} onCreated={fetchData} />
        </Suspense>
      )}
    </div>
  );
}
