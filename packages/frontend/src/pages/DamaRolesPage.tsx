import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import ExportMenu from '../components/ExportMenu';
import SavedViewsMenu from '../components/SavedViewsMenu';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import { useToastStore } from '../stores/toastStore';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import PageHeader from '../components/PageHeader';
import SectionCard from '../components/SectionCard';
import PersonPicker from '../components/PersonPicker';
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';
import { useRefreshOnFocus } from '../hooks/usePolling';
import { SkeletonRows } from '../components/Skeleton';
import { clickable } from '../lib/a11y';
import { GOVERNANCE_ROLES, PEOPLE_ONLY_ROLE_TYPES, PEOPLE_ONLY_REASON } from '../types';

// Required governance roles (CDO, Data Governance Lead, Data Owner,
// Business Data Steward). A required role with zero holders is a
// staffing gap worth shouting about, so its card gets the red
// treatment; optional roles stay quiet when empty.
const REQUIRED_ROLE_TYPES = new Set(GOVERNANCE_ROLES.filter((r) => r.required).map((r) => r.roleType));

// Category display order for the grouped By-Role view.
const CATEGORY_ORDER = ['Executive', 'Business', 'Technical', 'Entity-attached'] as const;

interface DamaRoleAssignment {
  id: string;
  personId: string | null;
  personName: string | null;
  // Agent holders ride the same row shape — exactly one of
  // (personId, agentId) is set on any assignment.
  agentId?: string | null;
  agentName?: string | null;
  roleType: string;
  scopeType: 'ORG';
  scopeId: string;
  since: string;
  createdAt: string;
}

interface Person {
  id: string;
  name: string;
}

interface OrgOption {
  id: string;
  name: string;
}

interface DomainOption {
  id: string;
  name: string;
  ownerId?: string | null;
  stewardIds?: string[];
}

interface SystemOption {
  id: string;
  name: string;
  ownerPersonId?: string | null;
  deputyOwnerId?: string | null;
  custodianIds?: string[];
}

interface AssetOption {
  id: string;
  name: string;
  ownerPersonId?: string | null;
  stewardIds?: string[];
}

// ── Entity-scoped role catalogue ────────────────────────────────────────
//
// Each entry tells the matrix renderer which entity type this role
// attaches to and where its holders live:
//
//   storage: 'entity' — holder ids live directly on the host record
//     (Domain.ownerId, System.custodianIds, DataAsset.stewardIds, …).
//     Assignments are edited on the source page; the matrix drills in
//     and the +Assign link routes there.
//
//   storage: 'dama' — holders are DAMA role assignments with
//     scopeType='DOMAIN' and scopeId=domain.id. The matrix renders a
//     row per domain pulling holders from the `dama` list, and the
//     +Assign link opens this page's form pre-scoped to that domain.
//
// `cardinality` mirrors the host-entity field or, for DAMA-storage,
// the backend's single-holder rule — owner-shaped roles are 'one',
// steward/architect/custodian-shaped are 'many'.

type DomainField = 'ownerId' | 'stewardIds';
type SystemField = 'ownerPersonId' | 'deputyOwnerId' | 'custodianIds';
type AssetField  = 'ownerPersonId' | 'stewardIds';

type EntityRoleScope =
  | { entityType: 'domain'; storage: 'entity'; field: DomainField; cardinality: 'one' | 'many' }
  | { entityType: 'system'; storage: 'entity'; field: SystemField; cardinality: 'one' | 'many' }
  | { entityType: 'asset';  storage: 'entity'; field: AssetField;  cardinality: 'one' | 'many' }
  | { entityType: 'domain'; storage: 'dama';   cardinality: 'one' | 'many' };

const ENTITY_SCOPED_ROLE_INFO: Record<string, EntityRoleScope> = {
  // Domain-scoped — fields on the DataDomain entity.
  DATA_DOMAIN_OWNER:       { entityType: 'domain', storage: 'entity', field: 'ownerId',       cardinality: 'one'  },
  DATA_DOMAIN_STEWARD:     { entityType: 'domain', storage: 'entity', field: 'stewardIds',    cardinality: 'many' },
  // Domain-scoped DAMA roles — backed by POST /dama-roles with
  // scopeType='DOMAIN'. Owners are single per domain; steward /
  // architect / custodian roles allow multiple holders.
  DATA_OWNER:              { entityType: 'domain', storage: 'dama',   cardinality: 'one'  },
  BUSINESS_DATA_STEWARD:   { entityType: 'domain', storage: 'dama',   cardinality: 'many' },
  TECHNICAL_DATA_STEWARD:  { entityType: 'domain', storage: 'dama',   cardinality: 'many' },
  DATA_ARCHITECT:          { entityType: 'domain', storage: 'dama',   cardinality: 'many' },
  DATA_CUSTODIAN:          { entityType: 'domain', storage: 'dama',   cardinality: 'many' },
  // System-scoped — fields on the System entity.
  SYSTEM_OWNER:            { entityType: 'system', storage: 'entity', field: 'ownerPersonId', cardinality: 'one'  },
  SYSTEM_DEPUTY_OWNER:     { entityType: 'system', storage: 'entity', field: 'deputyOwnerId', cardinality: 'one'  },
  SYSTEM_CUSTODIAN:        { entityType: 'system', storage: 'entity', field: 'custodianIds',  cardinality: 'many' },
  // Data Asset-scoped — fields on the DataAsset entity.
  DATA_ASSET_OWNER:        { entityType: 'asset',  storage: 'entity', field: 'ownerPersonId', cardinality: 'one'  },
  DATA_ASSET_STEWARD:      { entityType: 'asset',  storage: 'entity', field: 'stewardIds',    cardinality: 'many' },
};

function entityRoleInfo(roleType: string): EntityRoleScope | null {
  return ENTITY_SCOPED_ROLE_INFO[roleType] || null;
}

const ROLE_TYPE_LABELS: Record<string, string> = {
  // Executive/Strategic
  CDO: 'Chief Data Officer',
  DATA_GOVERNANCE_LEAD: 'Data Governance Lead',
  // Business
  DATA_OWNER: 'Data Owner',
  BUSINESS_DATA_STEWARD: 'Business Data Steward',
  DATA_QUALITY_ANALYST: 'Data Quality Analyst',
  // Technical
  TECHNICAL_DATA_STEWARD: 'Technical Data Steward',
  DATA_CUSTODIAN: 'Data Custodian',
  DATA_ARCHITECT: 'Data Architect',
  DATA_ENGINEER: 'Data Engineer',
  DATABASE_ADMINISTRATOR: 'Database Administrator',
  // Entity-attached (one-row-per-host-record assignments — see the
  // ENTITY_SCOPED_ROLE_INFO map above for storage details)
  DATA_DOMAIN_OWNER: 'Data Domain Owner',
  DATA_DOMAIN_STEWARD: 'Data Domain Steward',
  SYSTEM_OWNER: 'System Owner',
  SYSTEM_DEPUTY_OWNER: 'System Deputy Owner',
  SYSTEM_CUSTODIAN: 'System Custodian',
  DATA_ASSET_OWNER: 'Data Asset Owner',
  DATA_ASSET_STEWARD: 'Data Asset Steward',
};

