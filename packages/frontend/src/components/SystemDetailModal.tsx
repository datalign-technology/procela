import { useEffect, useRef, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useScrollLock } from '../hooks/useScrollLock';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import WhereUsed, { WhereUsedGroup } from './WhereUsed';
import CommentsPanel from './CommentsPanel';
import ActivityFeed from './ActivityFeed';
import { useTierLabel } from '../lib/governanceTier';
import { useTerm } from '../lib/terminology';

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
}

export default function SystemDetailModal({ systemId, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, !!systemId);
  useScrollLock(!!systemId);
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
      hint: 'Process steps that consume data from this system.',
      emptyText: 'No process steps depend on this system yet.',
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

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={data ? `System: ${data.system.name}` : 'System details'}
        style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
          padding: 24, maxWidth: 720, width: '90vw', maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              System
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 0' }}>
              {data?.system.name || 'Loading…'}
            </h2>
            {data?.system && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {data.system.systemType && <span>{data.system.systemType}</span>}
                {data.system.vendor && <><span>·</span><span>{data.system.vendor}</span></>}
                {data.system.businessCriticality && <><span>·</span><span>{data.system.businessCriticality} criticality</span></>}
                {data.system.connectivity && <><span>·</span><span>{data.system.connectivity}</span></>}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 20, color: 'var(--color-text-muted)', lineHeight: 1, padding: 4,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

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
                Activity
              </h3>
              <ActivityFeed entityType="System" entityId={systemId} inline initialRows={5} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
