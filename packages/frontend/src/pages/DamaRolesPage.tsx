import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
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
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';
import { formatPersonLabel } from '../lib/personLabel';
import { useRefreshOnFocus } from '../hooks/usePolling';

interface DamaRoleAssignment {
  id: string;
  personId: string;
  personName: string;
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
};

const ROLE_CATEGORIES: Record<string, string> = {
  CDO: 'Executive', DATA_GOVERNANCE_LEAD: 'Executive',
  DATA_OWNER: 'Business', BUSINESS_DATA_STEWARD: 'Business', DATA_QUALITY_ANALYST: 'Business',
  TECHNICAL_DATA_STEWARD: 'Technical', DATA_CUSTODIAN: 'Technical', DATA_ARCHITECT: 'Technical',
  DATA_ENGINEER: 'Technical', DATABASE_ADMINISTRATOR: 'Technical',
};

const ROLE_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  // Executive — pink/purple
  CDO: { bg: '#fce7f3', color: '#9d174d' },
  DATA_GOVERNANCE_LEAD: { bg: '#ede9fe', color: '#5b21b6' },
  // Business — blue/teal
  DATA_OWNER: { bg: '#dbeafe', color: '#1e40af' },
  BUSINESS_DATA_STEWARD: { bg: '#d1f0eb', color: '#0f4f46' },
  DATA_QUALITY_ANALYST: { bg: '#f0fdf4', color: '#166534' },
  // Technical — amber/slate
  TECHNICAL_DATA_STEWARD: { bg: '#fef3c7', color: '#92400e' },
  DATA_CUSTODIAN: { bg: '#e2e8f0', color: '#475569' },
  DATA_ARCHITECT: { bg: '#e0e7ff', color: '#3730a3' },
  DATA_ENGINEER: { bg: '#fef9c3', color: '#854d0e' },
  DATABASE_ADMINISTRATOR: { bg: '#f1f5f9', color: '#64748b' },
};

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
  personId: string;
  roleType: string;
  scopeType: 'ORG';
  scopeId: string;
}

const emptyForm: FormData = { personId: '', roleType: 'CDO', scopeType: 'ORG', scopeId: '' };

