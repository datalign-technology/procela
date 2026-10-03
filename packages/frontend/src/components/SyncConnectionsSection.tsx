import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { relativeTime, absoluteTime } from '../lib/relativeTime';

// Settings → Integrations → Directory & data sync panel. A read-only status
// view over every sync connection for the active org: what it imports, the
// source, its schedule, when it last ran and when it next runs, plus a
// "Sync now" trigger. Connections are *created* in the Sync wizard launched
// from the Organizations / People / Systems / Business Glossary pages; this
// panel is the single place to see them all and their freshness.

interface SyncConnectionRow {
  id: string;
  orgId: string;
  name: string;
  targetEntity: 'organizations' | 'people' | 'systems' | 'business-glossary';
  sourceType: 'DATABASE' | 'CSV_URL' | 'JSON_URL';
  executionMode?: 'DIRECT' | 'AGENT';
  config: { dbType?: string };
  schedule: {
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
  };
  status: 'ACTIVE' | 'PAUSED' | 'ERROR';
  lastSyncResult: {
    timestamp: string;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    errorMessages: string[];
  } | null;
}

const TARGET_LABELS: Record<SyncConnectionRow['targetEntity'], string> = {
  'organizations': 'Organizations',
  'people': 'People',
  'systems': 'Systems',
  'business-glossary': 'Business Glossary',
};

const DB_LABELS: Record<string, string> = {
  POSTGRESQL: 'PostgreSQL', MYSQL: 'MySQL', SQLSERVER: 'SQL Server', ORACLE: 'Oracle',
};

const STATUS_STYLES: Record<SyncConnectionRow['status'], { bg: string; color: string; label: string; title: string }> = {
  ACTIVE: { bg: '#dcfce7', color: '#166534', label: 'Active', title: 'Enabled and running on schedule' },
  PAUSED: { bg: '#f3f4f6', color: '#4b5563', label: 'Paused', title: 'Paused — the scheduler skips this connection' },
  ERROR:  { bg: '#fee2e2', color: '#991b1b', label: 'Error',  title: 'The last run failed — see the result for details' },
};

function sourceLabel(r: SyncConnectionRow): string {
  const agent = (r.executionMode || 'DIRECT') === 'AGENT' ? ' · agent' : '';
  if (r.sourceType === 'DATABASE') return `${DB_LABELS[r.config.dbType || ''] || 'Database'}${agent}`;
  if (r.sourceType === 'CSV_URL') return 'CSV URL';
  return 'JSON URL';
}

function intervalLabel(minutes: number): string {
  if (!minutes || minutes <= 0) return '—';
  if (minutes % 1440 === 0) { const d = minutes / 1440; return `${d} day${d === 1 ? '' : 's'}`; }
  if (minutes % 60 === 0) { const h = minutes / 60; return `${h}h`; }
  return `${minutes} min`;
}

function scheduleLabel(r: SyncConnectionRow): string {
  return r.schedule.enabled ? `Every ${intervalLabel(r.schedule.intervalMinutes)}` : 'Manual only';
}

// Future-facing relative time for the next scheduled run ("in 3 hr").
// The shared relativeTime() clamps the future to "just now", so next-sync
// needs its own forward formatter.
function untilTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diffSec = Math.floor((then - now) / 1000);
  if (diffSec <= 0) return 'due now';
  if (diffSec < 60) return 'in <1 min';
  if (diffSec < 3600) return `in ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `in ${Math.floor(diffSec / 3600)} hr`;
  const days = Math.floor(diffSec / 86400);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

function StatusChip({ status }: { status: SyncConnectionRow['status'] }) {
  const s = STATUS_STYLES[status];
  return (
    <span title={s.title} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function resultSummary(r: SyncConnectionRow['lastSyncResult']): string | null {
  if (!r) return null;
  const parts: string[] = [];
  if (r.created) parts.push(`${r.created} added`);
  if (r.updated) parts.push(`${r.updated} updated`);
  if (r.skipped) parts.push(`${r.skipped} skipped`);
  if (r.errors) parts.push(`${r.errors} error${r.errors === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'no changes';
}

export default function SyncConnectionsSection({ sectionStyle, sectionTitleStyle }: {
  sectionStyle: React.CSSProperties;
  sectionTitleStyle: React.CSSProperties;
}) {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const [rows, setRows] = useState<SyncConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: SyncConnectionRow[] }>(`/sync-connections${query}`);
      setRows(res.data || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load sync connections.'));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const runNow = async (r: SyncConnectionRow) => {
    setRunningId(r.id);
    try {
      const res = await apiClient.post<{ success: boolean; data?: { created: number; updated: number; skipped: number; errors: number }; error?: string }>(`/sync-connections/${r.id}/run`, {});
      if (res.success && res.data) {
        const d = res.data;
        addToast('success', `Synced "${r.name}": ${d.created} added · ${d.updated} updated${d.errors ? ` · ${d.errors} error${d.errors === 1 ? '' : 's'}` : ''}`);
      } else {
        addToast('error', res.error || `Sync of "${r.name}" reported a problem`);
      }
      await load();
    } catch (err) {
      addToast('error', errorMessage(err, `Failed to sync "${r.name}"`));
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
        <div>
          <h2 style={sectionTitleStyle}>Directory &amp; data sync</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            Scheduled imports that keep your organizations, people, systems and glossary in step with an external source
            (a SQL database, or a CSV/JSON URL). Set one up from the <strong>Sync</strong> action on the Organizations,
            People, Systems or Business Glossary pages; refresh happens automatically on each connection's schedule, and
            you can trigger a run here any time.
          </p>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 4, padding: '6px 10px', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 0' }}>
          No sync connections yet. Use the <strong>Sync</strong> action on the Organizations, People, Systems or
          Business Glossary pages to import from a database or a CSV/JSON URL.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>Imports</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>Source</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>Schedule</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>Last synced</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>Next sync</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '6px 4px', fontWeight: 500 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isAgent = (r.executionMode || 'DIRECT') === 'AGENT';
                const summary = resultSummary(r.lastSyncResult);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <td style={{ padding: '8px 4px', fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: '8px 4px', color: 'var(--color-text-secondary)' }}>{TARGET_LABELS[r.targetEntity]}</td>
                    <td style={{ padding: '8px 4px', color: 'var(--color-text-muted)' }}>{sourceLabel(r)}</td>
                    <td style={{ padding: '8px 4px', color: 'var(--color-text-muted)' }}>{scheduleLabel(r)}</td>
                    <td style={{ padding: '8px 4px', color: 'var(--color-text-muted)' }}>
                      <span title={absoluteTime(r.schedule.lastRunAt)}>{relativeTime(r.schedule.lastRunAt)}</span>
                      {summary && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{summary}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 4px', color: 'var(--color-text-muted)' }}>
                      {r.schedule.enabled ? <span title={absoluteTime(r.schedule.nextRunAt)}>{untilTime(r.schedule.nextRunAt)}</span> : '—'}
                    </td>
                    <td style={{ padding: '8px 4px' }}><StatusChip status={r.status} /></td>
                    <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                      {isAgent ? (
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }} title="This sync runs on an on-prem connector and is triggered by the agent, not a direct run.">on-prem connector</span>
                      ) : (
                        <button
                          onClick={() => runNow(r)}
                          disabled={runningId === r.id}
                          style={{ padding: '5px 12px', fontSize: 12, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: runningId === r.id ? 'default' : 'pointer', fontWeight: 500, opacity: runningId === r.id ? 0.6 : 1 }}
                        >
                          {runningId === r.id ? 'Syncing…' : 'Sync now'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
