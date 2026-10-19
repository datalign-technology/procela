import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import ExpandCollapseControls from '../components/ExpandCollapseControls';
import Card from '../components/Card';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import { INDUSTRIES } from '../types';
import { useOrgContext } from '../stores/orgContext';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import { usePermissions } from '../hooks/usePermissions';
import { useAiEnabled } from '../stores/aiConfigStore';
import { useToastStore } from '../stores/toastStore';
import ExportMenu from '../components/ExportMenu';
import ListToolbar from '../components/ListToolbar';
import { errorMessage, errorToast, successToast } from '../lib/errorToast';
import { statusBadgeStyle } from '../lib/statusBadge';
import EditableField from '../components/EditableField';
import DetailEditActions from '../components/DetailEditActions';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import ScopeBadge from '../components/ScopeBadge';
import { useScopeMembership } from '../hooks/useScopeMembership';
import HelpPopover from '../components/HelpPopover';
import { SkeletonRows } from '../components/Skeleton';
import PersonPicker from '../components/PersonPicker';
import OwnerCell from '../components/OwnerCell';
import Avatar from '../components/Avatar';
import TruncatedText from '../components/TruncatedText';
import { formatPersonLabel } from '../lib/personLabel';
import { TIER_COLORS, tierKey, useTierLabel } from '../lib/governanceTier';
import { relativeTime, absoluteTime } from '../lib/relativeTime';
import { useRefreshOnFocus } from '../hooks/usePolling';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface DataDomain {
  id: string; orgId: string; name: string; description: string;
  ownerId: string | null; ownerName: string | null;
  stewardIds: string[]; stewards: { id: string; name: string }[];
  dataAssetIds: string[]; assets: { id: string; name: string }[];
  // Rolled-up view (own assets + sub-domains'), backend-derived. `assets` /
  // `dataAssetIds` stay DIRECT (editable membership); these reflect the subtree.
  directAssetCount?: number; subtreeAssetCount?: number;
  subtreeAssetIds?: string[]; subtreeAssets?: { id: string; name: string }[];
  status: string; scopeDefinition?: string; criticality?: string; code?: string;
  // Sub-domain nesting + master/reference governance signals (backend-derived).
  parentDomainId?: string | null; parentDomainName?: string | null; subDomainCount?: number;
  containsMasterData?: boolean; containsReferenceData?: boolean; suggestedCriticality?: string;
  createdAt: string; updatedAt: string;
}
interface Person { id: string; name: string; }
// Enriched from the /data-assets list endpoint so the domain-detail assets
// table can show system / tier / owner inline (not just the name).
interface DataAssetOption { id: string; name: string; systemId?: string; governanceTier?: string; ownerName?: string; }

// Nodes of the unified generate-and-review tree. Every row is an editable
// name + description, so accepting an AI suggestion, editing it, and
// hand-adding your own are the same gesture. A GenDomain with `existingId`
// is a real catalog domain shown as locked context (branch mode); without
// it, it's a new top-level domain to be created.
interface GenSub { name: string; description: string; selected: boolean; }
interface GenDomain { name: string; description: string; selected: boolean; existingId?: string; subDomains: GenSub[]; }

const inputStyle: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)' };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' };

// "← Back to Domains" affordance on the detail page, matching
// GovernanceGroupDetailPage's backLinkStyle.
const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)',
  border: '1px solid var(--color-border)', borderRadius: 6,
  fontSize: 13, fontWeight: 500, textDecoration: 'none',
  color: 'var(--color-text)',
};

interface FormData { name: string; description: string; status: string; criticality: string; parentDomainId: string; code: string; }

// The selected domain's full editable record — identity (name/description/
// status/criticality/code/parent) PLUS governance (owner/stewards/assets),
// edited together in the detail pane under one Save.
interface DomainEditable {
  name: string; description: string; status: string; criticality: string;
  code: string; parentDomainId: string;
  ownerId: string; stewardIds: string[]; dataAssetIds: string[];
}

const CRITICALITY_OPTIONS = [
  { value: '', label: 'Unclassified' },
  { value: 'TIER_1', label: 'Tier-1 (critical)' },
  { value: 'TIER_2', label: 'Tier-2' },
  { value: 'TIER_3', label: 'Tier-3' },
  { value: 'TIER_4', label: 'Tier-4' },
];
const criticalityLabel = (v?: string) => CRITICALITY_OPTIONS.find((o) => o.value === (v || ''))?.label || 'Unclassified';
const emptyForm: FormData = { name: '', description: '', status: 'DRAFT', criticality: '', parentDomainId: '', code: '' };

const SIMPLE_TRANSITIONS: Record<string, string[]> = { DRAFT: ['ACTIVE'], ACTIVE: ['DRAFT', 'DEPRECATED'], DEPRECATED: ['DRAFT'] };
const ADVANCED_TRANSITIONS: Record<string, string[]> = { DRAFT: ['PROPOSED'], PROPOSED: ['UNDER_REVIEW', 'DRAFT'], UNDER_REVIEW: ['APPROVED', 'DRAFT'], APPROVED: ['ACTIVE', 'DRAFT'], ACTIVE: ['DRAFT', 'DEPRECATED'], DEPRECATED: ['DRAFT'] };

// Shared style for "Owner" / "Stewards" labels that open the Role Detail
// drawer. Looks like a label, hints clickability with a dotted underline.
const roleLabelBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0,
  color: 'inherit', font: 'inherit', cursor: 'pointer',
  textDecoration: 'underline', textDecorationStyle: 'dotted',
  textUnderlineOffset: 3,
};

// A row in the per-domain "⋯" actions dropdown.
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};

