import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { renderNavIcon } from '../components/navIcons';
import PageHeader from '../components/PageHeader';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import ExportMenu from '../components/ExportMenu';
import SavedViewsMenu from '../components/SavedViewsMenu';
import ListToolbar from '../components/ListToolbar';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import { useToastStore } from '../stores/toastStore';
import { useRoleDrawerStore } from '../stores/roleDrawerStore';
import EmbeddablePageHeader from '../components/EmbeddablePageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import SectionCard from '../components/SectionCard';
import PersonPicker from '../components/PersonPicker';
import Avatar from '../components/Avatar';
// Modal import removed: the single-role detail now opens on its own route
// (/dama-roles/:roleType) via RolePreviewPane rendered as the page body.
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';
import { useRefreshOnFocus } from '../hooks/usePolling';
import { SkeletonRows } from '../components/Skeleton';
import { GOVERNANCE_ROLES, PEOPLE_ONLY_ROLE_TYPES, PEOPLE_ONLY_REASON, DAMA_ROLE_TYPES } from '../types';

// Roles an operations manual can document (the manual picker's vocabulary).
// Entity-attached roles like Data Domain Owner aren't manual-eligible, so the
// role→manual affordance is shown only for these (plus any role that already
// has a manual).
const MANUAL_ELIGIBLE_ROLES = new Set<string>(DAMA_ROLE_TYPES);

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