export default function DamaRolesPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const openRoleDrawer = useRoleDrawerStore((s) => s.open);
  const [roles, setRoles] = useState<DamaRoleAssignment[]>([]);
  const [roleTypes, setRoleTypes] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [, setDomains] = useState<DomainOption[]>([]);
  // Counts come from the local `roles` list now (see roleCounts below);
  // the /summary endpoint is still fetched so future per-role analytics
  // have a single source of truth, but the result is intentionally
  // unused at the moment.
  const [, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const roleValidation = useFormValidation({
    personId: (v: any) => !v ? 'Select a person to assign the role to.' : null,
    scopeId: (v: any) => !v ? 'Select an organization.' : null,
  });
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [filterRoleType, setFilterRoleType] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [rolesRes, summaryRes, peopleRes, orgsRes, domainsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DamaRoleAssignment[]; roleTypes: string[] }>(`/dama-roles${query}`),
        apiClient.get<{ success: boolean; data: Record<string, number> }>(`/dama-roles/summary${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: OrgOption[] }>('/organizations'),
        apiClient.get<{ success: boolean; data: DomainOption[] }>(`/data-domains${query}`),
      ]);
      setRoles(rolesRes.data || []);
      setRoleTypes(rolesRes.roleTypes || []);
      setSummary(summaryRes.data || {});
      setPeople(peopleRes.data || []);
      setOrgs(orgsRes.data || []);
      setDomains(domainsRes.data || []);
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

  // Open the assign form pre-filled with a specific governance role —
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
    try {
      await apiClient.post('/dama-roles', form);
      addToast('success', 'Governance role assigned');
      setShowForm(false);
      setForm(emptyForm);
      fetchData();
    } catch (err: any) {
      setError(err?.message || 'Failed to assign role');
    }
  };

  const handleRemove = async (id: string) => {
    await apiClient.delete(`/dama-roles/${id}`);
    addToast('success', 'Governance role removed');
    fetchData();
  };

  const handleCancel = () => { setShowForm(false); setError(''); setForm(emptyForm); };

  const scopeNameForFilter = useCallback((scopeId: string) => {
    return orgs.find((o) => o.id === scopeId)?.name || '';
  }, [orgs]);

  // Apply role filter and free-text search against person name + org name.
  const filteredRoles = roles.filter((r) => {
    if (filterRoleType && r.roleType !== filterRoleType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${r.personName} ${scopeNameForFilter(r.scopeId)} ${ROLE_TYPE_LABELS[r.roleType] || r.roleType}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Per-role counts for the sidebar - based on the unfiltered roles list
  // so sidebar always shows the full distribution, not what's left after
  // a search filters things out.
  const roleCounts: Record<string, number> = {};
  for (const r of roles) roleCounts[r.roleType] = (roleCounts[r.roleType] || 0) + 1;

  const scopeName = (scopeId: string) => {
    return orgs.find((o) => o.id === scopeId)?.name || scopeId;
  };

  const roleBadge = (roleType: string): React.CSSProperties => {
    const c = ROLE_TYPE_COLORS[roleType] || { bg: '#f1f5f9', color: '#64748b' };
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
              headers: ['Person', 'Governance Role', 'Organization', 'Since'],
              rows: roles.map((r) => [
                r.personName,
                ROLE_TYPE_LABELS[r.roleType] || r.roleType,
                scopeName(r.scopeId),
                new Date(r.since).toLocaleDateString(),
              ]),
            })} />
          )}
          <IconButton icon="plus" label="Assign role" variant="primary" onClick={openAdd} />
        </>}
      >
        <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} aria-label="Help" title="Help">?</Link>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Person *</label>
              <select style={{ ...selectStyle, border: roleValidation.fieldError('personId') ? inputErrorBorder : selectStyle.border }} value={form.personId}
                onChange={(e) => setForm({ ...form, personId: e.target.value })}
                onBlur={() => { roleValidation.touch('personId'); roleValidation.validateField('personId', form.personId, form); }}>
                <option value="">-- Select person --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
              </select>
              {roleValidation.fieldError('personId') && <div style={fieldErrorStyle}>{roleValidation.fieldError('personId')}</div>}
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Governance Role *</label>
              <select style={selectStyle} value={form.roleType} onChange={(e) => setForm({ ...form, roleType: e.target.value })}>
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
            </div>
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
                Domain ownership (owner/steward) is managed directly on the Data Domain.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.personId || !form.scopeId ? 0.6 : 1, cursor: !form.personId || !form.scopeId ? 'not-allowed' : 'pointer' }}
              disabled={!form.personId || !form.scopeId}
              onClick={handleSave}
            >
              Assign Role
            </button>
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
       *  /decision-rights. The sidebar now lists every governance role —
       *  filled or not — so the user can see the whole slate at a glance
       *  and click into any role, including ones nobody currently holds. */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
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
          {Object.keys(ROLE_TYPE_LABELS).map((rt) => {
            const count = roleCounts[rt] || 0;
            const isActive = filterRoleType === rt;
            const c = ROLE_TYPE_COLORS[rt] || { bg: '#f1f5f9', color: '#64748b' };
            return (
              <SidebarItem
                key={rt}
                label={ROLE_TYPE_LABELS[rt]}
                count={count}
                active={isActive}
                onClick={() => setFilterRoleType(isActive ? null : rt)}
                accent={c.color}
              />
            );
          })}
        </div>

        <div>
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            {loading ? (
              <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
            ) : (
              <ByRoleView
                roles={filteredRoles}
                catalog={(roleTypes.length > 0 ? roleTypes : Object.keys(ROLE_TYPE_LABELS))}
                filterRoleType={filterRoleType}
                roleBadge={roleBadge}
                scopeName={scopeName}
                openRoleDrawer={openRoleDrawer}
                onAssign={openAddForRole}
                setConfirmDelete={setConfirmDelete}
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
function SidebarItem({ label, count, active, onClick, accent }: {
  label: string; count: number; active: boolean; onClick: () => void; accent?: string;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
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

// ── By-Role view ──────────────────────────────────────────────────────────
// One section per role type, showing the people who hold that role. The
// section header is clickable to open the Role Detail drawer.
function ByRoleView({ roles, catalog, filterRoleType, roleBadge, scopeName, openRoleDrawer, onAssign, setConfirmDelete }: {
  roles: DamaRoleAssignment[];
  /** Full governance-role catalog so every role is listed even with
   *  zero holders (consistent with the Governance Groups expected-role
   *  slate). */
  catalog: string[];
  filterRoleType: string | null;
  roleBadge: (rt: string) => React.CSSProperties;
  scopeName: (id: string) => string;
  openRoleDrawer: (rt: string) => void;
  onAssign: (rt: string) => void;
  setConfirmDelete: (id: string) => void;
}) {
  const byRole = new Map<string, DamaRoleAssignment[]>();
  for (const r of roles) {
    if (!byRole.has(r.roleType)) byRole.set(r.roleType, []);
    byRole.get(r.roleType)!.push(r);
  }
  // Iterate the whole catalog in canonical ROLE_TYPE_LABELS order
  // (executive first), not just roles that happen to have holders. When
  // a specific role filter is active, show only that section.
  const catalogSet = new Set(catalog);
  const ordered = Object.keys(ROLE_TYPE_LABELS)
    .filter((rt) => catalogSet.has(rt))
    .filter((rt) => !filterRoleType || rt === filterRoleType);
  return (
    <div>
      {ordered.map((rt) => {
        const list = (byRole.get(rt) || []).slice().sort((a, b) => a.personName.localeCompare(b.personName));
        const filled = list.length > 0;
        return (
          <div key={rt} style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--color-bg)' }}>
              <button
                type="button"
                onClick={() => openRoleDrawer(rt)}
                title="Learn about this role"
                style={{ ...roleBadge(rt), border: 'none', cursor: 'pointer', font: 'inherit', padding: '3px 10px' }}
              >
                {ROLE_TYPE_LABELS[rt] || rt}
              </button>
              {filled ? (
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{list.length} held</span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#b45309' }}>Unfilled</span>
              )}
              <button
                type="button"
                onClick={() => onAssign(rt)}
                style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--color-primary)' }}
              >
                + Assign
              </button>
            </div>
            {filled ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {list.map((r) => (
                  <li key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', alignItems: 'center', gap: 12, padding: '6px 14px', fontSize: 13 }}>
                    <span style={{ fontWeight: 500 }}>{r.personName}</span>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{scopeName(r.scopeId)}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>since {new Date(r.since).toLocaleDateString()}</span>
                    <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(r.id)} />
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                No one holds this role yet.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
