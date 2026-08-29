import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import { INDUSTRIES } from '../types';
import { clickable } from '../lib/a11y';
import { useOrgContext } from '../stores/orgContext';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import { usePermissions } from '../hooks/usePermissions';
import { useAiEnabled } from '../stores/aiConfigStore';
import { useToastStore } from '../stores/toastStore';
import ExportMenu from '../components/ExportMenu';
import { errorMessage, errorToast } from '../lib/errorToast';
import { getStatusColor } from '../lib/statusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import HelpPopover from '../components/HelpPopover';
import { SkeletonRows } from '../components/Skeleton';
import PersonPicker from '../components/PersonPicker';
import { formatPersonLabel } from '../lib/personLabel';
import { useRefreshOnFocus } from '../hooks/usePolling';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface DataDomain {
  id: string; orgId: string; name: string; description: string;
  ownerId: string | null; ownerName: string | null;
  stewardIds: string[]; stewards: { id: string; name: string }[];
  dataAssetIds: string[]; assets: { id: string; name: string }[];
  status: string; scopeDefinition?: string; criticality?: string;
  createdAt: string; updatedAt: string;
}
interface Person { id: string; name: string; }
interface DataAssetOption { id: string; name: string; }

const inputStyle: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)' };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' };

interface FormData { name: string; description: string; status: string; criticality: string; }
const emptyForm: FormData = { name: '', description: '', status: 'DRAFT', criticality: '' };

const SIMPLE_TRANSITIONS: Record<string, string[]> = { DRAFT: ['ACTIVE'], ACTIVE: ['DRAFT', 'DEPRECATED'], DEPRECATED: ['DRAFT'] };
const ADVANCED_TRANSITIONS: Record<string, string[]> = { DRAFT: ['PROPOSED'], PROPOSED: ['UNDER_REVIEW', 'DRAFT'], UNDER_REVIEW: ['APPROVED', 'DRAFT'], APPROVED: ['ACTIVE', 'DRAFT'], ACTIVE: ['DRAFT', 'DEPRECATED'], DEPRECATED: ['DRAFT'] };

function statusDot(status: string): React.CSSProperties {
  const c = getStatusColor(status);
  return { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 };
}

function healthDots(domain: DataDomain) {
  const hasOwner = !!domain.ownerId;
  const hasStewards = domain.stewards.length > 0;
  const hasAssets = domain.assets.length > 0;
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: hasOwner ? '#22c55e' : '#d1d5db' }} title={hasOwner ? 'Owner assigned' : 'No owner'} />
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: hasStewards ? '#22c55e' : '#d1d5db' }} title={hasStewards ? 'Stewards assigned' : 'No stewards'} />
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: hasAssets ? '#22c55e' : '#d1d5db' }} title={hasAssets ? 'Assets linked' : 'No assets'} />
    </span>
  );
}

// Shared style for "Owner" / "Stewards" labels that open the Role Detail
// drawer. Looks like a label, hints clickability with a dotted underline.
const roleLabelBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0,
  color: 'inherit', font: 'inherit', cursor: 'pointer',
  textDecoration: 'underline', textDecorationStyle: 'dotted',
  textUnderlineOffset: 3,
};