const ROLE_CATEGORIES: Record<string, string> = {
  CDO: 'Executive', DATA_GOVERNANCE_LEAD: 'Executive',
  DATA_QUALITY_ANALYST: 'Business',
  DATA_ENGINEER: 'Technical', DATABASE_ADMINISTRATOR: 'Technical',
  // Entity-attached roles get their own category — these are the rows
  // that render with the per-entity matrix. Mixes DAMA-storage domain
  // roles (Data Owner, Business / Technical Data Steward, Architect,
  // Custodian) with entity-storage host-attached roles (Domain Owner,
  // System Owner, Asset Steward, etc.).
  DATA_OWNER: 'Entity-attached',
  BUSINESS_DATA_STEWARD: 'Entity-attached',
  TECHNICAL_DATA_STEWARD: 'Entity-attached',
  DATA_ARCHITECT: 'Entity-attached',
  DATA_CUSTODIAN: 'Entity-attached',
  DATA_DOMAIN_OWNER: 'Entity-attached', DATA_DOMAIN_STEWARD: 'Entity-attached',
  SYSTEM_OWNER: 'Entity-attached', SYSTEM_DEPUTY_OWNER: 'Entity-attached',
  SYSTEM_CUSTODIAN: 'Entity-attached',
  DATA_ASSET_OWNER: 'Entity-attached', DATA_ASSET_STEWARD: 'Entity-attached',
};

// One palette per *category* rather than per role. Eighteen distinct
// role colours encoded nothing the role label wasn't already telling
// you — the page read as confetti and reserved no colour budget for
// real signal (e.g. required-but-unfilled). Four category palettes
// give scanning value ("this is a business role") and let the red
// staffing-gap treatment stay loud.
const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  Executive:         { bg: '#ede9fe', color: '#5b21b6' },  // purple
  Business:          { bg: '#dbeafe', color: '#1e40af' },  // blue
  Technical:         { bg: '#fef3c7', color: '#92400e' },  // amber
  'Entity-attached': { bg: '#e2e8f0', color: '#475569' },  // slate
};

const NEUTRAL_PALETTE = { bg: '#f1f5f9', color: '#64748b' };

