import { useEffect, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useScrollLock } from '../hooks/useScrollLock';
import { useNavigate, Link } from 'react-router-dom';
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
import { useTierLabel } from '../lib/governanceTier';
import { useTerm } from '../lib/terminology';

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
  assetsHere: { id: string; name: string; governanceTier?: string; healthScore?: number | null }[];
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
  const [data, setData] = useState<SystemThreeSixty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const detailBody = (
    <>
        {/* Edit mode replaces the read-only 360 with the system's own fields;
            the relationships (where-used, integrations, discussion, history)
            are read-only context and hidden while editing. */}
        {m.isEditing && data ? (
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
                style={{
                  marginTop: 14, background: 'none', border: 'none', padding: 0,
                  color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Edit integrations, custodians &amp; connections…
              </button>
            )}
          </>
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
    return (
      <div>
        <PageHeader
          kicker="SYSTEM"
          title={data?.system.name || 'Loading…'}
          copyId={data?.system.id}
          copyLabel="Copy system ID"
          subtitle={metaSegments.length > 0 ? metaSegments.join(' · ') : undefined}
          actions={<>
            {editActions}
            <Link to="/systems" style={backLinkStyle}>{'←'} Back to Systems</Link>
          </>}
        />
        {detailBody}
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
