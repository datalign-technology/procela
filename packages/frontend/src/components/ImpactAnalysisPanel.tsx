import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import SectionLabel from './SectionLabel';

// ──────────────────────────────────────────────────────────────────────────
// ImpactAnalysisPanel — "if this asset changes, what breaks and who
// needs to know?" Sits on the Data Asset 360 modal.
//
// Reads from GET /data-assets/:id/impact which walks the mapping →
// process → people chain server-side so we don't reproduce that
// logic on both sides of the wire.
//
// Two rows:
//   1. Summary tiles — activity count, process count, value stream
//      count, people-to-notify count. Read-at-a-glance for the
//      "how big is the blast radius" question.
//   2. Detail — expandable activity list + a people-to-notify list
//      with role provenance ("Susan Chen — Domain owner (Customer
//      Data), Responsible on Outage triage").
// ──────────────────────────────────────────────────────────────────────────

interface Activity {
  id: string;
  name: string;
  breadcrumb: string;
  valueStream: string | null;
  process: string | null;
  linkType: string;
  owner: { id: string; name: string } | null;
  responsible: { id: string; name: string } | null;
}

interface PersonNotify {
  id: string;
  name: string;
  roles: string[];
}

interface ImpactData {
  summary: {
    activityCount: number;
    processCount: number;
    valueStreamCount: number;
    peopleCount: number;
  };
  activities: Activity[];
  people: PersonNotify[];
  domain: { id: string; name: string; owner: { id: string; name: string } | null } | null;
}

interface Props {
  assetId: string;
  onNavigateToActivity?: (nodeId: string) => void;
  onNavigateToPerson?: (personId: string) => void;
}

export default function ImpactAnalysisPanel({ assetId, onNavigateToActivity, onNavigateToPerson }: Props) {
  const [data, setData] = useState<ImpactData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDetails, setExpandedDetails] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<{ success: boolean; data: ImpactData }>(`/data-assets/${assetId}/impact`)
      .then((res) => setData(res.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [assetId]);

  if (loading) {
    return (
      <div style={{
        marginBottom: 20, padding: 14,
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        background: 'var(--color-surface)',
        fontSize: 12,
        color: 'var(--color-text-muted)',
      }}>
        Analysing impact…
      </div>
    );
  }

  if (!data) return null;

  const { summary, activities, people } = data;

  const tile = (label: string, value: number, color: string) => (
    <div style={{
      flex: 1, minWidth: 100,
      padding: '10px 12px',
      background: 'var(--color-bg)',
      borderRadius: 4,
      borderLeft: `3px solid ${color}`,
    }}>
      <div style={{
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--color-text-muted)', fontWeight: 600,
      }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 600,
        color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums',
        marginTop: 2,
      }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      marginBottom: 20, padding: 14,
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      background: 'var(--color-surface)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 10, gap: 12,
      }}>
        <div>
          <SectionLabel marginBottom={0}>Impact analysis</SectionLabel>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
            If this asset changes, retires, or fails — this is what breaks and who to tell.
          </div>
        </div>
        {(activities.length > 0 || people.length > 0) && (
          <button
            onClick={() => setExpandedDetails(!expandedDetails)}
            style={{
              padding: '3px 10px', fontSize: 11,
              background: 'transparent',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {expandedDetails ? 'Hide details' : 'Show details'}
          </button>
        )}
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: expandedDetails ? 14 : 0 }}>
        {tile('Activities', summary.activityCount, '#0f4f46')}
        {tile('Processes', summary.processCount, '#92400e')}
        {tile('Value streams', summary.valueStreamCount, '#5b21b6')}
        {tile('Notify', summary.peopleCount, '#dc2626')}
      </div>

      {expandedDetails && (
        <>
          {/* Affected activities */}
          {activities.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <SectionLabel marginBottom={6}>
                Affected activities ({activities.length})
              </SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activities.map((a) => (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    background: 'var(--color-bg)',
                  }}>
                    <button
                      onClick={() => onNavigateToActivity?.(a.id)}
                      disabled={!onNavigateToActivity}
                      title={a.breadcrumb}
                      style={{
                        background: 'transparent', border: 'none',
                        color: onNavigateToActivity ? 'var(--color-primary)' : 'var(--color-text)',
                        cursor: onNavigateToActivity ? 'pointer' : 'default',
                        padding: 0, fontSize: 13, fontWeight: 500,
                        textAlign: 'left', minWidth: 0, flexShrink: 1,
                      }}
                    >{a.name}</button>
                    <span style={{
                      fontSize: 10, color: 'var(--color-text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      padding: '1px 6px', background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)', borderRadius: 3,
                    }}>{a.linkType}</span>
                    <span style={{
                      fontSize: 11, color: 'var(--color-text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', flex: 1,
                    }}>
                      {a.breadcrumb}
                    </span>
                    {a.responsible && (
                      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                        {a.responsible.name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* People to notify */}
          {people.length > 0 && (
            <div>
              <SectionLabel marginBottom={6}>
                Notify ({people.length})
              </SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {people.map((p) => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 8px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    background: 'var(--color-bg)',
                  }}>
                    <button
                      onClick={() => onNavigateToPerson?.(p.id)}
                      disabled={!onNavigateToPerson}
                      style={{
                        background: 'transparent', border: 'none',
                        color: onNavigateToPerson ? 'var(--color-primary)' : 'var(--color-text)',
                        cursor: onNavigateToPerson ? 'pointer' : 'default',
                        padding: 0, fontSize: 13, fontWeight: 500,
                        textAlign: 'left', flexShrink: 0,
                      }}
                    >{p.name}</button>
                    <span style={{
                      fontSize: 11, color: 'var(--color-text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {p.roles.join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activities.length === 0 && people.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', textAlign: 'center', padding: 8 }}>
              Nothing consumes or produces this asset. Change is safe — nobody to notify.
            </div>
          )}
        </>
      )}
    </div>
  );
}