function roleColors(roleType: string): { bg: string; color: string } {
  const cat = ROLE_CATEGORIES[roleType];
  return (cat && CATEGORY_COLORS[cat]) || NEUTRAL_PALETTE;
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

interface FormData {
  // A role assignment is held by exactly one of (person, agent). The form
  // picks one via assigneeType and fills only the corresponding id field.
  assigneeType: 'person' | 'agent';
  personId: string;
  agentId: string;
  roleType: string;
  scopeType: 'ORG' | 'DOMAIN';
  scopeId: string;
}

interface AgentOption { id: string; name: string; status: string; orgIds: string[]; }

const emptyForm: FormData = { assigneeType: 'person', personId: '', agentId: '', roleType: 'CDO', scopeType: 'ORG', scopeId: '' };

export default function DamaRolesPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const openRoleDrawer = useRoleDrawerStore((s) => s.open);
  const [roles, setRoles] = useState<DamaRoleAssignment[]>([]);
  const [roleTypes, setRoleTypes] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [systems, setSystems] = useState<SystemOption[]>([]);
  const [dataAssets, setDataAssets] = useState<AssetOption[]>([]);
  // Counts come from the local `roles` list now (see roleCounts below);
  // the /summary endpoint is still fetched so future per-role analytics
  // have a single source of truth, but the result is intentionally
  // unused at the moment.
  const [, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  // The required-id field switches with assigneeType — validate whichever
  // one applies. Falls back to a single combined message if neither is set.
  const roleValidation = useFormValidation({
    personId: (v: any, form: any) => (form?.assigneeType !== 'agent' && !v) ? 'Select a person to assign the role to.' : null,
    agentId: (v: any, form: any) => (form?.assigneeType === 'agent' && !v) ? 'Select an agent to assign the role to.' : null,
    scopeId: (v: any) => !v ? 'Select an organization.' : null,
  });
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [filterRoleType, setFilterRoleType] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Sidebar category collapse state (mirrors the main panel's collapse
  // controls but lives separately — users can fold the sidebar
  // independently from the cards).
  const [collapsedSidebarCats, setCollapsedSidebarCats] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [rolesRes, summaryRes, peopleRes, agentsRes, orgsRes, domainsRes, systemsRes, assetsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DamaRoleAssignment[]; roleTypes: string[] }>(`/dama-roles${query}`),
        apiClient.get<{ success: boolean; data: Record<string, number> }>(`/dama-roles/summary${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: AgentOption[] }>(`/agents${query}`),
        apiClient.get<{ success: boolean; data: OrgOption[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: DomainOption[] }>(`/data-domains${query}`),
        apiClient.get<{ success: boolean; data: SystemOption[] }>(`/systems${query}`).catch(() => ({ data: [] } as any)),
        apiClient.get<{ success: boolean; data: AssetOption[] }>(`/data-assets${query}`).catch(() => ({ data: [] } as any)),
      ]);
      setRoles(rolesRes.data || []);
      setRoleTypes(rolesRes.roleTypes || []);
      setSummary(summaryRes.data || {});
      setPeople(peopleRes.data || []);
      setAgents((agentsRes.data || []).filter((a) => a.status === 'ACTIVE'));
      setOrgs(orgsRes.data || []);
      setDomains(domainsRes.data || []);
      setSystems(systemsRes.data || []);
      setDataAssets(assetsRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useRefreshOnFocus(fetchData);

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm({
      ...emptyForm,
      scopeId: activeOrgId || (orgs.length > 0 ? orgs[0].id : ''),
    });
    setError('');
    setShowForm(true);
  };

  // Quick-lookup map: personId → display name. Used by the per-entity
  // matrix renderer to resolve entity-attached holder ids
  // (system.ownerPersonId, asset.stewardIds, etc.) without having to
  // pass the people array around.
  const personById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people) m.set(p.id, p.name);
    return m;
  }, [people]);

  // Open the assign form pre-scoped to a specific entity. Used by
  // the matrix's inline +Assign on DAMA-storage rows — pre-fills
  // scopeType + scopeId so the user only has to pick a holder.
  const openAddForEntity = (roleType: string, scopeType: 'DOMAIN', scopeId: string) => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm({ ...emptyForm, roleType, scopeType, scopeId });
    setError('');
    setShowForm(true);
  };

  // Entity-storage roles aren't stored in damaRoles — they're FK
  // fields on the host record. Send the user to the host page with
  // the entity highlighted so they can use the existing owner /
  // steward / custodian pickers there.
  const navigate = useNavigate();
  const navigateToEntity = (entityType: 'domain' | 'system' | 'asset', entityId: string) => {
    const base =
      entityType === 'domain' ? '/data-domains' :
      entityType === 'system' ? '/systems'      :
                                '/data-assets';
    navigate(`${base}?highlight=${encodeURIComponent(entityId)}`);
  };

  // used by the "By Role" catalog so an unfilled role is one click from
  // being assigned (mirrors the Governance Groups expected-role slate).
  const openAddForRole = (roleType: string) => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm({
      ...emptyForm,
      roleType,
      scopeId: activeOrgId || (orgs.length > 0 ? orgs[0].id : ''),
    });
    setError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!roleValidation.validateAll(form)) return;
    setError('');
    // Send only the id field that matches assigneeType. Backend accepts
    // either personId or agentId on this endpoint.
    const payload: Record<string, unknown> = {
      roleType: form.roleType,
      scopeType: form.scopeType,
      scopeId: form.scopeId,
    };
    if (form.assigneeType === 'agent') payload.agentId = form.agentId;
    else payload.personId = form.personId;
    try {
      await apiClient.post('/dama-roles', payload);
      addToast('success', 'Governance role assigned');
      setShowForm(false);
      setForm(emptyForm);
      fetchData();
    } catch (err: any) {
      setError(err?.message || 'Failed to assign role');
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await apiClient.delete(`/dama-roles/${id}`);
      addToast('success', 'Governance role removed');
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to remove role');
    }
  };

  const handleCancel = () => { setShowForm(false); setError(''); setForm(emptyForm); };

  const scopeNameForFilter = useCallback((scopeId: string) => {
    return orgs.find((o) => o.id === scopeId)?.name
      || domains.find((d) => d.id === scopeId)?.name
      || '';
  }, [orgs, domains]);

  // Apply role filter and free-text search against person name + org name.
  const filteredRoles = roles.filter((r) => {
    if (filterRoleType && r.roleType !== filterRoleType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${r.personName || ''} ${r.agentName || ''} ${scopeNameForFilter(r.scopeId)} ${ROLE_TYPE_LABELS[r.roleType] || r.roleType}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Per-role counts for the sidebar - based on the unfiltered roles list
  // so sidebar always shows the full distribution, not what's left after
  // a search filters things out. Entity-storage roles are counted from
  // the host entity collection (System.ownerPersonId, Domain.stewardIds,
  // …) since those holders don't appear in the damaRoles list.
  const roleCounts: Record<string, number> = {};
  for (const r of roles) roleCounts[r.roleType] = (roleCounts[r.roleType] || 0) + 1;
  for (const [rt, info] of Object.entries(ENTITY_SCOPED_ROLE_INFO)) {
    if (info.storage !== 'entity') continue;
    const sources =
      info.entityType === 'domain' ? domains :
      info.entityType === 'system' ? systems :
                                     dataAssets;
    const ids = new Set<string>();
    for (const e of sources) {
      const v = (e as any)[info.field];
      if (Array.isArray(v)) for (const id of v) { if (id) ids.add(id); }
      else if (v) ids.add(v);
    }
    if (ids.size > 0) roleCounts[rt] = (roleCounts[rt] || 0) + ids.size;
  }

  // Resolve a role assignment's scopeId against every kind it might
  // point at (org / data domain / system / data asset) and return the
  // name plus a kind tag so the row can render a typed badge. Falls
  // back to a short-id chip when nothing resolves — the same pattern
  // we use on the Data Mapping page for orphans.
  const resolveScope = (scopeId: string): { kind: 'ORG' | 'DOMAIN' | 'SYSTEM' | 'ASSET' | 'UNKNOWN'; name: string } => {
    const org = orgs.find((o) => o.id === scopeId);
    if (org) return { kind: 'ORG', name: org.name };
    const dom = domains.find((d) => d.id === scopeId);
    if (dom) return { kind: 'DOMAIN', name: dom.name };
    const sys = systems.find((s) => s.id === scopeId);
    if (sys) return { kind: 'SYSTEM', name: sys.name };
    const ast = dataAssets.find((a) => a.id === scopeId);
    if (ast) return { kind: 'ASSET', name: ast.name };
    return { kind: 'UNKNOWN', name: scopeId.length > 8 ? `${scopeId.slice(0, 8)}…` : scopeId };
  };

  const scopeName = (scopeId: string) => resolveScope(scopeId).name;

  const roleBadge = (roleType: string): React.CSSProperties => {
    const c = roleColors(roleType);
    return {
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.color,
    };
  };

  return (
    <div>
      <PageHeader
        title="Governance Roles"
        subtitle="Assign data management governance roles to people across organizations and data domains."
        actions={<>
          <SavedViewsMenu
            pageKey="dama-roles"
            currentFilters={{ filterRoleType, searchQuery }}
            onApply={(f) => {
              setFilterRoleType((f.filterRoleType as string | null) ?? null);
              setSearchQuery((f.searchQuery as string) || '');
            }}
          />
          {roles.length > 0 && (
            <ExportMenu build={() => ({
              filenameBase: 'governance-roles',
              sheetName: 'Governance Roles',
              headers: ['Holder', 'Type', 'Governance Role', 'Organization', 'Since'],
              rows: roles.map((r) => [
                r.agentId ? (r.agentName || '') : (r.personName || ''),
                r.agentId ? 'Agent' : 'Person',
                ROLE_TYPE_LABELS[r.roleType] || r.roleType,
                scopeName(r.scopeId),
                new Date(r.since).toLocaleDateString(),
              ]),
            })} />
          )}
          <IconButton icon="plus" label="Assign role" variant="primary" onClick={openAdd} />
        </>}
      >
      </PageHeader>

      {!loading && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search by person, organization, or role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: '1 1 280px', maxWidth: 420,
              fontSize: 13, padding: '6px 10px',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
            }}
          />
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            {filterRoleType
              ? ROLE_TYPE_LABELS[filterRoleType]
              : `${roles.length} assignment${roles.length === 1 ? '' : 's'} across ${Object.keys(ROLE_TYPE_LABELS).length} roles`}
          </div>
        </div>
      )}

      {/* Assign Form */}
      {showForm && (
        <SectionCard title="Assign Governance Role">
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Governance roles are <strong>org-wide</strong>. Assigning here, or from a
            group's expected-role panel on Governance Groups / Group Composition,
            all create the <strong>same</strong> assignment — it appears in every one of those places.
          </div>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#dc2626' }}>
              {error}
            </div>
          )}
          {/* Holder kind toggle — a role can be held by a person or an
              AI agent. Accountability roles (CDO, Governance Lead, Data
              Owner, Business Steward — see PEOPLE_ONLY_ROLE_TYPES)
              disable the Agent option with a tooltip explaining why
              the human must hold it. */}
          {(() => {
            const isPeopleOnly = PEOPLE_ONLY_ROLE_TYPES.has(form.roleType);
            return (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 6 }}>Holder type</label>
                <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  {(['person', 'agent'] as const).map((t) => {
                    const disabled = t === 'agent' && isPeopleOnly;
                    const active = form.assigneeType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={disabled}
                        aria-disabled={disabled}
                        title={disabled ? PEOPLE_ONLY_REASON : undefined}
                        onClick={() => { if (!disabled) setForm({ ...form, assigneeType: t, personId: '', agentId: '' }); }}
                        style={{
                          padding: '6px 14px', fontSize: 12, fontWeight: 500,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled ? 0.5 : 1,
                          background: active ? (t === 'agent' ? '#ede9fe' : 'var(--color-bg)') : 'transparent',
                          color: active ? (t === 'agent' ? '#5b21b6' : 'var(--color-text)') : 'var(--color-text-muted)',
                          border: 'none', borderRight: t === 'person' ? '1px solid var(--color-border)' : 'none',
                        }}
                      >
                        {t === 'agent' ? '⚙ Agent' : 'Person'}
                      </button>
                    );
                  })}
                </div>
                {isPeopleOnly && (
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {PEOPLE_ONLY_REASON}
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {form.assigneeType === 'agent' ? (
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Agent *</label>
                <select style={{ ...selectStyle, border: roleValidation.fieldError('agentId') ? inputErrorBorder : selectStyle.border }} value={form.agentId}
                  onChange={(e) => setForm({ ...form, agentId: e.target.value })}
                  onBlur={() => { roleValidation.touch('agentId'); roleValidation.validateField('agentId', form.agentId, form); }}>
                  <option value="">-- Select agent --</option>
                  {agents
                    .filter((a) => !form.scopeId || a.orgIds.includes(form.scopeId))
                    .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {roleValidation.fieldError('agentId') && <div style={fieldErrorStyle}>{roleValidation.fieldError('agentId')}</div>}
                {agents.length === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>No active agents in this org — create one on the Agents page.</div>
                )}
              </div>
            ) : (
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Person *</label>
              <div
                style={{ borderRadius: 4, border: roleValidation.fieldError('personId') ? inputErrorBorder : '1px solid transparent' }}
                onBlur={() => { roleValidation.touch('personId'); roleValidation.validateField('personId', form.personId, form); }}
              >
                <PersonPicker
                  mode="single"
                  valueMode="id"
                  value={form.personId || null}
                  onChange={(id) => setForm({ ...form, personId: (id as string) || '' })}
                  orgId={activeOrgId || undefined}
                  placeholder="Pick a person…"
                />
              </div>
              {roleValidation.fieldError('personId') && <div style={fieldErrorStyle}>{roleValidation.fieldError('personId')}</div>}
            </div>
            )}
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Governance Role *</label>
              {form.scopeType === 'DOMAIN' ? (
                // When the form was opened from a per-entity matrix row,
                // the role is contextual — changing it would unscope the
                // assignment. Show it as a read-only badge instead.
                <div style={{
                  border: '1px solid var(--color-border)', borderRadius: 4,
                  padding: '6px 10px', fontSize: 13,
                  background: 'var(--color-bg)', color: 'var(--color-text)',
                }}>
                  {ROLE_TYPE_LABELS[form.roleType] || form.roleType}
                </div>
              ) : (
                <select style={selectStyle} value={form.roleType} onChange={(e) => {
                  const next = e.target.value;
                  // If the new role is people-only and Agent is
                  // currently selected, flip back to Person so the
                  // form can't submit an invalid combo.
                  const flipToPerson = PEOPLE_ONLY_ROLE_TYPES.has(next) && form.assigneeType === 'agent';
                  setForm({
                    ...form,
                    roleType: next,
                    assigneeType: flipToPerson ? 'person' : form.assigneeType,
                    agentId: flipToPerson ? '' : form.agentId,
                  });
                }}>
                  <optgroup label="Executive/Strategic">
                    {(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS)).filter((rt) => ROLE_CATEGORIES[rt] === 'Executive').map((rt) => (
                      <option key={rt} value={rt}>{ROLE_TYPE_LABELS[rt] || rt}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Business">
                    {(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS)).filter((rt) => ROLE_CATEGORIES[rt] === 'Business').map((rt) => (
                      <option key={rt} value={rt}>{ROLE_TYPE_LABELS[rt] || rt}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Technical">
                    {(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS)).filter((rt) => ROLE_CATEGORIES[rt] === 'Technical').map((rt) => (
                      <option key={rt} value={rt}>{ROLE_TYPE_LABELS[rt] || rt}</option>
                    ))}
                  </optgroup>
                </select>
              )}
            </div>
            {form.scopeType === 'DOMAIN' ? (
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Data Domain</label>
                <div style={{
                  border: '1px solid var(--color-border)', borderRadius: 4,
                  padding: '6px 10px', fontSize: 13,
                  background: 'var(--color-bg)', color: 'var(--color-text)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    padding: '1px 6px', borderRadius: 3, background: '#dcfce7', color: '#166534',
                  }}>DOMAIN</span>
                  {domains.find((d) => d.id === form.scopeId)?.name || form.scopeId}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Scoped to this data domain. Edit on the Data Domains page to change scope.
                </div>
              </div>
            ) : (
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Organization *</label>
                <select style={{ ...selectStyle, border: roleValidation.fieldError('scopeId') ? inputErrorBorder : selectStyle.border }} value={form.scopeId}
                  onChange={(e) => setForm({ ...form, scopeId: e.target.value })}
                  onBlur={() => { roleValidation.touch('scopeId'); roleValidation.validateField('scopeId', form.scopeId, form); }}>
                  <option value="">-- Select organization --</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                {roleValidation.fieldError('scopeId') && <div style={fieldErrorStyle}>{roleValidation.fieldError('scopeId')}</div>}
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Org-wide assignment. To scope to a single domain, use the +Assign link on the per-domain row.
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            {(() => {
              const idFilled = form.assigneeType === 'agent' ? !!form.agentId : !!form.personId;
              const incomplete = !idFilled || !form.scopeId;
              return (
                <button
                  style={{ ...btnPrimary, opacity: incomplete ? 0.6 : 1, cursor: incomplete ? 'not-allowed' : 'pointer' }}
                  disabled={incomplete}
                  onClick={handleSave}
                >
                  Assign Role
                </button>
              );
            })()}
          </div>
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Governance Role?"
        message="This will permanently delete this role assignment. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          const id = confirmDelete;
          setConfirmDelete(null);
          if (id) await handleRemove(id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Two-column layout: role-type sidebar on the left, role catalog
       *  on the right. Same scan pattern as /data-assets, /systems, and
       *  /decision-rights. The sidebar mirrors the main panel's
       *  category structure (Executive / Business / Technical /
       *  Entity-attached) and shows a fill summary per section so
       *  staffing coverage is visible at a glance. */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 10,
          position: 'sticky', top: 12,
          maxHeight: 'calc(100vh - 180px)',
          overflowY: 'auto',
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, padding: '0 4px' }}>
            Roles
          </div>
          <SidebarItem label="All Roles" count={roles.length} active={!filterRoleType} onClick={() => setFilterRoleType(null)} />
          {CATEGORY_ORDER.map((cat) => {
            const inCat = Object.keys(ROLE_TYPE_LABELS).filter((rt) => ROLE_CATEGORIES[rt] === cat);
            if (inCat.length === 0) return null;
            const filledCount = inCat.filter((rt) => (roleCounts[rt] || 0) > 0).length;
            const c = CATEGORY_COLORS[cat] || NEUTRAL_PALETTE;
            const open = !collapsedSidebarCats.has(cat);
            return (
              <SidebarCategory
                key={cat}
                label={cat}
                filled={filledCount}
                total={inCat.length}
                color={c.color}
                open={open}
                onToggle={() => setCollapsedSidebarCats((prev) => {
                  const next = new Set(prev);
                  next.has(cat) ? next.delete(cat) : next.add(cat);
                  return next;
                })}
              >
                {inCat.map((rt) => {
                  const count = roleCounts[rt] || 0;
                  const isActive = filterRoleType === rt;
                  return (
                    <SidebarItem
                      key={rt}
                      label={ROLE_TYPE_LABELS[rt]}
                      count={count}
                      active={isActive}
                      onClick={() => setFilterRoleType(isActive ? null : rt)}
                      accent={c.color}
                      indent
                    />
                  );
                })}
              </SidebarCategory>
            );
          })}
        </div>

        <div>
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            {loading ? (
              <SkeletonRows rows={6} columns={4} />
            ) : (
              <ByRoleView
                roles={filteredRoles}
                catalog={(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS))}
                filterRoleType={filterRoleType}
                roleBadge={roleBadge}
                resolveScope={resolveScope}
                domains={domains}
                systems={systems}
                dataAssets={dataAssets}
                personById={personById}
                openRoleDrawer={openRoleDrawer}
                onAssign={openAddForRole}
                onAssignToEntity={openAddForEntity}
                navigateToEntity={navigateToEntity}
                setConfirmDelete={setConfirmDelete}
                programInUse={roles.length > 0}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar entry ─────────────────────────────────────────────────────────
// Single role-type item in the left sidebar. Active state mirrors the
// other sidebar-based pages so the pattern is identical visually.
function SidebarItem({ label, count, active, onClick, accent, indent }: {
  label: string; count: number; active: boolean; onClick: () => void; accent?: string;
  /** Nested under a category header. Adds left padding so the row
   *  reads as a child of its category. */
  indent?: boolean;
}) {
  return (
    <div
      {...clickable(onClick, { label: `${label} (${count})`, pressed: active })}
      style={{
        padding: `5px 8px 5px ${indent ? 18 : 8}px`,
        fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
        fontWeight: active ? 600 : 400,
        background: active ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderLeft: accent ? `3px solid ${accent}` : '3px solid transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-bg)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '0 5px', borderRadius: 8, fontWeight: 500 }}>{count}</span>
    </div>
  );
}

// Sidebar category header — collapses a group of roles and surfaces
// the fill ratio ("0 of 2 filled") so coverage is readable without
// scanning every card on the right.
function SidebarCategory({ label, filled, total, color, open, onToggle, children }: {
  label: string;
  filled: number;
  total: number;
  color: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 6px', background: 'none', border: 'none',
          borderLeft: `3px solid ${color}`,
          cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)',
        }}
      >
        <RolesChevron open={open} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 500 }}>
          {filled}/{total}
        </span>
      </button>
      {open && <div style={{ marginTop: 2 }}>{children}</div>}
    </div>
  );
}

// ── By-Role view ──────────────────────────────────────────────────────────
// One section per role type, showing the people who hold that role. The
// section header is clickable to open the Role Detail drawer.
function ByRoleView({ roles, catalog, filterRoleType, roleBadge, resolveScope, domains, systems, dataAssets, personById, openRoleDrawer, onAssign, onAssignToEntity, navigateToEntity, setConfirmDelete, programInUse }: {
  roles: DamaRoleAssignment[];
  /** Full governance-role catalog so every role is listed even with
   *  zero holders (consistent with the Governance Groups expected-role
   *  slate). */
  catalog: string[];
  filterRoleType: string | null;
  roleBadge: (rt: string) => React.CSSProperties;
  /** Resolve a scopeId to its kind + name. */
  resolveScope: (id: string) => { kind: 'ORG' | 'DOMAIN' | 'SYSTEM' | 'ASSET' | 'UNKNOWN'; name: string };
  /** Entities used by the per-entity matrix renderer. */
  domains: DomainOption[];
  systems: SystemOption[];
  dataAssets: AssetOption[];
  /** Quick lookup for resolving holder ids to display names in the
   *  entity matrix. */
  personById: Map<string, string>;
  openRoleDrawer: (rt: string) => void;
  onAssign: (rt: string) => void;
  /** Inline assign-to-entity for DAMA-storage matrix rows — opens the
   *  page's assign form pre-scoped to a specific domain so the user
   *  just picks a person and saves. */
  onAssignToEntity: (rt: string, scopeType: 'DOMAIN', scopeId: string) => void;
  /** Drill-down for entity-storage matrix rows: send the user to the
   *  host page with the entity highlighted so they can edit the
   *  owner/steward/custodian field using the existing picker there. */
  navigateToEntity: (entityType: 'domain' | 'system' | 'asset', entityId: string) => void;
  setConfirmDelete: (id: string) => void;
  /** True once the program is in use — at least one DAMA role assignment
   *  exists anywhere in the org. When false the org is in pre-launch
   *  setup mode and unfilled-required roles surface amber instead of
   *  red, since the user hasn't started staffing yet. */
  programInUse: boolean;
}) {
  // Expand / collapse state. Defaults to all-expanded so first load
  // matches what users see today; Expand all / Collapse all flips the
  // whole tree, individual chevrons toggle one row. We store the
  // *collapsed* set rather than expanded so new roles / categories
  // added to the catalog later default open without a migration.
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(new Set());

  // When the org has no host entities defined yet, the twelve
  // Entity-attached cards would all repeat "No data domains defined
  // yet" and bury the rest of the page. Render a single CTA in their
  // place instead. Computed per-render so it reacts to data arriving
  // after the initial mount.
  const noHostEntities = domains.length === 0 && systems.length === 0 && dataAssets.length === 0;

  const byRole = new Map<string, DamaRoleAssignment[]>();
  for (const r of roles) {
    if (!byRole.has(r.roleType)) byRole.set(r.roleType, []);
    byRole.get(r.roleType)!.push(r);
  }
  // Iterate the whole catalog in canonical ROLE_TYPE_LABELS order
  // (executive first), not just roles that happen to have holders. When
  // a specific role filter is active, show only that section. Entity-
  // attached roles render from local entity state (not the backend
  // catalog), so they're always included alongside the DAMA roles the
  // backend reports.
  const catalogSet = new Set([...catalog, ...Object.keys(ENTITY_SCOPED_ROLE_INFO)]);
  const ordered = Object.keys(ROLE_TYPE_LABELS)
    .filter((rt) => catalogSet.has(rt))
    .filter((rt) => !filterRoleType || rt === filterRoleType);

  const toggleCat = (cat: string) => setCollapsedCats((prev) => {
    const next = new Set(prev);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    return next;
  });
  const toggleRole = (rt: string) => setCollapsedRoles((prev) => {
    const next = new Set(prev);
    next.has(rt) ? next.delete(rt) : next.add(rt);
    return next;
  });
  const expandAll = () => { setCollapsedCats(new Set()); setCollapsedRoles(new Set()); };
  const collapseAll = () => {
    setCollapsedCats(new Set(CATEGORY_ORDER as readonly string[]));
    setCollapsedRoles(new Set(ordered));
  };
  // Render a single role as a card. Coloured left border keys it to
  // the role's badge palette; required roles with no holders go red.
  const renderRoleCard = (rt: string) => {
    const list = (byRole.get(rt) || []).slice().sort((a, b) => {
      const an = a.agentId ? (a.agentName || '') : (a.personName || '');
      const bn = b.agentId ? (b.agentName || '') : (b.personName || '');
      return an.localeCompare(bn);
    });
    // Entity-storage roles (SYSTEM_OWNER, DATA_DOMAIN_STEWARD, etc.)
    // hold their assignments as foreign-key fields on the host record,
    // not in the DAMA roles list — so `list.length` is always 0 even
    // when every entity has an owner. Walk the host collection for
    // those roles so the header doesn't read "Unfilled" right above a
    // matrix that proudly announces "2 of 2 systems have this role
    // assigned". Distinct holders are counted (one person owning two
    // systems is one holder), matching what users expect "N holders"
    // to mean.
    const entityInfoForCard = entityRoleInfo(rt);
    const entityHolderIds = (() => {
      if (!entityInfoForCard || entityInfoForCard.storage !== 'entity') return new Set<string>();
      const { entityType, field } = entityInfoForCard;
      const sources =
        entityType === 'domain' ? domains :
        entityType === 'system' ? systems :
                                  dataAssets;
      const ids = new Set<string>();
      for (const e of sources) {
        const v = (e as any)[field];
        if (Array.isArray(v)) for (const id of v) { if (id) ids.add(id); }
        else if (v) ids.add(v);
      }
      return ids;
    })();
    const filled = list.length > 0 || entityHolderIds.size > 0;
    const holderCount = entityInfoForCard?.storage === 'entity'
      ? entityHolderIds.size
      : list.length;
    const holderLabel = `${holderCount} ${holderCount === 1 ? 'holder' : 'holders'}`;
    const required = REQUIRED_ROLE_TYPES.has(rt);
    // Critical-gap red is reserved for orgs whose program is actually
    // in use (at least one DAMA assignment exists somewhere). On a
    // fresh org with zero assignments anywhere, four required roles
    // sitting empty would paint the page red on day one — that's
    // alarming for what's really just an unstarted setup. Pre-launch
    // orgs get the regular amber "Unfilled" treatment until they
    // staff anyone at all.
    const criticalGap = required && !filled && programInUse;
    const c = roleColors(rt);
    const roleOpen = !collapsedRoles.has(rt);
    return (
      <div
        key={rt}
        style={{
          border: `1px solid ${criticalGap ? '#fca5a5' : 'var(--color-border)'}`,
          borderLeft: `4px solid ${criticalGap ? '#dc2626' : c.color}`,
          borderRadius: 'var(--radius-md)',
          background: criticalGap ? '#fef2f2' : 'var(--color-surface)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
          <button
            type="button"
            onClick={() => toggleRole(rt)}
            aria-expanded={roleOpen}
            aria-label={`${roleOpen ? 'Collapse' : 'Expand'} ${ROLE_TYPE_LABELS[rt] || rt}`}
            title={roleOpen ? 'Collapse role' : 'Expand role'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--color-text-secondary)' }}
          >
            <RolesChevron open={roleOpen} />
          </button>
          <button
            type="button"
            onClick={() => openRoleDrawer(rt)}
            title="Learn about this role"
            style={{ ...roleBadge(rt), border: 'none', cursor: 'pointer', font: 'inherit', padding: '3px 10px' }}
          >
            {ROLE_TYPE_LABELS[rt] || rt}
          </button>
          {/* Persistent Required tag — visible regardless of fill state
              so users know which roles are mandatory without having to
              wait for them to go red. The Unfilled badge below carries
              the empty-state signal separately. */}
          {required && (
            <span
              title="Required for a governance program — every org should have a holder for this role."
              style={{
                fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                background: 'transparent',
                color: criticalGap ? '#991b1b' : 'var(--color-text-muted)',
                border: `1px solid ${criticalGap ? '#fca5a5' : 'var(--color-border)'}`,
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}
            >
              Required
            </span>
          )}
          {filled ? (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{holderLabel}</span>
          ) : criticalGap ? (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fee2e2', color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Unfilled
            </span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#b45309' }}>Unfilled</span>
          )}
          {/* Assign action emphasis tracks urgency: critical gap = loud
              red button (drives the eye), other rows = quiet text link
              so they don't compete for attention with the staffing
              gaps that actually need fixing. */}
          {criticalGap ? (
            <button
              type="button"
              onClick={() => onAssign(rt)}
              style={{
                marginLeft: 'auto',
                background: '#dc2626', border: 'none', borderRadius: 4,
                padding: '3px 12px', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', color: '#fff',
              }}
            >
              + Assign
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onAssign(rt)}
              style={{
                marginLeft: 'auto',
                background: 'none', border: 'none', padding: '2px 4px',
                fontSize: 11, cursor: 'pointer',
                color: 'var(--color-primary)', fontFamily: 'inherit',
              }}
            >
              + Assign
            </button>
          )}
        </div>
        {roleOpen && (() => {
          const entInfo = entityRoleInfo(rt);
          // Entity-attached roles get the per-entity matrix view —
          // every domain / system / asset listed with its current
          // holder(s) and the appropriate inline action. Org-only
          // DAMA roles (CDO, Governance Lead, Data Quality Analyst,
          // Engineer, DBA) keep the simple holder-list view because
          // there's no per-entity dimension to lay out.
          if (entInfo) {
            return renderEntityMatrix({
              rt,
              info: entInfo,
              dama: list,
              domains,
              systems,
              dataAssets,
              personById,
              onAssignToEntity,
              navigateToEntity,
              setConfirmDelete,
            });
          }
          // Org-scoped roles — original holder list.
          if (filled) {
            return (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--color-border)' }}>
                {list.map((r) => {
                  const isAgent = !!r.agentId;
                  const displayName = isAgent ? (r.agentName || 'Agent') : (r.personName || 'Unknown');
                  return (
                  <li key={r.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr auto auto', alignItems: 'center', gap: 12, padding: '6px 14px', fontSize: 13 }}>
                    <span title={isAgent ? 'AI Agent' : 'Person'} style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      background: isAgent ? '#ede9fe' : c.bg, color: isAgent ? '#5b21b6' : c.color,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                    }}>
                      {isAgent ? <Bot size={13} strokeWidth={2.4} /> : displayName.charAt(0).toUpperCase()}
                    </span>
                    <span style={{ fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {displayName}
                    </span>
                    <ScopeChip scope={resolveScope(r.scopeId)} rawId={r.scopeId} />
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>since {new Date(r.since).toLocaleDateString()}</span>
                    <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(r.id)} />
                  </li>
                  );
                })}
              </ul>
            );
          }
          return (
            <div style={{ padding: '4px 14px 10px', fontSize: 12, color: criticalGap ? '#7f1d1d' : 'var(--color-text-muted)' }}>
              {criticalGap ? 'This role is required and has no holder — assign someone to close the gap.' : 'No one holds this role yet.'}
            </div>
          );
        })()}
      </div>
    );
  };

  // Group the ordered role list under Executive / Business /
  // Technical headers so the page reads as a staffing chart, not a
  // flat list. When a single-role filter is active we drop the
  // headers (one role, no need for a section title) and the
  // expand/collapse controls (one card, no need).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!filterRoleType && (
        <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 4, alignItems: 'center', fontSize: 12 }}>
          <button type="button" onClick={expandAll} style={rolesTextBtn}>Expand all</button>
          <span style={{ color: 'var(--color-border)' }}>·</span>
          <button type="button" onClick={collapseAll} style={rolesTextBtn}>Collapse all</button>
        </div>
      )}
      {filterRoleType
        ? ordered.map(renderRoleCard)
        : CATEGORY_ORDER.map((cat) => {
            const inCat = ordered.filter((rt) => ROLE_CATEGORIES[rt] === cat);
            if (inCat.length === 0) return null;
            const catOpen = !collapsedCats.has(cat);
            // Entity-attached pre-launch placeholder. When the org has
            // no host entities, the twelve cards underneath would each
            // say "No data domains defined yet" — same message, dozen
            // times. Collapse to one CTA line that gets the user to
            // where they can fix it. Once a domain / system / asset
            // exists, the normal card list shows.
            const showEntitySetupCta = cat === 'Entity-attached' && noHostEntities;
            return (
              <div key={cat}>
                <button
                  type="button"
                  onClick={() => toggleCat(cat)}
                  aria-expanded={catOpen}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', padding: '2px 0',
                    marginBottom: catOpen ? 8 : 0,
                    cursor: 'pointer',
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: 'var(--color-text-muted)',
                    fontFamily: 'inherit',
                  }}
                >
                  <RolesChevron open={catOpen} />
                  {cat}
                  <span style={{ fontWeight: 500, letterSpacing: 'normal', textTransform: 'none', color: 'var(--color-text-muted)' }}>
                    ({inCat.length})
                  </span>
                </button>
                {catOpen && showEntitySetupCta ? (
                  <EntitySetupCta count={inCat.length} navigateToEntity={navigateToEntity} />
                ) : catOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {inCat.map(renderRoleCard)}
                  </div>
                )}
              </div>
            );
          })}
    </div>
  );
}

// ── Small atoms used by the expand/collapse controls ─────────────────────

function RolesChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ flexShrink: 0, opacity: 0.55, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none' }}
    >
      <path d="M9 5 L15 12 L9 19" />
    </svg>
  );
}

// Per-holder scope display. The small leading tag tells the user what
// the assignment is scoped to (Org / Domain / System / Asset) so a
// Data Architect attached to "Customer Data" no longer reads as a raw
// UUID. UNKNOWN renders amber so a deleted scope ref is obvious.
function ScopeChip({ scope, rawId }: {
  scope: { kind: 'ORG' | 'DOMAIN' | 'SYSTEM' | 'ASSET' | 'UNKNOWN'; name: string };
  rawId: string;
}) {
  const palette: Record<typeof scope.kind, { bg: string; fg: string }> = {
    ORG:     { bg: '#e0e7ff', fg: '#3730a3' },
    DOMAIN:  { bg: '#dcfce7', fg: '#166534' },
    SYSTEM:  { bg: '#fee2e2', fg: '#991b1b' },
    ASSET:   { bg: '#dbeafe', fg: '#1e40af' },
    UNKNOWN: { bg: '#fef3c7', fg: '#92400e' },
  };
  const c = palette[scope.kind];
  const isUnknown = scope.kind === 'UNKNOWN';
  return (
    <span
      title={isUnknown
        ? `Scope id ${rawId} did not resolve to any org, domain, system, or asset — likely deleted.`
        : `${scope.kind}: ${scope.name}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}
    >
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
        padding: '1px 6px', borderRadius: 3,
        background: c.bg, color: c.fg,
      }}>
        {scope.kind}
      </span>
      {isUnknown ? <em>unresolved</em> : scope.name}
    </span>
  );
}

const rolesTextBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: '2px 4px',
  color: 'var(--color-primary)', cursor: 'pointer',
  fontSize: 12, fontFamily: 'inherit',
};

// Replaces the entity-attached card list when the org has no host
// entities to assign roles against. One sentence + three drill-in
// links beats twelve cards each repeating the same "no data domains
// defined yet" line.
function EntitySetupCta({ count, navigateToEntity }: {
  count: number;
  navigateToEntity: (entityType: 'domain' | 'system' | 'asset', entityId: string) => void;
}) {
  const linkStyle: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0,
    color: 'var(--color-primary)', cursor: 'pointer',
    fontSize: 12, fontFamily: 'inherit', textDecoration: 'underline',
  };
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--color-surface)',
      border: '1px dashed var(--color-border)',
      borderRadius: 'var(--radius-md)',
      fontSize: 13, lineHeight: 1.5,
      color: 'var(--color-text-secondary)',
    }}>
      Define a data domain, system, or data asset to enable the {count} entity-attached
      roles. Owners and stewards are assigned directly on those records.
      <div style={{ marginTop: 6, display: 'flex', gap: 14 }}>
        <button type="button" style={linkStyle} onClick={() => navigateToEntity('domain', '')}>Data Domains →</button>
        <button type="button" style={linkStyle} onClick={() => navigateToEntity('system', '')}>Systems →</button>
        <button type="button" style={linkStyle} onClick={() => navigateToEntity('asset', '')}>Data Assets →</button>
      </div>
    </div>
  );
}

