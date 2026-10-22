import { useEffect, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useScrollLock } from '../hooks/useScrollLock';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import Modal from './Modal';
import PageHeader from './PageHeader';
import { useBreadcrumbLeaf } from './BreadcrumbContext';
import WhereUsed, { WhereUsedGroup } from './WhereUsed';
import CommentsPanel from './CommentsPanel';
import ActivityFeed from './ActivityFeed';
import EditableField from './EditableField';
import DetailEditActions from './DetailEditActions';
import SectionLabel from './SectionLabel';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { successToast, errorToast } from '../lib/errorToast';
import { useTierLabel, TIER_COLORS, tierKey } from '../lib/governanceTier';
import CertifiedBadge from './CertifiedBadge';
import { useTerm } from '../lib/terminology';
import Avatar from './Avatar';
import { useOrgNameLookup } from '../hooks/useOrgNameLookup';
import { relativeTime, absoluteTime } from '../lib/relativeTime';

const CRITICALITY_OPTS = [
  { value: '', label: '— None —' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];
const CONNECTIVITY_OPTS = [
  { value: 'INTEGRATED', label: 'Integrated' },
  { value: 'MANUAL', label: 'Manual' },
  { value: 'EXTERNAL', label: 'External' },
];

interface SystemEditable {
  name: string;
  description: string;
  systemType: string;
  businessCriticality: string;
  vendor: string;
  connectivity: string;
  ownerPersonId: string;
  deputyOwnerId: string;
}

// ──────────────────────────────────────────────────────────────────────────
// SystemDetailModal — the cross-layer view for a single System.
//
// Pulls /systems/:id/360 and feeds the result into the shared WhereUsed
// panel. Same shape will be reused on Asset, Activity, Person, and other
// detail surfaces so users learn one navigation pattern.
// ──────────────────────────────────────────────────────────────────────────

interface SystemSummary {
  id: string;
  name: string;
  description?: string;
  systemType?: string;
  businessCriticality?: string;
  vendor?: string;
  connectivity?: string;
  orgId?: string;
  updatedAt?: string;
  ownerName?: string | null;
  deputyOwnerName?: string | null;
  integrations?: Array<{
    id?: string;
    targetSystemId: string;
    targetSystemName?: string | null;
    interfaceType: string;
    frequency?: string;
    direction: 'INBOUND' | 'OUTBOUND' | 'BIDIRECTIONAL';
  }>;
  referencedByIntegrations?: Array<{
    systemId: string;
    systemName: string;
    interfaceType: string;
    frequency?: string;
    direction: string;
  }>;
}

const DIRECTION_LABEL: Record<string, string> = {
  OUTBOUND: 'sends to', INBOUND: 'receives from', BIDIRECTIONAL: 'two-way with',
};
// The inverse arrow for the "referenced by" view: another system's
// OUTBOUND edge means data arrives here, so we render it as "receives from".
const INVERSE_DIRECTION_LABEL: Record<string, string> = {
  OUTBOUND: 'receives from', INBOUND: 'sends to', BIDIRECTIONAL: 'two-way with',
};
function prettyToken(v?: string): string {
  if (!v) return '';
  return v.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

interface SystemThreeSixty {
  system: SystemSummary;
  linkedConnections: { id: string; name: string; connectionType?: string; status?: string }[];
  assetsHere: { id: string; name: string; governanceTier?: string; healthScore?: number | null; certificationStatus?: string; certifiedUntil?: string | null }[];
  dependentActivities: { id: string; name: string; path: string }[];
  ownership: {
    owner: { id: string; name: string | null } | null;
    deputy: { id: string; name: string | null } | null;
    custodians: { id: string; name: string; title: string | null }[];
  };
}

interface Props {
  systemId: string;
  onClose: () => void;
  /** People for the owner / deputy selects (edit mode). */
  people?: Array<{ id: string; name: string }>;
  /** System-type options for the type select (edit mode). */
  systemTypes?: string[];
  /** Gate the in-modal Edit affordance. */
  canWrite?: boolean;
  /** Called after a successful save so the list behind can refresh. */
  onSaved?: () => void;
  /** Escape hatch to the full editor (integrations, custodians, connections)
   *  that the in-modal quick-edit doesn't cover. */
  onEditFull?: () => void;
  /** Render as a routed detail page (PageHeader + Back) instead of a modal —
   *  the /systems/:id surface. Same body either way. */
  asPage?: boolean;
}

const backLinkStyle: CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

export default function SystemDetailModal({ systemId, onClose, people = [], systemTypes = [], canWrite = false, onSaved, onEditFull, asPage = false }: Props) {
  useScrollLock(!!systemId && !asPage);
  const navigate = useNavigate();
  const custodianLabel = useTerm('custodian');
  const tierLabel = useTierLabel();
  const { getOrgName } = useOrgNameLookup();
  const [data, setData] = useState<SystemThreeSixty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Page tabs (asPage view) + the header "⋯" menu.
  const [tab, setTab] = useState<'overview' | 'discussion' | 'history'>('overview');
  const [headerMenu, setHeaderMenu] = useState(false);
  useEffect(() => {
    if (!headerMenu) return;
    const close = () => setHeaderMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [headerMenu]);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: SystemThreeSixty }>(`/systems/${systemId}/360`);
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load system');
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const sys = data?.system;
  const m = useDetailEditMode<SystemEditable>(
    {
      name: sys?.name ?? '',
      description: sys?.description ?? '',
      systemType: sys?.systemType ?? '',
      businessCriticality: sys?.businessCriticality ?? '',
      vendor: sys?.vendor ?? '',
      connectivity: sys?.connectivity ?? 'INTEGRATED',
      ownerPersonId: data?.ownership.owner?.id ?? '',
      deputyOwnerId: data?.ownership.deputy?.id ?? '',
    },
    async (draft) => {
      try {
        await apiClient.put(`/systems/${systemId}`, draft);
        successToast('System updated');
        await fetchDetail();
        onSaved?.();
      } catch (err) { errorToast(err, 'Failed to update system'); throw err; }
    },
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const goto = (path: string) => { onClose(); navigate(path); };

  const groups: WhereUsedGroup[] = data ? [
    {
      title: 'Linked Connections',
      hint: 'How this system gets data in and out.',
      emptyText: 'No connections linked yet.',
      items: data.linkedConnections.map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: [c.connectionType, c.status].filter(Boolean).join(' · ') || undefined,
        onClick: () => goto(`/connections?highlight=${encodeURIComponent(c.id)}`),
      })),
    },
    {
      title: 'Data Assets here',
      hint: 'Assets registered as living in this system.',
      emptyText: 'No assets registered in this system yet.',
      items: data.assetsHere.map((a) => ({
        id: a.id,
        label: a.name,
        sublabel: [
          a.governanceTier ? tierLabel(a.governanceTier) : null,
          typeof a.healthScore === 'number' ? `${a.healthScore}% health` : null,
        ].filter(Boolean).join(' · ') || undefined,
        onClick: () => goto(`/data-assets?highlight=${encodeURIComponent(a.id)}`),
      })),
    },
    {
      title: 'Dependent Activities',
      hint: 'Process activities that consume data from this system.',
      emptyText: 'No process activities depend on this system yet.',
      items: data.dependentActivities.map((act) => ({
        id: act.id,
        label: act.name,
        sublabel: act.path !== act.name ? act.path : undefined,
        onClick: () => goto(`/processes?highlight=${encodeURIComponent(act.id)}`),
      })),
    },
    {
      title: 'Ownership',
      hint: 'Who is accountable for this system.',
      emptyText: 'No owner, deputy, or custodian assigned.',
      items: [
        ...(data.ownership.owner && data.ownership.owner.name ? [{
          id: `owner-${data.ownership.owner.id}`,
          label: data.ownership.owner.name,
          badge: 'Owner',
          badgeRoleType: 'SYSTEM_OWNER',
          onClick: () => goto(`/people/${data.ownership.owner!.id}`),
        }] : []),
        ...(data.ownership.deputy && data.ownership.deputy.name ? [{
          id: `deputy-${data.ownership.deputy.id}`,
          label: data.ownership.deputy.name,
          badge: 'Deputy',
          badgeRoleType: 'SYSTEM_DEPUTY_OWNER',
          onClick: () => goto(`/people/${data.ownership.deputy!.id}`),
        }] : []),
        ...data.ownership.custodians.map((c) => ({
          id: `cust-${c.id}`,
          label: c.name,
          sublabel: c.title || undefined,
          badge: custodianLabel,
          badgeRoleType: 'SYSTEM_CUSTODIAN',
          onClick: () => goto(`/people/${c.id}`),
        })),
      ],
    },
  ] : [];

  // System metadata renders as a "·"-joined meta line under the title.
  // Only segments with a value contribute; empty ones drop out cleanly.
  const metaSegments = data?.system
    ? [
        data.system.systemType,
        data.system.vendor,
        data.system.businessCriticality && `${data.system.businessCriticality} criticality`,
        data.system.connectivity,
      ].filter(Boolean)
    : [];

  // On the /systems/:id route the trail ends on the system's name.
  useBreadcrumbLeaf(asPage ? data?.system.name : undefined);

  const editActions = data ? (
    <DetailEditActions
      editing={m.isEditing}
      canEdit={canWrite}
      dirty={m.dirty}
      saving={m.saving}
      onEdit={m.enter}
      onCancel={m.cancel}
      onSave={m.save}
    />
  ) : undefined;

  const editForm = (
    <>
      <SectionLabel style={{ marginBottom: 10 }}>Edit system</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <EditableField label="Name" editing value={m.draft.name} onChange={(v) => m.set('name', v)} placeholder="System name" />
        <EditableField label="Type" editing value={m.draft.systemType} onChange={(v) => m.set('systemType', v)} type="select" options={[{ value: '', label: '— None —' }, ...Array.from(new Set([...systemTypes, m.draft.systemType].filter(Boolean))).map((t) => ({ value: t, label: t }))]} />
        <EditableField label="Business criticality" editing value={m.draft.businessCriticality} onChange={(v) => m.set('businessCriticality', v)} type="select" options={CRITICALITY_OPTS} />
        <EditableField label="Vendor" editing value={m.draft.vendor} onChange={(v) => m.set('vendor', v)} placeholder="e.g. SAP" />
        <EditableField label="Connectivity" editing value={m.draft.connectivity} onChange={(v) => m.set('connectivity', v)} type="select" options={CONNECTIVITY_OPTS} />
        <EditableField label="Owner" editing value={m.draft.ownerPersonId} onChange={(v) => m.set('ownerPersonId', v)} type="select" options={[{ value: '', label: '— Unassigned —' }, ...people.map((p) => ({ value: p.id, label: p.name }))]} />
        <EditableField label="Deputy owner" editing value={m.draft.deputyOwnerId} onChange={(v) => m.set('deputyOwnerId', v)} type="select" options={[{ value: '', label: '— None —' }, ...people.map((p) => ({ value: p.id, label: p.name }))]} />
      </div>
      <div style={{ marginTop: 12 }}>
        <EditableField label="Description" editing type="textarea" value={m.draft.description} onChange={(v) => m.set('description', v)} placeholder="What this system does" />
      </div>
      {onEditFull && (
        <button
          type="button"
          onClick={onEditFull}
          style={{ marginTop: 14, background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
        >
          Edit integrations, custodians &amp; connections…
        </button>
      )}
    </>
  );

  const detailBody = (
    <>
        {/* Edit mode replaces the read-only 360 with the system's own fields;
            the relationships (where-used, integrations, discussion, history)
            are read-only context and hidden while editing. */}
        {m.isEditing && data ? (
          editForm
        ) : (
          <>
        {data?.system.description && (
          <p style={{ fontSize: 13, color: 'var(--color-text)', marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
            {data.system.description}
          </p>
        )}

        {loading && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0', textAlign: 'center' }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ fontSize: 13, color: '#b91c1c', padding: '12px 0' }}>
            {error}
          </div>
        )}
        {!loading && !error && data && (
          <>
            <WhereUsed
              hint="Everything this system touches — connections feeding it, assets living in it, activities depending on it, and the people accountable."
              groups={groups}
            />
            {(() => {
              const declared = data.system.integrations || [];
              const referenced = data.system.referencedByIntegrations || [];
              if (declared.length === 0 && referenced.length === 0) return null;
              const rowStyle: CSSProperties = {
                display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline',
                padding: '7px 0', borderTop: '1px solid var(--color-border)', fontSize: 13,
              };
              const meta = (iface?: string, freq?: string) => {
                const parts = [prettyToken(iface), prettyToken(freq)].filter(Boolean);
                return parts.length
                  ? <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>· {parts.join(' · ')}</span>
                  : null;
              };
              return (
                <div style={{ marginTop: 20 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    Integrations
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    How this system connects to others. Rows marked “(declared elsewhere)” were defined on the other system.
                  </div>
                  {declared.map((i, idx) => (
                    <div key={i.id || `d${idx}`} style={rowStyle}>
                      <span style={{ color: 'var(--color-text-muted)' }}>{DIRECTION_LABEL[i.direction] || 'connects to'}</span>
                      <strong>{i.targetSystemName || <span style={{ color: '#92400e' }}>(target not set)</span>}</strong>
                      {meta(i.interfaceType, i.frequency)}
                    </div>
                  ))}
                  {referenced.map((r, idx) => (
                    <div key={`r${idx}`} style={rowStyle}>
                      <span style={{ color: 'var(--color-text-muted)' }}>{INVERSE_DIRECTION_LABEL[r.direction] || 'connects to'}</span>
                      <strong>{r.systemName}</strong>
                      {meta(r.interfaceType, r.frequency)}
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>(declared elsewhere)</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Discussion
              </h3>
              <CommentsPanel
                entityType="System"
                entityId={systemId}
                entityLabel={`System: ${data.system.name}`}
              />
            </div>
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                History
              </h3>
              <ActivityFeed entityType="System" entityId={systemId} inline initialRows={5} />
            </div>
          </>
        )}
          </>
        )}
    </>
  );

  if (asPage) {
    // ── Derived header + impact values (read view) ──
    const s = data?.system;
    const connCount = data?.linkedConnections.length ?? 0;
    const assetCount = data?.assetsHere.length ?? 0;
    const actCount = data?.dependentActivities.length ?? 0;
    const peopleCount = data
      ? (data.ownership.owner?.name ? 1 : 0) + (data.ownership.deputy?.name ? 1 : 0) + data.ownership.custodians.length
      : 0;
    const conn = s?.connectivity || 'INTEGRATED';
    const noConn = connCount === 0;
    const typePlain = s?.systemType === 'OT' ? 'Operational' : s?.systemType === 'IT' ? 'Business IT' : '';
    // Connectivity pill — an integrated system with no connection is the
    // case worth flagging (amber); otherwise a plain state.
    const connPill = conn === 'INTEGRATED' && noConn
      ? { label: 'Integrated, not connected', bg: '#FBE9D9', color: '#9A4A0E' }
      : conn === 'INTEGRATED'
        ? { label: 'Connected', bg: '#DCEFE5', color: '#17604B' }
        : conn === 'MANUAL'
          ? { label: 'Manual', bg: '#eef1f4', color: '#5b6b7b' }
          : { label: 'Vendor-managed', bg: '#ede9fe', color: '#5b21b6' };
    const pill = (bg: string, color: string): CSSProperties => ({
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px',
      borderRadius: 13, background: bg, color, fontSize: 13, fontWeight: 600,
    });
    const factRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--color-border)', fontSize: 14, alignItems: 'center' };
    const assignLink: CSSProperties = { color: 'var(--color-primary)', fontWeight: 600, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'none' };
    const card: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20 };
    const sectionH: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 600 };
    const healthFor = (hs: number | null | undefined) =>
      typeof hs === 'number' && hs > 0 ? `${hs}% health` : noConn ? 'Not measured: no connection' : 'Not measured';
    const startEdit = () => { setTab('overview'); m.enter(); };

    return (
      <div>
        <PageHeader
          kicker="System"
          title={s?.name || 'Loading…'}
          copyId={s?.id}
          copyLabel="Copy system ID"
          meta={s ? (
            <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
              {s.systemType && (
                <span style={pill('#E5ECF3', '#364A5E')} title={s.systemType === 'OT' ? 'Operational technology: controls or monitors physical equipment' : s.systemType === 'IT' ? 'Business IT system' : undefined}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.systemType}</span>{typePlain}
                </span>
              )}
              <span style={pill(connPill.bg, connPill.color)}><span style={{ width: 7, height: 7, borderRadius: 4, background: connPill.color }} />{connPill.label}</span>
            </span>
          ) : undefined}
          actions={<>
            <button type="button" onClick={() => navigate('/systems')} style={backLinkStyle}>{'←'} Back to Systems</button>
            {!m.isEditing && canWrite && conn === 'INTEGRATED' && noConn && (
              <button type="button" onClick={() => navigate('/systems?tab=connections')} style={backLinkStyle}>Connect</button>
            )}
            {editActions}
            {!m.isEditing && canWrite && onEditFull && (
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={headerMenu} onClick={(e) => { e.stopPropagation(); setHeaderMenu((v) => !v); }} style={{ width: 40, height: 40, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
                {headerMenu && (
                  <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 44, right: 0, zIndex: 30, minWidth: 240, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                    <button type="button" role="menuitem" onClick={() => { setHeaderMenu(false); onEditFull(); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 13, color: 'var(--color-text)', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Edit integrations, custodians &amp; connections…</button>
                  </div>
                )}
              </span>
            )}
          </>}
        />

        {loading && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0' }}>Loading…</div>}
        {error && <div style={{ fontSize: 13, color: 'var(--color-error)', padding: '12px 0' }}>{error}</div>}

        {!loading && !error && data && s && (
          m.isEditing ? (
            <div style={{ ...card, marginTop: 8 }}>{editForm}</div>
          ) : (
            <>
              {s.description && <p style={{ margin: '4px 0 12px', color: 'var(--color-text-secondary)', maxWidth: 720, lineHeight: 1.5 }}>{s.description}</p>}

              {/* Tabs */}
              <nav aria-label="System sections" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', marginBottom: 20 }}>
                {([['overview', 'Where used'], ['discussion', 'Discussion'], ['history', 'History']] as const).map(([key, label]) => {
                  const on = tab === key;
                  return (
                    <button key={key} type="button" onClick={() => setTab(key)} aria-current={on ? 'page' : undefined}
                      style={{ padding: '10px 14px', fontSize: 14, border: 0, background: 'transparent', cursor: 'pointer', fontWeight: on ? 600 : 500, color: on ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: `2px solid ${on ? 'var(--color-primary)' : 'transparent'}`, marginBottom: -1 }}>
                      {label}
                    </button>
                  );
                })}
              </nav>

              {tab === 'discussion' && <CommentsPanel entityType="System" entityId={systemId} entityLabel={`System: ${s.name}`} />}
              {tab === 'history' && <ActivityFeed entityType="System" entityId={systemId} inline initialRows={20} />}

              {tab === 'overview' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
                  <main style={{ flex: '999 1 540px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Impact summary */}
                    <section aria-label="Impact summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                      {[
                        { label: 'Connections', value: connCount, warn: connCount === 0 },
                        { label: 'Data assets', value: assetCount },
                        { label: 'Dependent activities', value: actCount },
                        { label: 'Accountable people', value: peopleCount },
                      ].map((k) => (
                        <div key={k.label} style={{ ...card, padding: '14px 16px' }}>
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>{k.label}</span>
                          <span style={{ display: 'block', fontSize: 24, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: k.warn ? '#9A4A0E' : 'var(--color-text)' }}>{k.value}</span>
                        </div>
                      ))}
                    </section>

                    {/* Connections */}
                    <section style={card}>
                      <h2 style={sectionH}>Connections</h2>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>How Procela reads data from this system.</p>
                      {connCount === 0 ? (
                        <div style={{ marginTop: 14, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', background: 'var(--color-bg)' }}>
                          <div style={{ maxWidth: 560 }}>
                            <div style={{ fontWeight: 600 }}>No connection yet</div>
                            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                              {conn === 'INTEGRATED'
                                ? `${s.name} is marked as integrated, but nothing is linked, so the health of its ${assetCount} data asset${assetCount === 1 ? '' : 's'} can't be measured.`
                                : `${s.name} is ${conn === 'MANUAL' ? 'updated manually' : 'vendor-managed'}, so a live connection isn't expected.`}
                            </div>
                          </div>
                          {canWrite && conn === 'INTEGRATED' && (
                            <button type="button" onClick={() => navigate('/systems?tab=connections')} style={{ height: 40, padding: '0 16px', border: 0, background: 'var(--color-primary)', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Connect {s.name}</button>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                          {data.linkedConnections.map((c) => (
                            <button key={c.id} type="button" onClick={() => navigate(`/connections/${c.id}`)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', textAlign: 'left' }}>
                              <span style={{ fontWeight: 600 }}>{c.name}</span>
                              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{[c.connectionType, c.status].filter(Boolean).join(' · ')}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Data assets here */}
                    <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '20px 20px 12px' }}>
                        <h2 style={sectionH}>Data assets here <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>{assetCount}</span></h2>
                        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>Assets registered as living in this system.</p>
                      </div>
                      {assetCount === 0 ? (
                        <div style={{ padding: '0 20px 20px', fontSize: 13, color: 'var(--color-text-muted)' }}>No assets registered in this system yet.</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 14 }}>
                            <thead><tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              <th style={{ padding: '10px 20px', fontWeight: 600, borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>Asset</th>
                              <th style={{ padding: '10px 12px', fontWeight: 600, borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>Tier</th>
                              <th style={{ padding: '10px 20px 10px 12px', fontWeight: 600, borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>Health</th>
                            </tr></thead>
                            <tbody>
                              {data.assetsHere.map((a) => {
                                const tc = TIER_COLORS[tierKey(a.governanceTier)];
                                return (
                                  <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '12px 20px' }}>
                                      <button type="button" onClick={() => navigate(`/data-assets/${a.id}`)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text)', fontWeight: 600, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>{a.name}</button>
                                    </td>
                                    <td style={{ padding: '12px' }}>
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        {a.governanceTier
                                          ? <span style={pill(tc.bg, tc.color)}><span style={{ width: 7, height: 7, borderRadius: 4, background: tc.color }} />{tierLabel(a.governanceTier)}</span>
                                          : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                                        <CertifiedBadge compact status={a.certificationStatus} certifiedUntil={a.certifiedUntil} />
                                      </span>
                                    </td>
                                    <td style={{ padding: '12px 20px 12px 12px', color: 'var(--color-text-muted)', fontSize: 13 }}>{healthFor(a.healthScore)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    {/* Dependent activities */}
                    <section style={card}>
                      <h2 style={sectionH}>Dependent activities <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>{actCount}</span></h2>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>Process steps that would be affected if {s.name} went down.</p>
                      {actCount === 0 ? (
                        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-muted)' }}>No process activities depend on this system yet.</div>
                      ) : (
                        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                          {data.dependentActivities.map((act, i) => (
                            <li key={act.id} style={{ padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}>
                              <button type="button" onClick={() => navigate(`/processes?highlight=${encodeURIComponent(act.id)}`)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text)', fontWeight: 600, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>{act.name}</button>
                              {act.path !== act.name && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{act.path}</div>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </main>

                  {/* Facts rail */}
                  <aside style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <section style={card}>
                      <SectionLabel style={{ marginBottom: 2 }}>Facts</SectionLabel>
                      <dl style={{ margin: 0 }}>
                        <div style={{ ...factRow, borderTop: 'none' }}>
                          <dt style={{ color: 'var(--color-text-muted)' }}>Owner</dt>
                          <dd style={{ margin: 0 }}>
                            {data.ownership.owner?.name
                              ? <button type="button" onClick={() => navigate(`/people/${data.ownership.owner!.id}`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text)', fontWeight: 500 }}><Avatar name={data.ownership.owner.name} size="sm" />{data.ownership.owner.name}</button>
                              : <button type="button" onClick={startEdit} style={assignLink}>Assign</button>}
                          </dd>
                        </div>
                        <div style={factRow}>
                          <dt style={{ color: 'var(--color-text-muted)' }}>Deputy owner</dt>
                          <dd style={{ margin: 0 }}>{data.ownership.deputy?.name
                            ? <button type="button" onClick={() => navigate(`/people/${data.ownership.deputy!.id}`)} style={{ ...assignLink, color: 'var(--color-text)', fontWeight: 500 }}>{data.ownership.deputy.name}</button>
                            : <button type="button" onClick={startEdit} style={assignLink}>Assign</button>}</dd>
                        </div>
                        <div style={factRow}>
                          <dt style={{ color: 'var(--color-text-muted)' }}>Custodians</dt>
                          <dd style={{ margin: 0, textAlign: 'right' }}>{data.ownership.custodians.length > 0
                            ? data.ownership.custodians.map((c) => c.name).join(', ')
                            : (onEditFull ? <button type="button" onClick={onEditFull} style={assignLink}>Add custodian</button> : <span style={{ color: 'var(--color-text-muted)' }}>None</span>)}</dd>
                        </div>
                        <div style={factRow}>
                          <dt style={{ color: 'var(--color-text-muted)' }}>Criticality</dt>
                          <dd style={{ margin: 0 }}>{s.businessCriticality
                            ? <span style={{ fontWeight: 500 }}>{s.businessCriticality.charAt(0) + s.businessCriticality.slice(1).toLowerCase()}</span>
                            : <button type="button" onClick={startEdit} style={assignLink}>Set criticality</button>}</dd>
                        </div>
                        <div style={factRow}>
                          <dt style={{ color: 'var(--color-text-muted)' }}>Type</dt>
                          <dd style={{ margin: 0 }}>{s.systemType ? `${s.systemType}${typePlain ? ` · ${typePlain}` : ''}` : <button type="button" onClick={startEdit} style={assignLink}>Set type</button>}</dd>
                        </div>
                        <div style={factRow}>
                          <dt style={{ color: 'var(--color-text-muted)' }}>Connectivity</dt>
                          <dd style={{ margin: 0, textAlign: 'right' }}>{conn === 'INTEGRATED' ? 'Integrated' : conn === 'MANUAL' ? 'Manual' : 'Vendor-managed'}
                            {conn === 'INTEGRATED' && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>Expected to have a live link</span>}</dd>
                        </div>
                        <div style={factRow}>
                          <dt style={{ color: 'var(--color-text-muted)' }}>Vendor</dt>
                          <dd style={{ margin: 0 }}>{s.vendor || <button type="button" onClick={startEdit} style={assignLink}>Add vendor</button>}</dd>
                        </div>
                        {s.orgId && (
                          <div style={factRow}>
                            <dt style={{ color: 'var(--color-text-muted)' }}>Belongs to</dt>
                            <dd style={{ margin: 0 }}>{getOrgName(s.orgId) || '—'}</dd>
                          </div>
                        )}
                        {s.updatedAt && (
                          <div style={factRow}>
                            <dt style={{ color: 'var(--color-text-muted)' }}>Updated</dt>
                            <dd style={{ margin: 0, color: 'var(--color-text-secondary)' }} title={absoluteTime(s.updatedAt)}>{relativeTime(s.updatedAt)}</dd>
                          </div>
                        )}
                      </dl>
                    </section>
                  </aside>
                </div>
              )}
            </>
          )
        )}
      </div>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      kicker="SYSTEM"
      title={data?.system.name || 'Loading…'}
      subtitle={metaSegments.length > 0 ? metaSegments.join(' · ') : undefined}
      ariaLabel={data ? `System: ${data.system.name}` : 'System details'}
      actions={editActions}
    >
      {detailBody}
    </Modal>
  );
}
