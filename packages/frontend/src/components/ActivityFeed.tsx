import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';

// ──────────────────────────────────────────────────────────────────────────
// ActivityFeed - a reusable timeline of audit events.
//
// Same component renders three different lenses:
//
//   Per-entity: pass entityType + entityId. Shows everything that happened
//   to that specific record - useful inside detail pages.
//
//   Personal: pass userId. Shows what one person has been up to. Used on
//   the Dashboard's "what I've been doing" panel.
//
//   Org-wide: pass neither. Shows the most recent activity across the
//   whole org. Used on the main Dashboard "Recent Activity" widget.
//
// The backend /audit endpoint enriches each row with entityName and
// userName so this component doesn't do per-row joins on the client.
// ──────────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  orgId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  timestamp: string;
  /** Server-enriched display name for the entity (null when unresolvable,
   *  e.g. the entity was deleted). */
  entityName: string | null;
  /** Server-enriched display name for the actor. */
  userName: string | null;
}

interface Props {
  /** Filter to a single entity. Provide both fields together or omit both. */
  entityType?: string;
  entityId?: string;
  /** Filter to actions taken by one person. */
  userId?: string;
  /** Hard cap on rows fetched. Default 30. */
  limit?: number;
  /** Number shown initially before "Show more". Default 5. */
  initialRows?: number;
  /** Inline shows just the list (no card / heading). Used inside detail
   *  modals which already have their own card. */
  inline?: boolean;
  title?: string;
}

export default function ActivityFeed({
  entityType, entityId, userId,
  limit = 30, initialRows = 5,
  inline = false, title = 'Recent Activity',
}: Props) {
  const { activeOrgId } = useOrgContext();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (activeOrgId) params.set('orgId', activeOrgId);
    if (entityType && entityId) { params.set('entityType', entityType); params.set('entityId', entityId); }
    if (userId) params.set('userId', userId);
    params.set('limit', String(limit));
    apiClient
      .get<{ success: boolean; data: AuditEntry[] }>(`/audit?${params.toString()}`)
      .then((res) => { if (!cancelled) setEntries(res.data || []); })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, [activeOrgId, entityType, entityId, userId, limit]);

  if (entries === null) {
    return inline ? <div style={muted}>Loading activity…</div> : null;
  }
  if (entries.length === 0) {
    return inline
      ? <div style={muted}>No activity yet.</div>
      : null;  // Dashboard hides empty feeds entirely
  }

  const visible = showAll ? entries : entries.slice(0, initialRows);
  const hasMore = entries.length > initialRows;

  const list = (
    <div style={inline
      ? {}
      : { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }
    }>
      {visible.map((e) => (
        <Row key={e.id} entry={e} hideEntityName={!!(entityType && entityId)} />
      ))}
      {hasMore && (
        <button
          onClick={() => setShowAll((v) => !v)}
          style={{
            width: '100%', textAlign: 'center', padding: '6px 0',
            background: 'transparent', border: 'none',
            color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12,
            borderTop: '1px solid var(--color-border)',
          }}
        >
          {showAll ? 'Show less' : `Show ${entries.length - initialRows} more`}
        </button>
      )}
    </div>
  );

  if (inline) return list;

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{title}</h2>
      {list}
    </div>
  );
}

// ── Single row ──────────────────────────────────────────────────────────

function Row({ entry, hideEntityName }: { entry: AuditEntry; hideEntityName: boolean }) {
  const action = entry.action.toUpperCase();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px', borderBottom: '1px solid var(--color-border)', fontSize: 12,
    }}>
      <span
        title={action}
        style={{
          width: 20, height: 20, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
          background: actionColor(action) + '18', color: actionColor(action),
        }}
      >
        {actionIcon(action)}
      </span>
      <span style={{ flex: 1, color: 'var(--color-text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {entry.userName && <><strong>{entry.userName}</strong> </>}
        <span style={{ color: 'var(--color-text-muted)' }}>{verbFor(action, entry.entityType)}</span>
        {!hideEntityName && entry.entityName && (
          <> <strong>{entry.entityName}</strong></>
        )}
        {entry.entityName === null && (
          <> <span style={{ color: 'var(--color-text-muted)' }}>({prettyEntityType(entry.entityType)})</span></>
        )}
      </span>
      <span title={new Date(entry.timestamp).toLocaleString()}
            style={{ color: 'var(--color-text-muted)', fontSize: 11, flexShrink: 0 }}>
        {timeAgo(entry.timestamp)}
      </span>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

const muted: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-muted)' };

function actionIcon(action: string): string {
  if (action === 'CREATE') return '+';
  if (action === 'UPDATE') return '~';
  if (action === 'DELETE') return '×';
  return '•';
}

function actionColor(action: string): string {
  if (action === 'CREATE') return '#16a34a';
  if (action === 'UPDATE') return '#2563eb';
  if (action === 'DELETE') return '#dc2626';
  return '#64748b';
}

/** Phrase the action as a plain-English verb so the row reads like a
 *  sentence: "Eleanor created System SAP Finance". */
function verbFor(action: string, entityType: string): string {
  const ent = prettyEntityType(entityType).toLowerCase();
  if (entityType.toLowerCase() === 'comment') {
    if (action === 'CREATE') return 'commented on';
    if (action === 'UPDATE') return 'edited a';
    if (action === 'DELETE') return 'deleted a';
  }
  if (action === 'CREATE') return `created ${ent}`;
  if (action === 'UPDATE') return `updated ${ent}`;
  if (action === 'DELETE') return `deleted ${ent}`;
  return `${action.toLowerCase()} ${ent}`;
}

function prettyEntityType(entityType: string): string {
  // GovernanceProgram -> Governance Program
  return entityType.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