// ── Per-entity matrix renderer ─────────────────────────────────────────
// Renders one row per host entity (domain / system / asset) that this
// role can attach to. Each row shows the entity name plus the holder(s)
// currently assigned. Holders come from the host entity's FK field
// (entity-storage) or from DAMA role assignments scoped to the entity
// (dama-storage). The trailing action depends on storage too:
//   - entity-storage → drill into the source page where the picker
//     lives (Manage / Change / + Assign).
//   - dama-storage → open the page's own assign form pre-scoped to
//     this entity (+ Assign), and a × per holder for direct removal.
// Unfilled rows surface visibly so staffing gaps are obvious.
function renderEntityMatrix({ rt, info, dama, domains, systems, dataAssets, personById, onAssignToEntity, navigateToEntity, setConfirmDelete }: {
  rt: string;
  info: EntityRoleScope;
  /** DAMA role assignments for `rt` (passed already filtered). Only
   *  used when info.storage === 'dama' — entity-storage roles pull
   *  holders directly from the entity's FK field. */
  dama: DamaRoleAssignment[];
  domains: DomainOption[];
  systems: SystemOption[];
  dataAssets: AssetOption[];
  personById: Map<string, string>;
  onAssignToEntity: (rt: string, scopeType: 'DOMAIN', scopeId: string) => void;
  navigateToEntity: (entityType: 'domain' | 'system' | 'asset', entityId: string) => void;
  setConfirmDelete: (id: string) => void;
}) {
  // Holder row carries the *assignment id* per holder for dama-storage
  // so the × button can target the right record; entity-storage rows
  // leave assignmentId null because removal is done on the source page.
  type Holder = { personId: string; assignmentId: string | null };

  const rows: Array<{ id: string; name: string; holders: Holder[] }> = (() => {
    if (info.storage === 'dama') {
      // DAMA-storage is always domain-scoped in this catalog.
      return domains.map((d) => ({
        id: d.id,
        name: d.name,
        holders: dama
          .filter((r) => r.scopeId === d.id && r.personId)
          .map((r) => ({ personId: r.personId as string, assignmentId: r.id })),
      }));
    }
    if (info.entityType === 'domain') {
      return domains.map((d) => ({
        id: d.id,
        name: d.name,
        holders: info.field === 'ownerId'
          ? (d.ownerId ? [{ personId: d.ownerId, assignmentId: null }] : [])
          : (d.stewardIds || []).map((pid) => ({ personId: pid, assignmentId: null })),
      }));
    }
    if (info.entityType === 'system') {
      return systems.map((s) => ({
        id: s.id,
        name: s.name,
        holders: info.field === 'custodianIds'
          ? (s.custodianIds || []).map((pid) => ({ personId: pid, assignmentId: null }))
          : info.field === 'ownerPersonId'
            ? (s.ownerPersonId ? [{ personId: s.ownerPersonId, assignmentId: null }] : [])
            : (s.deputyOwnerId ? [{ personId: s.deputyOwnerId, assignmentId: null }] : []),
      }));
    }
    return dataAssets.map((a) => ({
      id: a.id,
      name: a.name,
      holders: info.field === 'ownerPersonId'
        ? (a.ownerPersonId ? [{ personId: a.ownerPersonId, assignmentId: null }] : [])
        : (a.stewardIds || []).map((pid) => ({ personId: pid, assignmentId: null })),
    }));
  })();

  const entityLabel =
    info.entityType === 'domain' ? 'data domain'
    : info.entityType === 'system' ? 'system'
    : 'data asset';
  const entityLabelPlural =
    info.entityType === 'domain' ? 'data domains'
    : info.entityType === 'system' ? 'systems'
    : 'data assets';

  if (rows.length === 0) {
    return (
      <div style={{ padding: '4px 14px 10px', fontSize: 12, color: 'var(--color-text-muted)' }}>
        No {entityLabelPlural} defined yet — create one to assign this role.
      </div>
    );
  }

  // Filled count drives the header summary; matches the holder-list
  // view's "N holders" feel but per-entity.
  const filledCount = rows.filter((r) => r.holders.length > 0).length;
  const totalCount = rows.length;

  const handleRowAction = (rowId: string) => {
    if (info.storage === 'dama') onAssignToEntity(rt, 'DOMAIN', rowId);
    else navigateToEntity(info.entityType, rowId);
  };

  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <div style={{
        padding: '6px 14px',
        fontSize: 11,
        color: 'var(--color-text-muted)',
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        {filledCount} of {totalCount} {entityLabelPlural} have this role assigned
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row) => {
          const empty = row.holders.length === 0;
          // Single-cardinality roles hide the +Assign action once a
          // holder is set, since picking a second would be replacing
          // not adding. The user clicks the row name to drill in.
          const showRowAction = empty || info.cardinality === 'many';
          return (
            <li
              key={row.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 2fr auto',
                alignItems: 'center',
                gap: 12,
                padding: '8px 14px',
                fontSize: 13,
                borderTop: '1px solid var(--color-border)',
                background: empty ? '#fffbeb' : 'transparent',
              }}
            >
              <button
                type="button"
                onClick={() => navigateToEntity(info.entityType, row.id)}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  textAlign: 'left', cursor: 'pointer',
                  color: 'var(--color-primary)', fontWeight: 500,
                  fontSize: 13, fontFamily: 'inherit',
                }}
                title={`Open ${row.name}`}
              >
                {row.name}
              </button>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {empty ? (
                  <span style={{ fontSize: 12, color: '#b45309', fontStyle: 'italic' }}>
                    No holder — unassigned
                  </span>
                ) : (
                  row.holders.map((h) => (
                    <span
                      key={h.assignmentId || h.personId}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '2px 8px', borderRadius: 999,
                        background: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        fontSize: 12,
                      }}
                    >
                      <span style={{
                        width: 16, height: 16, borderRadius: '50%',
                        background: '#e0e7ff', color: '#3730a3',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, fontWeight: 700,
                      }}>
                        {(personById.get(h.personId) || '?').charAt(0).toUpperCase()}
                      </span>
                      {personById.get(h.personId) || 'Unknown person'}
                      {h.assignmentId && (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(h.assignmentId as string)}
                          aria-label={`Remove ${personById.get(h.personId) || 'holder'}`}
                          title="Remove holder"
                          style={{
                            background: 'none', border: 'none', padding: 0,
                            marginLeft: 2, cursor: 'pointer', lineHeight: 1,
                            color: 'var(--color-text-muted)', fontSize: 13,
                          }}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
              {showRowAction ? (
                <button
                  type="button"
                  onClick={() => handleRowAction(row.id)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    padding: '2px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    color: 'var(--color-primary)',
                    whiteSpace: 'nowrap',
                  }}
                  title={info.storage === 'dama'
                    ? `Assign on this ${entityLabel}`
                    : `Manage on the ${entityLabel} page`}
                >
                  {empty
                    ? '+ Assign'
                    : info.storage === 'dama'
                      ? '+ Add'
                      : 'Manage'}
                </button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