// The operations manual(s) documenting a role. Surfaced in the role preview
// as the reverse of the manual→role link authored on the Documentation page.
interface ManualRef {
  id: string;
  roleType: string;
  label: string;
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

// Whether a role can have more than one holder (person or agent). Drives the
// Single / Multiple hint in the roles list so it's clear up front whether one
// holder fills the role or you can (and should) assign several. Source of
// truth: the GOVERNANCE_ROLES catalog's `multiAssign` flag; entity-attached
// roles (not in that catalog) fall back to their storage cardinality.
function roleAllowsMultiple(roleType: string): boolean {
  const def = GOVERNANCE_ROLES.find((r) => r.roleType === roleType);
  if (def) return def.multiAssign;
  const info = entityRoleInfo(roleType);
  if (info) return info.cardinality === 'many';
  return true;
}

// Plain-language "who can hold it" line for a role — e.g. "One person",
// "Several people", "One per data domain", "Several per system". Reads better
// than a bare Single / Multiple chip, and makes clear that a "single" entity
// role means one holder *per entity*, not one holder overall.
function scopeText(roleType: string): string {
  const info = entityRoleInfo(roleType);
  if (info) {
    const ent = info.entityType === 'domain' ? 'data domain' : info.entityType === 'system' ? 'system' : 'data asset';
    return `${info.cardinality === 'one' ? 'One' : 'Several'} per ${ent}`;
  }
  return roleAllowsMultiple(roleType) ? 'Several people' : 'One person';
}

// A role's row model — computed once in the page and shared by the coverage
// cards, the category chips, and the table, so every count agrees.
interface RoleModel {
  rt: string;
  label: string;
  category: string | null;
  required: boolean;
  several: boolean;
  scopeText: string;
  holderNames: string[];
  holderCount: number;
  filled: boolean;
}

function buildRoleModel(
  rt: string,
  damaRoles: DamaRoleAssignment[],
  domains: DomainOption[],
  systems: SystemOption[],
  dataAssets: AssetOption[],
  personById: Map<string, string>,
): RoleModel {
  const damaNames = damaRoles.filter((r) => r.roleType === rt).map((r) => r.agentName || r.personName || 'Unknown');
  const entityNames: string[] = [];
  const info = entityRoleInfo(rt);
  if (info && info.storage === 'entity') {
    const sources: any[] = info.entityType === 'domain' ? domains : info.entityType === 'system' ? systems : dataAssets;
    const ids = new Set<string>();
    for (const e of sources) {
      const v = e[info.field];
      if (Array.isArray(v)) { for (const id of v) if (id) ids.add(id); }
      else if (v) ids.add(v);
    }
    for (const id of ids) {
      const n = personById.get(id);
      if (n && !damaNames.includes(n) && !entityNames.includes(n)) entityNames.push(n);
    }
  }
  const holderNames = [...damaNames, ...entityNames];
  return {
    rt,
    label: ROLE_TYPE_LABELS[rt] || rt,
    category: ROLE_CATEGORIES[rt] || null,
    required: REQUIRED_ROLE_TYPES.has(rt),
    several: roleAllowsMultiple(rt),
    scopeText: scopeText(rt),
    holderNames,
    holderCount: holderNames.length,
    filled: holderNames.length > 0,
  };
}

// The compact Single / Multiple cardinality chip shown next to a role name.
function CardinalityChip({ roleType }: { roleType: string }) {
  const multiple = roleAllowsMultiple(roleType);
  // Entity-scoped roles are single/multiple *per entity* — so the aggregate
  // list can show several holders of a "Single" role (one per domain/system/
  // asset). Say "per <entity>" so that reads as intended, not contradictory.
  const info = entityRoleInfo(roleType);
  const per = info
    ? ` per ${info.entityType === 'domain' ? 'data domain' : info.entityType === 'system' ? 'system' : 'data asset'}`
    : '';
  return (
    <span
      title={multiple
        ? `Multiple holders${per} — you can assign more than one person or agent.`
        : `Single holder${per} — exactly one person or agent.`}
      style={{
        fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
        background: 'var(--color-bg)', color: 'var(--color-text-muted)',
        border: '1px solid var(--color-border)',
        textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
      }}
    >
      {multiple ? 'Multiple' : 'Single'}
    </span>
  );
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

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

export default function DamaRolesPage({
  embedded = false,
  actionsPortal,
  focusRoleType,
}: {
  embedded?: boolean;
  actionsPortal?: HTMLElement | null;
  // When set, the page renders the single role's detail (holders / matrix /
  // assign) on its own route (/dama-roles/:roleType), matching the People
  // detail-page family — instead of the list + preview modal.
  focusRoleType?: string;
} = {}) {
  const { activeOrgId } = useOrgContext();
  // /dama-roles writes are governance:write = admin-only. Gate assignment /
  // removal so non-admins get a read-only roster ("Manage" links out stay).
  const { isAdmin } = usePermissions();
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
  const [manuals, setManuals] = useState<ManualRef[]>([]);
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
  const roleValidation = useFormValidation<FormData>({
    personId: (v, form) => (form?.assigneeType !== 'agent' && !v) ? 'Select a person to assign the role to.' : null,
    agentId: (v, form) => (form?.assigneeType === 'agent' && !v) ? 'Select an agent to assign the role to.' : null,
    scopeId: (v) => !v ? 'Select an organization.' : null,
  });
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Filter chips narrow the role list by *category* (Executive /
  // Business / Technical / Entity-attached) rather than by individual
  // role — one compact chip row instead of a pill per role across four
  // stacked rows. Clicking a table row still opens that specific role's
  // preview (previewRoleType), independent of this filter.
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Role-coverage card filter — narrows the table to roles that are unfilled,
  // required-and-unfilled, or have only a single holder. One at a time.
  const [coverageFilter, setCoverageFilter] = useState<'unfilled' | 'reqUnfilled' | 'single' | null>(null);
  // On the detail route (/dama-roles/:roleType) the trail ends on the role's
  // name ("Dashboard › Roles › Data Owner"); the list route registers no leaf.
  useBreadcrumbLeaf(focusRoleType ? (ROLE_TYPE_LABELS[focusRoleType] || focusRoleType) : undefined);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [rolesRes, summaryRes, peopleRes, agentsRes, orgsRes, domainsRes, systemsRes, assetsRes, manualsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DamaRoleAssignment[]; roleTypes: string[] }>(`/dama-roles${query}`),
        apiClient.get<{ success: boolean; data: Record<string, number> }>(`/dama-roles/summary${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        // agent:read is admin-only; degrade to an empty list for non-admins
        // (403) instead of failing the page load.
        apiClient.get<{ success: boolean; data: AgentOption[] }>(`/agents${query}`).catch(() => ({ success: true, data: [] as AgentOption[] })),
        apiClient.get<{ success: boolean; data: OrgOption[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: DomainOption[] }>(`/data-domains${query}`),
        apiClient.get<{ success: boolean; data: SystemOption[] }>(`/systems${query}`).catch(() => ({ success: true, data: [] as SystemOption[] })),
        apiClient.get<{ success: boolean; data: AssetOption[] }>(`/data-assets${query}`).catch(() => ({ success: true, data: [] as AssetOption[] })),
        apiClient.get<{ success: boolean; data: ManualRef[] }>(`/operations-manuals${query}`).catch(() => ({ success: true, data: [] as ManualRef[] })),
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
      setManuals(manualsRes.data || []);
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

  // roleType → the operations manual(s) that document it, for the reverse
  // role→manual link in the preview pane.
  const manualsByRole = useMemo(() => {
    const m = new Map<string, ManualRef[]>();
    for (const man of manuals) {
      if (!man.roleType) continue;
      const list = m.get(man.roleType);
      if (list) list.push(man); else m.set(man.roleType, [man]);
    }
    return m;
  }, [manuals]);

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
    } catch (err) {
      setError(errorMessage(err, 'Failed to assign role'));
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

  // One model per role, shared by the coverage cards, the category chips, and
  // the table, so counts never disagree.
  const roleCatalog = useMemo(() => {
    const set = new Set([...(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS)), ...Object.keys(ENTITY_SCOPED_ROLE_INFO)]);
    return Object.keys(ROLE_TYPE_LABELS).filter((rt) => set.has(rt));
  }, [roleTypes]);
  const roleModels = useMemo(
    () => roleCatalog.map((rt) => buildRoleModel(rt, roles, domains, systems, dataAssets, personById)),
    [roleCatalog, roles, domains, systems, dataAssets, personById],
  );
  // Coverage-card predicates. "Only one holder" flags a role that *can* take
  // several but currently has one — a shared role with no backup.
  const isUnfilled = (m: RoleModel) => !m.filled;
  const isReqUnfilled = (m: RoleModel) => m.required && !m.filled;
  const isSingleHolder = (m: RoleModel) => m.filled && m.several && m.holderCount === 1;
  const coverageCards = [
    { key: 'unfilled' as const, label: 'Unfilled roles', hint: 'Nobody holds these yet', tag: 'Fix first', count: roleModels.filter(isUnfilled).length },
    { key: 'reqUnfilled' as const, label: 'Required and unfilled', hint: 'Roles every program needs', tag: '', count: roleModels.filter(isReqUnfilled).length },
    { key: 'single' as const, label: 'Only one holder', hint: 'Shared roles with no backup', tag: '', count: roleModels.filter(isSingleHolder).length },
  ];
  // Category chips count *roles* (not holders), so "Entity-attached (12)" means
  // twelve roles, and "All Roles (17)" matches the table length.
  const catRoleCounts: Record<string, number> = {};
  for (const m of roleModels) if (m.category) catRoleCounts[m.category] = (catRoleCounts[m.category] || 0) + 1;
  const populatedRoleCategories = CATEGORY_ORDER.filter((cat) => (catRoleCounts[cat] || 0) > 0);

  // The table's visible rows — category chip, coverage card, and the search
  // box all narrow the same model list.
  const coverageTest = coverageFilter === 'unfilled' ? isUnfilled : coverageFilter === 'reqUnfilled' ? isReqUnfilled : coverageFilter === 'single' ? isSingleHolder : null;
  const q = searchQuery.trim().toLowerCase();
  const tableModels = roleModels.filter((m) => {
    if (filterCategory && m.category !== filterCategory) return false;
    if (coverageTest && !coverageTest(m)) return false;
    if (q && !`${m.label} ${m.category || ''} ${m.holderNames.join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const anyFilter = !!filterCategory || !!coverageFilter || !!q;
  const clearFilters = () => { setFilterCategory(null); setCoverageFilter(null); setSearchQuery(''); };

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
      {focusRoleType ? (
        <PageHeader
          kicker="Governance role"
          title={ROLE_TYPE_LABELS[focusRoleType] || focusRoleType}
          subtitle={ROLE_CATEGORIES[focusRoleType] ? `${ROLE_CATEGORIES[focusRoleType]} role` : undefined}
          actions={<Link to="/dama-roles" style={backLinkStyle}>{'←'} Back to Roles</Link>}
        />
      ) : (
        <>
          <EmbeddablePageHeader
            embedded={embedded}
            actionsPortal={actionsPortal}
            title="Governance Roles"
            subtitle="Assign data management governance roles to people across organizations and data domains."
            actions={
              <ListToolbar
                views={
                  <SavedViewsMenu
                    pageKey="dama-roles"
                    currentFilters={{ filterCategory, searchQuery }}
                    onApply={(f) => {
                      setFilterCategory((f.filterCategory as string | null) ?? null);
                      setSearchQuery((f.searchQuery as string) || '');
                    }}
                  />
                }
                export={
                  roles.length > 0 ? (
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
                  ) : undefined
                }
                primary={isAdmin ? <Button variant="primary" onClick={openAdd}>+ Assign role</Button> : undefined}
              />
            }
          >
          </EmbeddablePageHeader>
        </>
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
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--color-error)' }}>
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
                        {t === 'agent'
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{renderNavIcon('/agents', { size: 12, strokeWidth: 2 })}Agent</span>
                          : 'Person'}
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
                <select aria-label="Agent" style={{ ...selectStyle, border: roleValidation.fieldError('agentId') ? inputErrorBorder : selectStyle.border }} value={form.agentId}
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
                <select aria-label="Governance Role" style={selectStyle} value={form.roleType} onChange={(e) => {
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
                  {/* Entity-attached roles (Data Owner, stewards, custodians,
                      architect, …) belong here too. Without this optgroup a
                      "+ Assign" on any of those rows pre-selected a roleType the
                      dropdown had no <option> for, so it silently displayed the
                      first option (Chief Data Officer) instead of the chosen role. */}
                  <optgroup label="Entity-attached">
                    {(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS)).filter((rt) => ROLE_CATEGORIES[rt] === 'Entity-attached').map((rt) => (
                      <option key={rt} value={rt}>{ROLE_TYPE_LABELS[rt] || rt}</option>
                    ))}
                  </optgroup>
                  {/* Anything without a known category still needs to be
                      selectable, so it can't fall through to a wrong default. */}
                  <optgroup label="Other">
                    {(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS)).filter((rt) => !CATEGORY_ORDER.includes(ROLE_CATEGORIES[rt] as any)).map((rt) => (
                      <option key={rt} value={rt}>{ROLE_TYPE_LABELS[rt] || rt}</option>
                    ))}
                  </optgroup>
                </select>
              )}
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {roleAllowsMultiple(form.roleType)
                  ? 'Multiple holders — you can assign more than one person or agent to this role.'
                  : 'Single holder — exactly one person or agent holds this role.'}
              </div>
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
                <select aria-label="Organization" style={{ ...selectStyle, border: roleValidation.fieldError('scopeId') ? inputErrorBorder : selectStyle.border }} value={form.scopeId}
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
            <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
            {(() => {
              const idFilled = form.assigneeType === 'agent' ? !!form.agentId : !!form.personId;
              const incomplete = !idFilled || !form.scopeId;
              return (
                <Button
                  variant="primary"
                  disabled={incomplete}
                  onClick={handleSave}
                >
                  Assign Role
                </Button>
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

      {/* ── List body (hidden on the single-role detail route) ──
       *  Same scan pattern as /data-assets, /systems, and /decision-rights:
       *  category filter chips above a flat role catalog. Clicking a row
       *  navigates to that role's detail route. */}
      {!focusRoleType && !loading && (
      <div>
        {/* Role coverage — the staffing gaps worth acting on first. Each card
            filters the table when clicked. */}
        <section aria-label="Role coverage" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Role coverage</h2>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Click a card to filter the table</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            {coverageCards.map((card) => {
              const active = coverageFilter === card.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => setCoverageFilter(active ? null : card.key)}
                  aria-pressed={active}
                  style={{
                    textAlign: 'left', cursor: 'pointer', borderRadius: 'var(--radius-md)', padding: '14px 16px',
                    display: 'flex', flexDirection: 'column', gap: 4, minHeight: 88, boxSizing: 'border-box',
                    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: active ? 'var(--color-primary-light)' : 'var(--color-surface)',
                    boxShadow: active ? '0 0 0 1px var(--color-primary)' : 'var(--shadow-sm)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: card.count > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{card.count}</span>
                    {card.count > 0 && card.tag && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-warning)' }}>{card.tag}</span>}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{card.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{card.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        <Card padding={0} shadow="none" style={{ overflow: 'hidden' }}>
          {/* Toolbar: search + category chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ flex: '1 1 260px', minWidth: 200, display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', background: 'var(--color-surface)' }}>
              <span aria-hidden="true" style={{ fontSize: 13 }}>&#128269;</span>
              <input type="search" aria-label="Search roles" placeholder="Search by person, organization or role" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ border: 0, outline: 'none', flex: 1, font: 'inherit', fontSize: 13, color: 'var(--color-text)', background: 'transparent', minWidth: 0 }} />
            </div>
            {populatedRoleCategories.length >= 2 && (
              <div role="group" aria-label="Category" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([['All', null] as const, ...populatedRoleCategories.map((c) => [c, c] as const)]).map(([label, val]) => {
                  const active = filterCategory === val;
                  const count = val === null ? roleModels.length : (catRoleCounts[val] || 0);
                  return (
                    <button key={label} type="button" onClick={() => setFilterCategory(val)} aria-pressed={active}
                      style={{ height: 32, padding: '0 12px', borderRadius: 16, border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, background: active ? 'var(--color-primary-light)' : 'var(--color-surface)', color: active ? 'var(--color-primary)' : 'var(--color-text)', fontWeight: active ? 600 : 400, fontSize: 13, cursor: 'pointer' }}>
                      {label} <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)' }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {anyFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Showing {tableModels.length} of {roleModels.length} roles
              <button type="button" onClick={clearFilters} style={{ border: 0, background: 'transparent', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>Clear filters</button>
            </div>
          )}
          <RolesTable
            rows={tableModels}
            programInUse={roles.length > 0}
            onSelectRole={(rt) => navigate(`/dama-roles/${rt}`)}
            onAssign={openAddForRole}
            canEdit={isAdmin}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', fontSize: 13, color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
            <span>Roles {tableModels.length}</span>
            <span>"Per data domain / system / asset" roles are assigned on that item's own page.</span>
          </div>
        </Card>
      </div>
      )}
      {!focusRoleType && loading && <Card padding={0} shadow="none"><SkeletonRows rows={6} columns={5} /></Card>}

      {/* ── Single-role detail (the /dama-roles/:roleType route) ──
       *  Reuses the same RolePreviewPane the modal used, rendered as the
       *  page body inside a Card. Assign / remove actions reuse the shared
       *  assign form + confirm dialog above. */}
      {focusRoleType && (
        loading ? (
          <Card><SkeletonRows rows={4} columns={2} /></Card>
        ) : (
          <Card padding={0}>
            <RolePreviewPane
              bare
              roleType={focusRoleType}
              dama={roles.filter((r) => r.roleType === focusRoleType)}
              domains={domains}
              systems={systems}
              dataAssets={dataAssets}
              personById={personById}
              manuals={manualsByRole.get(focusRoleType) || []}
              roleBadge={roleBadge}
              resolveScope={resolveScope}
              onClose={() => navigate('/dama-roles')}
              onAssign={() => openAddForRole(focusRoleType)}
              onAssignToEntity={openAddForEntity}
              navigateToEntity={navigateToEntity}
              onOpenDrawer={openRoleDrawer}
              setConfirmDelete={setConfirmDelete}
              canEdit={isAdmin}
            />
          </Card>
        )
      )}
    </div>
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
function renderEntityMatrix({ rt, info, dama, domains, systems, dataAssets, personById, onAssignToEntity, navigateToEntity, setConfirmDelete, canEdit }: {
  rt: string;
  info: EntityRoleScope;
  /** Admin (governance:write). Non-admins get the read-only matrix. */
  canEdit: boolean;
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
          const showRowAction = (empty || info.cardinality === 'many') && (info.storage !== 'dama' || canEdit);
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
                      {h.assignmentId && canEdit && (
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

// ── Table styles (match the People page) ──────────────────────────────
const tableThStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const tableTdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--color-border)',
};

// ── RolesTable ────────────────────────────────────────────────────────
// Mirrors the People page's flat-list pattern: one row per role with
// columns for Role, Holders, Status, Action. Clicking a row opens the
// role's detail in the right preview pane (matrix / holders list /
// purpose). Replaces the previous nested-cards layout.
function RolesTable({ rows, programInUse, onSelectRole, onAssign, canEdit }: {
  rows: RoleModel[];
  programInUse: boolean;
  onSelectRole: (rt: string) => void;
  onAssign: (rt: string) => void;
  canEdit: boolean;
}) {
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!rowMenuId) return;
    const close = () => setRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId]);

  const openRow = (rt: string) => onSelectRole(rt);

  return (
    <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', minWidth: 940, borderCollapse: 'collapse', fontSize: 14 }}>
      <thead>
        <tr>
          <th scope="col" style={{ ...tableThStyle, paddingLeft: 16 }}>Role</th>
          <th scope="col" style={{ ...tableThStyle, width: 140 }}>Category</th>
          <th scope="col" style={{ ...tableThStyle, width: 180 }} title="How many people can hold it, and over what">Who can hold it</th>
          <th scope="col" style={tableThStyle}>Holders</th>
          <th scope="col" style={{ ...tableThStyle, width: 150 }}>Status</th>
          <th scope="col" style={{ ...tableThStyle, width: 130, textAlign: 'right', paddingRight: 16 }}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={6} style={{ ...tableTdStyle, color: 'var(--color-text-muted)', textAlign: 'center', padding: 24 }}>
            No roles match the current filter.
          </td></tr>
        )}
        {rows.map((m) => {
          const criticalGap = m.required && !m.filled && programInUse;
          const canAdd = m.filled && m.several;
          return (
            <tr
              key={m.rt}
              onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="button"]')) return; openRow(m.rt); }}
              style={{ cursor: 'pointer', transition: 'background 0.1s' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
            >
              <td style={{ ...tableTdStyle, paddingLeft: 16 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" onClick={() => openRow(m.rt)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>{m.label}</button>
                  {m.required && (
                    <span title="Every governance program should have someone in this role" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '1px 8px' }}>Required</span>
                  )}
                </span>
              </td>
              <td style={{ ...tableTdStyle, color: 'var(--color-text-secondary)' }}>{m.category || '—'}</td>
              <td style={{ ...tableTdStyle, color: 'var(--color-text-secondary)' }}>{m.scopeText}</td>
              <td style={tableTdStyle}>
                {m.filled ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-flex' }}>
                      {m.holderNames.slice(0, 3).map((n, i) => (
                        <span key={i} style={{ marginRight: -6, border: '2px solid var(--color-surface)', borderRadius: 999, display: 'inline-flex' }}><Avatar name={n} size="sm" /></span>
                      ))}
                    </span>
                    <span style={{ marginLeft: 6, color: 'var(--color-text-secondary)' }}>{m.holderNames.slice(0, 3).join(', ')}</span>
                    {m.holderCount > 3 && <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>+{m.holderCount - 3} more</span>}
                  </span>
                ) : canEdit ? (
                  <button type="button" onClick={() => onAssign(m.rt)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, background: 'none', border: 0, cursor: 'pointer', color: 'var(--color-primary)' }}>
                    <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 13, border: '1px dashed var(--color-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1 }}>+</span>
                    Assign someone
                  </button>
                ) : <span style={{ color: 'var(--color-text-muted)' }}>No holders</span>}
              </td>
              <td style={tableTdStyle}>
                {m.filled ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 13, fontSize: 13, fontWeight: 600, background: '#dcefe5', color: '#17604b' }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor' }} />Filled</span>
                ) : criticalGap ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 13, fontSize: 13, fontWeight: 600, background: '#fbe4e4', color: '#a4262c' }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor' }} />Required, unfilled</span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 13, fontSize: 13, fontWeight: 600, background: '#fbe9d9', color: '#9a4a0e' }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor' }} />Unfilled</span>
                )}
              </td>
              <td style={{ ...tableTdStyle, textAlign: 'right', paddingRight: 16, whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {canEdit && canAdd && (
                    <button type="button" onClick={() => onAssign(m.rt)} style={{ height: 32, padding: '0 12px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Add holder</button>
                  )}
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <button type="button" aria-label={`More actions for ${m.label}`} aria-haspopup="menu" aria-expanded={rowMenuId === m.rt} onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === m.rt ? null : m.rt); }} style={{ width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8, color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
                    {rowMenuId === m.rt && (
                      <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 170, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                        <button type="button" role="menuitem" onClick={() => { setRowMenuId(null); openRow(m.rt); }} style={rolesMenuItemStyle}>Open role</button>
                        {canEdit && <button type="button" role="menuitem" onClick={() => { setRowMenuId(null); onAssign(m.rt); }} style={rolesMenuItemStyle}>{m.filled ? 'Add holder' : 'Assign someone'}</button>}
                      </div>
                    )}
                  </span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

const rolesMenuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};

// ── RolePreviewPane ──────────────────────────────────────────────────
// Right rail (340px), mirrors the People page's 360° preview pane.
// Opens when a table row is clicked. Shows role purpose, holders
// (org-scoped) or per-entity matrix (entity-attached), and an Assign
// action.
function RolePreviewPane({
  roleType, dama, domains, systems, dataAssets, personById, manuals,
  roleBadge, resolveScope, onClose, onAssign, onAssignToEntity,
  navigateToEntity, onOpenDrawer, setConfirmDelete, canEdit, inline = false, bare = false,
}: {
  canEdit: boolean;
  /** Rendered inline beneath the clicked row (no sticky rail, no close ×). */
  inline?: boolean;
  /** Rendered inside a <Modal> body — drop the card chrome and the close ×
   *  (the modal supplies both). */
  bare?: boolean;
  roleType: string;
  dama: DamaRoleAssignment[];
  domains: DomainOption[];
  systems: SystemOption[];
  dataAssets: AssetOption[];
  personById: Map<string, string>;
  manuals: ManualRef[];
  roleBadge: (rt: string) => React.CSSProperties;
  resolveScope: (id: string) => { kind: 'ORG' | 'DOMAIN' | 'SYSTEM' | 'ASSET' | 'UNKNOWN'; name: string };
  onClose: () => void;
  onAssign: () => void;
  onAssignToEntity: (rt: string, scopeType: 'DOMAIN', scopeId: string) => void;
  navigateToEntity: (entityType: 'domain' | 'system' | 'asset', entityId: string) => void;
  onOpenDrawer: (rt: string) => void;
  setConfirmDelete: (id: string) => void;
}) {
  const info = entityRoleInfo(roleType);
  const def = GOVERNANCE_ROLES.find((r) => r.roleType === roleType);
  const purpose = def?.purpose || '';
  const required = REQUIRED_ROLE_TYPES.has(roleType);
  const navigate = useNavigate();
  const openManual = () => navigate('/documentation?tab=manual');

  return (
    <Card padding={0} shadow="none" borderColor={bare ? 'transparent' : undefined} style={bare ? { margin: 0, border: 'none', background: 'transparent' } : inline ? { margin: 12 } : { position: 'sticky', top: 12, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onOpenDrawer(roleType)}
          title="Learn about this role"
          style={{ ...roleBadge(roleType), border: 'none', cursor: 'pointer', padding: '3px 10px', font: 'inherit' }}
        >
          {ROLE_TYPE_LABELS[roleType] || roleType}
        </button>
        {required && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
            background: 'transparent', color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>Required</span>
        )}
        <CardinalityChip roleType={roleType} />
        {!inline && !bare && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}
          >×</button>
        )}
      </div>

      {purpose && (
        <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, borderBottom: '1px solid var(--color-border)' }}>
          {purpose}
        </div>
      )}

      {info ? (
        // Entity-attached: render the per-entity matrix.
        renderEntityMatrix({
          rt: roleType, info,
          dama, domains, systems, dataAssets, personById,
          onAssignToEntity, navigateToEntity, setConfirmDelete, canEdit,
        })
      ) : (
        // Org-scoped: render the simple holder list.
        <div style={{ padding: 0 }}>
          {dama.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-text-muted)' }}>
              No one holds this role yet.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {dama.map((r) => {
                const isAgent = !!r.agentId;
                const displayName = isAgent ? (r.agentName || 'Agent') : (r.personName || 'Unknown');
                return (
                  <li key={r.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 8, alignItems: 'center', padding: '8px 14px', borderTop: '1px solid var(--color-border)', fontSize: 13 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: isAgent ? '#ede9fe' : '#e0e7ff',
                      color: isAgent ? '#5b21b6' : '#3730a3',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, flexShrink: 0,
                    }}>
                      {isAgent ? renderNavIcon('/agents', { size: 13, strokeWidth: 2.4 }) : displayName.charAt(0).toUpperCase()}
                    </span>
                    <span style={{ fontWeight: 500 }}>{displayName}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      <ScopeChip scope={resolveScope(r.scopeId)} rawId={r.scopeId} />
                    </span>
                    {canEdit && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(r.id)} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Reverse of the manual→role link authored on the Documentation page:
          the operations manual(s) that document this role's cadence. Shown for
          manual-eligible roles, or any role that already has a manual. */}
      {(manuals.length > 0 || MANUAL_ELIGIBLE_ROLES.has(roleType)) && (
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)' }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 6 }}>
          Operations manual
        </div>
        {manuals.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            No manual documents this role yet.{canEdit && <> <button type="button" onClick={openManual} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-primary)', font: 'inherit', fontSize: 12 }}>Add one →</button></>}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {manuals.map((man) => (
              <li key={man.id}>
                <button
                  type="button"
                  onClick={openManual}
                  title={`Open "${man.label}" on the Documentation page`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 4,
                    padding: '6px 10px', cursor: 'pointer', font: 'inherit', fontSize: 13, color: 'var(--color-primary)',
                  }}
                >
                  <span style={{ display: 'inline-flex', flexShrink: 0 }}>{renderNavIcon('/documentation', { size: 13 })}</span>
                  <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{man.label}</span>
                  <span aria-hidden="true" style={{ flexShrink: 0 }}>&rarr;</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {canEdit && (
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={onAssign}
          style={{ width: '100%' }}
        >
          + Assign
        </Button>
      </div>
      )}
    </Card>
  );
}
