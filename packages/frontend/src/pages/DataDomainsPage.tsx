import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import { exportCsv } from '../lib/exportCsv';
import { errorToast } from '../lib/errorToast';
import { getStatusColor } from '../lib/statusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import HelpPopover from '../components/HelpPopover';
import InfoTip from '../components/InfoTip';
import UnsavedBanner from '../components/UnsavedBanner';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import SortableTh from '../components/SortableTh';
import { useSortedList } from '../hooks/useSortedList';
import { SkeletonRows } from '../components/Skeleton';
import DependencyBanner, { useDependencyChecks } from '../components/DependencyBanner';

interface DataDomain {
  id: string;
  orgId: string;
  name: string;
  description: string;
  ownerId: string | null;
  ownerName: string | null;
  stewardIds: string[];
  stewards: { id: string; name: string }[];
  dataAssetIds: string[];
  assets: { id: string; name: string }[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Person {
  id: string;
  name: string;
}

interface DataAssetOption {
  id: string;
  name: string;
}

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};

const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--color-border)',
};

interface FormData {
  name: string;
  description: string;
  status: string;
  scopeDefinition: string;
}

const emptyForm: FormData = { name: '', description: '', status: 'DRAFT', scopeDefinition: '' };

const SIMPLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT:      ['ACTIVE'],
  ACTIVE:     ['DRAFT', 'DEPRECATED'],
  DEPRECATED: ['DRAFT'],
};
const ADVANCED_TRANSITIONS: Record<string, string[]> = {
  DRAFT:        ['PROPOSED'],
  PROPOSED:     ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED:     ['ACTIVE', 'DRAFT'],
  ACTIVE:       ['DRAFT', 'DEPRECATED'],
  DEPRECATED:   ['DRAFT'],
};
const SIMPLE_LOCKED = new Set(['ACTIVE', 'DEPRECATED']);
const ADVANCED_LOCKED = new Set(['UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED']);