export default function DataDomainsPage() {
  const { activeOrgId } = useOrgContext();
  const openRoleDrawer = useRoleDrawerStore((s) => s.open);
  const { canWrite } = usePermissions();
  const aiEnabled = useAiEnabled();
  const { addToast } = useToastStore();
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [allAssets, setAllAssets] = useState<DataAssetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [statusMode, setStatusMode] = useState<'simple' | 'advanced'>('simple');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<{ assets: number; stewards: number } | null>(null);
  const [createStewardshipTeam, setCreateStewardshipTeam] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

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

  // Detail editing
  const [detailOwnerId, setDetailOwnerId] = useState('');
  const [detailStewardIds, setDetailStewardIds] = useState<string[]>([]);
  const [detailAssetIds, setDetailAssetIds] = useState<string[]>([]);
  const [assetSearch, setAssetSearch] = useState('');

  // AI generate
  const [generating, setGenerating] = useState(false);
  const [generatedDomains, setGeneratedDomains] = useState<Array<{ name: string; description: string; selected: boolean }>>([]);
  const [showGeneratePreview, setShowGeneratePreview] = useState(false);
  const [generateStewardshipTeams, setGenerateStewardshipTeams] = useState(true);
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

  const selectedDomain = selectedDomainId ? domains.find((d) => d.id === selectedDomainId) || null : null;

  useEffect(() => {
    if (!selectedDomainId && filteredDomains.length > 0) setSelectedDomainId(filteredDomains[0].id);
    else if (selectedDomainId && !filteredDomains.find((d) => d.id === selectedDomainId) && filteredDomains.length > 0) setSelectedDomainId(filteredDomains[0].id);
  }, [filteredDomains, selectedDomainId]);

  const openDetail = (domain: DataDomain) => {
    setSelectedDomainId(domain.id);
    setDetailOwnerId(domain.ownerId || '');
    setDetailStewardIds(domain.stewardIds || []);
    setDetailAssetIds(domain.dataAssetIds || []);
    setAssetSearch('');
    setShowForm(false);
  };

  // Auto-sync detail state when selectedDomain changes
  useEffect(() => {
    if (selectedDomain) {
      setDetailOwnerId(selectedDomain.ownerId || '');
      setDetailStewardIds(selectedDomain.stewardIds || []);
      setDetailAssetIds(selectedDomain.dataAssetIds || []);
    }
  }, [selectedDomain]);

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm); setEditingId(null); setCreateStewardshipTeam(true); setShowForm(true);
  };
  const openEdit = (domain: DataDomain) => {
    setForm({ name: domain.name, description: domain.description, status: domain.status, criticality: domain.criticality || '' });
    setEditingId(domain.id); setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

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

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      if (editingId) {
        await apiClient.put(`/data-domains/${editingId}`, form);
        addToast('success', 'Domain updated');
      } else {
        await apiClient.post('/data-domains', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
        addToast('success', 'Domain created');
        if (createStewardshipTeam) {
          try {
            const parentId = await ensureGovernanceHierarchy();
            await apiClient.post('/governance-groups', { name: `${form.name.trim()} Stewardship Team`, type: 'STEWARDSHIP_TEAM', description: `Stewardship team for the ${form.name.trim()} domain.`, status: 'ACTIVE', orgId: activeOrgId, parentId });
            addToast('success', `Stewardship team created for ${form.name.trim()}`);
          } catch { addToast('error', 'Domain created, but stewardship team creation failed'); }
        }
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

  const handleDetailSave = async () => {
    if (!selectedDomain) return;
    await apiClient.put(`/data-domains/${selectedDomain.id}`, { ownerId: detailOwnerId || null, stewardIds: detailStewardIds, dataAssetIds: detailAssetIds });
    addToast('success', 'Governance details saved'); fetchData();
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

  const handleGenerate = async () => {
    if (!activeOrgId) { errorToast(null, 'Select an organization first.'); return; }
    const detected = await detectIndustry();
    if (!detected) {
      // Nothing on the org or any visible ancestor — let the user pick
      // one inline so they're not stuck. They can also use this to
      // override the auto-detected industry (see the IconButton menu).
      setPickedIndustry(INDUSTRIES[0]);
      setIndustryPickerOpen(true);
      return;
    }
    await generateForIndustry(detected);
  };

  // Actually fire the /generate call once we know which industry to
  // ask Claude about. Surface the raw model response when extraction
  // failed so the operator can see what came back.
  const generateForIndustry = async (industry: string) => {
    setGenerating(true);
    try {
      const res = await apiClient.post<{ success: boolean; data: Array<{ name: string; description: string }> }>('/data-domains/generate', { industry });
      const suggestions = (res.data || []).map((d) => ({ ...d, selected: true }));
      if (suggestions.length === 0) {
        errorToast(null, 'No suggestions returned. Retry — Claude occasionally returns prose; a retry usually fixes it.');
        return;
      }
      setGeneratedDomains(suggestions);
      setShowGeneratePreview(true);
    } catch (err: any) {
      const snippet = err?.body?.rawSnippet ? `\n\n— AI returned: ${err.body.rawSnippet}` : '';
      errorToast(err, `Generation failed.${snippet}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleApplyGenerated = async () => {
    const toCreate = generatedDomains.filter((d) => d.selected);
    if (toCreate.length === 0) { setShowGeneratePreview(false); return; }
    try {
      const results = await Promise.allSettled(toCreate.map((d) => apiClient.post('/data-domains', { name: d.name, description: d.description, status: 'DRAFT', ...(activeOrgId ? { orgId: activeOrgId } : {}) })));
      const created = results.filter((r) => r.status === 'fulfilled').length;
      if (generateStewardshipTeams && created > 0) {
        const parentId = await ensureGovernanceHierarchy();
        await Promise.all(toCreate.filter((_, i) => results[i].status === 'fulfilled').map((d) =>
          apiClient.post('/governance-groups', { name: `${d.name} Stewardship Team`, type: 'STEWARDSHIP_TEAM', status: 'ACTIVE', orgId: activeOrgId, parentId }).catch(() => {})
        ));
      }
      addToast('success', `Created ${created} domain${created !== 1 ? 's' : ''}${generateStewardshipTeams ? ' with stewardship teams' : ''}`);
      setShowGeneratePreview(false); setGeneratedDomains([]); fetchData();
    } catch (err) { errorToast(err, 'Failed to create domains'); }
  };

  const transitions = statusMode === 'advanced' ? ADVANCED_TRANSITIONS : SIMPLE_TRANSITIONS;
  const unownedCount = domains.filter((d) => !d.ownerId).length;

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Data Domains"
        subtitle="Organize data assets into governed domains with assigned owners and stewards."
        actions={
          <>
            {canWrite && aiEnabled && domains.length === 0 && (
              <IconButton icon="wand" label={generating ? 'Generating…' : 'Generate from Industry'} disabled={generating} onClick={handleGenerate} />
            )}
            {domains.length > 0 && (
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
            )}
            {canWrite && <IconButton icon="plus" label="Add domain" variant="primary" onClick={openAdd} />}
          </>
        }
      >
        <HelpPopover id="domains-intro" title="Data Domains">
          Domains group related data assets into governed categories (e.g. Customer Data, Financial Data).
          Each domain has an owner, stewards, and a scope definition.
        </HelpPopover>
      </PageHeader>

      {/* Ownership gap warning */}
      {unownedCount > 0 && (
        <div style={{ padding: '8px 14px', marginBottom: 12, borderRadius: 'var(--radius-md)', background: '#fffbeb', border: '1px solid #fcd34d', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#92400e' }}>
          <span style={{ fontWeight: 700 }}>{unownedCount}</span> domain{unownedCount !== 1 ? 's have' : ' has'} no owner assigned
        </div>
      )}

      <ConfirmDialog open={confirmDelete !== null} title="Delete Data Domain?"
        message={deleteImpact && (deleteImpact.assets > 0 || deleteImpact.stewards > 0)
          ? `This domain has ${deleteImpact.assets} asset${deleteImpact.assets !== 1 ? 's' : ''} and ${deleteImpact.stewards} steward${deleteImpact.stewards !== 1 ? 's' : ''}. This cannot be undone.`
          : 'This will permanently delete this data domain.'}
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
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingId ? 'Edit Data Domain' : 'Add New Data Domain'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus aria-label="Name" style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Customer Data" /></div>
            <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
              {editingId ? (
                <select aria-label="Status" style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value={form.status}>{form.status}</option>
                  {(transitions[form.status] || []).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <select aria-label="Status" style={selectStyle} value="DRAFT" disabled><option value="DRAFT">Draft</option></select>
              )}
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
            {/* Description absorbed the former "Scope Definition" field. */}
            <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input aria-label="Description" style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Purpose and scope — what this domain is and what data falls in/out of it" /></div>
          </div>
          {!editingId && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <input type="checkbox" checked={createStewardshipTeam} onChange={(e) => setCreateStewardshipTeam(e.target.checked)} style={{ marginTop: 2 }} />
              <div><div style={{ fontSize: 12, fontWeight: 500 }}>Create a Stewardship Team for this domain</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>Assign members later under Governance Groups.</div></div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button variant="primary" disabled={!form.name.trim()} onClick={handleSave}>{editingId ? 'Save Changes' : 'Add Domain'}</Button>
          </div>
        </Card>
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
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Left: Domain index */}
          <Card padding={0} shadow="none" style={{ overflow: 'hidden', position: 'sticky', top: 12, maxHeight: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
              <input aria-label="Search domains" style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }} placeholder="Search domains..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              {canWrite && filteredDomains.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
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
                  <span>{bulkSelectedIds.size > 0 ? `${bulkSelectedIds.size} selected` : 'Select all visible'}</span>
                  {bulkSelectedIds.size > 0 && (
                    <button onClick={clearBulkSelection} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 11, padding: 0 }}>Clear</button>
                  )}
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredDomains.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>No domains match.</div>
              ) : filteredDomains.map((d) => {
                const isActive = selectedDomainId === d.id;
                const isChecked = bulkSelectedIds.has(d.id);
                return (
                  <div key={d.id} {...clickable(() => openDetail(d), { label: `Open domain ${d.name}` })} style={{
                    padding: '10px 12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: isActive ? '#dbeafe' : isChecked ? '#f0f9ff' : 'transparent',
                    borderBottom: '1px solid var(--color-border)',
                    borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                    transition: 'background 0.1s',
                  }}
                    onMouseEnter={(e) => { if (!isActive && !isChecked) e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { if (!isActive && !isChecked) e.currentTarget.style.background = 'transparent'; }}>
                    {canWrite && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${d.name}`}
                        checked={isChecked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleBulkSelect(d.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    )}
                    <span style={statusDot(d.status)} title={d.status} />
                    {/* Domain name only — matches the flat one-line
                        list style on Systems / Data Assets / People.
                        Asset count and owner used to sit under the
                        name; they added row height and pushed rows
                        out of alignment for the row-height-uniform
                        rule the rest of the app follows. Both signals
                        are still visible on the detail panel to the
                        right when a domain is selected. */}
                    <div
                      style={{
                        flex: 1, minWidth: 0,
                        fontSize: 13, fontWeight: isActive ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {d.name}
                    </div>
                    {healthDots(d)}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-muted)', background: 'var(--color-bg)' }}>
              {filteredDomains.length} of {domains.length} domains
            </div>
          </Card>

          {/* Right: Domain detail (or bulk edit panel) */}
          <Card padding={0} shadow="none" style={{ minHeight: 400 }}>
            {bulkSelectedIds.size > 0 ? (
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
            ) : selectedDomain ? (
              <div style={{ padding: '24px 28px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{selectedDomain.name}</h2>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, ...(() => { const c = getStatusColor(selectedDomain.status); return { background: c.bg, color: c.color }; })() }}>{selectedDomain.status}</span>
                    </div>
                    {selectedDomain.description && <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6, margin: 0 }}>{selectedDomain.description}</p>}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(selectedDomain)} />}
                    {canWrite && (
                      <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={async () => {
                        try { const r = await apiClient.get<{ success: boolean; data: { assets: number; stewards: number } }>(`/data-domains/${selectedDomain.id}/impact`); setDeleteImpact(r.data || null); } catch { setDeleteImpact(null); }
                        setConfirmDelete(selectedDomain.id);
                      }} />
                    )}
                  </div>
                </div>

                {/* Status lifecycle */}
                {canWrite && (transitions[selectedDomain.status] || []).length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={labelStyle}>Status Transitions</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(transitions[selectedDomain.status] || []).map((s) => (
                        <Button key={s} variant="secondary" size="sm" onClick={() => handleStatusChange(selectedDomain.id, s)}>{s.replace(/_/g, ' ')}</Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Owner — the label opens the Role Detail drawer for
                  *  Data Domain Owner so users learn the role's
                  *  responsibilities and typical decision authority. */}
                <div style={{ marginBottom: 20 }}>
                  <div style={labelStyle}>
                    <button
                      type="button"
                      onClick={() => openRoleDrawer('DATA_DOMAIN_OWNER')}
                      title="Learn about this role"
                      style={roleLabelBtnStyle}
                    >
                      Owner (Data Domain Owner)
                    </button>
                  </div>
                  <PersonPicker
                    mode="single"
                    valueMode="id"
                    value={detailOwnerId || null}
                    onChange={(pid) => setDetailOwnerId(pid || '')}
                    placeholder="-- Unassigned --"
                  />
                </div>

                {/* Stewards */}
                <div style={{ marginBottom: 20 }}>
                  <div style={labelStyle}>
                    <button
                      type="button"
                      onClick={() => openRoleDrawer('DATA_DOMAIN_STEWARD')}
                      title="Learn about this role"
                      style={roleLabelBtnStyle}
                    >
                      Stewards ({detailStewardIds.length})
                    </button>
                  </div>
                  <PersonPicker
                    mode="multi"
                    valueMode="id"
                    value={detailStewardIds}
                    onChange={(ids) => setDetailStewardIds(ids as string[])}
                    placeholder="Add stewards…"
                  />
                </div>

                {/* Data Assets */}
                <div style={{ marginBottom: 20 }}>
                  <div style={labelStyle}>Data Assets ({detailAssetIds.length})</div>
                  <input aria-label="Search assets" style={{ ...inputStyle, fontSize: 12, marginBottom: 6 }} placeholder="Search assets..." value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} />
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4, padding: 6, background: 'var(--color-bg)' }}>
                    {allAssets.filter((a) => !assetSearch || a.name.toLowerCase().includes(assetSearch.toLowerCase())).map((a) => (
                      <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 4px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={detailAssetIds.includes(a.id)} onChange={() => setDetailAssetIds((prev) => prev.includes(a.id) ? prev.filter((id) => id !== a.id) : [...prev, a.id])} />
                        {a.name}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Save */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button variant="primary" onClick={handleDetailSave}>Save Governance Details</Button>
                </div>

                {/* Timestamps */}
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 16 }}>
                  Created {new Date(selectedDomain.createdAt).toLocaleDateString()} · Updated {new Date(selectedDomain.updatedAt).toLocaleDateString()}
                </div>
              </div>
            ) : (
              <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Select a domain from the list to view and edit its governance details.</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* AI Generate Preview Modal */}
      {/* Industry picker — opens when the active org and its visible
          ancestors carry no `industry`, so the user can still kick off
          a generation. Common for division/department-scoped admins
          whose parent company isn't in their visible org set. */}
      {industryPickerOpen && (
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
                  setIndustryPickerOpen(false);
                  if (chosen) await generateForIndustry(chosen);
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
                {generating ? 'Generating…' : 'Generate domains'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showGeneratePreview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowGeneratePreview(false)}>
          <div ref={generatePreviewRef} role="dialog" aria-modal="true" aria-label="Generated domains preview" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', padding: 24, maxWidth: 600, width: '92vw', maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Suggested Data Domains</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>Uncheck any you don't need; the rest will be created as DRAFT domains.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {generatedDomains.map((d, i) => (
                <label key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border)', background: d.selected ? '#f0f9ff' : 'transparent', cursor: 'pointer' }}>
                  <input type="checkbox" checked={d.selected} onChange={() => setGeneratedDomains((p) => p.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))} style={{ marginTop: 3 }} />
                  <div><div style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</div><div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{d.description}</div></div>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={generateStewardshipTeams} onChange={(e) => setGenerateStewardshipTeams(e.target.checked)} />
              <div><div style={{ fontSize: 12, fontWeight: 500 }}>Also create Stewardship Teams</div></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <Button variant="secondary" onClick={() => setShowGeneratePreview(false)}>Cancel</Button>
              <Button variant="primary" disabled={!generatedDomains.some((d) => d.selected)} onClick={handleApplyGenerated}>
                Create {generatedDomains.filter((d) => d.selected).length} Domains
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