export default function DataDomainsPage({ focusDomainId }: { focusDomainId?: string } = {}) {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  // Governance-scope membership for the per-row "in scope / not governed"
  // badge — only surfaces when the org's program has a defined scope.
  const scope = useScopeMembership(activeOrgId);
  const openRoleDrawer = useRoleDrawerStore((s) => s.open);
  const { canWrite } = usePermissions();
  const aiEnabled = useAiEnabled();
  const { addToast } = useToastStore();
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [allAssets, setAllAssets] = useState<DataAssetOption[]>([]);
  const [systemNameById, setSystemNameById] = useState<Record<string, string>>({});
  const tierLabel = useTierLabel();
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [statusMode, setStatusMode] = useState<'simple' | 'advanced'>('simple');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<{ assets: number; stewards: number; subDomains?: number; subDomainNames?: string[] } | null>(null);
  const [createStewardshipTeam, setCreateStewardshipTeam] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // "Needs attention" quick filter: '' all · 'emptySub' sub-domains with no
  // assets · 'noCriticality' criticality not set. Applied flat (ignores the
  // tree fold) so the matching rows read as a focused worklist.
  const [attentionFilter, setAttentionFilter] = useState<'' | 'emptySub' | 'noCriticality'>('');
  // Which row's "⋯" actions menu is open (one at a time).
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  // Left-tree expand/collapse: the set of parent-domain ids whose sub-domains
  // are folded away. Persisted per org so navigation state survives reloads.
  // Default is fully expanded (empty set) — matches the pre-collapse behaviour.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Bulk selection
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdates, setBulkUpdates] = useState<{ ownerId: string; status: string }>({ ownerId: '', status: '' });
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [applyingBulk, setApplyingBulk] = useState(false);
  const toggleBulkSelect = (id: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearBulkSelection = () => {
    setBulkSelectedIds(new Set());
    setBulkUpdates({ ownerId: '', status: '' });
  };

  // Detail editing — owner/stewards/assets live in the unified `m` draft below.
  const [assetSearch, setAssetSearch] = useState('');

  // AI generate — one nested-tree review. "Generate domains" builds top-level
  // domains each with suggested sub-domains; the per-domain wand seeds the same
  // tree with a single existing (locked) parent. `genBranchMode` distinguishes
  // the two; `pendingGen` remembers the intent when the industry picker has to
  // open first.
  const [generating, setGenerating] = useState(false);
  const [genTree, setGenTree] = useState<GenDomain[]>([]);
  const [showGeneratePreview, setShowGeneratePreview] = useState(false);
  const [generateStewardshipTeams, setGenerateStewardshipTeams] = useState(true);
  const [genBranchMode, setGenBranchMode] = useState(false);
  const [pendingGen, setPendingGen] = useState<{ type: 'tree' } | { type: 'branch'; domain: DataDomain } | null>(null);
  // Industry picker — opens when the active org (and its visible
  // ancestors) carries no `industry`, or when the user explicitly
  // wants to override the auto-detected value.
  const [industryPickerOpen, setIndustryPickerOpen] = useState(false);
  const [pickedIndustry, setPickedIndustry] = useState<string>('');
  const industryPickerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(industryPickerRef, industryPickerOpen);
  useEffect(() => {
    if (!industryPickerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIndustryPickerOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [industryPickerOpen]);
  const generatePreviewRef = useRef<HTMLDivElement>(null);
  useFocusTrap(generatePreviewRef, showGeneratePreview);
  useEffect(() => {
    if (!showGeneratePreview) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowGeneratePreview(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showGeneratePreview]);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [domainsRes, peopleRes, assetsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DataDomain[] }>(`/data-domains${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: DataAssetOption[]; systems?: { id: string; name: string }[] }>(`/data-assets${query}`),
      ]);
      setDomains(domainsRes.data || []);
      setPeople(peopleRes.data || []);
      setAllAssets(assetsRes.data || []);
      setSystemNameById(Object.fromEntries((assetsRes.systems || []).map((s) => [s.id, s.name])));
      if (activeOrgId) {
        try {
          const orgRes = await apiClient.get<{ success: boolean; data: { statusMode?: string } }>(`/organizations/${activeOrgId}`);
          setStatusMode((orgRes.data?.statusMode as 'simple' | 'advanced') || 'simple');
        } catch { /* */ }
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useRefreshOnFocus(fetchData);

  const filteredDomains = useMemo(() => {
    if (!searchQuery.trim()) return domains.sort((a, b) => a.name.localeCompare(b.name));
    const q = searchQuery.toLowerCase();
    return domains.filter((d) => d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  }, [domains, searchQuery]);

  // Order the (filtered) list so each parent domain is immediately followed by
  // its sub-domains — a flat list the render indents by one level. Children
  // whose parent isn't in the filtered set fall back to top-level position.
  const orderedDomains = useMemo(() => {
    const present = new Set(filteredDomains.map((d) => d.id));
    const byName = (a: DataDomain, b: DataDomain) => a.name.localeCompare(b.name);
    const tops = filteredDomains.filter((d) => !d.parentDomainId || !present.has(d.parentDomainId)).sort(byName);
    const out: DataDomain[] = [];
    for (const t of tops) {
      out.push(t);
      for (const c of filteredDomains.filter((d) => d.parentDomainId === t.id).sort(byName)) out.push(c);
    }
    return out;
  }, [filteredDomains]);

  // Parents that actually have a sub-domain rendered in the current (filtered)
  // list — the only rows that get a collapse caret.
  const parentsWithChildren = useMemo(() => {
    const s = new Set<string>();
    for (const d of orderedDomains) if (d.parentDomainId) s.add(d.parentDomainId);
    return s;
  }, [orderedDomains]);
  // Rows that survive the fold: hide a sub-domain whose parent is collapsed.
  const visibleDomains = useMemo(
    () => orderedDomains.filter((d) => !(d.parentDomainId && collapsedIds.has(d.parentDomainId))),
    [orderedDomains, collapsedIds],
  );

  // Persist the collapsed set per org. The prevKey guard skips the save on the
  // render where the org (and thus the storage key) changed, so the freshly
  // loaded set for the new org isn't clobbered by the previous org's state.
  const collapseKey = activeOrgId ? `procela.dataDomains.collapsed.${activeOrgId}` : 'procela.dataDomains.collapsed';
  const prevCollapseKeyRef = useRef(collapseKey);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(collapseKey);
      setCollapsedIds(raw ? new Set<string>(JSON.parse(raw)) : new Set());
    } catch { setCollapsedIds(new Set()); }
  }, [collapseKey]);
  useEffect(() => {
    if (prevCollapseKeyRef.current !== collapseKey) { prevCollapseKeyRef.current = collapseKey; return; }
    try { localStorage.setItem(collapseKey, JSON.stringify(Array.from(collapsedIds))); } catch { /* */ }
  }, [collapsedIds, collapseKey]);

  const selectedDomain = selectedDomainId ? domains.find((d) => d.id === selectedDomainId) || null : null;
  // Parent of the selected sub-domain (if any) — used to offer an explicit
  // "inherit owner from parent" assignment when a sub-domain has none.
  const selectedParentDomain = selectedDomain?.parentDomainId
    ? (domains.find((d) => d.id === selectedDomain.parentDomainId) || null)
    : null;

  // Unified detail view/edit: the pane opens read-only and flips its identity
  // AND governance fields into editors under one Edit → Save. Reseeds from the
  // selected domain (serialised compare) when the selection changes.
  const m = useDetailEditMode<DomainEditable>(
    {
      name: selectedDomain?.name ?? '',
      description: selectedDomain?.description ?? '',
      status: selectedDomain?.status ?? 'DRAFT',
      criticality: selectedDomain?.criticality ?? '',
      code: selectedDomain?.code ?? '',
      parentDomainId: selectedDomain?.parentDomainId ?? '',
      ownerId: selectedDomain?.ownerId ?? '',
      stewardIds: selectedDomain?.stewardIds ?? [],
      dataAssetIds: selectedDomain?.dataAssetIds ?? [],
    },
    async (draft) => {
      if (!selectedDomain) return;
      if (!draft.name.trim()) { errorToast(null, 'Name is required'); throw new Error('no-name'); }
      try {
        await apiClient.put(`/data-domains/${selectedDomain.id}`, {
          name: draft.name.trim(),
          description: draft.description,
          status: draft.status,
          criticality: draft.criticality,
          code: draft.code,
          parentDomainId: draft.parentDomainId,
          ownerId: draft.ownerId || null,
          stewardIds: draft.stewardIds,
          dataAssetIds: draft.dataAssetIds,
        });
        successToast('Domain saved');
        fetchData();
      } catch (err) { errorToast(err, 'Failed to save domain'); throw err; }
    },
  );

  // Focus mode (/data-domains/:id): drive the selection off the route param so
  // the shared detail body renders for exactly that domain.
  useEffect(() => {
    if (focusDomainId) setSelectedDomainId(focusDomainId);
  }, [focusDomainId]);

  // End the breadcrumb trail on the focused domain's name (focus mode only;
  // the list page keeps its own leaf).
  useBreadcrumbLeaf(focusDomainId ? selectedDomain?.name : undefined);

  // List mode only: auto-select the first visible domain so the (list-mode)
  // state stays valid. Skipped in focus mode, where selection is the route.
  useEffect(() => {
    if (focusDomainId) return;
    if (!selectedDomainId && filteredDomains.length > 0) setSelectedDomainId(filteredDomains[0].id);
    else if (selectedDomainId && !filteredDomains.find((d) => d.id === selectedDomainId) && filteredDomains.length > 0) setSelectedDomainId(filteredDomains[0].id);
  }, [filteredDomains, selectedDomainId, focusDomainId]);

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm); setCreateStewardshipTeam(true); setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setForm(emptyForm); };

  const ensureGovernanceHierarchy = async (): Promise<string | null> => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: Array<{ id: string; type: string }> }>(`/governance-groups${query}`);
      const groups = res.data || [];
      let council = groups.find((g) => g.type === 'COUNCIL');
      let office = groups.find((g) => g.type === 'OFFICE');
      let committee = groups.find((g) => g.type === 'COMMITTEE');
      if (committee) return committee.id;
      if (!council) { const r = await apiClient.post<{ success: boolean; data: { id: string } }>('/governance-groups', { name: 'Data Governance Council', type: 'COUNCIL', status: 'ACTIVE', orgId: activeOrgId }); council = { id: r.data.id, type: 'COUNCIL' }; }
      if (!office) { const r = await apiClient.post<{ success: boolean; data: { id: string } }>('/governance-groups', { name: 'Data Governance Office', type: 'OFFICE', status: 'ACTIVE', orgId: activeOrgId, parentId: council.id }); office = { id: r.data.id, type: 'OFFICE' }; }
      if (!committee) { const r = await apiClient.post<{ success: boolean; data: { id: string } }>('/governance-groups', { name: 'Enterprise Data Committee', type: 'COMMITTEE', status: 'ACTIVE', orgId: activeOrgId, parentId: office.id }); committee = { id: r.data.id, type: 'COMMITTEE' }; }
      return committee.id;
    } catch { return null; }
  };

  // Create-only: an existing domain is edited in the detail pane (the `m`
  // draft above). The stewardship-team auto-creation is a create-time side
  // effect, so it stays here.
  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      await apiClient.post('/data-domains', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
      addToast('success', 'Domain created');
      if (createStewardshipTeam) {
        try {
          const parentId = await ensureGovernanceHierarchy();
          await apiClient.post('/governance-groups', { name: `${form.name.trim()} Stewardship Team`, type: 'STEWARDSHIP_TEAM', description: `Stewardship team for the ${form.name.trim()} domain.`, status: 'ACTIVE', orgId: activeOrgId, parentId });
          addToast('success', `Stewardship team created for ${form.name.trim()}`);
        } catch { addToast('error', 'Domain created, but stewardship team creation failed'); }
      }
      closeForm(); fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to save domain'));
    }
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/data-domains/${id}`);
    if (selectedDomainId === id) setSelectedDomainId(null);
    addToast('success', 'Domain deleted'); fetchData();
  };

  // Set the draft owner to the parent domain's owner (a quick-fill used while
  // editing a sub-domain that has none); the unified Save persists it.
  const inheritOwnerFromParent = () => {
    if (!selectedParentDomain?.ownerId) return;
    m.set('ownerId', selectedParentDomain.ownerId);
  };

  const handleBulkApply = async () => {
    const ids = Array.from(bulkSelectedIds);
    if (ids.length === 0) return;
    const updates: Record<string, string | null> = {};
    if (bulkUpdates.ownerId) updates.ownerId = bulkUpdates.ownerId === '__unassign__' ? null : bulkUpdates.ownerId;
    if (bulkUpdates.status) updates.status = bulkUpdates.status;
    if (Object.keys(updates).length === 0) {
      addToast('error', 'Pick at least one field to change.');
      return;
    }
    setApplyingBulk(true);
    try {
      const res = await apiClient.patch<{ success: boolean; updated: number; skipped: Array<{ id: string; reason: string }> }>('/data-domains/bulk', { ids, updates });
      const skippedCount = res.skipped?.length || 0;
      addToast('success', `Updated ${res.updated} domain${res.updated !== 1 ? 's' : ''}${skippedCount ? ` (skipped ${skippedCount})` : ''}`);
      clearBulkSelection();
      fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Bulk update failed'));
    } finally {
      setApplyingBulk(false);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(bulkSelectedIds);
    if (ids.length === 0) return;
    setApplyingBulk(true);
    try {
      const res = await apiClient.post<{ success: boolean; deleted: number }>('/data-domains/bulk-delete', { ids });
      addToast('success', `Deleted ${res.deleted} domain${res.deleted !== 1 ? 's' : ''}`);
      if (selectedDomainId && ids.includes(selectedDomainId)) setSelectedDomainId(null);
      clearBulkSelection();
      fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Bulk delete failed'));
    } finally {
      setApplyingBulk(false);
      setConfirmBulkDelete(false);
    }
  };

  const handleStatusChange = async (domainId: string, newStatus: string) => {
    try {
      await apiClient.put(`/data-domains/${domainId}`, { status: newStatus });
      addToast('success', `Status changed to ${newStatus.replace('_', ' ')}`); fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to update status')); }
  };

  // Walk the active org and its ancestors to find the first non-empty
  // `industry`. Returns null when nothing is set — common when the
  // user is scoped to a division/department and the parent that holds
  // industry isn't in their visible org list. The picker handles the
  // null case.
  const detectIndustry = async (): Promise<string | null> => {
    try {
      const orgRes = await apiClient.get<{ success: boolean; data: Array<{ id: string; industry: string; parentId?: string }> }>('/organizations');
      const allOrgs = orgRes.data || [];
      let current = allOrgs.find((o) => o.id === activeOrgId);
      let industry = current?.industry || '';
      while (current && !industry) {
        current = allOrgs.find((o: any) => o.id === (current as any).parentId);
        if (current) industry = current.industry || '';
      }
      return industry || null;
    } catch {
      return null;
    }
  };

  // "Generate domains" — the full-tree build. Detect industry (or ask), then
  // build the nested tree.
  const handleGenerate = async () => {
    if (!activeOrgId) { errorToast(null, 'Select an organization first.'); return; }
    const industry = await detectIndustry();
    if (!industry) { setPendingGen({ type: 'tree' }); setPickedIndustry(INDUSTRIES[0]); setIndustryPickerOpen(true); return; }
    await buildTree(industry);
  };

  // Suggest top-level domains, then fan out sub-domains for each (one AI call
  // per domain, in parallel) into a single nested review tree.
  const buildTree = async (industry: string) => {
    setGenerating(true);
    try {
      const res = await apiClient.post<{ success: boolean; data: Array<{ name: string; description: string }> }>('/data-domains/generate', { industry });
      const tops = res.data || [];
      if (tops.length === 0) {
        errorToast(null, 'No suggestions returned. Retry — Claude occasionally returns prose; a retry usually fixes it.');
        return;
      }
      const withSubs = await Promise.all(tops.map(async (t): Promise<GenDomain> => {
        let subDomains: GenSub[] = [];
        try {
          const sr = await apiClient.post<{ success: boolean; data: Array<{ name: string; description: string }> }>(
            '/data-domains/generate-subdomains', { industry, parentName: t.name, parentDescription: t.description });
          subDomains = (sr.data || []).map((s) => ({ name: s.name, description: s.description, selected: true }));
        } catch { subDomains = []; }
        return { name: t.name, description: t.description, selected: true, subDomains };
      }));
      setGenTree(withSubs);
      setGenBranchMode(false);
      setShowGeneratePreview(true);
    } catch (err: any) {
      const snippet = err?.body?.rawSnippet ? `\n\n— AI returned: ${err.body.rawSnippet}` : '';
      errorToast(err, `Generation failed.${snippet}`);
    } finally {
      setGenerating(false);
    }
  };

  // Per-domain "Suggest sub-domains" — the branch build. Opens the same tree
  // seeded with one existing domain as a locked parent.
  const generateSubsForDomain = async (domain: DataDomain) => {
    const industry = await detectIndustry();
    if (!industry) { setPendingGen({ type: 'branch', domain }); setPickedIndustry(INDUSTRIES[0]); setIndustryPickerOpen(true); return; }
    await buildBranch(industry, domain);
  };

  const buildBranch = async (industry: string, domain: DataDomain) => {
    setGenerating(true);
    try {
      const sr = await apiClient.post<{ success: boolean; data: Array<{ name: string; description: string }> }>(
        '/data-domains/generate-subdomains', { industry, parentName: domain.name, parentDescription: domain.description });
      const subDomains: GenSub[] = (sr.data || []).map((s) => ({ name: s.name, description: s.description, selected: true }));
      if (subDomains.length === 0) {
        errorToast(null, 'No sub-domains returned. Retry — Claude occasionally returns prose; a retry usually fixes it.');
        return;
      }
      setGenTree([{ name: domain.name, description: domain.description, selected: true, existingId: domain.id, subDomains }]);
      setGenBranchMode(true);
      setShowGeneratePreview(true);
    } catch (err: any) {
      const snippet = err?.body?.rawSnippet ? `\n\n— AI returned: ${err.body.rawSnippet}` : '';
      errorToast(err, `Sub-domain generation failed.${snippet}`);
    } finally {
      setGenerating(false);
    }
  };

  // ── Tree editing ───────────────────────────────────────────────────────
  const closeGenerate = () => { setShowGeneratePreview(false); setGenTree([]); setGenBranchMode(false); };
  const updateDomain = (di: number, patch: Partial<GenDomain>) => setGenTree((t) => t.map((d, i) => (i === di ? { ...d, ...patch } : d)));
  const updateSub = (di: number, si: number, patch: Partial<GenSub>) => setGenTree((t) => t.map((d, i) => (i === di ? { ...d, subDomains: d.subDomains.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : d)));
  const addSub = (di: number) => setGenTree((t) => t.map((d, i) => (i === di ? { ...d, subDomains: [...d.subDomains, { name: '', description: '', selected: true }] } : d)));
  const removeSub = (di: number, si: number) => setGenTree((t) => t.map((d, i) => (i === di ? { ...d, subDomains: d.subDomains.filter((_, j) => j !== si) } : d)));
  // Reparent a sub-domain onto a different top-level domain in the tree. The
  // sub keeps its name / description / selected state and lands at the end of
  // the target's list (same as a freshly added one). Conflict detection needs
  // no special-casing: subConflict keys off the sub's *current* domain, so a
  // move into a parent that already holds that name lights up the duplicate
  // warning and blocks Apply automatically.
  const moveSub = (fromDi: number, si: number, toDi: number) => setGenTree((t) => {
    if (fromDi === toDi || !t[fromDi] || !t[toDi]) return t;
    const sub = t[fromDi].subDomains[si];
    if (!sub) return t;
    return t.map((d, i) => {
      if (i === fromDi) return { ...d, subDomains: d.subDomains.filter((_, j) => j !== si) };
      if (i === toDi) return { ...d, subDomains: [...d.subDomains, sub] };
      return d;
    });
  });
  const addTopDomain = () => setGenTree((t) => [...t, { name: '', description: '', selected: true, subDomains: [] }]);
  const removeTopDomain = (di: number) => setGenTree((t) => t.filter((_, i) => i !== di));

  // Conflict detection mirrors the backend rule: names are unique among
  // siblings (same parent), not globally. Empty selected names also block.
  const norm = (s: string) => s.trim().toLowerCase();
  const topDomainConflict = (di: number): boolean => {
    const dom = genTree[di];
    if (!dom.selected || dom.existingId) return false;
    const nm = norm(dom.name);
    if (!nm) return false;
    if (genTree.some((o, oi) => oi !== di && o.selected && !o.existingId && norm(o.name) === nm)) return true;
    return domains.some((d) => !d.parentDomainId && norm(d.name) === nm);
  };
  const subConflict = (di: number, si: number): boolean => {
    const dom = genTree[di];
    const sub = dom.subDomains[si];
    if (!sub.selected) return false;
    const nm = norm(sub.name);
    if (!nm) return false;
    if (dom.subDomains.some((o, oj) => oj !== si && o.selected && norm(o.name) === nm)) return true;
    return dom.existingId ? domains.some((d) => d.parentDomainId === dom.existingId && norm(d.name) === nm) : false;
  };
  // Apply is blocked while any selected node is empty-named or conflicts, and
  // when nothing creatable is selected.
  const genHasCreatable = genTree.some((d) => (d.selected && !d.existingId) || d.subDomains.some((s) => s.selected));
  const genHasError = genTree.some((d, di) => {
    if (d.selected && !d.existingId && !d.name.trim()) return true;
    if (topDomainConflict(di)) return true;
    return d.subDomains.some((s, si) => (s.selected && !s.name.trim()) || subConflict(di, si));
  });

  const handleApplyGenerated = async () => {
    const chosen = genTree.filter((d) => d.selected);
    let createdParents = 0; let createdSubs = 0; let failed = 0;
    const newTopNames: string[] = [];
    try {
      for (const dom of chosen) {
        // Create (or reuse) the parent first so children can reference its id.
        let parentId = dom.existingId;
        if (!parentId) {
          const nm = dom.name.trim();
          if (!nm) { failed++; continue; }
          try {
            const r = await apiClient.post<{ success: boolean; data: { id: string } }>('/data-domains', { name: nm, description: dom.description, status: 'DRAFT', ...(activeOrgId ? { orgId: activeOrgId } : {}) });
            parentId = r.data.id; createdParents++; newTopNames.push(nm);
          } catch { failed++; continue; }
        }
        for (const sub of dom.subDomains.filter((s) => s.selected)) {
          const nm = sub.name.trim();
          if (!nm) { failed++; continue; }
          try {
            await apiClient.post('/data-domains', { name: nm, description: sub.description, status: 'DRAFT', parentDomainId: parentId, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
            createdSubs++;
          } catch { failed++; }
        }
      }
      if (generateStewardshipTeams && newTopNames.length > 0) {
        const teamParent = await ensureGovernanceHierarchy();
        await Promise.all(newTopNames.map((n) =>
          apiClient.post('/governance-groups', { name: `${n} Stewardship Team`, type: 'STEWARDSHIP_TEAM', status: 'ACTIVE', orgId: activeOrgId, parentId: teamParent }).catch(() => {})));
      }
      const parts: string[] = [];
      if (createdParents) parts.push(`${createdParents} domain${createdParents === 1 ? '' : 's'}`);
      if (createdSubs) parts.push(`${createdSubs} sub-domain${createdSubs === 1 ? '' : 's'}`);
      addToast(failed > 0 ? 'info' : 'success', `Created ${parts.join(' + ') || 'nothing'}${failed > 0 ? ` · ${failed} failed` : ''}`);
    } catch (err) {
      errorToast(err, 'Failed to create domains');
    }
    closeGenerate();
    fetchData();
  };

  const transitions = statusMode === 'advanced' ? ADVANCED_TRANSITIONS : SIMPLE_TRANSITIONS;
  const unownedCount = domains.filter((d) => !d.ownerId).length;

  // Summary-stat counts for the chip row above the list (mirrors the
  // Organizations page). Top-level vs sub-domain split, plus a total linked
  // asset count. For the asset total we sum each top-level domain's rolled-up
  // `subtreeAssetCount` (which already includes its sub-domains' assets),
  // falling back to a domain's direct count — so a parent's assets and its
  // children's aren't double-counted.
  const topDomainCount = domains.filter((d) => !d.parentDomainId).length;
  const subDomainCount = domains.filter((d) => d.parentDomainId).length;
  const totalLinkedAssets = domains
    .filter((d) => !d.parentDomainId)
    .reduce((sum, d) => sum + (d.subtreeAssetCount ?? d.directAssetCount ?? d.assets.length), 0);

  // A domain's rolled-up asset count (subtree where available, else direct).
  const assetCountOf = (d: DataDomain) => d.subtreeAssetCount ?? d.directAssetCount ?? d.assets.length;
  // Needs-attention predicates + counts, over all domains / assets.
  const isEmptySub = (d: DataDomain) => !!d.parentDomainId && assetCountOf(d) === 0;
  const emptySubCount = domains.filter(isEmptySub).length;
  const noCriticalityCount = domains.filter((d) => !d.criticality).length;
  const assetsNoDomainCount = allAssets.filter((a) => !domains.some((d) => d.dataAssetIds.includes(a.id))).length;

  // The rows the table renders: the tree (visibleDomains) by default, or a flat
  // list of matches when a Needs-attention card is active.
  const attnTest: Record<'emptySub' | 'noCriticality', (d: DataDomain) => boolean> = {
    emptySub: isEmptySub,
    noCriticality: (d) => !d.criticality,
  };
  const domainRows = attentionFilter ? orderedDomains.filter(attnTest[attentionFilter]) : visibleDomains;

  // The AI modals (industry picker + generate/suggest preview) are lifted to
  // consts so both the list view and the focus detail page can mount them —
  // the detail page's "Suggest sub-domains" action drives the same flow.
  const industryPickerModal = industryPickerOpen && (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1060, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => setIndustryPickerOpen(false)}
    >
      <div
        ref={industryPickerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Select industry"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)', padding: 24,
          maxWidth: 480, width: '92vw',
        }}
      >
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Pick an industry</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
          The active organization doesn't have an industry on file. Choose one for this generation and Procela will ask Claude for standard data domains in that industry. Your org isn't modified.
        </p>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
          Industry
        </label>
        <select
          aria-label="Industry"
          value={pickedIndustry}
          onChange={(e) => setPickedIndustry(e.target.value)}
          autoFocus
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)', marginBottom: 18 }}
        >
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => setIndustryPickerOpen(false)}
            style={{ padding: '8px 14px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              const chosen = pickedIndustry;
              const pending = pendingGen;
              setIndustryPickerOpen(false);
              setPendingGen(null);
              if (!chosen) return;
              if (pending?.type === 'branch') {
                await buildBranch(chosen, pending.domain);
              } else {
                await buildTree(chosen);
              }
            }}
            disabled={!pickedIndustry || generating}
            style={{
              padding: '8px 14px',
              background: pickedIndustry ? 'var(--color-primary)' : '#e5e7eb',
              color: pickedIndustry ? '#fff' : 'var(--color-text-muted)',
              border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600,
              cursor: pickedIndustry ? 'pointer' : 'default',
            }}
          >
            {generating ? 'Generating…' : (pendingGen?.type === 'branch' ? 'Generate sub-domains' : 'Generate domains')}
          </button>
        </div>
      </div>
    </div>
  );

  const generatePreviewModal = showGeneratePreview && (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1050, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={closeGenerate}>
      <div ref={generatePreviewRef} role="dialog" aria-modal="true" aria-label={genBranchMode ? 'Suggest sub-domains' : 'Generate domains'} onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', padding: 24, maxWidth: 640, width: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{genBranchMode ? 'Suggest sub-domains' : 'Generate domains'}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
          Review the tree — edit any name, uncheck what you don't need, or add your own. Everything selected is created as DRAFT. Names must be unique within their parent.
        </p>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
          {genTree.map((dom, di) => {
            const dupTop = topDomainConflict(di);
            return (
              <div key={di} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', background: dom.selected ? 'var(--color-bg)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {dom.existingId ? (
                    <span title="Existing domain" style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>PARENT</span>
                  ) : (
                    <input type="checkbox" aria-label={`Include ${dom.name || 'new domain'}`} checked={dom.selected} onChange={() => updateDomain(di, { selected: !dom.selected })} style={{ flexShrink: 0 }} />
                  )}
                  <input
                    aria-label="Domain name"
                    value={dom.name}
                    readOnly={!!dom.existingId}
                    onChange={(e) => updateDomain(di, { name: e.target.value })}
                    placeholder="Domain name"
                    style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 8px', background: dom.existingId ? 'var(--color-bg)' : 'var(--color-surface)', color: 'var(--color-text)' }}
                  />
                  {!dom.existingId && (
                    <button type="button" aria-label="Remove domain" onClick={() => removeTopDomain(di)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0 }}>×</button>
                  )}
                </div>
                {!dom.existingId && (
                  <input
                    aria-label="Domain description"
                    value={dom.description}
                    onChange={(e) => updateDomain(di, { description: e.target.value })}
                    placeholder="Description (optional)"
                    style={{ width: '100%', marginTop: 6, fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 8px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
                  />
                )}
                {dupTop && <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 4 }}>A top-level domain with this name already exists.</div>}
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 22 }}>
                  {dom.subDomains.map((sub, si) => {
                    const dupSub = subConflict(di, si);
                    return (
                      <div key={si}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span aria-hidden="true" style={{ color: 'var(--color-text-muted)', fontSize: 11, flexShrink: 0 }}>↳</span>
                          <input type="checkbox" aria-label={`Include ${sub.name || 'new sub-domain'}`} checked={sub.selected} onChange={() => updateSub(di, si, { selected: !sub.selected })} style={{ flexShrink: 0 }} />
                          <input aria-label="Sub-domain name" value={sub.name} onChange={(e) => updateSub(di, si, { name: e.target.value })} placeholder="Sub-domain name" style={{ flex: 1, minWidth: 0, fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 8px', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
                          {genTree.length > 1 && (
                            <select
                              aria-label="Move sub-domain to another domain"
                              title="Move to another domain"
                              value=""
                              onChange={(e) => { const to = Number(e.target.value); if (Number.isInteger(to)) moveSub(di, si, to); }}
                              style={{ flexShrink: 0, fontSize: 11, border: '1px solid var(--color-border)', borderRadius: 4, padding: '3px 4px', background: 'var(--color-surface)', color: 'var(--color-text-muted)', cursor: 'pointer', maxWidth: 130 }}
                            >
                              <option value="">Move to…</option>
                              {genTree.map((d2, di2) => (di2 !== di ? (
                                <option key={di2} value={di2}>{d2.name.trim() || `Untitled domain ${di2 + 1}`}</option>
                              ) : null))}
                            </select>
                          )}
                          <button type="button" aria-label="Remove sub-domain" onClick={() => removeSub(di, si)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0 }}>×</button>
                        </div>
                        {dupSub && <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 2, paddingLeft: 41 }}>Duplicate name under this parent.</div>}
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => addSub(di)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, padding: '2px 0' }}>+ Add sub-domain</button>
                </div>
              </div>
            );
          })}
          {!genBranchMode && (
            <button type="button" onClick={addTopDomain} style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--color-border)', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 13, padding: '6px 12px', borderRadius: 6 }}>+ Add domain</button>
          )}
        </div>
        {!genBranchMode && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" checked={generateStewardshipTeams} onChange={(e) => setGenerateStewardshipTeams(e.target.checked)} />
            <div style={{ fontSize: 12, fontWeight: 500 }}>Also create Stewardship Teams for new top-level domains</div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <Button variant="secondary" onClick={closeGenerate}>Cancel</Button>
          <Button variant="primary" disabled={!genHasCreatable || genHasError} onClick={handleApplyGenerated}>Create selected</Button>
        </div>
      </div>
    </div>
  );

  // /data-domains/:id renders this component in focus mode: just the single
  // domain's detail as a routed page, not the two-pane list.
  const focus = !!focusDomainId;

  // The focused domain's detail body (identity → timestamps). The name/status
  // header that used to sit atop this body now lives in the PageHeader below
  // (title + action cluster + status meta), so the page shows the name once.
  const detailBody = selectedDomain ? (() => {
    const editing = m.isEditing;
    const statusOptions = Array.from(new Set([m.draft.status, ...(transitions[m.draft.status] || [])])).map((s) => ({ value: s, label: s.replace(/_/g, ' ') }));
    const parentOptions = [
      { value: '', label: '— None (top-level domain)' },
      ...domains.filter((d) => !d.parentDomainId && d.id !== selectedDomain.id).map((d) => ({ value: d.id, label: d.name })),
    ];
    const ownerName = people.find((p) => p.id === m.draft.ownerId)?.name || selectedDomain.ownerName;
    return (
      <>
        {/* Identity fields */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
          {editing && (
            <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="Domain name" />
          )}
          {editing && (
            <EditableField label="Status" editing value={m.draft.status} onChange={(v) => m.set('status', v)} type="select" options={statusOptions} />
          )}
          <EditableField label="Criticality" editing={editing} value={m.draft.criticality} onChange={(v) => m.set('criticality', v)} type="select" options={CRITICALITY_OPTIONS}>
            {criticalityLabel(selectedDomain.criticality)}
          </EditableField>
          <EditableField label="Code" editing={editing} value={m.draft.code} onChange={(v) => m.set('code', v)} placeholder="e.g. MFG" emptyText="—">
            {selectedDomain.code ? <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>{selectedDomain.code}</span> : undefined}
          </EditableField>
          <EditableField label="Parent domain" editing={editing} value={m.draft.parentDomainId} onChange={(v) => m.set('parentDomainId', v)} type="select" options={parentOptions}>
            {selectedDomain.parentDomainName || 'Top-level domain'}
          </EditableField>
        </div>

        {/* Description */}
        {(editing || selectedDomain.description) && (
          <div style={{ marginBottom: 20 }}>
            <EditableField label="Description" editing={editing} type="textarea" value={m.draft.description} onChange={(v) => m.set('description', v)} placeholder="Purpose and scope — what this domain is and what data falls in/out of it" emptyText="No description">
              {selectedDomain.description ? <span style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{selectedDomain.description}</span> : undefined}
            </EditableField>
          </div>
        )}

        {/* Status lifecycle — quick guided transitions (view only). */}
        {!editing && canWrite && (transitions[selectedDomain.status] || []).length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={labelStyle}>Status Transitions</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(transitions[selectedDomain.status] || []).map((s) => (
                <Button key={s} variant="secondary" size="sm" onClick={() => handleStatusChange(selectedDomain.id, s)}>{s.replace(/_/g, ' ')}</Button>
              ))}
            </div>
          </div>
        )}

        {/* Owner — label opens the Role Detail drawer. */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>
            <button type="button" onClick={() => openRoleDrawer('DATA_DOMAIN_OWNER')} title="Learn about this role" style={roleLabelBtnStyle}>
              Owner (Data Domain Owner)
            </button>
          </div>
          {editing ? (
            <>
              <PersonPicker mode="single" valueMode="id" value={m.draft.ownerId || null} onChange={(pid) => m.set('ownerId', pid || '')} placeholder="-- Unassigned --" />
              {!m.draft.ownerId && selectedParentDomain?.ownerId && selectedParentDomain.ownerName && (
                <button
                  type="button"
                  onClick={inheritOwnerFromParent}
                  style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                  title={`Assign ${selectedParentDomain.ownerName} — the owner of the parent domain "${selectedParentDomain.name}" — as this sub-domain's owner`}
                >
                  ↰ Inherit owner from {selectedParentDomain.name}: {selectedParentDomain.ownerName}
                </button>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13 }}>{ownerName || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>}</div>
          )}
        </div>

        {/* Stewards */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>
            <button type="button" onClick={() => openRoleDrawer('DATA_DOMAIN_STEWARD')} title="Learn about this role" style={roleLabelBtnStyle}>
              Stewards ({editing ? m.draft.stewardIds.length : (selectedDomain.stewards?.length || 0)})
            </button>
          </div>
          {editing ? (
            <PersonPicker mode="multi" valueMode="id" value={m.draft.stewardIds} onChange={(ids) => m.set('stewardIds', ids as string[])} placeholder="Add stewards…" />
          ) : (
            <div style={{ fontSize: 13 }}>
              {(selectedDomain.stewards?.length || 0) === 0
                ? <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>None</span>
                : selectedDomain.stewards.map((s) => s.name).join(', ')}
            </div>
          )}
        </div>

        {/* Data Assets — DIRECT membership on this exact domain. */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>
            Data Assets ({(editing ? m.draft.dataAssetIds.length : (selectedDomain.dataAssetIds?.length || 0))} direct{(selectedDomain.subtreeAssetCount ?? 0) > (selectedDomain.dataAssetIds?.length ?? 0)
              ? ` · ${selectedDomain.subtreeAssetCount} incl. sub-domains` : ''})
          </div>
          {editing ? (
            <>
              <input aria-label="Search assets" style={{ ...inputStyle, fontSize: 12, marginBottom: 6 }} placeholder="Search assets..." value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} />
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4, padding: 6, background: 'var(--color-bg)' }}>
                {allAssets.filter((a) => !assetSearch || a.name.toLowerCase().includes(assetSearch.toLowerCase())).map((a) => (
                  <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 4px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={m.draft.dataAssetIds.includes(a.id)} onChange={() => m.set('dataAssetIds', m.draft.dataAssetIds.includes(a.id) ? m.draft.dataAssetIds.filter((id) => id !== a.id) : [...m.draft.dataAssetIds, a.id])} />
                    {a.name}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13 }}>
              {(selectedDomain.assets?.length || 0) === 0
                ? <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>None assigned directly</span>
                : selectedDomain.assets.map((a) => a.name).join(', ')}
            </div>
          )}
          {(() => {
            const own = new Set(selectedDomain.dataAssetIds || []);
            const viaSub = (selectedDomain.subtreeAssets || []).filter((a) => !own.has(a.id));
            if (viaSub.length === 0) return null;
            return (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
                <span style={{ fontWeight: 600 }}>Via sub-domains ({viaSub.length}):</span> {viaSub.map((a) => a.name).join(', ')}
                <div style={{ marginTop: 2, fontStyle: 'italic' }}>Rolled up into this domain&rsquo;s coverage &amp; health — assign each under its own sub-domain, not here.</div>
              </div>
            );
          })()}
        </div>

        {/* Timestamps */}
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 16 }}>
          Created {new Date(selectedDomain.createdAt).toLocaleDateString()} · Updated {new Date(selectedDomain.updatedAt).toLocaleDateString()}
        </div>
      </>
    );
  })() : null;

  // ── Focus mode (detail page) ──────────────────────────────────────────────
  if (focus) {
    if (loading) {
      return (
        <div>
          <PageHeader title="Loading…" />
          <Card><SkeletonRows rows={6} columns={2} /></Card>
        </div>
      );
    }
    if (!selectedDomain) {
      return (
        <EmptyState
          icon={renderNavIcon('/data-domains')}
          title="Domain not found"
          description="The data domain you're looking for may have been deleted, or you don't have access."
          action={{ label: '← Back to Domains', onClick: () => navigate('/data-domains') }}
        />
      );
    }
    return (
      <div>
        <PageHeader
          kicker={`Data domain${selectedDomain.code ? ` · ${selectedDomain.code}` : ''}`}
          title={selectedDomain.name}
          copyId={selectedDomain.id}
          copyLabel="Copy domain ID"
          subtitle={selectedDomain.description || undefined}
          actions={
            <>
              <Link to="/data-domains" style={backLinkStyle}>← Back to Domains</Link>
              <DetailEditActions editing={m.isEditing} canEdit={canWrite} dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} />
              {/* wand + trash + status transitions consolidated into one ⋯ menu. */}
              {!m.isEditing && canWrite && (
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={openMenuId === '__header__'} onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === '__header__' ? null : '__header__'); }} style={{ width: 40, height: 40, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
                  {openMenuId === '__header__' && (
                    <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 44, right: 0, zIndex: 30, minWidth: 210, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                      {(transitions[selectedDomain.status] || []).map((s) => (
                        <button key={s} type="button" role="menuitem" onClick={() => { setOpenMenuId(null); handleStatusChange(selectedDomain.id, s); }} style={menuItemStyle}>Set status: {s.replace(/_/g, ' ')}</button>
                      ))}
                      {aiEnabled && !selectedDomain.parentDomainId && (
                        <button type="button" role="menuitem" disabled={generating} onClick={() => { setOpenMenuId(null); generateSubsForDomain(selectedDomain); }} style={menuItemStyle}>{generating ? 'Suggesting…' : 'Suggest sub-domains'}</button>
                      )}
                      <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 2px' }} />
                      <button type="button" role="menuitem" onClick={async () => {
                        setOpenMenuId(null);
                        try { const r = await apiClient.get<{ success: boolean; data: { assets: number; stewards: number; subDomains?: number; subDomainNames?: string[] } }>(`/data-domains/${selectedDomain.id}/impact`); setDeleteImpact(r.data || null); } catch { setDeleteImpact(null); }
                        setConfirmDelete(selectedDomain.id);
                      }} style={{ ...menuItemStyle, color: 'var(--color-error)' }}>Delete</button>
                    </div>
                  )}
                </span>
              )}
            </>
          }
          meta={
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={statusBadgeStyle(selectedDomain.status)} title={`Status: ${selectedDomain.status.replace(/_/g, ' ')}`}>
                {selectedDomain.status.replace(/_/g, ' ')}
              </span>
              {!selectedDomain.criticality ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: '#fef3c7', color: '#92400e' }}>Criticality not set</span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{criticalityLabel(selectedDomain.criticality)}</span>
              )}
            </span>
          }
        />

        {m.isEditing ? (
          <Card padding={24}>{detailBody}</Card>
        ) : (() => {
          const subDomains = domains.filter((d) => d.parentDomainId === selectedDomain.id).sort((a, b) => a.name.localeCompare(b.name));
          const directCount = selectedDomain.dataAssetIds?.length ?? 0;
          const subAllEmpty = subDomains.length > 0 && subDomains.every((s) => assetCountOf(s) === 0);
          const showGap = directCount > 0 && subAllEmpty;
          const assetIds = (selectedDomain.subtreeAssetIds?.length ? selectedDomain.subtreeAssetIds : selectedDomain.dataAssetIds) || [];
          const domainAssets = assetIds.map((id) => allAssets.find((a) => a.id === id)).filter(Boolean) as DataAssetOption[];
          const factRow = (label: string, value: React.ReactNode) => (
            <div style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <dt style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{label}</dt>
              <dd style={{ margin: 0, textAlign: 'right', fontSize: 13 }}>{value}</dd>
            </div>
          );
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
              <main style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Sub-domain gap — assets sit on the parent while its sub-domains are empty. */}
                {showGap && (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 'var(--radius-md)', background: '#fef3c7', border: '1px solid #fcd34d' }}>
                    <span aria-hidden="true" style={{ color: '#92400e', flexShrink: 0, marginTop: 1, fontSize: 16 }}>{'⚠'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>All {directCount} asset{directCount === 1 ? '' : 's'} sit on this parent domain</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>Its {subDomains.length} sub-domain{subDomains.length === 1 ? '' : 's'} {subDomains.length === 1 ? 'has' : 'have'} no assets. Move each asset to the sub-domain it belongs to so the right steward is accountable.</div>
                    </div>
                    {canWrite && (
                      <button type="button" onClick={() => m.enter()} style={{ height: 34, padding: '0 14px', border: '1px solid #92400e', background: 'var(--color-surface)', color: '#92400e', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Sort assets</button>
                    )}
                  </div>
                )}

                {/* Assets — a real table (system / tier / owner), not a comma line. */}
                <Card padding={0}>
                  <div style={{ padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', borderBottom: domainAssets.length ? '1px solid var(--color-border)' : 'none' }}>
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Data assets <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{domainAssets.length}</span></h2>
                    {canWrite && <button type="button" onClick={() => m.enter()} style={{ height: 32, padding: '0 12px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>Add assets</button>}
                  </div>
                  {domainAssets.length === 0 ? (
                    <div style={{ padding: '18px', fontSize: 13, color: 'var(--color-text-muted)' }}>No data assets assigned to this domain yet.</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            <th style={{ padding: '10px 12px 10px 18px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Asset</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>System</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Tier</th>
                            <th style={{ padding: '10px 18px 10px 12px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Owner</th>
                          </tr>
                        </thead>
                        <tbody>
                          {domainAssets.map((a) => {
                            const tc = TIER_COLORS[tierKey(a.governanceTier)];
                            return (
                              <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <td style={{ padding: '10px 12px 10px 18px' }}>
                                  <button type="button" onClick={() => navigate(`/data-assets/${a.id}`)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text)', fontWeight: 600, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>{a.name}</button>
                                </td>
                                <td style={{ padding: '10px 12px', color: 'var(--color-text-secondary)' }}>{a.systemId ? (systemNameById[a.systemId] || <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>) : <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>}</td>
                                <td style={{ padding: '10px 12px' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: tc.bg, color: tc.color }}>{tierLabel(a.governanceTier)}</span>
                                </td>
                                <td style={{ padding: '10px 18px 10px 12px' }}><OwnerCell name={a.ownerName} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                {/* Sub-domains — cards with steward + asset status. */}
                {subDomains.length > 0 && (
                  <Card padding={0}>
                    <div style={{ padding: '16px 18px 10px' }}>
                      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Sub-domains <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{subDomains.length}</span></h2>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, padding: '0 18px 18px' }}>
                      {subDomains.map((s) => {
                        const n = assetCountOf(s);
                        return (
                          <button key={s.id} type="button" onClick={() => navigate(`/data-domains/${s.id}`)} style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', background: 'var(--color-surface)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{s.name}</span>
                              {s.code && <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12, color: 'var(--color-text-muted)' }}>{s.code}</span>}
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 6 }}>{s.stewards.length > 0 ? `Steward ${s.stewards.map((x) => x.name).join(', ')}` : 'No steward'}</div>
                            <div style={{ fontSize: 13, marginTop: 4, fontWeight: 500, color: n === 0 ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>{n === 0 ? 'No assets yet' : `${n} asset${n === 1 ? '' : 's'}`}</div>
                          </button>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </main>

              {/* Facts rail. */}
              <aside aria-label="Facts" style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Card>
                  <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600 }}>Facts</h2>
                  <dl style={{ margin: 0 }}>
                    {/* Owner */}
                    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                      <dt style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Owner</dt>
                      <dd style={{ margin: '6px 0 0' }}>
                        {selectedDomain.ownerName ? <OwnerCell name={selectedDomain.ownerName} /> : (canWrite ? <button type="button" onClick={() => m.enter()} style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--color-primary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>+ Assign owner</button> : <span style={{ color: 'var(--color-text-muted)' }}>Unassigned</span>)}
                      </dd>
                    </div>
                    {/* Stewards */}
                    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                      <dt style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Stewards {selectedDomain.stewards.length > 0 ? selectedDomain.stewards.length : ''}</dt>
                      <dd style={{ margin: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {selectedDomain.stewards.length === 0 ? (
                          canWrite ? <button type="button" onClick={() => m.enter()} style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--color-primary)', fontWeight: 600, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>+ Assign stewards</button> : <span style={{ color: 'var(--color-text-muted)' }}>None</span>
                        ) : selectedDomain.stewards.map((s) => (
                          <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar name={s.name} size="sm" /><button type="button" onClick={() => navigate(`/people/${s.id}`)} style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--color-text)', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>{s.name}</button></span>
                        ))}
                      </dd>
                    </div>
                    {factRow('Criticality', selectedDomain.criticality ? criticalityLabel(selectedDomain.criticality) : (canWrite ? <button type="button" onClick={() => m.enter()} style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--color-primary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Set criticality</button> : <span style={{ color: 'var(--color-text-muted)' }}>Unclassified</span>))}
                    {factRow('Code', selectedDomain.code ? <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>{selectedDomain.code}</span> : <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>)}
                    {factRow('Parent', selectedDomain.parentDomainName ? <button type="button" onClick={() => selectedDomain.parentDomainId && navigate(`/data-domains/${selectedDomain.parentDomainId}`)} style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--color-text)', fontWeight: 500, cursor: 'pointer' }}>{selectedDomain.parentDomainName}</button> : 'None (top level)')}
                    {factRow('Created', <span title={absoluteTime(selectedDomain.createdAt)}>{relativeTime(selectedDomain.createdAt)}</span>)}
                    <div style={{ padding: '10px 0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <dt style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Updated</dt>
                      <dd style={{ margin: 0, textAlign: 'right', fontSize: 13 }} title={absoluteTime(selectedDomain.updatedAt)}>{relativeTime(selectedDomain.updatedAt)}</dd>
                    </div>
                  </dl>
                </Card>
              </aside>
            </div>
          );
        })()}

        {/* Delete confirm — mounted in focus mode so the detail Delete works.
            After a delete, route back to the list. */}
        <ConfirmDialog open={confirmDelete !== null} title="Delete Data Domain?"
          message={(() => {
            const parts: string[] = [];
            if (deleteImpact && (deleteImpact.assets > 0 || deleteImpact.stewards > 0)) {
              parts.push(`This domain has ${deleteImpact.assets} asset${deleteImpact.assets !== 1 ? 's' : ''} and ${deleteImpact.stewards} steward${deleteImpact.stewards !== 1 ? 's' : ''}. This cannot be undone.`);
            } else {
              parts.push('This will permanently delete this data domain.');
            }
            if (deleteImpact?.subDomains) {
              const names = deleteImpact.subDomainNames || [];
              const shown = names.slice(0, 3).join(', ');
              const more = names.length > 3 ? ` +${names.length - 3} more` : '';
              const list = shown ? ` (${shown}${more})` : '';
              parts.push(`It has ${deleteImpact.subDomains} sub-domain${deleteImpact.subDomains !== 1 ? 's' : ''}${list}. ${deleteImpact.subDomains !== 1 ? 'They' : 'It'} won't be deleted — ${deleteImpact.subDomains !== 1 ? 'they' : 'it'}'ll move to the top level.`);
            }
            return parts.join(' ');
          })()}
          confirmLabel="Delete"
          onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); setDeleteImpact(null); if (id) { await handleDelete(id); navigate('/data-domains'); } }}
          onCancel={() => { setConfirmDelete(null); setDeleteImpact(null); }}
        />

        {industryPickerModal}
        {generatePreviewModal}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Data Domains"
        subtitle="Organize data assets into governed domains with assigned owners and stewards."
        actions={
          <ListToolbar
            export={
              domains.length > 0 ? (
                <ExportMenu build={() => ({
                  filenameBase: 'data-domains',
                  sheetName: 'Data Domains',
                  headers: ['Name', 'Description', 'Owner', 'Stewards', 'Assets', 'Status'],
                  rows: domains.map((d) => [
                    d.name,
                    d.description,
                    d.ownerName || '',
                    d.stewards.map((s) => s.name).join('; '),
                    d.assets.map((a) => a.name).join('; '),
                    d.status,
                  ]),
                })} />
              ) : undefined
            }
            extra={canWrite && aiEnabled ? (
              <IconButton icon="wand" label={generating ? 'Suggesting…' : 'Suggest domains'} disabled={generating} onClick={handleGenerate} />
            ) : undefined}
            primary={canWrite ? <IconButton icon="plus" label="Add domain" variant="primary" onClick={openAdd} /> : undefined}
          />
        }
      >
        <HelpPopover id="domains-intro" title="Data Domains">
          Domains group related data assets into governed categories (e.g. Customer Data, Financial Data).
          Each domain has an owner, stewards, and a scope definition.
        </HelpPopover>
      </PageHeader>

      {/* Ownership gap warning */}
      {unownedCount > 0 && (
        <div style={{ padding: '8px 14px', marginBottom: 12, borderRadius: 'var(--radius-md)', background: 'var(--color-warning-light)', border: '1px solid var(--color-warning)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <span style={{ fontWeight: 700 }}>{unownedCount}</span> domain{unownedCount !== 1 ? 's have' : ' has'} no owner assigned
        </div>
      )}

      <ConfirmDialog open={confirmDelete !== null} title="Delete Data Domain?"
        message={(() => {
          const parts: string[] = [];
          if (deleteImpact && (deleteImpact.assets > 0 || deleteImpact.stewards > 0)) {
            parts.push(`This domain has ${deleteImpact.assets} asset${deleteImpact.assets !== 1 ? 's' : ''} and ${deleteImpact.stewards} steward${deleteImpact.stewards !== 1 ? 's' : ''}. This cannot be undone.`);
          } else {
            parts.push('This will permanently delete this data domain.');
          }
          if (deleteImpact?.subDomains) {
            const names = deleteImpact.subDomainNames || [];
            const shown = names.slice(0, 3).join(', ');
            const more = names.length > 3 ? ` +${names.length - 3} more` : '';
            const list = shown ? ` (${shown}${more})` : '';
            parts.push(`It has ${deleteImpact.subDomains} sub-domain${deleteImpact.subDomains !== 1 ? 's' : ''}${list}. ${deleteImpact.subDomains !== 1 ? 'They' : 'It'} won't be deleted — ${deleteImpact.subDomains !== 1 ? 'they' : 'it'}'ll move to the top level.`);
          }
          return parts.join(' ');
        })()}
        confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); setDeleteImpact(null); if (id) await handleDelete(id); }}
        onCancel={() => { setConfirmDelete(null); setDeleteImpact(null); }}
      />

      <ConfirmDialog open={confirmBulkDelete}
        title={`Delete ${bulkSelectedIds.size} domain${bulkSelectedIds.size !== 1 ? 's' : ''}?`}
        message={`This will permanently delete the ${bulkSelectedIds.size} selected data domain${bulkSelectedIds.size !== 1 ? 's' : ''}. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)} />

      {/* Add/Edit Form */}
      {showForm && (
        <Card padding={20} marginBottom={16}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add New Data Domain</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus aria-label="Name" style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Customer Data" /></div>
            <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Code</label>
              <input aria-label="Code" style={{ ...inputStyle, fontFamily: 'var(--font-mono, ui-monospace, monospace)' }} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={form.parentDomainId ? 'e.g. MFG-02' : 'e.g. MFG'} />
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>Structured governance code. Auto-suggested if left blank.</div></div>
            <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
              <select aria-label="Status" style={selectStyle} value="DRAFT" disabled><option value="DRAFT">Draft</option></select>
            </div>
            <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Criticality</label>
              <select aria-label="Criticality" style={selectStyle} value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}>
                <option value="">Unclassified</option>
                <option value="TIER_1">Tier-1 (critical)</option>
                <option value="TIER_2">Tier-2</option>
                <option value="TIER_3">Tier-3</option>
                <option value="TIER_4">Tier-4</option>
              </select>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>Tier-1 domains drive the Council Scorecard's coverage measure.</div>
            </div>
            <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Parent domain</label>
              <select
                aria-label="Parent domain"
                style={selectStyle}
                value={form.parentDomainId}
                onChange={(e) => setForm({ ...form, parentDomainId: e.target.value })}
              >
                <option value="">— None (top-level domain)</option>
                {domains
                  .filter((d) => !d.parentDomainId)
                  .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>Nest this under a parent to make it a sub-domain. One level deep.</div>
            </div>
            {/* Description absorbed the former "Scope Definition" field. */}
            <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input aria-label="Description" style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Purpose and scope — what this domain is and what data falls in/out of it" /></div>
          </div>
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <input type="checkbox" checked={createStewardshipTeam} onChange={(e) => setCreateStewardshipTeam(e.target.checked)} style={{ marginTop: 2 }} />
            <div><div style={{ fontSize: 12, fontWeight: 500 }}>Create a Stewardship Team for this domain</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>Assign members later under Governance Groups.</div></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button variant="primary" disabled={!form.name.trim()} onClick={handleSave}>Add Domain</Button>
          </div>
        </Card>
      )}

      {/* Summary stats — top-level vs sub-domain split + total linked assets,
          mirroring the Organizations page chip row. Rendered only when there
          are domains. */}
      {domains.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#dbeafe', color: '#1e40af',
            borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 500,
          }}>
            <span style={{ fontWeight: 700 }}>{topDomainCount}</span>
            <span>Domain{topDomainCount === 1 ? '' : 's'}</span>
          </div>
          {subDomainCount > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#f1f5f9', color: '#475569',
              borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 500,
            }}>
              <span style={{ fontWeight: 700 }}>{subDomainCount}</span>
              <span>Sub-domain{subDomainCount === 1 ? '' : 's'}</span>
            </div>
          )}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#ede9fe', color: '#5b21b6',
            borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 500,
            marginLeft: 'auto',
          }}>
            <span style={{ fontWeight: 700 }}>{totalLinkedAssets}</span>
            <span>Data asset{totalLinkedAssets === 1 ? '' : 's'}</span>
          </div>
        </div>
      )}

      {/* Needs attention — a steward's worklist as one-click filters. Empty
          sub-domains and criticality-not-set filter the table; assets-in-no-
          domain jumps to the registry's Unassigned view. */}
      {domains.length > 0 && !loading && (
        <section aria-label="Needs attention" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Needs attention</div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Every domain should have an owner, stewards, and assets</span>
          </div>
          {/* auto-fill (not auto-fit) so a short card set stays tile-sized and
              left-aligned instead of ballooning to full width — matches the
              Data Assets needs-attention tiles. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {(() => {
              const cards = [
                { key: 'emptySub', count: emptySubCount, label: 'Sub-domains with no assets', hint: 'Assets sit on the parent instead', priority: true, kind: 'filter' as const },
                { key: 'noDomain', count: assetsNoDomainCount, label: 'Assets in no domain', hint: 'Opens Data Assets → Unassigned', kind: 'link' as const },
                { key: 'noCriticality', count: noCriticalityCount, label: 'Criticality not set', hint: 'How much the business depends on it', kind: 'filter' as const },
              ];
              return cards.map((c) => {
                const active = c.kind === 'filter' && attentionFilter === c.key;
                const zero = c.count === 0;
                const onClick = c.kind === 'link'
                  ? () => navigate('/data-assets?attention=noDomain')
                  : () => setAttentionFilter(active ? '' : (c.key as 'emptySub' | 'noCriticality'));
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={c.kind === 'filter' ? active : undefined}
                    disabled={zero && c.kind === 'filter' && !active}
                    onClick={onClick}
                    style={{
                      textAlign: 'left', cursor: zero && c.kind === 'filter' && !active ? 'default' : 'pointer',
                      borderRadius: 'var(--radius-md)', padding: '12px 14px',
                      display: 'flex', flexDirection: 'column', gap: 3, minHeight: 82,
                      background: active ? 'var(--color-primary-light)' : 'var(--color-surface)',
                      border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      boxShadow: active ? '0 0 0 1px var(--color-primary)' : 'var(--shadow-sm)',
                      opacity: zero && c.kind === 'filter' && !active ? 0.6 : 1,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: zero ? 'var(--color-text-muted)' : 'var(--color-text)' }}>{c.count}</span>
                      {c.priority && c.count > 0 && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', color: 'var(--color-warning)' }}>Fix first</span>}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{c.label}</span>
                    <span className="na-card-hint" title={c.hint}>{c.hint}</span>
                  </button>
                );
              });
            })()}
          </div>
        </section>
      )}

      {/* Main content: dictionary layout */}
      {loading ? (
        <SkeletonRows rows={5} columns={4} />
      ) : generating && !showGeneratePreview ? (
        /* AI generation is in-flight. Without this card the only
           visible feedback is the header IconButton's tooltip
           changing — invisible on hover-less touch and easy to
           miss anywhere else. Mirrors the ValueStreamWizard's
           spinner pattern so users get the same "AI is working,
           expect 10–30s" signal across both wizards. */
        <Card padding="3rem" shadow="none" borderColor="var(--color-primary)" style={{ textAlign: 'center' }}>
          <Spinner size={28} thickness={3} color="var(--color-primary)" style={{ marginBottom: 12 }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--color-primary)' }}>Generating data domains…</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            AI is suggesting domains based on your industry. This usually takes 10–30 seconds.
          </p>
        </Card>
      ) : domains.length === 0 && !showForm ? (
        <EmptyState icon={renderNavIcon('/data-domains')} title="No data domains defined yet"
          description="Data domains group related data assets under a single governance umbrella — owner, stewards, policies."
          action={{ label: 'Add Domain', onClick: openAdd }}
          secondaryAction={canWrite && aiEnabled ? { label: 'Generate from Industry', onClick: handleGenerate, variant: 'secondary' } : undefined} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: bulkSelectedIds.size > 0 ? 'minmax(0, 1fr) minmax(340px, 460px)' : '1fr', gap: 16, alignItems: 'start' }}>
          {/* Domain index — the main, full-width list. Clicking a row opens
              its detail page (/data-domains/:id), matching the People / Systems
              / Governance Groups detail-page family. A right column appears only
              while bulk-editing. */}
          <Card padding={0} shadow="none" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 160px)' }}>
            {/* Tree toolbar — select-all + expand/collapse on one compact
                band (matching the Organizations / Governance Groups tree
                pages), with the search pushed to the right. */}
            <div style={{ display: 'flex', gap: 12, padding: '8px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)', alignItems: 'center', flexWrap: 'wrap' }}>
              {canWrite && filteredDomains.length > 0 && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible domains"
                    checked={filteredDomains.every((d) => bulkSelectedIds.has(d.id))}
                    ref={(el) => {
                      if (el) {
                        const some = filteredDomains.some((d) => bulkSelectedIds.has(d.id));
                        const all = filteredDomains.every((d) => bulkSelectedIds.has(d.id));
                        el.indeterminate = some && !all;
                      }
                    }}
                    onChange={() => {
                      const allSelected = filteredDomains.every((d) => bulkSelectedIds.has(d.id));
                      setBulkSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (allSelected) filteredDomains.forEach((d) => next.delete(d.id));
                        else filteredDomains.forEach((d) => next.add(d.id));
                        return next;
                      });
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  {bulkSelectedIds.size > 0 ? `${bulkSelectedIds.size} selected` : 'Select all visible'}
                </label>
              )}
              {parentsWithChildren.size > 0 && (
                <ExpandCollapseControls
                  size={11}
                  onExpandAll={() => setCollapsedIds(new Set())}
                  onCollapseAll={() => setCollapsedIds(new Set(parentsWithChildren))}
                />
              )}
              {bulkSelectedIds.size > 0 && (
                <button onClick={clearBulkSelection} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, padding: 0 }}>Clear</button>
              )}
              <input aria-label="Search domains" style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', marginLeft: 'auto', flex: '1 1 180px', maxWidth: 280 }} placeholder="Search domains..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {domainRows.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>No domains match.</div>
              ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {canWrite && <th style={{ width: 36, padding: '10px 0 10px 14px', borderBottom: '1px solid var(--color-border)' }} />}
                    <th style={{ padding: '10px 12px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Domain</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Owner</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Stewards</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', textAlign: 'right' }}>Assets</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Status</th>
                    <th style={{ padding: '10px 14px 10px 12px', borderBottom: '1px solid var(--color-border)' }}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {domainRows.map((d) => {
                    const isChecked = bulkSelectedIds.has(d.id);
                    const isSub = !!d.parentDomainId;
                    // Carets only in tree mode (not while a Needs-attention card
                    // flattens the list).
                    const isCollapsible = !attentionFilter && parentsWithChildren.has(d.id);
                    const isCollapsed = collapsedIds.has(d.id);
                    const assetCount = assetCountOf(d);
                    const openDetail = () => navigate(`/data-domains/${d.id}`);
                    return (
                      <tr
                        key={d.id}
                        onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, select, label, [role="button"]')) return; openDetail(); }}
                        style={{ cursor: 'pointer', borderBottom: '1px solid var(--color-border)', background: isChecked ? 'color-mix(in srgb, var(--color-primary-light) 45%, transparent)' : 'transparent' }}
                        onMouseEnter={(e) => { if (!isChecked) e.currentTarget.style.background = 'var(--color-bg)'; }}
                        onMouseLeave={(e) => { if (!isChecked) e.currentTarget.style.background = isChecked ? 'color-mix(in srgb, var(--color-primary-light) 45%, transparent)' : 'transparent'; }}
                      >
                        {canWrite && (
                          <td style={{ padding: '0 0 0 14px' }}>
                            <input type="checkbox" aria-label={`Select ${d.name}`} checked={isChecked} onChange={() => toggleBulkSelect(d.id)} style={{ cursor: 'pointer' }} />
                          </td>
                        )}
                        {/* Domain — indented for sub-domains; caret toggles the parent. */}
                        <td style={{ padding: '10px 12px', paddingLeft: isSub ? 40 : 12, maxWidth: 320 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {isCollapsible && (
                              <button type="button" aria-label={isCollapsed ? `Expand ${d.name}` : `Collapse ${d.name}`} aria-expanded={!isCollapsed} onClick={() => toggleCollapse(d.id)} style={{ background: 'none', border: 'none', padding: 0, marginLeft: -22, cursor: 'pointer', width: 16, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 11 }}>
                                {isCollapsed ? '▸' : '▾'}
                              </button>
                            )}
                            <button type="button" onClick={openDetail} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text)', fontWeight: 600, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>{d.name}</button>
                            {d.code && <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11, color: 'var(--color-text-muted)' }}>{d.code}</span>}
                            {scope.applied && <ScopeBadge inScope={scope.has('domain', d.id)} />}
                          </span>
                          {d.description && (
                            <span style={{ display: 'block', marginTop: 2, maxWidth: 300 }}>
                              <TruncatedText text={d.description} style={{ fontSize: 12, color: 'var(--color-text-muted)' }} />
                            </span>
                          )}
                        </td>
                        {/* Owner — real name + avatar (was a tiny green chip). */}
                        <td style={{ padding: '10px 12px' }}><OwnerCell name={d.ownerName} /></td>
                        {/* Stewards — real names. */}
                        <td style={{ padding: '10px 12px', color: 'var(--color-text-secondary)' }}>
                          {d.stewards.length > 0 ? d.stewards.map((s) => s.name).join(', ') : <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>}
                        </td>
                        {/* Assets — rolled-up count, or a "No assets" gap chip. */}
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {assetCount > 0 ? (
                            <button type="button" onClick={openDetail} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{assetCount}</button>
                          ) : (
                            <span title="No data assets assigned to this domain" style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', border: '1px dashed var(--color-border)', borderRadius: 999, fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)' }}>No assets</span>
                          )}
                        </td>
                        {/* Status pill. */}
                        <td style={{ padding: '10px 12px' }}>
                          <span style={statusBadgeStyle(d.status)} title={`Status: ${d.status.replace(/_/g, ' ')}`}>{d.status.replace(/_/g, ' ')}</span>
                        </td>
                        {/* Actions — "Add assets" only where empty, plus a "⋯" menu. */}
                        <td style={{ padding: '8px 14px 8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {canWrite && assetCount === 0 && (
                              <button type="button" onClick={openDetail} style={{ height: 30, padding: '0 12px', border: '1px solid var(--color-primary)', background: 'var(--color-surface)', color: 'var(--color-primary)', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Add assets</button>
                            )}
                            {canWrite && (
                              <span style={{ position: 'relative', display: 'inline-flex' }}>
                                <button type="button" aria-label={`Actions for ${d.name}`} aria-haspopup="menu" aria-expanded={openMenuId === d.id} onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === d.id ? null : d.id); }} style={{ width: 30, height: 30, border: 'none', background: 'transparent', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>⋯</button>
                                {openMenuId === d.id && (
                                  <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 190, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                                    <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); openDetail(); }} style={menuItemStyle}>Open</button>
                                    {!isSub && (
                                      <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); setForm({ ...emptyForm, parentDomainId: d.id }); setCreateStewardshipTeam(true); setShowForm(true); }} style={menuItemStyle}>Add sub-domain</button>
                                    )}
                                    {!isSub && aiEnabled && (
                                      <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); generateSubsForDomain(d); }} style={menuItemStyle}>Suggest sub-domains</button>
                                    )}
                                    <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 2px' }} />
                                    <button type="button" role="menuitem" onClick={async () => {
                                      setOpenMenuId(null);
                                      try { const r = await apiClient.get<{ success: boolean; data: { assets: number; stewards: number; subDomains?: number; subDomainNames?: string[] } }>(`/data-domains/${d.id}/impact`); setDeleteImpact(r.data || null); } catch { setDeleteImpact(null); }
                                      setConfirmDelete(d.id);
                                    }} style={{ ...menuItemStyle, color: 'var(--color-error)' }}>Delete</button>
                                  </div>
                                )}
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              )}
            </div>
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-muted)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>
                {attentionFilter
                  ? `${domainRows.length} ${attentionFilter === 'emptySub' ? 'sub-domain(s) with no assets' : 'domain(s) with no criticality'}`
                  : `${filteredDomains.length} of ${domains.length} domains`}
              </span>
              {attentionFilter && (
                <button type="button" onClick={() => setAttentionFilter('')} style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--color-primary)', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>Clear filter</button>
              )}
            </div>
          </Card>

          {/* Right: bulk-edit panel — shown only while rows are selected. The
              single-domain detail now lives on its own /data-domains/:id page. */}
          {bulkSelectedIds.size > 0 && (
          <Card padding={0} shadow="none" style={{ minHeight: 400 }}>
            <div style={{ padding: '24px 28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Bulk edit {bulkSelectedIds.size} domain{bulkSelectedIds.size !== 1 ? 's' : ''}</h2>
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, margin: 0 }}>
                      Pick the fields to change. Empty fields are left untouched. Status changes that aren't a valid transition for a given domain will be skipped.
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={clearBulkSelection}>Clear selection</Button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={labelStyle}>Owner</label>
                    <select aria-label="Owner" style={selectStyle} value={bulkUpdates.ownerId} onChange={(e) => setBulkUpdates({ ...bulkUpdates, ownerId: e.target.value })}>
                      <option value="">— No change —</option>
                      <option value="__unassign__">— Clear owner —</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Status</label>
                    <select aria-label="Status" style={selectStyle} value={bulkUpdates.status} onChange={(e) => setBulkUpdates({ ...bulkUpdates, status: e.target.value })}>
                      <option value="">— No change —</option>
                      {(statusMode === 'advanced' ? ['DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED'] : ['DRAFT', 'ACTIVE', 'DEPRECATED']).map((s) => (
                        <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                  <Button variant="secondary" style={{ color: '#991b1b', borderColor: '#fca5a5' }} disabled={applyingBulk} onClick={() => setConfirmBulkDelete(true)}>
                    Delete {bulkSelectedIds.size} domain{bulkSelectedIds.size !== 1 ? 's' : ''}
                  </Button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" disabled={applyingBulk} onClick={clearBulkSelection}>Cancel</Button>
                    <Button variant="primary" disabled={applyingBulk} onClick={handleBulkApply}>
                      {applyingBulk ? 'Applying…' : 'Apply changes'}
                    </Button>
                  </div>
                </div>
              </div>
          </Card>
          )}
        </div>
      )}

      {/* AI modals (industry picker + generate/suggest preview) — defined as
          consts above so the detail page can reuse them too. */}
      {industryPickerModal}
      {generatePreviewModal}
    </div>
  );
}