export default function DataDomainsPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const deps = useDependencyChecks();
  const { addToast } = useToastStore();
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [allAssets, setAllAssets] = useState<DataAssetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [selectedDomain, setSelectedDomain] = useState<DataDomain | null>(null);
  const [statusMode, setStatusMode] = useState<'simple' | 'advanced'>('simple');
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<{ assets: number; stewards: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);

  // Filters
  const [filterOwner, setFilterOwner] = useState('');
  const [filterSteward, setFilterSteward] = useState('');
  const [filterAsset, setFilterAsset] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Bulk assign
  const [bulkAssignType, setBulkAssignType] = useState<'owner' | 'steward' | ''>('');
  const [bulkAssignPersonId, setBulkAssignPersonId] = useState('');
  const [bulkStewardRole, setBulkStewardRole] = useState<'business' | 'technical'>('business');
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState('');

  // Collapsible prerequisites banner
  const [showPrereqs, setShowPrereqs] = useState(true);

  // Stewardship team option on create
  const [createStewardshipTeam, setCreateStewardshipTeam] = useState(true);

  // AI generate state
  const [generating, setGenerating] = useState(false);
  const [generatedDomains, setGeneratedDomains] = useState<Array<{ name: string; description: string; selected: boolean }>>([]);
  const [showGeneratePreview, setShowGeneratePreview] = useState(false);
  const [generateStewardshipTeams, setGenerateStewardshipTeams] = useState(true);

  // Detail editing state
  const [detailOwnerId, setDetailOwnerId] = useState<string>('');
  const [detailStewardIds, setDetailStewardIds] = useState<string[]>([]);
  const [detailAssetIds, setDetailAssetIds] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [domainsRes, peopleRes, assetsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DataDomain[] }>(`/data-domains${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: DataAssetOption[] }>(`/data-assets${query}`),
      ]);
      setDomains(domainsRes.data || []);
      setPeople(peopleRes.data || []);
      setAllAssets(assetsRes.data || []);
      if (activeOrgId) {
        try {
          const orgRes = await apiClient.get<{ success: boolean; data: { statusMode?: string } }>(`/organizations/${activeOrgId}`);
          setStatusMode((orgRes.data?.statusMode as 'simple' | 'advanced') || 'simple');
        } catch { /* */ }
      }
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm);
    setEditingId(null);
    setSelectedDomain(null);
    setCreateStewardshipTeam(true);
    setShowForm(true);
  };

  const openEdit = (domain: DataDomain) => {
    setForm({ name: domain.name, description: domain.description, status: domain.status, scopeDefinition: (domain as any).scopeDefinition || '' });
    setEditingId(domain.id);
    setSelectedDomain(null);
    setShowForm(true);
  };

  const openDetail = (domain: DataDomain) => {
    setSelectedDomain(domain);
    setDetailOwnerId(domain.ownerId || '');
    setDetailStewardIds(domain.stewardIds || []);
    setDetailAssetIds(domain.dataAssetIds || []);
    setShowForm(false);
    setEditingId(null);
  };

  const { isDirty, markDirty, markClean, confirmIfDirty } = useUnsavedChanges();
  const closeForm = () => { markClean(); setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const ensureGovernanceHierarchy = async (): Promise<string | null> => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: Array<{ id: string; type: string; name: string }> }>(`/governance-groups${query}`);
      const groups = res.data || [];

      let council = groups.find((g) => g.type === 'COUNCIL');
      let office = groups.find((g) => g.type === 'OFFICE');
      let committee = groups.find((g) => g.type === 'COMMITTEE');

      if (committee) return committee.id;

      // Create missing hierarchy levels
      if (!council) {
        const r = await apiClient.post<{ success: boolean; data: { id: string } }>('/governance-groups', {
          name: 'Data Governance Council', type: 'COUNCIL',
          description: 'Executive steering committee that sets data governance strategy, policy, and priorities.',
          status: 'ACTIVE', orgId: activeOrgId || undefined,
        });
        council = { id: r.data.id, type: 'COUNCIL', name: 'Data Governance Council' };
      }

      if (!office) {
        const r = await apiClient.post<{ success: boolean; data: { id: string } }>('/governance-groups', {
          name: 'Data Governance Office', type: 'OFFICE',
          description: 'Day-to-day program management and coordination of governance activities.',
          status: 'ACTIVE', orgId: activeOrgId || undefined, parentId: council.id,
        });
        office = { id: r.data.id, type: 'OFFICE', name: 'Data Governance Office' };
      }

      if (!committee) {
        const r = await apiClient.post<{ success: boolean; data: { id: string } }>('/governance-groups', {
          name: 'Enterprise Data Committee', type: 'COMMITTEE',
          description: 'Cross-functional working group that implements governance standards and practices.',
          status: 'ACTIVE', orgId: activeOrgId || undefined, parentId: office.id,
        });
        committee = { id: r.data.id, type: 'COMMITTEE', name: 'Enterprise Data Committee' };
        addToast('info', 'Governance hierarchy created (Council, Office, Committee)');
      }

      return committee.id;
    } catch { return null; }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      if (editingId) {
        await apiClient.put(`/data-domains/${editingId}`, form);
        addToast('success', 'Data domain updated');
      } else {
        await apiClient.post('/data-domains', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
        addToast('success', 'Data domain created');

        if (createStewardshipTeam) {
          try {
            const parentId = await ensureGovernanceHierarchy();
            await apiClient.post('/governance-groups', {
              name: `${form.name.trim()} Stewardship Team`,
              type: 'STEWARDSHIP_TEAM',
              description: `Data stewardship team responsible for the ${form.name.trim()} domain. Ensures data quality, standards compliance, and issue resolution.`,
              status: 'ACTIVE',
              orgId: activeOrgId || undefined,
              parentId,
            });
            addToast('success', `Stewardship team created for ${form.name.trim()}`);
          } catch {
            addToast('error', 'Domain created, but stewardship team creation failed');
          }
        }
      }
      markClean();
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      setCreateStewardshipTeam(true);
      fetchData();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to save domain';
      addToast('error', msg);
    }
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/data-domains/${id}`);
    if (selectedDomain?.id === id) setSelectedDomain(null);
    addToast('success', 'Data domain deleted');
    fetchData();
  };

  // ── Bulk select handlers ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === domains.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(domains.map((d) => d.id)));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/data-domains/${id}`)));
    addToast('success', `Deleted ${selectedIds.size} data domains`);
    setSelectedIds(new Set());
    setSelectedDomain(null);
    fetchData();
  };

  const handleCancel = () => { confirmIfDirty(closeForm); };

  const handleBulkAssign = async () => {
    if (selectedIds.size === 0 || !bulkAssignPersonId) return;
    const targetIds = Array.from(selectedIds);
    try {
      if (bulkAssignType === 'owner') {
        await Promise.all(targetIds.map((id) => apiClient.put(`/data-domains/${id}`, { ownerId: bulkAssignPersonId })));
        const personName = people.find((p) => p.id === bulkAssignPersonId)?.name || '';
        addToast('success', `Set ${personName} as owner of ${targetIds.length} domain${targetIds.length === 1 ? '' : 's'}`);
      } else {
        await Promise.all(targetIds.map(async (id) => {
          const domain = domains.find((d) => d.id === id);
          if (!domain) return;
          const existing = domain.stewardIds || [];
          if (!existing.includes(bulkAssignPersonId)) {
            await apiClient.put(`/data-domains/${id}`, { stewardIds: [...existing, bulkAssignPersonId] });
          }
        }));
        const personName = people.find((p) => p.id === bulkAssignPersonId)?.name || '';
        addToast('success', `Added ${personName} as ${bulkStewardRole} steward to ${targetIds.length} domain${targetIds.length === 1 ? '' : 's'}`);
      }
      setBulkAssignType('');
      setBulkAssignPersonId('');
      setSelectedIds(new Set());
      fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Bulk assignment failed');
    }
  };

  const handleBulkStatus = async () => {
    if (selectedIds.size === 0 || !bulkStatusValue) return;
    const targetIds = Array.from(selectedIds);
    try {
      await Promise.all(targetIds.map((id) => apiClient.put(`/data-domains/${id}`, { status: bulkStatusValue })));
      addToast('success', `Set ${targetIds.length} domain${targetIds.length === 1 ? '' : 's'} to ${bulkStatusValue}`);
      setBulkStatusOpen(false);
      setBulkStatusValue('');
      setSelectedIds(new Set());
      fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Bulk status change failed');
    }
  };

  const handleDetailSave = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!selectedDomain) return;
    const res = await apiClient.put<{ success: boolean; data: DataDomain }>(`/data-domains/${selectedDomain.id}`, {
      ownerId: detailOwnerId || null,
      stewardIds: detailStewardIds,
      dataAssetIds: detailAssetIds,
    });
    if (res.data) setSelectedDomain(res.data);
    addToast('success', 'Governance details saved');
    fetchData();
  };

  const toggleSteward = (personId: string) => {
    setDetailStewardIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId],
    );
  };

  const toggleAsset = (assetId: string) => {
    setDetailAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId],
    );
  };

  // ── AI-generate handler ──
  const handleGenerate = async () => {
    if (!activeOrgId) {
      errorToast(null, 'Select an organization from the "Working In" dropdown first.');
      return;
    }
    setGenerating(true);
    try {
      // Look up the active org's industry.
      const orgRes = await apiClient.get<{ success: boolean; data: Array<{ id: string; industry: string }> }>('/organizations');
      const activeOrg = (orgRes.data || []).find((o) => o.id === activeOrgId);
      // Walk up the parent chain to find an org with an industry set.
      let industry = activeOrg?.industry || '';
      if (!industry) {
        const allOrgs = orgRes.data || [];
        let current = activeOrg;
        while (current && !industry) {
          const parent = allOrgs.find((o: any) => o.id === (current as any).parentId);
          if (parent) industry = (parent as any).industry || '';
          current = parent;
        }
      }
      if (!industry) {
        errorToast(null, 'The active organization (and its ancestors) has no industry set. Set it on the Organizations page first.');
        setGenerating(false);
        return;
      }
      const res = await apiClient.post<{ success: boolean; data: Array<{ name: string; description: string }> }>('/data-domains/generate', { industry });
      const suggestions = (res.data || []).map((d) => ({ ...d, selected: true }));
      if (suggestions.length === 0) {
        errorToast(null, 'AI returned no suggestions. Try a different industry.');
        setGenerating(false);
        return;
      }
      setGeneratedDomains(suggestions);
      setShowGeneratePreview(true);
    } catch (err) {
      errorToast(err, 'AI generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleApplyGenerated = async () => {
    const toCreate = generatedDomains.filter((d) => d.selected);
    if (toCreate.length === 0) { setShowGeneratePreview(false); return; }
    let created = 0;
    let skipped = 0;
    try {
      const results = await Promise.allSettled(toCreate.map((d) =>
        apiClient.post('/data-domains', {
          name: d.name,
          description: d.description,
          status: 'DRAFT',
          ...(activeOrgId ? { orgId: activeOrgId } : {}),
        }),
      ));
      const succeeded = toCreate.filter((_, i) => results[i].status === 'fulfilled');
      created = succeeded.length;
      skipped = toCreate.length - created;

      if (generateStewardshipTeams && succeeded.length > 0) {
        const parentId = await ensureGovernanceHierarchy();
        await Promise.all(succeeded.map((d) =>
          apiClient.post('/governance-groups', {
            name: `${d.name} Stewardship Team`,
            type: 'STEWARDSHIP_TEAM',
            description: `Data stewardship team responsible for the ${d.name} domain.`,
            status: 'ACTIVE',
            orgId: activeOrgId || undefined,
            parentId,
          }).catch(() => {}),
        ));
      }

      if (created > 0 && skipped > 0) {
        addToast('info', `Created ${created} domain${created === 1 ? '' : 's'}, skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}`);
      } else if (created > 0) {
        addToast('success', `Created ${created} domain${created === 1 ? '' : 's'}${generateStewardshipTeams ? ' with stewardship teams' : ''}`);
      } else {
        addToast('info', `All ${skipped} domain${skipped === 1 ? '' : 's'} already exist — nothing created`);
      }
      setShowGeneratePreview(false);
      setGeneratedDomains([]);
      fetchData();
    } catch (err) {
      errorToast(err, 'Failed to create domains');
    }
  };

  const statusBadgeStyle = (status: string): React.CSSProperties => {
    const c = getStatusColor(status);
    return {
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.color,
    };
  };

  const handleStatusChange = async (domainId: string, newStatus: string) => {
    try {
      await apiClient.put(`/data-domains/${domainId}`, { status: newStatus });
      addToast('success', `Status changed to ${newStatus.replace('_', ' ')}`);
      fetchData();
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to update status';
      addToast('error', msg);
    }
  };

  // Sort: comparators keyed by column name; URL persists ?sort=&dir=
  const { sorted: sortedDomains, sortKey, sortDir, toggleSort } = useSortedList(
    domains,
    {
      name: (a, b) => a.name.localeCompare(b.name),
      status: (a, b) => a.status.localeCompare(b.status),
      owner: (a, b) => (a.ownerName || '').localeCompare(b.ownerName || ''),
    },
    'name',
  );

  const hasFilters = !!(filterOwner || filterSteward || filterAsset || filterStatus);
  const filteredDomains = sortedDomains.filter((d) => {
    if (filterOwner === '__none__' && d.ownerId) return false;
    if (filterOwner === '__none__' && !d.ownerId) { /* pass */ }
    else if (filterOwner && filterOwner !== '__none__' && d.ownerId !== filterOwner) return false;
    if (filterSteward === '__none__' && d.stewardIds?.length > 0) return false;
    if (filterSteward === '__none__' && (!d.stewardIds || d.stewardIds.length === 0)) { /* pass */ }
    else if (filterSteward && filterSteward !== '__none__' && !d.stewardIds?.includes(filterSteward)) return false;
    if (filterAsset === '__none__' && d.dataAssetIds?.length > 0) return false;
    if (filterAsset === '__none__' && (!d.dataAssetIds || d.dataAssetIds.length === 0)) { /* pass */ }
    else if (filterAsset && filterAsset !== '__none__' && !d.dataAssetIds?.includes(filterAsset)) return false;
    if (filterStatus && d.status !== filterStatus) return false;
    return true;
  });

  const ownerOptions = [...new Map(domains.filter((d) => d.ownerId && d.ownerName).map((d) => [d.ownerId, d.ownerName!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const stewardOptions = [...new Map(domains.flatMap((d) => d.stewards || []).map((s) => [s.id, s.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const assetOptions = [...new Map(domains.flatMap((d) => d.assets || []).map((a) => [a.id, a.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const statusOptions = [...new Set(domains.map((d) => d.status))].sort();

  return (
    <div>
      {showPrereqs ? (
        <div style={{ position: 'relative' }}>
          <DependencyBanner phase="Domains depend on scope and principles being defined first." checks={[
            { label: 'Define governance scope', met: deps.hasScope, link: '/governance-program' },
            { label: 'Establish guiding principles', met: deps.hasPrinciples, link: '/governance-program' },
          ]} />
          <button
            onClick={() => setShowPrereqs(false)}
            title="Dismiss prerequisites"
            style={{
              position: 'absolute', top: 6, right: 8,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 14, lineHeight: 1, color: 'var(--color-text-muted)',
              padding: '2px 6px', borderRadius: 4,
            }}
          >
            {'×'}
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 8 }}>
          <button
            onClick={() => setShowPrereqs(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--color-primary)', padding: 0,
            }}
          >
            Show prerequisites
          </button>
        </div>
      )}
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Domains</h1>
            <InfoTip term="Data Domain" />
            <HelpPopover id="domains-intro" title="Data Domains">
              Domains group related data assets into governed categories (e.g. Customer Data, Financial Data).
              Each domain has an owner, stewards, and a scope definition. Status lifecycle applies —
              locked domains cannot be edited until moved back to Draft.
            </HelpPopover>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Organize data assets into governed domains with assigned owners and stewards.
          </p>
          {domains.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <span>{domains.length} domains</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span>{domains.filter((d) => d.ownerId).length} with owners</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span>{domains.filter((d) => d.stewardIds && d.stewardIds.length > 0).length} with stewards</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {domains.length > 0 && (
            <IconButton icon="trash" label="Delete all domains" variant="danger"
              onClick={() => setShowDeleteAll(true)} />
          )}
          {domains.length > 0 && (
            <IconButton icon="download" label="Export CSV"
              onClick={() => exportCsv('data-domains.csv', ['Name', 'Description', 'Owner', 'Stewards', 'Assets', 'Status'], domains.map((d) => [
                d.name,
                d.description,
                d.ownerName || '',
                d.stewards.map((s) => s.name).join('; '),
                d.assets.map((a) => a.name).join('; '),
                d.status,
              ]))} />
          )}
          {canWrite && (
            <IconButton
              icon="settings"
              label={
                generating ? 'Generating\u2026'
                : domains.length > 0 ? `Generate disabled — ${domains.length} domain${domains.length === 1 ? '' : 's'} already exist. Delete all to regenerate.`
                : 'Generate from industry'
              }
              disabled={generating || domains.length > 0}
              onClick={() => setConfirmGenerate(true)}
            />
          )}
          {canWrite && (
            <IconButton icon="plus" label="Add domain" variant="primary" onClick={openAdd} />
          )}
        </div>
      </div>

      {/* AI generation loading indicator */}
      {generating && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '2.5rem',
          textAlign: 'center',
          marginBottom: 20,
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12, animation: 'procelaGenSpin 2s linear infinite' }}>{'\u2699'}</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--color-primary)' }}>
            Generating data domains...
          </h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            AI is suggesting data domains based on your organization's industry. This usually takes 10{'\u2013'}20 seconds.
          </p>
          <style>{`@keyframes procelaGenSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Ownership gap warning */}
      {domains.length > 0 && (() => {
        const unownedCount = domains.filter((d) => !d.ownerId).length;
        if (unownedCount === 0) return null;
        return (
          <div style={{ padding: '8px 14px', marginBottom: 12, borderRadius: 'var(--radius-md)', background: '#fffbeb', border: '1px solid #fcd34d', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#92400e' }}>
            <span style={{ fontWeight: 700 }}>{unownedCount}</span> domain{unownedCount !== 1 ? 's have' : ' has'} no owner assigned
          </div>
        );
      })()}

      <ConfirmDialog
        open={confirmGenerate}
        title="Generate Data Domains with AI?"
        message="AI will suggest data domains based on your organization's industry. You'll see a preview where you can select which domains to create before anything is saved."
        confirmLabel="Generate"
        variant="primary"
        onConfirm={() => { setConfirmGenerate(false); handleGenerate(); }}
        onCancel={() => setConfirmGenerate(false)}
      />
      <ConfirmDialog
        open={showDeleteAll}
        title="Delete All Data Domains?"
        message={`This will permanently delete all ${domains.length} data domains. This cannot be undone.`}
        confirmLabel="Delete All"
        requireTypedConfirmation="DELETE"
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/data-domains/all');
          setSelectedDomain(null);
          setSelectedIds(new Set());
          fetchData();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Data Domains?"
        message={`Delete ${selectedIds.size} selected data domains? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Bulk Assign Dialog */}
      <ConfirmDialog
        open={bulkAssignType !== ''}
        title={bulkAssignType === 'owner'
          ? `Set owner for ${selectedIds.size} domain${selectedIds.size === 1 ? '' : 's'}`
          : `Add steward to ${selectedIds.size} domain${selectedIds.size === 1 ? '' : 's'}`}
        message=""
        confirmLabel={bulkAssignPersonId ? (bulkAssignType === 'owner' ? 'Set Owner' : 'Add Steward') : 'Select a person'}
        variant="primary"
        onConfirm={handleBulkAssign}
        onCancel={() => { setBulkAssignType(''); setBulkAssignPersonId(''); }}
      >
        <div style={{ marginTop: 8 }}>
          {bulkAssignType === 'steward' && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Steward Type</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['business', 'technical'] as const).map((t) => (
                  <button key={t} onClick={() => setBulkStewardRole(t)} style={{
                    padding: '5px 14px', fontSize: 12, fontWeight: bulkStewardRole === t ? 600 : 500,
                    background: bulkStewardRole === t ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: bulkStewardRole === t ? '#fff' : 'var(--color-text-secondary)',
                    border: bulkStewardRole === t ? 'none' : '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', cursor: 'pointer', textTransform: 'capitalize',
                  }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Person</label>
          <select
            style={{ ...selectStyle, appearance: 'auto' as any }}
            value={bulkAssignPersonId}
            onChange={(e) => setBulkAssignPersonId(e.target.value)}
          >
            <option value="">-- Select person --</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </ConfirmDialog>

      {/* Bulk Status Dialog */}
      <ConfirmDialog
        open={bulkStatusOpen}
        title={`Set status for ${selectedIds.size} domain${selectedIds.size === 1 ? '' : 's'}`}
        message=""
        confirmLabel={bulkStatusValue ? `Set to ${bulkStatusValue}` : 'Select a status'}
        variant="primary"
        onConfirm={handleBulkStatus}
        onCancel={() => { setBulkStatusOpen(false); setBulkStatusValue(''); }}
      >
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            This will change the status for all selected domains. Status lifecycle rules are bypassed for bulk operations.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {['DRAFT', 'ACTIVE', 'DEPRECATED'].map((s) => (
              <label key={s} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                background: bulkStatusValue === s ? '#eff6ff' : 'var(--color-bg)',
                border: `1px solid ${bulkStatusValue === s ? '#93c5fd' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
              }}>
                <input type="radio" name="bulkStatus" checked={bulkStatusValue === s} onChange={() => setBulkStatusValue(s)} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: s === 'ACTIVE' ? '#22c55e' : s === 'DEPRECATED' ? '#ef4444' : '#9ca3af',
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.charAt(0) + s.slice(1).toLowerCase()}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Data Domain?"
        message={
          deleteImpact && (deleteImpact.assets > 0 || deleteImpact.stewards > 0)
            ? `This will permanently delete this data domain. This domain has ${deleteImpact.assets} data asset${deleteImpact.assets !== 1 ? 's' : ''} and ${deleteImpact.stewards} steward${deleteImpact.stewards !== 1 ? 's' : ''} assigned. This cannot be undone.`
            : 'This will permanently delete this data domain. This cannot be undone.'
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          const id = confirmDelete;
          setConfirmDelete(null);
          setDeleteImpact(null);
          if (id) await handleDelete(id);
        }}
        onCancel={() => { setConfirmDelete(null); setDeleteImpact(null); }}
      />

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Data Domain' : 'Add New Data Domain'}
          </h3>
          <UnsavedBanner visible={isDirty()} onSave={handleSave} onDiscard={closeForm} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input
                autoFocus
                style={inputStyle}
                value={form.name}
                onChange={(e) => { markDirty(); setForm({ ...form, name: e.target.value }); }}
                placeholder="e.g. Customer Data, Financial Data"
              />
            </div>
            {!editingId && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
                <select style={selectStyle} value="DRAFT" disabled>
                  <option value="DRAFT">Draft</option>
                </select>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2, display: 'block' }}>New domains start as Draft</span>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => { markDirty(); setForm({ ...form, description: e.target.value }); }}
                placeholder="Describe the purpose and scope of this data domain"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>Scope Definition <HelpPopover id="domain-scope" title="Scope Definition">Define what data falls inside and outside this domain. Clear boundaries prevent overlap and ensure every asset has a governance home.</HelpPopover></label>
              <input
                style={inputStyle}
                value={form.scopeDefinition}
                onChange={(e) => { markDirty(); setForm({ ...form, scopeDefinition: e.target.value }); }}
                placeholder="What data falls in/out of this domain? e.g. All customer-facing data excluding internal analytics"
              />
            </div>
          </div>
          {!editingId && (
            <div style={{
              marginTop: 16, padding: '12px 14px',
              background: 'var(--color-bg)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <input
                type="checkbox"
                id="create-stewardship-team"
                checked={createStewardshipTeam}
                onChange={(e) => setCreateStewardshipTeam(e.target.checked)}
                style={{ marginTop: 2, cursor: 'pointer' }}
              />
              <label htmlFor="create-stewardship-team" style={{ cursor: 'pointer' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  Create a Data Stewardship Team for this domain
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                  A stewardship team is responsible for data quality, standards compliance, and issue resolution within this domain. You can assign members after creation under Governance Groups.
                </div>
              </label>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1, cursor: !form.name.trim() ? 'not-allowed' : 'pointer' }}
              disabled={!form.name.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Domain'}
            </button>
          </div>
        </div>
      )}

      {/* Master-detail grid layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left column: filters + table + bulk action bar */}
        <div>
          {/* Filters */}
          {domains.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <select style={{ ...selectStyle, width: 'auto', minWidth: 140, fontSize: 12, padding: '5px 8px' }} value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)}>
                <option value="">All Owners</option>
                <option value="__none__">No Owner</option>
                {ownerOptions.map(([id, name]) => <option key={id} value={id!}>{name}</option>)}
              </select>
              <select style={{ ...selectStyle, width: 'auto', minWidth: 140, fontSize: 12, padding: '5px 8px' }} value={filterSteward} onChange={(e) => setFilterSteward(e.target.value)}>
                <option value="">All Stewards</option>
                <option value="__none__">No Stewards</option>
                {stewardOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select style={{ ...selectStyle, width: 'auto', minWidth: 140, fontSize: 12, padding: '5px 8px' }} value={filterAsset} onChange={(e) => setFilterAsset(e.target.value)}>
                <option value="">All Assets</option>
                <option value="__none__">No Assets</option>
                {assetOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select style={{ ...selectStyle, width: 'auto', minWidth: 120, fontSize: 12, padding: '5px 8px' }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All Statuses</option>
                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {hasFilters && (
                <button onClick={() => { setFilterOwner(''); setFilterSteward(''); setFilterAsset(''); setFilterStatus(''); }} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer', padding: '4px 8px' }}>
                  Clear
                </button>
              )}
              {hasFilters && (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Showing {filteredDomains.length} of {domains.length}
                </span>
              )}
            </div>
          )}

          {/* Table */}
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
            {loading ? (
              <SkeletonRows rows={5} columns={4} />
            ) : domains.length === 0 && !showForm ? (
              <EmptyState
                icon={'\u2637'}
                title="No data domains defined yet"
                description="Data domains group related data assets under a single governance umbrella \u2014 owner, stewards, policies. Start with the big buckets (Customer, Finance, Product) and refine later."
                action={{ label: '+ Add Domain', onClick: openAdd }}
              />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    <th style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                      <input type="checkbox"
                        checked={domains.length > 0 && selectedIds.size === domains.length}
                        onChange={toggleSelectAll} />
                    </th>
                    <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Name</SortableTh>
                    <SortableTh sortKey="status" active={sortKey} dir={sortDir} onClick={toggleSort}>Status</SortableTh>
                    <th style={{ ...thStyle, width: 100, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hasFilters && filteredDomains.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                        No domains match your filters. <button onClick={() => { setFilterOwner(''); setFilterSteward(''); setFilterAsset(''); setFilterStatus(''); }} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 13 }}>Clear filters</button>
                      </td>
                    </tr>
                  ) : (
                    filteredDomains.map((domain) => {
                      const isSelected = selectedIds.has(domain.id);
                      const hasOwner = !!domain.ownerId;
                      const hasStewards = domain.stewards.length > 0;
                      const hasAssets = domain.assets.length > 0;
                      return (
                      <tr key={domain.id} style={{ transition: 'background 0.1s', cursor: 'pointer', background: isSelected ? '#f0f9ff' : selectedDomain?.id === domain.id ? '#f5f3ff' : '' }}
                        onMouseEnter={(e) => { if (!isSelected && selectedDomain?.id !== domain.id) e.currentTarget.style.background = 'var(--color-bg)'; }}
                        onMouseLeave={(e) => { if (!isSelected && selectedDomain?.id !== domain.id) e.currentTarget.style.background = ''; }}>
                        <td style={{ ...tdStyle, textAlign: 'center', width: 32 }} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(domain.id)} />
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 500 }} onClick={() => openDetail(domain)}>
                          <span style={{ color: 'var(--color-primary)' }}>{domain.name}</span>
                          <span style={{ display: 'inline-flex', gap: 3, marginLeft: 8, verticalAlign: 'middle' }}>
                            <span
                              style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: hasOwner ? '#22c55e' : '#d1d5db' }}
                              title={hasOwner ? 'Owner assigned' : 'No owner'}
                            />
                            <span
                              style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: hasStewards ? '#22c55e' : '#d1d5db' }}
                              title={hasStewards ? 'Stewards assigned' : 'No stewards'}
                            />
                            <span
                              style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: hasAssets ? '#22c55e' : '#d1d5db' }}
                              title={hasAssets ? 'Assets linked' : 'No assets'}
                            />
                          </span>
                        </td>
                        <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                          <select
                            value={domain.status}
                            onChange={(e) => { if (e.target.value !== domain.status) handleStatusChange(domain.id, e.target.value); }}
                            style={{ ...statusBadgeStyle(domain.status), border: 'none', cursor: 'pointer', appearance: 'auto' as any, paddingRight: 16 }}
                          >
                            <option value={domain.status}>{domain.status.replace('_', ' ')}</option>
                            {((statusMode === 'advanced' ? ADVANCED_TRANSITIONS : SIMPLE_TRANSITIONS)[domain.status] || []).map((s) => (
                              <option key={s} value={s}>{s.replace('_', ' ')}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            {!(statusMode === 'advanced' ? ADVANCED_LOCKED : SIMPLE_LOCKED).has(domain.status) && (
                              <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(domain)} />
                            )}
                            {!(statusMode === 'advanced' ? ADVANCED_LOCKED : SIMPLE_LOCKED).has(domain.status) && (
                              <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={async () => {
                                try {
                                  const res = await apiClient.get<{ success: boolean; data: { assets: number; stewards: number } }>(`/data-domains/${domain.id}/impact`);
                                  setDeleteImpact(res.data || null);
                                } catch { setDeleteImpact(null); }
                                setConfirmDelete(domain.id);
                              }} />
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Bulk Action Bar */}
          {selectedIds.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginTop: 12,
              background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedIds.size} selected</span>
              <button
                onClick={() => setBulkAssignType('owner')}
                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
              >
                Set Owner\u2026
              </button>
              <button
                onClick={() => setBulkAssignType('steward')}
                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
              >
                Add Steward\u2026
              </button>
              <button
                onClick={() => setBulkStatusOpen(true)}
                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
              >
                Set Status\u2026
              </button>
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
            </div>
          )}
        </div>

        {/* Right column: detail panel */}
        <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
          {selectedDomain ? (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>
                  {selectedDomain.name} \u2014 Governance Details
                </h3>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--color-text-muted)' }} onClick={() => setSelectedDomain(null)} title="Close">
                  x
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Owner */}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Owner (Data Owner)</label>
                  <select style={selectStyle} value={detailOwnerId} onChange={(e) => setDetailOwnerId(e.target.value)}>
                    <option value="">-- Unassigned --</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                {/* Stewards */}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
                    Stewards ({detailStewardIds.length} selected)
                  </label>
                  <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4, padding: 8, background: 'var(--color-bg)' }}>
                    {people.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 4 }}>No people available</div>
                    ) : people.map((p) => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '3px 0', cursor: 'pointer' }}>
                        <input type="checkbox" checked={detailStewardIds.includes(p.id)} onChange={() => toggleSteward(p.id)} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Data Assets */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
                    Data Assets ({detailAssetIds.length} assigned)
                  </label>
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4, padding: 8, background: 'var(--color-bg)' }}>
                    {allAssets.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 4 }}>No data assets available. Create data assets first.</div>
                    ) : allAssets.map((a) => (
                      <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '3px 0', cursor: 'pointer' }}>
                        <input type="checkbox" checked={detailAssetIds.includes(a.id)} onChange={() => toggleAsset(a.id)} />
                        {a.name}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Scope */}
                {(selectedDomain as any).scopeDefinition && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Scope Definition</label>
                    <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>{(selectedDomain as any).scopeDefinition}</p>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button style={btnSecondary} onClick={() => setSelectedDomain(null)}>Close</button>
                <button style={btnPrimary} onClick={handleDetailSave}>Save Governance Details</button>
              </div>
            </div>
          ) : (
            <div style={{
              background: 'var(--color-surface)', border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-md)', padding: '3rem 2rem', textAlign: 'center',
              color: 'var(--color-text-muted)', fontSize: 13,
            }}>
              Select a domain to view and edit governance details
            </div>
          )}
        </div>
      </div>

      {/* AI Generate Preview Modal */}
      {showGeneratePreview && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1050,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowGeneratePreview(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-surface)',
              borderRadius: 10,
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
              padding: 24,
              maxWidth: 600, width: '92vw', maxHeight: '85vh', overflowY: 'auto',
            }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Suggested Data Domains</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
              AI-generated based on your organization's industry. Uncheck any you don't need; the rest will be created as DRAFT domains.
            </p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button
                onClick={() => setGeneratedDomains((prev) => prev.map((d) => ({ ...d, selected: true })))}
                style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 500, padding: 0 }}
              >
                Select all
              </button>
              <span style={{ color: 'var(--color-text-muted)' }}>{'|'}</span>
              <button
                onClick={() => setGeneratedDomains((prev) => prev.map((d) => ({ ...d, selected: false })))}
                style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontWeight: 500, padding: 0 }}
              >
                Deselect all
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {generatedDomains.map((d, i) => (
                <label
                  key={i}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    padding: '10px 12px', borderRadius: 6,
                    border: '1px solid var(--color-border)',
                    background: d.selected ? 'var(--color-primary-light)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={d.selected}
                    onChange={() => setGeneratedDomains((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)),
                    )}
                    style={{ marginTop: 3, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{d.description}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{
              marginTop: 16, padding: '10px 12px',
              background: 'var(--color-bg)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <input
                type="checkbox"
                id="generate-stewardship-teams"
                checked={generateStewardshipTeams}
                onChange={(e) => setGenerateStewardshipTeams(e.target.checked)}
                style={{ marginTop: 2, cursor: 'pointer' }}
              />
              <label htmlFor="generate-stewardship-teams" style={{ cursor: 'pointer' }}>
                <div style={{ fontSize: 12, fontWeight: 500 }}>Also create a Data Stewardship Team for each domain</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>Assign members later under Governance Groups</div>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button
                onClick={() => setShowGeneratePreview(false)}
                style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleApplyGenerated}
                disabled={generatedDomains.filter((d) => d.selected).length === 0}
                style={{
                  padding: '8px 18px', fontSize: 13, fontWeight: 500,
                  background: generatedDomains.some((d) => d.selected) ? 'var(--color-primary)' : '#e5e7eb',
                  color: generatedDomains.some((d) => d.selected) ? '#fff' : '#9ca3af',
                  border: 'none', borderRadius: 6,
                  cursor: generatedDomains.some((d) => d.selected) ? 'pointer' : 'not-allowed',
                }}
              >
                Create {generatedDomains.filter((d) => d.selected).length} domain{generatedDomains.filter((d) => d.selected).length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
